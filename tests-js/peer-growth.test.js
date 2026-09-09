import test from "node:test";
import assert from "node:assert/strict";
import { populationSlope, addPeerGrowth } from "../src/server/peer-growth.js";
import { compareSignals } from "../src/shared/signals.js";
import { Tracker } from "../src/server/tracker.js";
import { Store } from "../src/server/store.js";

function row(id, counts = [14, 14], times = [1000, 10000], capacity = 20) {
  return {
    id,
    capacity,
    players: counts.at(-1),
    lastSeen: times.at(-1),
    history: counts.map((players, i) => ({ players, at: times[i], capacity })),
    alert: "potential",
    signalState: "growing",
    notificationEligible: true,
    isFresh: true,
  };
}

test("endpoint slope includes flat and negative observations, uses elapsed time, never maximizes the graph", () => {
  assert.equal(populationSlope(row("flat"), 10000).per10s, 0);
  assert.equal(populationSlope(row("dip", [17, 14]), 10000).per10s, -10 / 3);
  const r = row("zigzag", [14, 17, 15], [1000, 4000, 10000]);
  assert.equal(populationSlope(r, 10000).per10s, 10 / 9);
  assert.equal(populationSlope(r, 20000).per10s, 10 / 9); // No synthetic heartbeat endpoint.
  assert.equal(populationSlope(r, 30001), null);
  assert.equal(populationSlope(row("single", [14], [1000]), 1000), null);
  assert.equal(
    populationSlope(row("duplicate", [14, 17], [1000, 1000]), 1000),
    null,
  );
  assert.equal(
    populationSlope(row("too-short", [14, 17], [1000, 3000]), 3000),
    null,
  );
  assert.equal(
    populationSlope(row("gap", [14, 17], [1000, 21001]), 21001),
    null,
  );
  const capacityChange = row("capacity", [14, 17]);
  capacityChange.history[0].capacity = 25;
  assert.equal(populationSlope(capacityChange, 10000), null);
});

test("percentiles require 20 other comparable servers and do not manufacture an alert", () => {
  const target = row("target", [14, 17]);
  const peers = Array.from({ length: 20 }, (_, i) => row(`peer-${i}`));
  addPeerGrowth([target, ...peers.slice(1)], 10000);
  assert.equal(target.peerGrowth.count, 19);
  assert.equal(target.peerGrowth.percentile, null);
  addPeerGrowth([target, ...peers], 10000);
  assert.equal(target.peerGrowth.percentile, 100);
  assert.equal(target.peerGrowth.medianPer10s, 0);
  assert.equal(target.peerGrowth.slopePer10s, 10 / 3);
  const tiny = {
    ...row("tiny", [14, 15]),
    alert: "watch",
    notificationEligible: false,
  };
  addPeerGrowth([tiny, ...peers], 10000);
  assert.equal(tiny.peerGrowth.percentile, 100);
  assert.equal(tiny.alert, "watch");
  assert.equal(tiny.notificationEligible, false);
  const flat = row("flat");
  addPeerGrowth([flat, ...peers], 10000);
  assert.equal(flat.peerGrowth.percentile, 0); // Ties aren't faster.
});

test("peer cohort matches starting population, capacity, duration and actual observation recency", () => {
  const target = row("target", [14, 18]);
  const rows = [
    target,
    row("match", [14, 14]),
    row("start-boundary", [16, 16]),
    row("end-only-match", [18, 18]),
    row("capacity", [14, 14], [1000, 10000], 25),
    row("too-short", [14, 14], [7000, 10000]),
    row("stale", [14, 14], [-23000, -14000]),
    row("return", [14, 18], [-20000, 10000]),
  ];
  addPeerGrowth(rows, 10000);
  assert.equal(target.peerGrowth.count, 2);
  assert.equal(target.peerGrowth.percentile, null);
});

test("peer ranking has a stable neutral fallback and does not override rapid tier", () => {
  const low = { ...row("low"), peerGrowth: { percentile: 10 } };
  const high = { ...row("high"), peerGrowth: { percentile: 90 } };
  const unknown = row("unknown");
  const rapid = {
    ...row("rapid"),
    alert: "cluster",
    peerGrowth: { percentile: 0 },
  };
  const expected = ["rapid", "high", "unknown", "low"];
  for (const input of [
    [low, high, unknown, rapid],
    [unknown, high, rapid, low],
    [high, low, unknown, rapid],
  ])
    assert.deepEqual(
      input.sort(compareSignals).map((r) => r.id),
      expected,
    );
});

test("tracker adds peer context without extra requests or mutating stored chart observations", async () => {
  const store = new Store();
  let now = 1000000,
    requests = 0;
  const tracker = new Tracker(store, {
    now: () => now,
    interval: 3000,
    requestLimit: 20,
    fetchFn: async () => {
      requests++;
      return new Response(
        JSON.stringify({
          data: Array.from({ length: 21 }, (_, i) => ({
            id: `server-${i}`,
            maxPlayers: 20,
            playing: i === 0 && requests > 1 ? 17 : 14,
          })),
        }),
      );
    },
  });
  try {
    await tracker.poll();
    now = tracker.nextAt;
    await tracker.poll();
    const snapshot = tracker.snapshot();
    const lead = snapshot.rows.find((r) => r.id === "server-0");
    assert.equal(lead.peerGrowth.percentile, 100);
    assert.equal(lead.notificationEligible, true);
    assert.equal(requests, 2);
    const before = JSON.stringify([...tracker.records]);
    for (let i = 0; i < 10; i++) {
      now += 1000;
      tracker.snapshot();
    }
    assert.equal(JSON.stringify([...tracker.records]), before);
    assert.equal(requests, 2);
  } finally {
    store.close();
  }
});
