import test from "node:test";
import assert from "node:assert/strict";
import { cropBmp, recognizeBiome } from "../src/server/tesseract-biome.js";

test("BMP encoding preserves BGR pixels, row order, and padding", () => {
  const bmp = cropBmp(Buffer.from([10, 20, 30, 255, 40, 50, 60, 255]), 1, 2);
  assert.equal(bmp.toString("ascii", 0, 2), "BM");
  assert.equal(bmp.length, 62);
  assert.deepEqual([...bmp.subarray(54, 62)], [40, 50, 60, 0, 10, 20, 30, 0]);
  assert.throws(() => cropBmp(Buffer.alloc(0), 425, 32));
});

test("faint and flat channels remain safe", () => {
  const bmp = cropBmp(Buffer.from([0, 20, 0, 255, 0, 24, 0, 255]), 2, 1, 1);
  assert.deepEqual([...bmp.subarray(54, 60)], [0, 0, 0, 255, 255, 255]);
  const flat = cropBmp(Buffer.alloc(4), 1, 1, 0);
  assert.deepEqual([...flat.subarray(54, 57)], [255, 255, 255]);
});

test("Tesseract stops at the first passing channel and hides all failed reads", async () => {
  const pixels = Buffer.alloc(4, 255);
  let calls = 0;
  const worker = {
    recognize: async () => ({
      data: {
        text: ++calls === 3 ? "INCINERATOR" : "xxxxxxxxxxxxxx",
        confidence: 85,
      },
    }),
  };
  const result = await recognizeBiome(worker, pixels, 1, 1);
  assert.equal(result.channel, "green");
  assert.equal(result.text, "INCINERATOR");
  assert.equal(calls, 3);
  calls = 0;
  worker.recognize = async () => {
    calls++;
    return { data: { text: "unreadable", confidence: 40 } };
  };
  assert.equal((await recognizeBiome(worker, pixels, 1, 1)).text, "");
  assert.equal(calls, 4);
  calls = 0;
  worker.recognize = async () => {
    calls++;
    return { data: { text: "HEAVEN", confidence: 90 } };
  };
  assert.equal(
    (await recognizeBiome(worker, pixels, 1, 1)).channel,
    "original",
  );
  assert.equal(calls, 1);
});
