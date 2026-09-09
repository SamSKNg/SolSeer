import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/server/store.js";
import { Tracker } from "../src/server/tracker.js";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

test("joins and quota exist only in their session; fresh sessions have no startup wait", () => {
  const first = new Store();
  first.join(
    {
      id: "job",
      players: 17,
      capacity: 20,
      alert: "potential",
      growthPer10s: 4,
    },
    1000000,
  );
  for (let i = 0; i < 3; i++) first.reserve(1000000 + i);
  first.cooldown(1120000);
  assert.equal(first.summary().job.count, 1);
  assert.ok(first.availableIn(1005000) > 0);
  const fresh = new Store();
  assert.deepEqual(fresh.joins(), []);
  assert.deepEqual(fresh.summary(), {});
  assert.equal(fresh.availableIn(1005000), 0);
  const tracker = new Tracker(fresh);
  let scheduled;
  tracker.schedule = (ms) => {
    scheduled = ms;
  };
  tracker.start();
  assert.equal(scheduled, 0);
  tracker.stop();
  first.close();
  fresh.close();
});

test("session join list is bounded, summaries count every click and returned data is isolated", () => {
  const store = new Store();
  for (let i = 0; i < 220; i++)
    store.join({ id: "job", players: 15 }, 1000000 + i);
  assert.equal(store.joins().length, 200);
  assert.equal(store.joins()[0].id, 220);
  assert.equal(store.summary().job.count, 220);
  store.joins()[0].players = 99;
  store.summary().job.count = 99;
  assert.equal(store.joins()[0].players, 15);
  assert.equal(store.summary().job.count, 220);
  store.close();
  assert.deepEqual(store.joins(), []);
});

test(
  "restarting the HTTP backend clears join history; refreshing within a session does not",
  { timeout: 15000 },
  async () => {
    const base = "http://127.0.0.1:3198";
    for (let session = 0; session < 2; session++) {
      const child = spawn(process.execPath, ["src/server/index.js"], {
        env: {
          ...process.env,
          PORT: "3198",
          CLUSTER_NO_POLL: "1",
          ROBLOX_SECURITY_COOKIE: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let ready = false;
      child.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("Signal is ready")) ready = true;
      });
      child.stderr.resume();
      try {
        for (let i = 0; i < 50 && !ready && child.exitCode === null; i++)
          await delay(100);
        assert.ok(ready, "Session backend started");
        const snapshot = async () =>
          (await fetch(base + "/api/snapshot")).json();
        assert.equal((await snapshot()).totalJoins, 0);
        await fetch(base + "/api/join/session-job", {
          method: "POST",
          redirect: "manual",
        });
        assert.equal((await snapshot()).totalJoins, 1);
        assert.equal((await snapshot()).totalJoins, 1);
      } finally {
        child.kill();
        if (child.exitCode === null)
          await new Promise((resolve) => child.once("exit", resolve));
      }
    }
  },
);
