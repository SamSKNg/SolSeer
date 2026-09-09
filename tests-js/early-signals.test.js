import test from "node:test";
import assert from "node:assert/strict";
import { score, updateSignalHold } from "../src/server/scorer.js";
import { compareSignals, signalLabel } from "../src/shared/signals.js";
import { Tracker } from "../src/server/tracker.js";
import { Store } from "../src/server/store.js";

function record(counts, times = counts.map((_, i) => i * 5000)) {
  return {
    id: "job",
    players: counts.at(-1),
    capacity: 20,
    lastSeen: times.at(-1),
    history: counts.map((players, i) => ({
      players,
      at: times[i],
      poll: i + 1,
      capacity: 20,
    })),
  };
}
function observe(r, players, at) {
  const previous = r.players;
  r.players = players;
  r.lastSeen = at;
  r.history.push({
    players,
    at,
    poll: r.history.length + 1,
    capacity: r.capacity,
  });
  updateSignalHold(r, previous, r.history.length);
  return score(r);
}

test("rapid filling requires +3 within 10 elapsed seconds and at least 13 players", () => {
  for (const [counts, times] of [
    [
      [10, 13],
      [0, 5000],
    ],
    [
      [14, 15, 17],
      [0, 5000, 10000],
    ],
    [
      [16, 19],
      [0, 10000],
    ],
  ]) {
    const result = score(record(counts, times));
    assert.equal(result.alert, "cluster");
    assert.equal(result.notificationEligible, true);
    assert.equal(result.followUpConfirmed, false); // No confirmation wait.
  }
  assert.equal(score(record([14, 17], [0, 10001])).alert, "potential");
  assert.equal(score(record([14, 17], [0, 15001])).notificationEligible, false);
  assert.equal(score(record([9, 12])).notificationEligible, false);
});

test("rates use elapsed time, window boundaries are exact, and anonymous gaps cannot imply rapid activity", () => {
  const fast = score(record([13, 17], [0, 5000]));
  const slow = score(record([13, 17], [0, 15000]));
  assert.equal(fast.alert, "cluster");
  assert.equal(slow.alert, "potential");
  assert.equal(fast.growthPer10s, 8);
  assert.ok(Math.abs(slow.growthPer10s - 8 / 3) < 0.001);
  assert.equal(score(record([11, 13], [0, 15000])).alert, "potential");
  assert.equal(score(record([11, 13], [0, 15001])).notificationEligible, false);
  assert.equal(score(record([11, 17], [0, 20500])).notificationEligible, false);
});

test("full bursts are visible missed-entry leads, not actionable notifications", () => {
  const r = record([17]);
  const full = observe(r, 20, 5000);
  assert.equal(full.alert, "potential");
  assert.equal(full.filledBurst, true);
  assert.equal(full.notificationEligible, false);
  assert.equal(signalLabel({ ...r, ...full }), "Full · recent filling");
  assert.equal(full.signalHoldPollsRemaining, 2);
  const drop = observe(r, 19, 10000);
  assert.equal(drop.alert, "potential");
  assert.equal(drop.notificationEligible, false);
  assert.equal(drop.signalHoldPollsRemaining, 1);
});

test("follow-up confirms retained population, not a biome, and never renews a hold by itself", () => {
  const r = record([13]);
  const early = observe(r, 15, 5000);
  assert.equal(early.notificationEligible, true);
  assert.equal(early.followUpConfirmed, false);
  const next = observe(r, 15, 10000);
  assert.equal(next.followUpConfirmed, true);
  assert.ok(
    next.reasons.some((reason) => reason.includes("not biome confirmation")),
  );
  observe(r, 15, 15000);
  const held = observe(r, 15, 20000);
  assert.equal(held.notificationEligible, false);
  assert.equal(held.signalHoldPollsRemaining, 1);
  assert.equal(observe(r, 15, 25000).alert, "watch");
});

test("dips and missing observations cannot masquerade as successful follow-up", () => {
  const r = record([13]);
  observe(r, 15, 5000);
  assert.equal(score(r, 3, 10000).followUpConfirmed, false); // Other page.
  assert.equal(observe(r, 14, 10000).followUpConfirmed, false);
  assert.equal(observe(r, 15, 15000).followUpConfirmed, false);
  const delayed = record([13]);
  observe(delayed, 15, 5000);
  assert.equal(observe(delayed, 15, 25001).followUpConfirmed, false);
});

test("freshness expires on wall time without consuming hold polls or manufacturing history", () => {
  const r = record([13]);
  observe(r, 15, 5000);
  assert.equal(score(r, 2, 25000).notificationEligible, true);
  const stale = score(r, 2, 25001);
  assert.equal(stale.isFresh, false);
  assert.equal(stale.notificationEligible, false);
  assert.equal(stale.signalHoldPollsRemaining, 2);
  assert.equal(signalLabel({ ...r, ...stale }), "Stale observation");
  assert.equal(score(r, 4, 25001).alert, "watch");
  assert.equal(r.history.length, 2);
  const full = record(Array(13).fill(20));
  assert.equal(score(full, 31, full.lastSeen + 90000).alert, "watch");
});

test("capacity changes and duplicate timestamps cannot produce growth or infinite pace", () => {
  const r = record([13, 16]);
  r.history[0].capacity = 15;
  assert.equal(score(r).notificationEligible, false);
  const duplicate = score(record([13, 16], [5000, 5000]));
  assert.equal(duplicate.notificationEligible, false);
  assert.equal(duplicate.growthPer10s, null);
});

test("ranking puts actionable rapid filling first, then early leads, full and stale leads", () => {
  const row = (id, extra) => ({
    id,
    alert: "potential",
    players: 17,
    capacity: 20,
    isFresh: true,
    growthPer10s: 2,
    lastSeen: 5000,
    ...extra,
  });
  const rows = [
    row("full", { alert: "cluster", players: 20, growthPer10s: 99 }),
    row("stale", { alert: "cluster", isFresh: false }),
    row("early", {}),
    row("rapid", { alert: "cluster" }),
    row("confirmed", { followUpConfirmed: true }),
  ].sort(compareSignals);
  assert.deepEqual(
    rows.map((r) => r.id),
    ["rapid", "confirmed", "early", "full", "stale"],
  );
});

test("discovery advances independently, wraps at the end, and never adds requests", async () => {
  let now = 1000000;
  const requests = [];
  const store = new Store();
  const tracker = new Tracker(store, {
    now: () => now,
    interval: 5000,
    requestLimit: 12,
    fetchFn: async (url) => {
      const cursor = new URL(url).searchParams.get("cursor");
      requests.push(cursor);
      return new Response(
        JSON.stringify({
          data: [],
          nextPageCursor:
            cursor === "page2" ? "page3" : cursor === "page3" ? null : "page2",
        }),
      );
    },
  });
  try {
    for (let i = 0; i < 12; i++) {
      await tracker.poll();
      now = tracker.nextAt;
    }
    assert.deepEqual(requests, [
      null,
      null,
      "page2",
      null,
      null,
      "page3",
      null,
      null,
      "page2",
      null,
      null,
      "page3",
    ]);
    assert.equal(tracker.polls, 12);
    assert.equal(tracker.events[0].retention, null);
  } finally {
    store.close();
  }
});

test("expired discovery cursors recover through a new top-page seed", async () => {
  let now = 1000000;
  const requests = [];
  const store = new Store();
  const tracker = new Tracker(store, {
    now: () => now,
    interval: 5000,
    requestLimit: 12,
    fetchFn: async (url) => {
      const cursor = new URL(url).searchParams.get("cursor");
      requests.push(cursor);
      return cursor
        ? new Response("", { status: 400 })
        : new Response(JSON.stringify({ data: [], nextPageCursor: "expired" }));
    },
  });
  try {
    for (let i = 0; i < 4; i++) {
      await tracker.poll();
      now = tracker.nextAt;
    }
    assert.deepEqual(requests, [null, null, "expired", null]);
    assert.equal(tracker.status, "Live");
  } finally {
    store.close();
  }
});

test("discovery can begin if later top-page responses add a next cursor", async () => {
  let now = 1000000;
  const requests = [];
  const store = new Store();
  const tracker = new Tracker(store, {
    now: () => now,
    interval: 5000,
    requestLimit: 12,
    fetchFn: async (url) => {
      requests.push(new URL(url).searchParams.get("cursor"));
      return new Response(
        JSON.stringify({
          data: [],
          nextPageCursor: requests.length === 1 ? null : "page2",
        }),
      );
    },
  });
  try {
    for (let i = 0; i < 3; i++) {
      await tracker.poll();
      now = tracker.nextAt;
    }
    assert.deepEqual(requests, [null, null, "page2"]);
  } finally {
    store.close();
  }
});

test("a fetched low-population baseline enables immediate detection on crossing the display floor", async () => {
  let now = 1000000,
    players = 11;
  const store = new Store();
  const tracker = new Tracker(store, {
    now: () => now,
    interval: 5000,
    requestLimit: 12,
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "job", playing: players, maxPlayers: 20 }],
        }),
      ),
  });
  try {
    await tracker.poll();
    assert.equal(tracker.snapshot().rows.length, 0);
    assert.equal(tracker.records.get("job").history.length, 1);
    now = tracker.nextAt;
    players = 13;
    await tracker.poll();
    assert.equal(tracker.snapshot().rows[0].notificationEligible, true);
    assert.equal(tracker.snapshot().rows[0].growth15s, 2);
  } finally {
    store.close();
  }
});
