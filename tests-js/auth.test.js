import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRobloxFetch,
  configuredRobloxFetch,
} from "../src/server/roblox-fetch.js";
import { Tracker } from "../src/server/tracker.js";
import { Store } from "../src/server/store.js";

const endpoint =
  "https://games.roblox.com/v1/games/15532962292/servers/Public?limit=100";
const dummy = "_|WARNING:-TEST-ONLY|_not-a-real-session";

test("private .env loading supports quoted cookies, absence, blanks and environment precedence", async () => {
  const folder = mkdtempSync(join(tmpdir(), "signal-env-test-"));
  const path = join(folder, ".env");
  const sent = [];
  const fakeFetch = async (_url, options) => {
    sent.push(options.headers.get("Cookie"));
    return new Response('{"data":[]}');
  };
  try {
    await configuredRobloxFetch({}, fakeFetch, path)(endpoint);
    assert.equal(sent.pop(), null);
    writeFileSync(
      path,
      `# Local fixture only\nROBLOX_SECURITY_COOKIE="${dummy}#suffix"\nVITE_UNRELATED=ignored\n`,
    );
    const env = {};
    await configuredRobloxFetch(env, fakeFetch, path)(endpoint);
    assert.equal(sent.pop(), `.ROBLOSECURITY=${dummy}#suffix`);
    assert.deepEqual(env, {});
    for (const override of ["", "override-test-only"]) {
      await configuredRobloxFetch(
        { ROBLOX_SECURITY_COOKIE: override },
        fakeFetch,
        path,
      )(endpoint);
      assert.equal(sent.pop(), override ? `.ROBLOSECURITY=${override}` : null);
    }
    writeFileSync(path, 'ROBLOX_SECURITY_COOKIE=""\n');
    await configuredRobloxFetch({}, fakeFetch, path)(endpoint);
    assert.equal(sent.pop(), null);
    writeFileSync(path, `ROBLOX_SECURITY_COOKIE="${dummy};other=value"`);
    assert.throws(
      () => configuredRobloxFetch({}, fakeFetch, path),
      (error) =>
        error.message.includes("Invalid ROBLOX_SECURITY_COOKIE") &&
        !error.message.includes(dummy),
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("cookie is optional, server-only, GET-only and never forwarded through redirects", async () => {
  for (const cookie of ["", dummy]) {
    let calls = 0;
    const request = createRobloxFetch(cookie, async (url, options) => {
      calls++;
      assert.equal(url, endpoint);
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(
        options.headers.get("cookie"),
        cookie ? `.ROBLOSECURITY=${dummy}` : null,
      );
      assert.equal(options.headers.get("x-csrf-token"), null);
      return new Response('{"data":[]}');
    });
    assert.equal(request.hasCookie, Boolean(cookie));
    await request(endpoint);
    for (const url of [
      "https://example.com/",
      endpoint.replace("https:", "http:"),
      endpoint.replace("games.roblox.com", "games.roblox.com.example.com"),
      endpoint.replace("/servers/Public", "/favorites"),
      endpoint.replace("https://", "https://user:pass@"),
    ]) {
      await assert.rejects(request(url), /Blocked request/);
    }
    await assert.rejects(
      request(endpoint, { method: "POST" }),
      /Blocked request/,
    );
    assert.equal(calls, 1);
  }
});

test("configuration consumes the environment secret and rejects header injection without echo", () => {
  const env = { ROBLOX_SECURITY_COOKIE: dummy };
  configuredRobloxFetch(env);
  assert.equal(env.ROBLOX_SECURITY_COOKIE, undefined);
  for (const value of [
    dummy + "\r\nInjected: yes",
    dummy + "; other=value",
    '"' + dummy + '"',
    `.ROBLOSECURITY=${dummy}`,
    " " + dummy,
  ]) {
    const invalid = { ROBLOX_SECURITY_COOKIE: value };
    assert.throws(
      () => configuredRobloxFetch(invalid),
      (error) => {
        assert.ok(!error.message.includes(dummy));
        return /Invalid ROBLOX_SECURITY_COOKIE/.test(error.message);
      },
    );
    assert.equal(invalid.ROBLOX_SECURITY_COOKIE, undefined);
  }
});

test("network and response parsing failures cannot echo the cookie into snapshots", async () => {
  for (const fetchFn of [
    async () => {
      throw new Error(`request Cookie: .ROBLOSECURITY=${dummy}`);
    },
    async () => new Response(dummy),
  ]) {
    const store = new Store();
    try {
      const tracker = new Tracker(store, {
        fetchFn: createRobloxFetch(dummy, fetchFn),
      });
      await tracker.poll();
      assert.ok(tracker.error);
      assert.ok(!JSON.stringify(tracker.snapshot()).includes(dummy));
      assert.ok(!JSON.stringify(tracker).includes(dummy));
    } finally {
      store.close();
    }
  }
});

test("authenticated failures stay within the same three-attempt budget and do not negotiate CSRF", async () => {
  for (const status of [401, 403, 429]) {
    const store = new Store();
    let now = 1000000,
      calls = 0;
    const tracker = new Tracker(store, {
      now: () => now,
      fetchFn: createRobloxFetch(dummy, async () => {
        calls++;
        return new Response(dummy, {
          status,
          headers: { "retry-after": "1", "x-csrf-token": "test-token" },
        });
      }),
    });
    try {
      for (let i = 0; i < 3; i++) {
        await tracker.poll();
        now += 20500;
      }
      // Go back to the still-full window to check that no fourth request is sent.
      now = 1045000;
      await tracker.poll();
      assert.equal(calls, 3);
      assert.equal(tracker.error, `Roblox HTTP ${status}`);
      assert.ok(!JSON.stringify(tracker.snapshot()).includes(dummy));
      assert.equal(tracker.nextAt, 1060250);
    } finally {
      store.close();
    }
  }
});
