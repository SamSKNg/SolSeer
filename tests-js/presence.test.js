import test from "node:test";
import assert from "node:assert/strict";
import { PresenceTracker } from "../src/server/presence-tracker.js";

const response = (value, status = 200) =>
  new Response(JSON.stringify(value), { status });

test("account presence resolves the exact Sol's RNG Job ID", async () => {
  const calls = [];
  const request = Object.assign(() => {}, {
    hasCookie: true,
    authenticatedUser: async () => {
      calls.push("identity");
      return response({ id: 42, name: "Seer", displayName: "Seer Display" });
    },
    userPresence: async (id) => {
      calls.push(`presence:${id}`);
      return response({
        userPresences: [
          {
            userId: 42,
            userPresenceType: 2,
            placeId: 15532962292,
            gameId: "exact-job-id",
            lastLocation: "Sol's RNG",
          },
        ],
      });
    },
  });
  const tracker = new PresenceTracker({ request, now: () => 1234 });
  assert.deepEqual(calls, []);
  const current = await tracker.refresh();
  assert.equal(current.status, "in_experience");
  assert.equal(current.serverId, "exact-job-id");
  assert.equal(current.username, "Seer");
  assert.equal(current.checkedAt, 1234);
  await tracker.refresh();
  assert.deepEqual(calls, ["identity", "presence:42", "presence:42"]);
});

test("presence never treats another experience or a hidden instance as current", async () => {
  let presence = {
    userId: 42,
    userPresenceType: 2,
    placeId: 1,
    gameId: "other-job",
  };
  const request = Object.assign(() => {}, {
    hasCookie: true,
    authenticatedUser: async () => response({ id: 42, name: "Seer" }),
    userPresence: async () => response({ userPresences: [presence] }),
  });
  const tracker = new PresenceTracker({ request });
  assert.equal((await tracker.refresh()).status, "in_other_experience");
  assert.equal(tracker.snapshot().serverId, null);
  presence = {
    ...presence,
    placeId: 15532962292,
    gameId: null,
  };
  assert.equal((await tracker.refresh()).status, "experience_server_hidden");
  assert.equal(tracker.snapshot().serverId, null);
});

test("presence disables safely without a cookie and sanitizes failures", async () => {
  const anonymous = new PresenceTracker({ request: { hasCookie: false } });
  assert.equal((await anonymous.refresh()).status, "cookie_required");
  const request = Object.assign(() => {}, {
    hasCookie: true,
    authenticatedUser: async () =>
      response({ secret: "PRIVATE_RESPONSE_MUST_NOT_ESCAPE" }, 500),
  });
  const tracker = new PresenceTracker({ request });
  const state = await tracker.refresh();
  assert.equal(state.status, "unavailable");
  assert.ok(!JSON.stringify(state).includes("PRIVATE_RESPONSE"));
});
