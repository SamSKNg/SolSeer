import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/server/store.js";
import { Tracker } from "../src/server/tracker.js";

function fixture() {
  const store = new Store();
  let now = 1000000,
    players = 15;
  const tracker = new Tracker(store, {
    interval: 5000,
    requestLimit: 12,
    now: () => now,
    fetchFn: async () =>
      new Response(
        JSON.stringify({
          data:
            players === null
              ? []
              : [{ id: "job", playing: players, maxPlayers: 20 }],
        }),
      ),
  });
  return {
    store,
    tracker,
    advance: (ms) => {
      now += ms;
    },
    async poll(count) {
      players = count;
      now = Math.max(now, tracker.nextAt);
      await tracker.poll();
      return tracker.snapshot().rows.find((row) => row.id === "job");
    },
  };
}

test("two-poll grace period renews only while a fresh observation meets a rule, never from the hold itself", async () => {
  const f = fixture();
  try {
    await f.poll(15);
    const trigger = await f.poll(17);
    assert.equal(trigger.signalHoldPollsRemaining, 2);
    assert.equal(trigger.signalHold.expiresAtPoll, 4);
    // The original +2 remains inside the three-poll rule window for two more observations.
    await f.poll(17);
    const lastQualifying = await f.poll(17);
    assert.equal(lastQualifying.growthQualifies, true);
    assert.equal(lastQualifying.signalHold.expiresAtPoll, 6);
    const held = await f.poll(17);
    assert.equal(held.growthQualifies, false);
    assert.equal(held.alert, "potential");
    assert.equal(held.signalHoldPollsRemaining, 1);
    assert.equal(held.signalHold.expiresAtPoll, 6);
    const expired = await f.poll(17);
    assert.equal(expired.alert, "potential");
    assert.equal(expired.signalState, "holding");
    assert.equal(expired.notificationEligible, false);
    assert.equal(expired.signalHoldPollsRemaining, 0);
    f.tracker.recordJoin("job");
    assert.equal(f.store.joins()[0].signalState, "holding");
  } finally {
    f.store.close();
  }
});

test("a population drop preserves the hold but cannot resurrect an old +2 baseline", async () => {
  const f = fixture();
  try {
    await f.poll(13);
    await f.poll(16);
    const dropped = await f.poll(15);
    assert.equal(dropped.signalHoldPollsRemaining, 1);
    assert.equal(dropped.alert, "potential");
    assert.equal(dropped.players, 15);
    assert.equal(dropped.deltaPoll, -1);
    assert.equal(dropped.growthQualifies, false);
    assert.equal((await f.poll(16)).alert, "watch");
    const fresh = await f.poll(17);
    assert.equal(fresh.alert, "potential");
    assert.equal(fresh.signalHoldPollsRemaining, 2);
    assert.equal(fresh.signalHold.detectedAtPoll, 5);
  } finally {
    f.store.close();
  }
});

test("stale burst memory expires on wall time even when no further polls completed", async () => {
  const f = fixture();
  try {
    await f.poll(15);
    await f.poll(17);
    f.advance(21000);
    assert.equal(f.tracker.snapshot().rows[0].signalHoldPollsRemaining, 2);
    assert.equal(f.tracker.snapshot().rows[0].signalHoldPollsRemaining, 2);
    const row = await f.poll(null);
    assert.equal(row.signalHoldPollsRemaining, 1);
    assert.equal(row.alert, "potential");
    assert.equal(row.isFresh, false);
    assert.equal(row.notificationEligible, false);
    f.advance(160000);
    assert.equal(f.tracker.snapshot().rows.length, 0);
    assert.equal(await f.poll(null), undefined); // Normal freshness filter resumes.
  } finally {
    f.store.close();
  }
});

test("an in-flight request only consumes a hold poll when it completes, including failure", async () => {
  const f = fixture();
  try {
    await f.poll(15);
    await f.poll(17);
    f.advance(5000);
    let finish;
    f.tracker.fetchFn = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const pending = f.tracker.poll();
    assert.equal(f.tracker.snapshot().rows[0].signalHoldPollsRemaining, 2);
    finish(new Response("", { status: 500 }));
    await pending;
    assert.equal(f.tracker.snapshot().rows[0].signalHoldPollsRemaining, 1);
    f.tracker.fetchFn = async () => new Response("", { status: 500 });
    await f.poll(null);
    assert.equal(f.tracker.snapshot().rows[0].signalHoldPollsRemaining, 0);
  } finally {
    f.store.close();
  }
});

test("sustained fullness is context only and never creates or renews a hold", async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 13; i++) await f.poll(19);
    const sustained = await f.poll(20);
    assert.equal(sustained.sustainedNearFull, true);
    assert.equal(sustained.signalHoldPollsRemaining, 0);
    assert.equal(sustained.signalHold, undefined);
    assert.equal(sustained.alert, "watch");
    const dropped = await f.poll(18);
    assert.equal(dropped.sustainedNearFull, false);
    assert.equal(dropped.signalHoldPollsRemaining, 0);
    assert.equal(dropped.alert, "watch");
    assert.equal((await f.poll(18)).alert, "watch");
  } finally {
    f.store.close();
  }
});

test("rapid signals remain recent leads during the grace period while pace and count update", async () => {
  const f = fixture();
  try {
    await f.poll(13);
    const strong = await f.poll(17);
    assert.equal(strong.alert, "cluster");
    const dropped = await f.poll(16);
    assert.equal(dropped.alert, "potential");
    assert.equal(dropped.signalHoldPollsRemaining, 1);
    assert.ok((dropped.growthPer10s ?? 0) < strong.growthPer10s);
    assert.equal(dropped.notificationEligible, false);
    assert.equal((await f.poll(15)).alert, "watch"); // Next completed poll ends the decline grace.
    assert.equal((await f.poll(15)).alert, "watch");
  } finally {
    f.store.close();
  }
});

test("a large drop below the display floor removes the lead immediately but keeps its history", async () => {
  const f = fixture();
  try {
    assert.equal(await f.poll(12), undefined);
    await f.poll(13);
    await f.poll(15);
    const dropped = await f.poll(12);
    assert.equal(dropped, undefined);
    assert.equal(f.tracker.records.get("job").players, 12);
    assert.equal(await f.poll(null), undefined);
    assert.equal(f.tracker.records.has("job"), true);
  } finally {
    f.store.close();
  }
});

test("pending minus-one removal waits for a completed poll, including other pages and errors", async () => {
  for (const failure of [false, true]) {
    const f = fixture();
    try {
      await f.poll(13);
      await f.poll(16);
      const declining = await f.poll(15);
      assert.equal(declining.signalState, "declining");
      assert.equal(declining.burstMemory.removeAtPoll, 4);
      f.store.cooldown(f.tracker.nextAt + 1000);
      await f.tracker.poll(); // Quota wait is not a completed poll.
      assert.equal(f.tracker.snapshot().rows[0].signalState, "declining");
      assert.equal(f.tracker.polls, 3);
      f.advance(7000);
      let finish;
      f.tracker.fetchFn = () =>
        new Promise((resolve) => {
          finish = resolve;
        });
      const pending = f.tracker.poll();
      assert.equal(f.tracker.snapshot().rows[0].signalState, "declining");
      finish(
        failure
          ? new Response("", { status: 500 })
          : new Response(JSON.stringify({ data: [] })),
      );
      await pending;
      const removed = f.tracker.snapshot().rows[0];
      assert.equal(removed.alert, "watch");
      assert.equal(removed.signalHoldPollsRemaining, 0);
      assert.equal(removed.burstRemainingMs, 0);
      assert.equal(removed.history.length, 3); // A missing page isn't a new observation.
      assert.equal(f.tracker.snapshot().rows[0].alert, "watch");
      f.tracker.fetchFn = async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "job", playing: 15, maxPlayers: 20 }],
          }),
        );
      assert.equal((await f.poll(15)).alert, "watch"); // No resurrection on a flat return.
    } finally {
      f.store.close();
    }
  }
});
