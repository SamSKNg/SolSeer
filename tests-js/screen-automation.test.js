import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  matchBiome,
  ScreenAutomation,
} from "../src/server/screen-automation.js";

test("biome OCR matching tolerates punctuation, spacing, and small OCR errors", () => {
  assert.equal(matchBiome("v4.958\n[SNOWY]\n[NIGHTTIME]").biome, "Snowy");
  assert.equal(matchBiome("[SAND ST0RM]").biome, "Sandstorm");
  assert.equal(matchBiome("C0RRUPTION").biome, "Corruption");
  assert.equal(matchBiome("unrelated player text"), null);
});

test("biome OCR stays active with Auto-Start off and keeps the last reading", () => {
  let now = 1000;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  let spawnedArgs;
  const automation = new ScreenAutomation({
    helperPath: process.execPath,
    platform: "win32",
    spawnFn: (_path, args) => {
      spawnedArgs = args;
      return child;
    },
    now: () => now,
  });
  automation.configure({ autoStart: false, ocrResolution: "1080p" });
  assert.deepEqual(spawnedArgs, ["1080p", "ocr-only"]);
  assert.equal(automation.snapshot().enabled, true);
  assert.equal(automation.snapshot().autoStart, false);
  child.stdout.write(
    `${JSON.stringify({ kind: "scan", biomeText: "[GL1TCHED]", at: now })}\n`,
  );
  assert.equal(automation.snapshot().biome, "Glitched");
  assert.equal(automation.snapshot().biomeFresh, true);
  now += 15001;
  assert.equal(automation.snapshot().biome, "Glitched");
  assert.equal(automation.snapshot().biomeFresh, false);
  child.stdout.write(
    `${JSON.stringify({ kind: "scan", biomeText: "unreadable", zoomedOut: true, zoomPresses: 2, at: now })}\n`,
  );
  assert.equal(automation.snapshot().biome, "Glitched");
  assert.equal(automation.snapshot().zoomPresses, 2);
  assert.equal(
    automation.snapshot().message,
    "Biome unclear; zooming Roblox out.",
  );
  automation.stop();
  assert.equal(child.killed, true);
  assert.equal(automation.snapshot().biome, "Glitched");
});
