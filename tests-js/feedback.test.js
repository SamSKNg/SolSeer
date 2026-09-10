import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FeedbackCollector } from "../src/server/feedback.js";
import { Store } from "../src/server/store.js";

test("post-arrival OCR biome observations persist with join and graph evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "solseer-biomes-"));
  try {
    const store = new Store();
    const attempt = store.join(
      {
        id: "job",
        players: 17,
        capacity: 20,
        alert: "cluster",
        signalState: "growing",
        growth10s: 4,
        growthPer10s: 8,
        reasons: ["+4 net players in 5s"],
        history: [
          { at: 1000, players: 13, capacity: 20, poll: 1 },
          { at: 6000, players: 17, capacity: 20, poll: 2 },
        ],
      },
      6000,
    );
    assert.equal(
      store.recordJoinBiome(
        "job",
        { biome: "Glitched", biomeAt: 6900, biomeConfidence: 0.94 },
        7000,
      ),
      null,
      "a frame captured before presence confirmed arrival is rejected",
    );
    const recorded = store.recordJoinBiome(
      "job",
      {
        biome: "Glitched",
        biomeAt: 7100,
        biomeConfidence: 0.94,
        biomeText: "[GL1TCHED]",
      },
      7000,
    );
    assert.equal(recorded.biome, "Glitched");
    assert.equal(recorded.biomeSource, "windows_ocr");
    assert.equal(
      store.recordJoinBiome("job", { biome: "Normal", biomeAt: 7200 }, 7000),
      null,
      "the first post-arrival match is immutable training evidence",
    );

    const collector = new FeedbackCollector(directory);
    await collector.save(store.biomeExample(attempt.id, null, 7300));
    const document = JSON.parse(
      await readFile(join(directory, "biome-observations.json"), "utf8"),
    );
    assert.equal(document.version, 2);
    assert.equal(document.examples[0].biome, "Glitched");
    assert.equal(document.examples[0].confidence, 0.94);
    assert.equal(document.examples[0].rawText, "[GL1TCHED]");
    assert.equal(document.examples[0].source, "windows_ocr");
    assert.equal(document.examples[0].signal.growth10s, 4);
    assert.deepEqual(
      document.examples[0].observations.map((point) => point.players),
      [13, 17],
    );
    store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
