// Polling budgets are session-only; join history can be persisted locally.
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { DIAGNOSTIC_POLLING } from "./polling-config.js";
import { randomUUID } from "node:crypto";
import { BIOMES } from "../shared/biomes.js";

const observations = (row) =>
  (row.history ?? []).slice(-120).map(({ at, players, capacity, poll }) => ({
    at,
    players,
    capacity: capacity ?? row.capacity ?? null,
    poll: poll ?? null,
  }));

const signalEvidence = (row) => ({
  deltaPoll: row.deltaPoll ?? null,
  growth15s: row.growth15s ?? null,
  growth10s: row.growth10s ?? null,
  growthWindowMs: row.growthWindowMs ?? null,
  growthPer10s: row.growthPer10s ?? null,
  followUpConfirmed: row.followUpConfirmed ?? false,
  burstGainRetained: row.burstGainRetained ?? null,
  burstGain: row.burstMemory?.gain ?? null,
  openSlots: row.openSlots ?? null,
  peerGrowth: row.peerGrowth ?? null,
  reasons: Array.isArray(row.reasons) ? [...row.reasons] : [],
});

export class Store {
  #history = [];
  #joined = new Map();
  #attempts = [];
  #cooldownUntil = 0;
  #nextId = 1;
  #firstSessionId = 1;
  #directory;

  constructor(directory) {
    this.#directory = directory;
    if (!directory || !existsSync(join(directory, "join-history.json"))) return;
    const data = JSON.parse(
      readFileSync(join(directory, "join-history.json"), "utf8"),
    );
    if (
      data.version !== 1 ||
      !Array.isArray(data.joins) ||
      data.joins.some(
        (row) =>
          !Number.isSafeInteger(row.id) ||
          row.id < 1 ||
          typeof row.jobId !== "string" ||
          !Number.isFinite(row.at),
      )
    )
      throw new Error(
        "Invalid join history; the existing file has not been overwritten.",
      );
    this.#history = data.joins
      .map(({ joinObservations = [], joinSignal = {}, ...row }) => {
        Object.defineProperties(row, {
          joinObservations: { value: joinObservations },
          joinSignal: { value: joinSignal },
        });
        return row;
      })
      .sort((a, b) => b.at - a.at || b.id - a.id);
    for (const row of this.#history) {
      this.#nextId = Math.max(this.#nextId, row.id + 1);
      const previous = this.#joined.get(row.jobId);
      this.#joined.set(row.jobId, {
        count: (previous?.count ?? 0) + 1,
        at: Math.max(previous?.at ?? row.at, row.at),
      });
    }
    this.#firstSessionId = this.#nextId;
  }

  exportHistory() {
    return {
      version: 1,
      joins: this.#history.map((row) => ({
        ...row,
        joinObservations: row.joinObservations,
        joinSignal: row.joinSignal,
      })),
    };
  }

  #persist() {
    if (!this.#directory) return;
    mkdirSync(this.#directory, { recursive: true });
    const target = join(this.#directory, "join-history.json");
    const temporary = target + ".tmp";
    writeFileSync(temporary, JSON.stringify(this.exportHistory()), {
      mode: 0o600,
    });
    renameSync(temporary, target);
  }

  join(row, now = Date.now()) {
    const entry = {
      id: this.#nextId++,
      feedbackId: randomUUID(),
      jobId: row.id,
      at: now,
      players: row.players ?? null,
      capacity: row.capacity ?? null,
      alert: row.alert ?? null,
      signalState: row.signalState ?? null,
      growthPer10s: row.growthPer10s ?? null,
      biome: null,
      biomeConfidence: null,
      biomeDetectedAt: null,
      biomeText: null,
      biomeSource: null,
    };
    Object.defineProperty(entry, "joinObservations", {
      value: observations(row),
    });
    Object.defineProperty(entry, "joinSignal", {
      value: signalEvidence(row),
    });
    this.#history.push(entry);
    this.#history.sort((a, b) => b.at - a.at || b.id - a.id);
    const previous = this.#joined.get(row.id);
    this.#joined.set(row.id, {
      count: (previous?.count ?? 0) + 1,
      at: Math.max(previous?.at ?? now, now),
    });
    this.#persist();
    return { ...entry };
  }
  joins() {
    return this.#history.slice(0, 200).map((row) => ({ ...row }));
  }
  summary() {
    return Object.fromEntries(
      [...this.#joined].map(([id, value]) => [id, { ...value }]),
    );
  }
  recordJoinBiome(jobId, reading, observedAfter = 0) {
    if (!BIOMES.includes(reading?.biome)) return null;
    const detectedAt = Number(reading.biomeAt);
    if (!Number.isFinite(detectedAt) || detectedAt < observedAfter) return null;
    const entry = this.#history.find((row) => row.jobId === jobId);
    if (
      !entry ||
      entry.id < this.#firstSessionId ||
      entry.biome != null ||
      detectedAt < entry.at
    )
      return null;
    entry.biome = reading.biome;
    entry.biomeConfidence = Number.isFinite(reading.biomeConfidence)
      ? reading.biomeConfidence
      : null;
    entry.biomeDetectedAt = detectedAt;
    entry.biomeText = String(reading.biomeText ?? "").slice(0, 1000);
    entry.biomeSource =
      reading.biomeSource === "tesseract" ? "tesseract" : "windows_ocr";
    this.#persist();
    return { ...entry };
  }
  biomeExample(id, current, now = Date.now()) {
    const entry = this.#history.find((row) => row.id === id);
    if (!entry)
      throw Object.assign(new Error("Join attempt was not found."), {
        status: 404,
      });
    return {
      feedbackId: entry.feedbackId,
      biome: entry.biome,
      confidence: entry.biomeConfidence,
      rawText: entry.biomeText,
      source: entry.biomeSource,
      detectedAt: entry.biomeDetectedAt,
      recordedAt: now,
      join: {
        jobId: entry.jobId,
        at: entry.at,
        players: entry.players,
        capacity: entry.capacity,
        alert: entry.alert,
        signalState: entry.signalState,
        growthPer10s: entry.growthPer10s,
      },
      signal: entry.joinSignal,
      observations: current ? observations(current) : entry.joinObservations,
    };
  }
  requests(now) {
    this.#attempts = this.#attempts.filter((at) => at > now - 60000);
    return [...this.#attempts];
  }
  reserve(now, limit = null) {
    const wait = this.availableIn(now, limit);
    // Synchronous reservation is atomic within this single Node process.
    if (!wait) {
      this.#attempts.push(now);
      this.#attempts.sort((a, b) => a - b);
    }
    return wait;
  }
  availableIn(now, limit = null) {
    if (limit === null) {
      this.requests(now); // Keep the rolling usage counter bounded, not capped.
      return Math.max(0, this.#cooldownUntil - now);
    }
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > DIAGNOSTIC_POLLING.requestLimit
    )
      throw new Error("Invalid request budget");
    const sent = this.requests(now);
    return Math.max(
      0,
      this.#cooldownUntil - now,
      sent.length >= limit ? sent[sent.length - limit] + 60250 - now : 0,
    );
  }
  cooldown(until) {
    this.#cooldownUntil = Math.max(this.#cooldownUntil, until);
  }
  close() {
    this.#history = [];
    this.#joined.clear();
    this.#attempts = [];
    this.#cooldownUntil = 0;
    this.#nextId = 1;
  }
}
