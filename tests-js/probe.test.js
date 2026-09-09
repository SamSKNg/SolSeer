import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/server/store.js";
import { runPollingProbe, quotaHeaders } from "../src/server/poll-probe.js";

test("probe waits for previous traffic, sends 12 spaced requests, and preserves normal quota", async () => {
  const store = new Store();
  let now = 1000000;
  store.reserve(now);
  const starts = [];
  try {
    const results = await runPollingProbe({
      store,
      now: () => now,
      wait: async (ms) => {
        now += ms;
      },
      report: () => {},
      request: async () => {
        starts.push(now);
        now += 100;
        return new Response('{"data":[]}');
      },
    });
    assert.equal(results.length, 12);
    assert.equal(starts[0], 1060250);
    assert.ok(starts.slice(1).every((at, i) => at - starts[i] === 5000));
    assert.equal(store.requests(now).length, 12);
    // The normal app must wait for all but its last two requests to expire.
    assert.equal(store.availableIn(now), starts[9] + 60250 - now);
    assert.ok(store.reserve(now) > 0);
  } finally {
    store.close();
  }
});

test("probe stops on 429, exhausted headers, auth errors, malformed payloads and network failures", async () => {
  for (const kind of [429, 401, 403, "empty-quota", "invalid", "network"]) {
    const store = new Store();
    let calls = 0;
    const output = [];
    try {
      await runPollingProbe({
        store,
        now: () => 1000000,
        wait: async () => {
          throw new Error("Should not retry");
        },
        report: (text) => output.push(text),
        request: async () => {
          calls++;
          if (kind === "network") throw new Error("SECRET");
          if (kind === "invalid") return new Response("SECRET");
          return new Response('{"data":[]}', {
            status: typeof kind === "number" ? kind : 200,
            headers:
              kind === "empty-quota"
                ? { "x-ratelimit-remaining": "0" }
                : { "retry-after": "120" },
          });
        },
      });
      assert.equal(calls, 1);
      assert.ok(!output.join(" ").includes("SECRET"));
      if (kind === 429) assert.equal(store.availableIn(1000000), 120250);
      if (kind === "empty-quota")
        assert.equal(store.availableIn(1000000), 60250);
    } finally {
      store.close();
    }
  }
});

test("probe header output only includes numeric allowlisted fields", () => {
  const headers = quotaHeaders(
    new Headers({
      "x-ratelimit-limit": "12",
      "x-ratelimit-remaining": "secret-text",
      "set-cookie": "SECRET",
      authorization: "SECRET",
    }),
  );
  assert.equal(headers["x-ratelimit-limit"], 12);
  assert.equal(headers["x-ratelimit-remaining"], null);
  assert.ok(!JSON.stringify(headers).includes("SECRET"));
});
