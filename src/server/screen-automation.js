import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BIOMES, BIOME_ALIASES, normalizeBiome } from "../shared/biomes.js";

const defaultHelper = fileURLToPath(
  new URL("../../native/solseer-screen-helper.exe", import.meta.url),
);

const distance = (left, right) => {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++)
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + Number(left[i - 1] !== right[j - 1]),
      );
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
};

const similarity = (left, right) =>
  left || right
    ? 1 - distance(left, right) / Math.max(left.length, right.length)
    : 1;

const BIOME_MATCH_THRESHOLD = 0.7;

export function biomeCandidate(text) {
  const lines = String(text ?? "")
    .split(/[\r\n]+/)
    .map(normalizeBiome)
    .filter((line) => line.length >= 3 && line.length <= 32);
  let best = null;
  for (const biome of BIOMES) {
    const variants = [biome, ...(BIOME_ALIASES[biome] ?? [])].map(
      normalizeBiome,
    );
    for (const line of lines) {
      for (const variant of variants) {
        const score =
          line === variant
            ? 1
            : line.includes(variant)
              ? 0.96
              : variant.includes(line) && line.length >= 4
                ? 0.82
                : similarity(line, variant);
        if (!best || score > best.confidence)
          best = { biome, confidence: score };
      }
    }
  }
  return best;
}

export function matchBiome(text) {
  const best = biomeCandidate(text);
  return best?.confidence >= BIOME_MATCH_THRESHOLD ? best : null;
}

export class ScreenAutomation {
  constructor({
    helperPath = defaultHelper,
    platform = process.platform,
    spawnFn = spawn,
    now = Date.now,
  } = {}) {
    this.helperPath = helperPath;
    this.platform = platform;
    this.spawnFn = spawnFn;
    this.now = now;
    this.enabled = true;
    this.autoStart = false;
    this.child = null;
    this.buffer = "";
    this.onUpdate = () => {};
    this.state = {
      supported: platform === "win32" && existsSync(helperPath),
      enabled: true,
      autoStart: false,
      resolution: "1440p",
      status: "starting",
      message: "Biome OCR is starting.",
      biome: null,
      biomeConfidence: null,
      biomeText: null,
      biomeAt: null,
      playVisible: false,
      playAt: null,
      lastScanAt: null,
      scanBiome: null,
      scanConfidence: null,
      scanAccepted: false,
      matchThreshold: BIOME_MATCH_THRESHOLD,
      lastAutoStartAt: null,
    };
  }

  configure(preferences) {
    const resolution = preferences?.ocrResolution ?? "1440p";
    const resolutionChanged = resolution !== this.state.resolution;
    const autoStart = Boolean(preferences?.autoStart);
    const autoStartChanged = autoStart !== this.autoStart;
    this.autoStart = autoStart;
    this.state = {
      ...this.state,
      enabled: true,
      autoStart,
      resolution,
    };
    if (!this.state.supported) {
      this.state = {
        ...this.state,
        status: "unsupported",
        message: "Windows OCR helper is unavailable.",
      };
    } else {
      if ((resolutionChanged || autoStartChanged) && this.child) this.stop();
      if (!this.child) this.start();
    }
    this.onUpdate();
  }

  start() {
    if (!this.state.supported || this.child) return;
    const child = this.spawnFn(
      this.helperPath,
      [
        this.state.resolution,
        this.autoStart ? "autostart" : "ocr-only",
        process.execPath,
        fileURLToPath(new URL("./tesseract-worker.js", import.meta.url)),
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.child = child;
    this.buffer = "";
    this.state = {
      ...this.state,
      status: "starting",
      message: "Starting Windows OCR.",
    };
    child.stdout?.on("data", (chunk) => {
      if (this.child === child) this.#read(chunk);
    });
    child.stderr?.on("data", () => {});
    child.on("error", () => {
      if (this.child !== child) return;
      this.state = {
        ...this.state,
        status: "error",
        message: "Windows OCR helper could not start.",
      };
      this.onUpdate();
    });
    child.on("exit", () => {
      if (this.child !== child) return;
      this.child = null;
      this.state = {
        ...this.state,
        status: "error",
        message: "Windows OCR helper stopped.",
      };
      this.onUpdate();
    });
  }

  stop() {
    const child = this.child;
    this.child = null;
    if (child && !child.killed) child.kill();
  }

  #read(chunk) {
    this.buffer = (this.buffer + chunk.toString("utf8")).slice(-65536);
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const at = Number.isFinite(event.at) ? event.at : this.now();
      if (event.kind === "status") {
        this.state = {
          ...this.state,
          status: String(event.status ?? "error"),
          message: String(event.message ?? "Windows OCR status changed."),
        };
      } else if (event.kind === "scan") {
        const candidate = biomeCandidate(event.biomeText);
        const matched =
          candidate?.confidence >= BIOME_MATCH_THRESHOLD ? candidate : null;
        this.state = {
          ...this.state,
          status: "scanning",
          message: event.clicked
            ? "Play detected and clicked."
            : event.clickAttempted
              ? "Play detected, but Windows did not accept the click."
              : event.playFound
                ? this.autoStart
                  ? "Play detected; confirming before click."
                  : "Play screen detected."
                : "Reading the maximized Roblox window.",
          biome: matched?.biome ?? this.state.biome,
          biomeSource: matched
            ? event.ocrEngine === "tesseract"
              ? "tesseract"
              : "windows_ocr"
            : this.state.biomeSource,
          biomeConfidence: matched?.confidence ?? this.state.biomeConfidence,
          biomeText: matched
            ? String(event.biomeText ?? "").slice(0, 1000)
            : this.state.biomeText,
          biomeAt: matched ? at : this.state.biomeAt,
          playVisible: event.playFound === true,
          playAt: event.playFound ? at : this.state.playAt,
          lastScanAt: at,
          scanBiome: candidate?.biome ?? null,
          scanConfidence: candidate?.confidence ?? null,
          scanAccepted: matched != null,
          lastAutoStartAt: event.clicked ? at : this.state.lastAutoStartAt,
        };
      }
      this.onUpdate();
    }
  }

  snapshot() {
    const now = this.now();
    const biomeFresh =
      this.state.status === "scanning" &&
      this.state.biomeAt != null &&
      now - this.state.biomeAt <= 15000;
    return {
      ...this.state,
      biomeFresh,
    };
  }
}
