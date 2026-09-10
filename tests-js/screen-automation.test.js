import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  matchBiome,
  ScreenAutomation,
} from "../src/server/screen-automation.js";

test("biome OCR matching uses the 70% threshold and tolerates OCR errors", () => {
  assert.equal(matchBiome("v4.958\n[SNOWY]\n[NIGHTTIME]").biome, "Snowy");
  assert.equal(matchBiome("[SAND ST0RM]").biome, "Sandstorm");
  assert.equal(matchBiome("C0RRUPTION").biome, "Corruption");
  assert.equal(matchBiome("CORRUPTXYZ").confidence, 0.7);
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
  assert.equal(automation.snapshot().biomeText, "[GL1TCHED]");
  assert.equal(automation.snapshot().biomeFresh, true);
  child.stdout.write(
    `${JSON.stringify({ kind: "scan", biomeText: "PLAY", playFound: true, at: now })}\n`,
  );
  assert.equal(automation.snapshot().message, "Play screen detected.");
  assert.equal(automation.snapshot().playVisible, true);
  assert.equal(automation.snapshot().playAt, now);
  now += 15001;
  assert.equal(automation.snapshot().biome, "Glitched");
  assert.equal(automation.snapshot().biomeFresh, false);
  child.stdout.write(
    `${JSON.stringify({ kind: "scan", biomeText: "unreadable", at: now })}\n`,
  );
  assert.equal(automation.snapshot().biome, "Glitched");
  assert.equal(
    automation.snapshot().message,
    "Reading the maximized Roblox window.",
  );
  automation.stop();
  assert.equal(child.killed, true);
  assert.equal(automation.snapshot().biome, "Glitched");
});
