import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/server/store.js";
import { Tracker } from "../src/server/tracker.js";
import { score } from "../src/server/scorer.js";

const response = (players, cursor = "page2") =>
  new Response(
    JSON.stringify({
      data: [{ id: "job", playing: players, maxPlayers: 20, ping: 50 }],
      nextPageCursor: cursor,
    }),
  );
const sample = (counts) => {
  const history = counts.map((players, i) => ({ at: i * 5000, players }));
  return {
    id: "job",
    players: counts.at(-1),
    capacity: 20,
    history,
    lastSeen: history.at(-1).at,
    pollInterval: 5000,
  };
};

test("near-cap thresholds, warmup, declining and strong growth", () => {
  assert.equal(score(sample([13, 15])).alert, "potential");
  assert.equal(score(sample([12, 14, 15])).alert, "cluster");
  assert.equal(score(sample([12, 14])).alert, "potential");
  assert.equal(score(sample([19, 18])).alert, "watch");
  assert.equal(score(sample([20])).alert, "warmup");
  assert.equal(score(sample([9, 13])).alert, "cluster");
});

test("growth alerts never fast-forward the schedule or replace coverage polls", async () => {
  for (const interval of [5000, 20500]) {
    const store = new Store();
    let now = 1000000;
    const urls = [],
      replies = [response(13), response(15), response(16)];
    const tracker = new Tracker(store, {
      now: () => now,
      interval,
      requestLimit: interval === 5000 ? 12 : 3,
      fetchFn: async (url) => {
        urls.push(url);
        return replies.shift();
      },
    });
    try {
      await tracker.poll();
      now = tracker.nextAt;
      await tracker.poll();
      assert.equal(
        tracker.snapshot().rows[0].alert,
        interval === 5000 ? "potential" : "warmup",
      );
      assert.equal(tracker.nextAt - now, interval);
      assert.equal("pending" in tracker.snapshot(), false);
      now = tracker.nextAt;
      await tracker.poll();
      assert.equal(new URL(urls[2]).searchParams.get("cursor"), "page2");
      assert.equal("verification" in tracker.events[0], false);
      assert.equal(tracker.status, "Live");
    } finally {
      store.close();
    }
  }
});

test("ordinary polling uses top, top, coverage; errors retain observed servers", async () => {
  const store = new Store();
  let now = 1000000;
  const urls = [];
  const replies = [
    response(13, "one"),
    response(14, "two"),
    new Response("bad", { status: 500 }),
    response(14),
  ];
  const tracker = new Tracker(store, {
    now: () => now,
    fetchFn: async (url) => {
      urls.push(url);
      return replies.shift();
    },
  });
  try {
    await tracker.poll();
    now += 20500;
    await tracker.poll();
    now += 20500;
    await tracker.poll();
    assert.equal(new URL(urls[2]).searchParams.get("cursor"), "one");
    assert.equal(tracker.records.get("job").players, 14);
    assert.equal(tracker.events[0].error, "Roblox HTTP 500");
    now = tracker.nextAt;
    await tracker.poll();
    assert.equal(new URL(urls[3]).searchParams.get("cursor"), "one");
    assert.equal(tracker.status, "Live");
  } finally {
    store.close();
  }
});

test("429 reset header takes precedence over short retry-after", async () => {
  const store = new Store();
  const tracker = new Tracker(store, {
    now: () => 1000000,
    fetchFn: async () =>
      new Response("", {
        status: 429,
        headers: { "retry-after": "5", "x-ratelimit-reset": "47" },
      }),
  });
  try {
    await tracker.poll();
    assert.equal(tracker.nextAt, 1047500);
    assert.equal(store.availableIn(1000000), 47500);
    assert.equal(store.requests(1000000).length, 1);
  } finally {
    store.close();
  }
});

test("UI snapshots do not rebase old observations on current time", async () => {
  const store = new Store();
  let now = 1000000;
  const replies = [response(13), response(15)];
  const tracker = new Tracker(store, {
    now: () => now,
    fetchFn: async () => replies.shift(),
  });
  try {
    await tracker.poll();
    now += 20500;
    await tracker.poll();
    const row = tracker.snapshot().rows[0];
    now += 10000;
    assert.equal(tracker.snapshot().rows[0].growthPer10s, row.growthPer10s);
    assert.equal(tracker.snapshot().rows[0].lastSeen, row.lastSeen);
    tracker.recordJoin("job");
    assert.equal(tracker.snapshot().rows[0].joined.count, 1);
  } finally {
    store.close();
  }
});

test("flat observations are kept while missed pages, errors, and heartbeats add no chart samples", async () => {
  const store = new Store();
  let now = 1000000;
  const replies = [
    response(17),
    response(17),
    new Response(JSON.stringify({ data: [] })),
    new Response("bad", { status: 500 }),
  ];
  const tracker = new Tracker(store, {
    now: () => now,
    interval: 5000,
    requestLimit: 12,
    fetchFn: async () => replies.shift(),
  });
  try {
    await tracker.poll();
    now += 5000;
    await tracker.poll();
    const samples = tracker.snapshot().rows[0].history;
    assert.deepEqual(
      samples.map(({ at, players }) => ({ at, players })),
      [
        { at: 1000000, players: 17 },
        { at: 1005000, players: 17 },
      ],
    );
    now += 1000;
    assert.deepEqual(tracker.snapshot().rows[0].history, samples);
    now += 4000;
    await tracker.poll();
    now += 5000;
    await tracker.poll();
    assert.deepEqual(tracker.snapshot().rows[0].history, samples);
  } finally {
    store.close();
  }
});
