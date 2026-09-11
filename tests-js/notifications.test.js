import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Notifications } from "../src/server/notifications.js";
import { Store } from "../src/server/store.js";
import { Tracker } from "../src/server/tracker.js";

const enabled = {
  enabled: true,
  potential: true,
  cluster: true,
  autoJoin: false,
  autoJoinPotential: true,
  autoJoinCluster: true,
  autoJoinRecentFull: false,
  autoStart: false,
  ocrResolution: "1440p",
  biomeTargets: [],
};
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

test("a long held plateau stays visible and pinned without repeating desktop alerts", () =>
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
      assert.equal(tracker.snapshot().rows[0].alert, "potential");
      assert.equal(tracker.snapshot().rows[0].noticeEligible, true);
      assert.deepEqual(await poll(18), []);
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
    await writeFile(
      notifications.path,
      JSON.stringify({ enabled: true, potential: false, cluster: true }),
    );
    assert.deepEqual(new Notifications(folder).preferences, {
      enabled: true,
      potential: false,
      cluster: true,
      autoJoin: false,
      autoJoinPotential: true,
      autoJoinCluster: true,
      autoJoinRecentFull: false,
      autoStart: false,
      ocrResolution: "1440p",
      biomeTargets: [],
    });
    for (const value of [
      null,
      {},
      { ...enabled, enabled: "true" },
      { ...enabled, autoJoinRecentFull: "true" },
      { ...enabled, ocrResolution: "720p" },
      { ...enabled, biomeTargets: ["Not a biome"] },
      { ...enabled, biomeTargets: ["Aurora", "aurora"] },
    ])
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

test("a newly full rapid signal notifies and remains eligible for the Roblox queue", () =>
  fixture(async (_notifications, folder) => {
    const joined = [];
    const notifications = new Notifications(folder, {
      onAutoJoin: (event) => joined.push(event),
    });
    await notifications.save({ ...enabled, autoJoin: true });
    const fullRapid = {
      ...row("cluster", "full-rapid"),
      players: 20,
      signalState: "full",
    };
    notifications.update(sample(1, [fullRapid]));
    assert.equal(notifications.claim()[0].id, "full-rapid");
    assert.deepEqual(
      joined.map((event) => event.id),
      ["full-rapid"],
    );
    notifications.update(
      sample(2, [{ ...fullRapid, notificationEligible: false }]),
    );
    assert.deepEqual(notifications.claim(), []);
    assert.deepEqual(
      joined.map((event) => event.id),
      ["full-rapid"],
    );
  }));

test("recent full bursts are opt-in, work for both tiers, persist, and attempt each episode once", () =>
  fixture(async (_unused, folder) => {
    for (const tier of ["potential", "cluster"]) {
      const joined = [];
      const notifications = new Notifications(folder, {
        onAutoJoin: (event) => {
          joined.push(event.id);
          return true;
        },
      });
      await notifications.save({
        ...enabled,
        autoJoin: true,
        autoJoinPotential: false,
        autoJoinCluster: false,
      });
      const full = {
        ...row(tier, tier),
        players: 20,
        signalState: "full",
        notificationEligible: false,
      };
      notifications.update(sample(1, [full]));
      assert.deepEqual(joined, []);
      await notifications.save({
        ...notifications.preferences,
        autoJoinRecentFull: true,
      });
      assert.equal(
        new Notifications(folder).preferences.autoJoinRecentFull,
        true,
      );
      notifications.update(sample(2, [full]));
      assert.deepEqual(joined, [tier]);
      assert.deepEqual(notifications.claim(), []);
      notifications.update(sample(3, [full], 100000));
      assert.deepEqual(joined, [tier]);
    }
  }));

test("recent full auto-join respects stale/current/biome/cooldown guards and keeps pending bursts eligible", () =>
  fixture(async (_unused, folder) => {
    const joined = [];
    const notifications = new Notifications(folder, {
      onAutoJoin: (event) => {
        joined.push(event.id);
        return true;
      },
    });
    await notifications.save({
      ...enabled,
      autoJoin: true,
      autoJoinRecentFull: true,
      biomeTargets: ["Singularity"],
    });
    const full = {
      ...row("potential", "recent"),
      players: 20,
      signalState: "full",
      notificationEligible: false,
    };
    notifications.update(sample(1, [{ ...full, isFresh: false }]));
    notifications.update({ ...sample(2, [full]), currentServerId: "recent" });
    notifications.update({
      ...sample(3, [full]),
      automation: { status: "scanning", biome: "Singularity" },
    });
    assert.deepEqual(joined, []);
    notifications.startJoinCooldown("other", 15000);
    notifications.update(sample(4, [full], 20000));
    assert.deepEqual(joined, []);
    notifications.update(
      sample(5, [{ ...full, players: 19, signalState: "holding" }], 80000),
    );
    assert.deepEqual(joined, []);
    notifications.update(sample(6, [full], 85000));
    assert.deepEqual(joined, ["recent"]);
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

test("auto-join selects one strongest new signal and runs once per episode", () =>
  fixture(async (_notifications, folder) => {
    const joined = [];
    const notifications = new Notifications(folder, {
      onAutoJoin: (event) => joined.push(event),
    });
    await notifications.save({ ...enabled, enabled: false, autoJoin: true });
    notifications.update(
      sample(1, [row("potential", "early"), row("cluster", "rapid")]),
    );
    assert.deepEqual(
      joined.map((event) => event.id),
      ["rapid"],
    );
    assert.equal(
      notifications.update(sample(1, [row("cluster", "rapid")])).pending,
      0,
    );
    notifications.update(sample(2, [row("cluster", "rapid")]));
    notifications.update(sample(3, [row("potential", "rapid")]));
    assert.deepEqual(
      joined.map((event) => event.id),
      ["rapid"],
    );
    notifications.update(sample(4, []));
    notifications.update(sample(5, []));
    notifications.update(sample(6, [row("potential", "rapid")], 70000));
    assert.deepEqual(
      joined.map((event) => event.id),
      ["rapid", "rapid"],
    );
  }));

test("auto-join respects signal type choices and never replays an active episode when enabled", () =>
  fixture(async (_notifications, folder) => {
    const joined = [];
    const notifications = new Notifications(folder, {
      onAutoJoin: (event) => joined.push(event),
    });
    notifications.update(sample(1, [row("potential", "existing")]));
    await notifications.save({
      ...enabled,
      enabled: false,
      potential: false,
      autoJoin: true,
    });
    notifications.update(sample(2, [row("potential", "existing")]));
    assert.deepEqual(joined, []);
    notifications.update(sample(3, [row("cluster", "existing")]));
    assert.deepEqual(
      joined.map((event) => event.id),
      ["existing"],
    );
  }));

test("auto-join has independent early and rapid signal selectors", () =>
  fixture(async (_notifications, folder) => {
    const joined = [];
    const notifications = new Notifications(folder, {
      onAutoJoin: (event) => joined.push(event.id),
    });
    await notifications.save({
      ...enabled,
      enabled: false,
      potential: false,
      cluster: false,
      autoJoin: true,
      autoJoinPotential: false,
      autoJoinCluster: true,
    });
    notifications.update(
      sample(1, [row("potential", "early"), row("cluster", "rapid")]),
    );
    assert.deepEqual(joined, ["rapid"]);
    notifications.update(sample(2, []));
    notifications.update(sample(3, []));
    await notifications.save({
      ...enabled,
      enabled: false,
      potential: false,
      cluster: false,
      autoJoin: true,
      autoJoinPotential: true,
      autoJoinCluster: false,
    });
    notifications.update(
      sample(4, [row("potential", "early"), row("cluster", "rapid")], 70000),
    );
    assert.deepEqual(joined, ["rapid", "early"]);
  }));

test("auto-join excludes the account's current server and chooses the next signal", () =>
  fixture(async (_notifications, folder) => {
    const joined = [];
    const notifications = new Notifications(folder, {
      onAutoJoin: (event) => joined.push(event.id),
    });
    await notifications.save({ ...enabled, autoJoin: true });
    notifications.update({
      ...sample(1, [
        row("cluster", "current-job"),
        row("potential", "other-job"),
      ]),
      currentServerId: "current-job",
    });
    assert.deepEqual(joined, ["other-job"]);
  }));

test("a selected OCR target biome stays latched until another biome is recognized", () =>
  fixture(async (_notifications, folder) => {
    const joined = [];
    const notifications = new Notifications(folder, {
      onAutoJoin: (event) => joined.push(event.id),
    });
    await notifications.save({
      ...enabled,
      autoJoin: true,
      autoStart: true,
      biomeTargets: ["Glitched", "Dreamspace"],
    });
    const result = notifications.update({
      ...sample(1, [
        row("cluster", "rare-signal"),
        row("potential", "early-signal"),
      ]),
      automation: { biome: "Glitched", biomeFresh: true },
    });
    assert.deepEqual(joined, []);
    assert.equal(result.autoJoinPausedBiome, "Glitched");

    const unclear = notifications.update({
      ...sample(2, [
        {
          ...row("cluster", "rare-signal"),
          notificationEligible: false,
          signalState: "holding",
        },
        {
          ...row("potential", "early-signal"),
          notificationEligible: false,
          signalState: "holding",
        },
      ]),
      automation: { biome: "Glitched", biomeFresh: false },
    });
    assert.deepEqual(joined, []);
    assert.equal(unclear.autoJoinPausedBiome, "Glitched");

    notifications.update({
      ...sample(3, [
        {
          ...row("cluster", "rare-signal"),
          notificationEligible: false,
          signalState: "holding",
        },
        {
          ...row("potential", "early-signal"),
          notificationEligible: false,
          signalState: "holding",
        },
      ]),
      automation: { biome: "Normal", biomeFresh: true },
    });
    assert.deepEqual(joined, ["rare-signal"]);
  }));

test("join cooldown blocks another auto-join until startup completes or sixty seconds pass", () =>
  fixture(async (_notifications, folder) => {
    const joined = [];
    const notifications = new Notifications(folder, {
      onAutoJoin: (event) => joined.push(event.id),
    });
    await notifications.save({ ...enabled, autoJoin: true, autoStart: true });
    const first = notifications.update(
      sample(1, [row("cluster", "first")], 1000),
    );
    assert.deepEqual(joined, ["first"]);

    const cooling = notifications.update(
      sample(2, [row("cluster", "second")], 3000),
    );
    assert.deepEqual(joined, ["first"]);
    assert.equal(cooling.autoJoinCooldownUntil, 61000);
    assert.equal(cooling.autoJoinCooldownServerId, "first");

    notifications.update({
      ...sample(3, [row("cluster", "third")], 7000),
      automation: {
        lastAutoStartAt: 5000,
        biomeAt: 6500,
        biome: "Normal",
      },
    });
    assert.deepEqual(joined, ["first", "third"]);

    notifications.update(sample(4, [row("cluster", "fourth")], 68000));
    assert.deepEqual(joined, ["first", "third", "fourth"]);
  }));
