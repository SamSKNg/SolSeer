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
    assert.equal(expired.alert, "watch");
    assert.equal(expired.signalHoldPollsRemaining, 0);
    f.tracker.recordJoin("job");
    assert.equal(f.store.joins()[0].alert, "watch");
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

test("missing servers age holds by global polls; snapshots and wall time do not consume polls", async () => {
  const f = fixture();
  try {
    await f.poll(15);
    await f.poll(17);
    f.advance(160000);
    assert.equal(f.tracker.snapshot().rows[0].signalHoldPollsRemaining, 2);
    assert.equal(f.tracker.snapshot().rows[0].signalHoldPollsRemaining, 2);
    const row = await f.poll(null);
    assert.equal(row.signalHoldPollsRemaining, 1);
    assert.equal(row.alert, "potential");
    assert.equal(row.isFresh, false);
    assert.equal(row.notificationEligible, false);
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
    assert.equal((await f.poll(15)).alert, "watch");
  } finally {
    f.store.close();
  }
});

test("only already-held candidates can temporarily survive a drop below 13, with accurate counts", async () => {
  const f = fixture();
  try {
    assert.equal(await f.poll(12), undefined);
    await f.poll(13);
    await f.poll(15);
    const dropped = await f.poll(12);
    assert.equal(dropped.players, 12);
    assert.equal(dropped.alert, "potential");
    assert.equal(dropped.signalHoldPollsRemaining, 1);
    assert.equal(await f.poll(null), undefined);
    assert.equal(f.tracker.records.has("job"), true);
  } finally {
    f.store.close();
  }
});
