import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Notifications } from "../src/server/notifications.js";
import { Store } from "../src/server/store.js";
import { Tracker } from "../src/server/tracker.js";

const enabled = { enabled: true, potential: true, cluster: true };
const row = (alert = "potential", id = "server") => ({
  id,
  alert,
  players: 17,
  capacity: 20,
  notificationEligible: true,
});
const sample = (poll, rows, now = poll * 5000) => ({
  events: [{ id: poll }],
  rows,
  now,
});
async function fixture(run) {
  const folder = await mkdtemp(join(tmpdir(), "solseer-notifications-"));
  try {
    await run(new Notifications(folder), folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test("a long held plateau stays visible without repeating or rearming desktop alerts", () =>
  fixture(async (notifications) => {
    await notifications.save(enabled);
    const store = new Store();
    let now = 1000000,
      players = 14;
    const tracker = new Tracker(store, {
      now: () => now,
      interval: 3000,
      requestLimit: 20,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            data: [{ id: "job", playing: players, maxPlayers: 20 }],
          }),
        ),
    });
    const poll = async (count) => {
      now = tracker.nextAt;
      players = count;
      await tracker.poll();
      notifications.update(tracker.snapshot());
      return notifications.claim();
    };
    try {
      await poll(14);
      assert.equal((await poll(16)).length, 1);
      for (let i = 0; i < 35; i++) {
        assert.deepEqual(await poll(16), []);
        assert.equal(tracker.snapshot().rows[0].signalState, "holding");
      }
      for (let i = 0; i < 10; i++) assert.deepEqual(await poll(16), []);
      assert.equal(tracker.snapshot().rows[0].alert, "watch");
      assert.equal((await poll(18)).length, 1);
    } finally {
      store.close();
    }
  }));

test("notification preferences persist independently, validate input and default to disabled", () =>
  fixture(async (notifications, folder) => {
    assert.equal(notifications.preferences.enabled, false);
    await writeFile(join(folder, ".env"), "synthetic-cookie-fixture");
    await notifications.save(enabled);
    assert.deepEqual(new Notifications(folder).preferences, enabled);
    assert.equal(
      await readFile(join(folder, ".env"), "utf8"),
      "synthetic-cookie-fixture",
    );
    for (const value of [null, {}, { ...enabled, enabled: "true" }])
      await assert.rejects(notifications.save(value), { status: 400 });
    await writeFile(notifications.path, "invalid JSON");
    assert.equal(new Notifications(folder).preferences.enabled, false);
  }));

test("detects new potential and strong upgrades once, ignoring heartbeats and rank oscillation", () =>
  fixture(async (notifications) => {
    await notifications.save(enabled);
    assert.equal(notifications.update(sample(1, [row()])).pending, 1);
    assert.equal(notifications.claim()[0].alert, "potential");
    assert.deepEqual(notifications.claim(), []); // another tab / reload
    assert.equal(notifications.update(sample(1, [row()], 6000)).pending, 0);
    assert.equal(notifications.update(sample(2, [row()])).pending, 0);
    notifications.update(sample(3, [row("cluster")]));
    assert.equal(notifications.claim()[0].alert, "cluster");
    notifications.update(sample(4, [row()]));
    notifications.update(sample(5, [row("cluster")]));
    assert.deepEqual(notifications.claim(), []);
  }));

test("rearms only after two inactive completed polls, not after one skipped sample", () =>
  fixture(async (notifications) => {
    await notifications.save(enabled);
    notifications.update(sample(1, [row()]));
    notifications.claim();
    notifications.update(sample(2, []));
    notifications.update(sample(3, [row()]));
    assert.deepEqual(notifications.claim(), []);
    notifications.update(sample(4, [row("watch")]));
    notifications.update(sample(5, []));
    notifications.update(sample(6, [row()]));
    assert.equal(notifications.claim().length, 1);
  }));

test("changing preferences does not replay active signals and selected types are respected", () =>
  fixture(async (notifications) => {
    notifications.update(sample(1, [row()]));
    await notifications.save({ ...enabled, potential: false });
    notifications.update(sample(2, [row(), row("potential", "second")]));
    assert.deepEqual(notifications.claim(), []);
    notifications.update(sample(3, [row("cluster"), row("cluster", "second")]));
    assert.equal(notifications.claim().length, 2);
    await notifications.save({ ...enabled, enabled: false });
    notifications.update(sample(4, [row("cluster", "third")]));
    assert.deepEqual(notifications.claim(), []);
  }));

test("queue is bounded, expires stale alerts, discards departed signals and prioritizes strong clusters", () =>
  fixture(async (notifications) => {
    await notifications.save(enabled);
    notifications.update(sample(1, [row(), row("cluster", "strong")]));
    assert.equal(notifications.claim()[0].id, "strong");
    notifications.update(sample(2, [row("cluster", "new")]));
    notifications.update(sample(3, [row("potential", "new")]));
    assert.deepEqual(notifications.claim(), []);
    notifications.update(
      sample(
        4,
        Array.from({ length: 110 }, (_, i) => row("potential", `batch-${i}`)),
      ),
    );
    assert.equal(
      notifications.update(
        sample(
          4,
          Array.from({ length: 110 }, (_, i) => row("potential", `batch-${i}`)),
        ),
      ).pending,
      100,
    );
    assert.equal(notifications.update(sample(4, [], 50000)).pending, 0);
    notifications.update(sample(5, [row("potential", "departed")], 55000));
    notifications.update(sample(6, [], 60000));
    assert.deepEqual(notifications.claim(), []);
  }));

test("held, full, and stale leads cannot enqueue alerts, and heartbeats discard unsafe queued leads", () =>
  fixture(async (notifications) => {
    await notifications.save(enabled);
    for (const extra of [
      { notificationEligible: false },
      { isFresh: false },
      { players: 20 },
    ]) {
      notifications.update(sample(1, [{ ...row(), ...extra }]));
      assert.deepEqual(notifications.claim(), []);
    }
    notifications.update(sample(2, [row("cluster", "fresh")]));
    assert.equal(
      notifications.update(
        sample(2, [{ ...row("cluster", "fresh"), isFresh: false }], 12000),
      ).pending,
      0,
    );
    notifications.update(sample(3, [row("cluster", "fills")]));
    assert.equal(
      notifications.update(
        sample(3, [{ ...row("cluster", "fills"), players: 20 }], 16000),
      ).pending,
      0,
    );
  }));

test("end-to-end first growth observation notifies immediately, follow-up does not repeat, upgrade notifies once", () =>
  fixture(async (notifications) => {
    await notifications.save(enabled);
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
    const poll = async (count) => {
      players = count;
      now = tracker.nextAt;
      await tracker.poll();
      notifications.update(tracker.snapshot());
      return notifications.claim();
    };
    try {
      assert.deepEqual(await poll(11), []);
      const first = await poll(13);
      assert.equal(first[0].alert, "potential");
      assert.equal(first[0].followUpConfirmed, false);
      assert.match(first[0].reason, /\+2 net players in 5s/);
      assert.deepEqual(await poll(13), []);
      assert.equal(tracker.snapshot().rows[0].followUpConfirmed, true);
      assert.equal((await poll(16))[0].alert, "cluster");
      assert.deepEqual(await poll(17), []);
      assert.deepEqual(await poll(20), []);
      assert.deepEqual(await poll(19), []);
    } finally {
      store.close();
    }
  }));
