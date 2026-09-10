import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FeedbackCollector } from "../src/server/feedback.js";
import { Store } from "../src/server/store.js";

test("biome outcomes persist with graph evidence and can be changed or unmarked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "solseer-feedback-"));
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
    const collector = new FeedbackCollector(directory);
    const rare = store.feedbackExample(attempt.id, "rare", null, 7000);
    await collector.save(rare);
    store.setJoinOutcome(attempt.id, "rare");
    let document = JSON.parse(
      await readFile(join(directory, "biome-feedback.json"), "utf8"),
    );
    assert.equal(document.version, 1);
    assert.equal(document.examples[0].outcome, "rare");
    assert.equal(document.examples[0].signal.growth10s, 4);
    assert.deepEqual(
      document.examples[0].observations.map((point) => point.players),
      [13, 17],
    );
    assert.equal(store.joins()[0].outcome, "rare");

    const current = {
      capacity: 20,
      history: [
        { at: 1000, players: 13, capacity: 20, poll: 1 },
        { at: 9000, players: 20, capacity: 20, poll: 3 },
      ],
    };
    await collector.save(
      store.feedbackExample(attempt.id, "not_rare", current, 10000),
    );
    document = JSON.parse(
      await readFile(join(directory, "biome-feedback.json"), "utf8"),
    );
    assert.equal(document.examples.length, 1);
    assert.equal(document.examples[0].outcome, "not_rare");
    assert.deepEqual(
      document.examples[0].observations.map((point) => point.players),
      [13, 20],
    );

    await collector.save(
      store.feedbackExample(attempt.id, null, current, 11000),
    );
    document = JSON.parse(
      await readFile(join(directory, "biome-feedback.json"), "utf8"),
    );
    assert.deepEqual(document.examples, []);
    assert.throws(() => store.feedbackExample(attempt.id, "maybe"), {
      status: 400,
    });
    assert.throws(() => store.feedbackExample(999, "rare"), { status: 404 });
    store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
