import test from "node:test";
import assert from "node:assert/strict";
import { PLACE_ID, joinUrl } from "../src/shared/roblox-links.js";
import { Store } from "../src/server/store.js";
import { Tracker } from "../src/server/tracker.js";

test("direct app links preserve each exact Job ID without a website or matchmaking fallback", () => {
  for (const id of [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ]) {
    assert.equal(
      joinUrl(id),
      `roblox://placeId=${PLACE_ID}&gameInstanceId=${id}`,
    );
  }
});

test("Job IDs are encoded as one parameter, never injected as extra launch arguments", () => {
  const id = "job&placeId=other?launchData=private#fragment";
  const params = new URLSearchParams(joinUrl(id).slice("roblox://".length));
  assert.equal(params.get("placeId"), String(PLACE_ID));
  assert.equal(params.get("gameInstanceId"), id);
  assert.deepEqual([...params.keys()], ["placeId", "gameInstanceId"]);
});

test("Join, switching servers, and Rejoin keep their own IDs and still record one click each", () => {
  const store = new Store();
  const tracker = new Tracker(store, { now: () => 1000000 });
  try {
    for (const id of ["first-job", "second-job", "first-job"]) {
      assert.equal(tracker.recordJoin(id), joinUrl(id));
    }
    assert.deepEqual(
      store.joins().map((entry) => entry.jobId),
      ["first-job", "second-job", "first-job"],
    );
    assert.equal(store.summary()["first-job"].count, 2);
    assert.equal(store.summary()["second-job"].count, 1);
    assert.equal(store.requests(1000000).length, 0);
  } finally {
    store.close();
  }
});
