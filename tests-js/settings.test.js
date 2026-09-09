import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSettings } from "../src/server/local-settings.js";
import { Store } from "../src/server/store.js";
import { Tracker } from "../src/server/tracker.js";
import { createRobloxFetch } from "../src/server/roblox-fetch.js";

const dummy = "_|WARNING:-SYNTHETIC|_test#only'123";
test("local cookie saves, replaces and clears across restarts without echo or legacy changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "solseer-settings-"));
  const legacyPath = join(directory, "legacy.env");
  const received = [];
  const options = {
    directory: join(directory, "profile"),
    legacyPath,
    env: {},
    fetchFn: async (_, init) => {
      received.push(init.headers.get("Cookie"));
      return new Response('{"data":[]}');
    },
  };
  try {
    await writeFile(legacyPath, 'ROBLOX_SECURITY_COOKIE="legacy-test-only"');
    const settings = new LocalSettings(options);
    assert.equal(settings.status().hasCookie, true);
    const status = await settings.save(dummy, () => {});
    assert.equal(status.saved, true);
    assert.ok(!JSON.stringify(status).includes(dummy));
    const restarted = new LocalSettings(options);
    await restarted.request(
      "https://games.roblox.com/v1/games/123/servers/Public",
    );
    assert.equal(received.pop(), `.ROBLOSECURITY=${dummy}`);
    for (const bad of [
      "Cookie:abc",
      ".ROBLOSECURITY=abc",
      "invalid\r\nheader",
      '"quoted"',
      undefined,
      "a".repeat(32769),
    ]) {
      await assert.rejects(
        settings.save(bad, () => {}),
        { status: 400 },
      );
    }
    assert.ok((await readFile(settings.path, "utf8")).includes(dummy));
    await settings.save("replacement-test", () => {});
    assert.ok(!(await readFile(settings.path, "utf8")).includes(dummy));
    await settings.save("", () => {});
    assert.equal(new LocalSettings(options).status().hasCookie, false);
    assert.equal(
      await readFile(legacyPath, "utf8"),
      'ROBLOX_SECURITY_COOKIE="legacy-test-only"',
    );
    const env = { ROBLOX_SECURITY_COOKIE: "explicit-test" };
    const explicit = new LocalSettings({ ...options, env });
    assert.equal(explicit.status().environmentOverride, true);
    assert.equal(explicit.status().hasCookie, true);
    assert.deepEqual(env, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cookie changes preserve quota and cooldown and take effect after in-flight failure", async () => {
  let finish;
  const store = new Store();
  const tracker = new Tracker(store, {
    now: () => 1000000,
    fetchFn: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  try {
    const poll = tracker.poll();
    tracker.configureFetch(createRobloxFetch("synthetic-new"));
    finish(new Response("", { status: 401 }));
    await poll;
    assert.equal(tracker.interval, 3000);
    assert.equal(tracker.requestLimit, 20);
    assert.equal(tracker.nextAt, 1060000);
    store.cooldown(1100000);
    tracker.configureFetch(createRobloxFetch(""));
    assert.equal(tracker.interval, 20500);
    assert.equal(tracker.requestLimit, 3);
    assert.equal(tracker.nextAt, 1100000);
    assert.equal(store.requests(1000000).length, 1);
  } finally {
    store.close();
  }
});
