import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/store.js";

test("history survives restart with evidence, labels, IDs and all attempts", () => {
  const directory = mkdtempSync(join(tmpdir(), "solseer-history-test-"));
  try {
    const store = new Store(directory);
    for (let i = 0; i < 205; i++)
      store.join(
        { id: "server", players: 3, history: [{ at: i, players: 2 }] },
        i,
      );
    store.recordJoinBiome("server", {
      biome: "Normal",
      biomeAt: 210,
      biomeConfidence: 0.8,
      biomeText: "NORMAL",
    });
    assert.equal(
      store.recordJoinBiome("server", { biome: "Normal", biomeAt: 211 }),
      null,
    );
    store.close();
    const restored = new Store(directory);
    assert.equal(restored.joins().length, 200);
    assert.equal(restored.exportHistory().joins.length, 205);
    assert.equal(restored.joins()[0].biome, "Normal");
    assert.equal(
      restored.exportHistory().joins[0].joinObservations[0].players,
      2,
    );
    assert.equal(restored.summary().server.count, 205);
    assert.equal(restored.join({ id: "next" }, 220).id, 206);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid history is not silently overwritten", () => {
  const directory = mkdtempSync(join(tmpdir(), "solseer-history-test-"));
  try {
    const path = join(directory, "join-history.json");
    writeFileSync(path, "broken");
    assert.throws(() => new Store(directory));
    assert.equal(readFileSync(path, "utf8"), "broken");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
