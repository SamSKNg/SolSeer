import test from "node:test";
import assert from "node:assert/strict";
import { Tracker } from "../src/server/tracker.js";
import { Store } from "../src/server/store.js";
import { AUTHENTICATED_POLLING } from "../src/server/polling-config.js";

const server = (id, playing) => ({ id, playing, maxPlayers: 20 });
const page = (data, nextPageCursor = null, headers = {}) =>
  new Response(JSON.stringify({ data, nextPageCursor }), { headers });
function fixture(fetchFn) {
  const store = new Store();
  let now = 1000000;
  const calls = [];
  const tracker = new Tracker(store, {
    ...AUTHENTICATED_POLLING,
    interval: 3000,
    pagesPerPoll: 2,
    now: () => now,
    fetchFn: async (url, options) => {
      const cursor = new URL(url).searchParams.get("cursor");
      calls.push({ cursor, at: now });
      return fetchFn(cursor, calls.length, options, (ms) => {
        now += ms;
      });
    },
  });
  return {
    store,
    tracker,
    calls,
    advance: (ms) => {
      now += ms;
    },
    async poll() {
      now = Math.max(now, tracker.nextAt);
      await tracker.poll();
      return tracker.snapshot();
    },
  };
}

test("each pair starts from page 1, uses its fresh cursor, stops at page 2 and preserves page timestamps", async () => {
  const f = fixture((cursor, call, _options, advance) => {
    advance(cursor ? 50 : 100);
    return cursor
      ? page([server("second", 16)], "never-fetch-page3")
      : page([server("first", 17)], `page2-from-${call}`);
  });
  try {
    await f.poll();
    await f.poll();
    assert.deepEqual(
      f.calls.map((c) => c.cursor),
      [null, "page2-from-1", null, "page2-from-3"],
    );
    assert.deepEqual(
      f.calls.map((c) => c.at),
      [1000000, 1000100, 1003000, 1003100],
    );
    const s = f.tracker.snapshot();
    assert.equal(s.polls, 2);
    assert.equal(s.totalRequests, 4);
    assert.equal(s.budget, 4);
    assert.equal(s.events[0].requests, 2);
    assert.equal(s.events[0].count, 2);
    assert.equal(s.events[0].partial, false);
    assert.deepEqual(
      f.tracker.records.get("first").history.map((h) => h.at),
      [1000100, 1003100],
    );
    assert.deepEqual(
      f.tracker.records.get("second").history.map((h) => h.at),
      [1000150, 1003150],
    );
  } finally {
    f.store.close();
  }
});

test("duplicates across pages count once per cycle, use the later reading and cannot fake a burst", async () => {
  const f = fixture((cursor, call, _options, advance) => {
    advance(100);
    return cursor
      ? page([server("job", call === 2 ? 15 : 17)])
      : page([server("job", call === 1 ? 13 : 16)], "page2");
  });
  try {
    const first = await f.poll();
    assert.equal(first.rows[0].alert, "warmup");
    assert.equal(first.rows[0].players, 15);
    assert.equal(first.rows[0].history.length, 1);
    assert.equal(first.events[0].duplicates, 1);
    assert.equal(first.events[0].fetchedCount, 2);
    const second = await f.poll();
    assert.equal(second.rows[0].history.length, 2);
    assert.equal(second.rows[0].deltaPoll, 2);
    assert.equal(second.rows[0].notificationEligible, true);
  } finally {
    f.store.close();
  }
});

test("missing next cursor skips page 2 and late-added cursors are picked up on the next cycle", async () => {
  const f = fixture((cursor, call) =>
    page([server("job", 15)], call === 1 || cursor ? null : "page2"),
  );
  try {
    assert.equal((await f.poll()).events[0].requests, 1);
    assert.equal((await f.poll()).events[0].requests, 2);
    assert.deepEqual(
      f.calls.map((c) => c.cursor),
      [null, null, "page2"],
    );
  } finally {
    f.store.close();
  }
});

test("page-2 failures retain page-1 results without refreshing old page-2 observations", async () => {
  for (const status of [400, 500, 429, "malformed", "network"]) {
    const f = fixture((cursor, call, _options, advance) => {
      advance(100);
      if (!cursor)
        return page([server("first", call === 1 ? 13 : 15)], `page2-${call}`);
      if (call === 2) return page([server("second", 17)]);
      if (status === "network")
        throw new Error("PRIVATE_VALUE_MUST_NOT_ESCAPE");
      if (status === "malformed")
        return new Response("PRIVATE_VALUE_MUST_NOT_ESCAPE");
      return new Response("", { status, headers: { "retry-after": "12" } });
    });
    try {
      await f.poll();
      const lastSeen = f.tracker.records.get("second").lastSeen;
      const partial = await f.poll();
      assert.equal(partial.events[0].partial, true);
      assert.equal(partial.events[0].requests, 2);
      assert.equal(partial.events[0].count, 1);
      assert.equal(partial.rows.find((r) => r.id === "first").players, 15);
      assert.equal(f.tracker.records.get("second").lastSeen, lastSeen);
      assert.equal(f.tracker.records.get("second").history.length, 1);
      assert.ok(!JSON.stringify(partial).includes("PRIVATE_VALUE"));
      if (status === 429) assert.ok(partial.nextAt - partial.now >= 12500);
      await f.poll();
      assert.equal(f.calls[4].cursor, null); // Never retry a saved page-2 cursor.
    } finally {
      f.store.close();
    }
  }
});

test("page-1 rate limits stop the pair and exhausted headers defer page 2", async () => {
  for (const mode of ["429", "header"]) {
    const f = fixture(() =>
      mode === "429"
        ? new Response("", { status: 429, headers: { "retry-after": "12" } })
        : page(
            [server("job", 15)],
            "page2",
            mode === "header"
              ? { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "12" }
              : {},
          ),
    );
    try {
      const s = await f.poll();
      assert.equal(f.calls.length, 1);
      assert.equal(s.events[0].requests, 1);
      assert.ok(s.nextAt > s.now + 3000);
      if (mode !== "429") {
        assert.equal(s.events[0].partial, true);
        assert.equal(s.events[0].deferredPage, 2);
        assert.equal(s.rows[0].players, 15);
      }
    } finally {
      f.store.close();
    }
  }
});

test("authentication failures downgrade to anonymous one-page polling even on page 2", async () => {
  for (const failingPage of [1, 2]) {
    const f = fixture((_cursor, call) =>
      call === failingPage
        ? new Response("", { status: 403 })
        : page([], "page2"),
    );
    try {
      const s = await f.poll();
      assert.equal(s.requestLimit, null);
      assert.equal(s.pagesPerPoll, 1);
      assert.equal(s.pollIntervalMs, 20500);
      assert.ok(s.nextAt - s.now >= 60000);
      assert.equal(f.calls.length, failingPage);
    } finally {
      f.store.close();
    }
  }
});

test("two pages are one completed heuristic poll; in-flight page 2 cannot invent burst loss", async () => {
  let players = 13,
    finish;
  const f = fixture((cursor, call) => {
    if (!cursor) return page([server("job", players)], "page2");
    if (call === 6)
      return new Promise((resolve) => {
        finish = resolve;
      });
    return page([]);
  });
  try {
    await f.poll();
    players = 16;
    await f.poll();
    players = 15;
    const pending = f.poll();
    // Flush the resolved page-1 request and its response body.
    while (!finish) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.tracker.snapshot().events[0].id, 2);
    assert.equal(f.tracker.snapshot().rows[0].players, 16);
    await f.tracker.poll(); // Busy guard: never start an overlapping pair.
    assert.equal(f.calls.length, 6);
    finish(page([]));
    const dropped = await pending;
    assert.equal(dropped.polls, 3);
    assert.equal(dropped.rows[0].signalState, "holding");
    players = 14;
    const removed = await f.poll();
    assert.equal(removed.rows[0].alert, "watch");
    assert.equal(removed.rows[0].history.length, 4);
    assert.equal(removed.totalRequests, 8);
  } finally {
    f.store.close();
  }
});

test("stopping during page 1 never launches page 2", async () => {
  let tracker;
  const f = fixture(() => {
    tracker.stop();
    return page([server("job", 15)], "page2");
  });
  tracker = f.tracker;
  try {
    const s = await f.poll();
    assert.equal(f.calls.length, 1);
    assert.equal(s.events[0].partial, true);
    assert.equal(s.busy, false);
  } finally {
    f.store.close();
  }
});
