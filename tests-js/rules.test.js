import test from "node:test";
import assert from "node:assert/strict";
import { score } from "../src/server/scorer.js";
import { Tracker } from "../src/server/tracker.js";
import { Store } from "../src/server/store.js";
import { AUTHENTICATED_POLLING } from "../src/server/polling-config.js";

function record(counts, step = 5000) {
  const history = counts.map((players, i) => ({
    players,
    at: i * step,
    poll: i + 1,
    capacity: 20,
  }));
  return {
    id: "job",
    players: counts.at(-1),
    capacity: 20,
    lastSeen: history.at(-1).at,
    pollInterval: 5000,
    history,
  };
}

test("early leads use net +2 within 15.5 elapsed seconds at 13–18 players", () => {
  for (const counts of [
    [13, 15],
    [13, 14, 15],
    [13, 14, 14, 15],
    [11, 13],
    [12, 14],
    [16, 18],
  ]) {
    const result = score(record(counts));
    assert.equal(result.alert, "potential");
    assert.equal(result.growth15s, 2);
    assert.equal(result.notificationEligible, true);
  }
  for (const counts of [
    [10, 12],
    [17, 19],
    [13, 14],
    [14, 15],
    [13, 14, 14, 14, 15],
    [15, 16, 15, 16],
  ])
    assert.equal(score(record(counts)).alert, "watch");
  const missed = record([13, 15]);
  missed.history[1].poll = 5;
  assert.equal(score(missed).alert, "potential"); // Poll IDs do not define elapsed time.
  assert.notEqual(score(record([13, 15], 60000)).alert, "potential");
  assert.equal(score(record([13, 15], 15500)).alert, "potential");
  assert.notEqual(score(record([13, 15], 15501)).alert, "potential");
});

test("19/20 and 20/20 require a full observed minute, including alternating counts", () => {
  assert.equal(score(record(Array(12).fill(19))).sustainedNearFull, false);
  for (const counts of [
    Array(13).fill(19),
    Array(13).fill(20),
    Array.from({ length: 13 }, (_, i) => 19 + (i % 2)),
  ]) {
    const result = score(record(counts));
    assert.equal(result.alert, "watch");
    assert.equal(result.notificationEligible, false);
    assert.equal(result.nearFullDurationMs, 60000);
    assert.equal(result.sustainedNearFull, true);
    assert.ok(result.reasons.some((reason) => reason.includes("60s")));
  }
  assert.equal(score(record([19])).sustainedNearFull, false);
});

test("near-full context resets on low observations, long elapsed gaps, or capacity changes", () => {
  const dropped = Array(13).fill(19);
  dropped[6] = 18;
  assert.equal(score(record(dropped)).nearFullDurationMs, 25000);
  assert.equal(score(record([19, 20], 60000)).nearFullDurationMs, 0);
  const missing = record(Array(13).fill(19));
  missing.history.at(-1).poll += 4;
  assert.equal(score(missing).nearFullDurationMs, 60000);
  const capacityChange = record(Array(13).fill(19));
  capacityChange.history[6].capacity = 25;
  assert.equal(score(capacityChange).nearFullDurationMs, 25000);
});

test("UI excludes below-13 servers but tracking retains already-fetched baselines", async () => {
  const store = new Store();
  let now = 1000000,
    count = 15;
  const tracker = new Tracker(store, {
    interval: 5000,
    requestLimit: 12,
    now: () => now,
    fetchFn: async (url) => {
      assert.equal(new URL(url).searchParams.get("excludeFullGames"), "false");
      return new Response(
        JSON.stringify({
          data: [
            { id: "job", playing: count, maxPlayers: 20 },
            { id: "low", playing: 12, maxPlayers: 20 },
            { id: "job", playing: count, maxPlayers: 20 },
            { id: "full", playing: 20, maxPlayers: 20 },
          ],
        }),
      );
    },
  });
  try {
    await tracker.poll();
    assert.equal(tracker.snapshot().rows.length, 2);
    assert.equal(tracker.events[0].filteredBelowMin, 1);
    assert.equal(tracker.events[0].duplicates, 1);
    now += 5000;
    count = 12;
    await tracker.poll();
    assert.equal(tracker.records.has("job"), true);
    assert.equal(tracker.records.has("low"), true);
    assert.deepEqual(
      tracker.snapshot().rows.map((r) => r.id),
      ["full"],
    );
    now += 5000;
    count = 13;
    await tracker.poll();
    assert.equal(tracker.records.get("job").history.length, 3);
  } finally {
    store.close();
  }
});

test("authenticated polling fetches only the top page every two seconds", async () => {
  const store = new Store();
  let now = 1000000;
  const starts = [];
  const tracker = new Tracker(store, {
    ...AUTHENTICATED_POLLING,
    now: () => now,
    fetchFn: async (url) => {
      starts.push(now);
      now += 100;
      return new Response(
        JSON.stringify({
          data: [{ id: "job", playing: 15, maxPlayers: 20 }],
          nextPageCursor: "ignored-page-2",
        }),
      );
    },
  });
  try {
    for (let i = 0; i < 35; i++) {
      await tracker.poll();
      if (i < 34) now = tracker.nextAt;
    }
    assert.ok(starts.slice(1).every((start, i) => start - starts[i] === 2000));
    assert.equal(tracker.snapshot().requestLimit, null);
    assert.equal(tracker.snapshot().pagesPerPoll, 1);
    assert.equal(tracker.snapshot().coverageEvery, 0);
    assert.equal(tracker.snapshot().totalRequests, 35);
    assert.equal(tracker.snapshot().polls, 35);
    assert.equal(tracker.snapshot().pollIntervalMs, 2000);
  } finally {
    store.close();
  }
});

test("authentication failure downgrades the schedule without an immediate retry", async () => {
  const store = new Store();
  const tracker = new Tracker(store, {
    interval: 5000,
    requestLimit: 12,
    now: () => 1000000,
    fetchFn: async () => new Response("", { status: 403 }),
  });
  try {
    await tracker.poll();
    assert.equal(tracker.snapshot().requestLimit, null);
    assert.equal(tracker.snapshot().pollIntervalMs, 20500);
    assert.equal(tracker.nextAt, 1060000);
  } finally {
    store.close();
  }
});
