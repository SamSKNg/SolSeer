import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTHENTICATED_POLLING,
  ANONYMOUS_POLLING,
  pollingFor,
} from "../src/server/polling-config.js";
import { score, updateSignalHold } from "../src/server/scorer.js";
import { Store } from "../src/server/store.js";
import { Tracker } from "../src/server/tracker.js";

test("live polling exceeds old caps but stops until Roblox's retry expires", async () => {
  for (const authenticated of [true, false]) {
    const store = new Store();
    let now = 1000000,
      calls = 0,
      limited = false;
    const tracker = new Tracker(store, {
      ...pollingFor(authenticated),
      now: () => now,
      fetchFn: async () => {
        calls++;
        return limited
          ? new Response("", { status: 429, headers: { "retry-after": "12" } })
          : new Response('{"data":[]}');
      },
    });
    tracker.configurePolling(1);
    try {
      for (let i = 0; i < 65; i++) {
        await tracker.poll();
        assert.equal(tracker.nextAt - now, 1000);
        now = tracker.nextAt;
      }
      assert.equal(calls, 65);
      assert.equal(tracker.snapshot().requestLimit, null);
      limited = true;
      await tracker.poll();
      assert.equal(tracker.nextAt - now, 12500);
      now += 1000;
      await tracker.poll();
      assert.equal(calls, 66);
      now = tracker.nextAt;
      limited = false;
      await tracker.poll();
      assert.equal(calls, 67);
    } finally {
      store.close();
    }
  }
});

const record = (counts) => ({
  id: "job",
  players: counts.at(-1),
  capacity: 20,
  lastSeen: (counts.length - 1) * 3000,
  history: counts.map((players, i) => ({
    players,
    capacity: 20,
    at: i * 3000,
    poll: i + 1,
  })),
});

test("authenticated polling uses one top page every 2s; anonymous keeps its discovery rotation", () => {
  assert.deepEqual(pollingFor(true), {
    interval: 2000,
    requestLimit: null,
    pagesPerPoll: 1,
    coverageEvery: 0,
  });
  assert.equal(pollingFor(true), AUTHENTICATED_POLLING);
  assert.equal(pollingFor(false), ANONYMOUS_POLLING);
  assert.deepEqual(pollingFor(false), {
    interval: 20500,
    requestLimit: null,
    pagesPerPoll: 1,
    coverageEvery: 3,
  });
});

test("burst detection uses elapsed time rather than a fixed sample count", () => {
  const early = score(record([11, 11, 11, 12, 12, 13]));
  assert.equal(early.alert, "potential");
  assert.equal(early.growth15s, 2);
  assert.equal(score(record([13, 14, 15, 16])).alert, "cluster"); // +3 / 9s
  assert.equal(score(record([13, 14, 15, 15, 16])).alert, "cluster"); // +3 / 12s
  assert.equal(score(record([13, 14, 15, 15, 15, 15, 16])).alert, "potential"); // Only +2 remains inside the last 15.5s.
  const stale = record([13, 15]);
  assert.equal(score(stale, 2, stale.lastSeen + 20000).isFresh, true);
  assert.equal(score(stale, 2, stale.lastSeen + 20001).isFresh, false);
  assert.equal(score(record(Array(21).fill(20))).sustainedNearFull, true);
  assert.equal(score(record(Array(21).fill(20))).alert, "watch");
});

test("two completed poll grace expires after six seconds but burst memory remains", () => {
  const r = record([13, 15]);
  updateSignalHold(r, 13, 2);
  assert.equal(score(r, 3, 6000).signalHoldPollsRemaining, 1);
  assert.equal(score(r, 3, 6000).alert, "potential");
  assert.equal(score(r, 4, 9000).signalHoldPollsRemaining, 0);
  assert.equal(score(r, 4, 9000).alert, "potential");
  assert.equal(score(r, 4, 9000).signalState, "recent");
  assert.equal(score(r, 4, 9000).notificationEligible, false);
});

test("40-attempt budget rejects the next attempt and larger limits, preserving cooldowns", () => {
  const store = new Store();
  try {
    for (let i = 0; i < 40; i++)
      assert.equal(store.reserve(1000000 + Math.floor(i / 2) * 3000, 40), 0);
    assert.equal(store.reserve(1059000, 40), 1250);
    assert.equal(store.requests(1059000).length, 40);
    store.cooldown(1100000);
    assert.equal(store.reserve(1060250, 40), 39750);
    assert.throws(
      () => store.availableIn(1060250, 41),
      /Invalid request budget/,
    );
  } finally {
    store.close();
  }
});
