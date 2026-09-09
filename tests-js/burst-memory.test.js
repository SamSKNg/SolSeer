import test from "node:test";
import assert from "node:assert/strict";
import { score, updateSignalHold } from "../src/server/scorer.js";
import { signalLabel, compareSignals } from "../src/shared/signals.js";

function fixture() {
  const r = { id: "job", history: [], capacity: 20 };
  return {
    r,
    observe(players, at, capacity = 20) {
      const previous = r.players;
      Object.assign(r, { players, lastSeen: at, capacity });
      r.history.push({ players, at, capacity, poll: r.history.length + 1 });
      updateSignalHold(r, previous, r.history.length);
      return score(r);
    },
  };
}

test("a burst remains visible for 60s without inventing follow-up or renewing from heartbeats", () => {
  const { r, observe } = fixture();
  observe(13, 1000);
  const burst = observe(16, 4000);
  assert.equal(burst.notificationEligible, true);
  assert.equal(r.burstMemory.expiresAt, 64000);
  const before = JSON.stringify(r);
  const recent = score(r, 100, 10000); // Many other-page polls cannot expire memory.
  assert.equal(recent.signalState, "recent");
  assert.equal(recent.notificationEligible, false);
  assert.equal(recent.burstRemainingMs, 54000);
  const stale = score(r, 101, 24001);
  assert.equal(signalLabel({ ...r, ...stale }), "Stale observation");
  assert.equal(stale.notificationEligible, false);
  assert.equal(score(r, 102, 63999).alert, "potential");
  assert.equal(score(r, 103, 64000).alert, "watch");
  assert.equal(score(r, 2, 64000).alert, "watch"); // Even if no polls consumed the old grace period.
  assert.equal(JSON.stringify(r), before);
});

test("real flat readings hold a burst and stop exactly at two minutes", () => {
  const { r, observe } = fixture();
  observe(13, 1000);
  observe(16, 4000);
  for (let at = 7000; at < 124000; at += 3000) {
    const held = observe(16, at);
    assert.equal(held.signalState, "holding");
    assert.equal(held.notificationEligible, false);
    assert.equal(r.burstMemory.startedAt, 4000);
    assert.ok(r.burstMemory.expiresAt <= 124000);
  }
  const expired = observe(16, 124000);
  assert.equal(expired.alert, "watch");
  assert.equal(expired.burstRemainingMs, 0);
  assert.equal(observe(16, 127000).alert, "watch");
  assert.equal(observe(18, 130000).notificationEligible, true);
  assert.equal(r.burstMemory.startedAt, 130000); // Genuine new burst, not a plateau replay.
});

test("a one-player loss from the new peak immediately downgrades even above the original trigger", () => {
  const { r, observe } = fixture();
  observe(13, 1000);
  observe(15, 4000);
  observe(19, 7000);
  const drop = observe(18, 10000);
  assert.equal(r.burstMemory.triggerPlayers, 15);
  assert.equal(r.burstMemory.peakPlayers, 19);
  assert.equal(drop.signalState, "declining");
  assert.equal(signalLabel({ ...r, ...drop }), "Declining · recent burst");
  assert.equal(drop.notificationEligible, false);
  assert.equal(drop.followUpConfirmed, false);
  assert.equal(r.burstMemory.removeAtPoll, 5);
  assert.equal(score(r, 4, 17000).signalState, "declining"); // No six-second wall timer.
  // A +1 rebound to the peak is not a new qualifying burst.
  assert.equal(observe(19, 18000).alert, "watch");
  assert.equal(r.burstMemory, null);
  assert.equal(r.signalHold, null);
});

test("additional losses and flat readings never extend a declining burst", () => {
  const { r, observe } = fixture();
  observe(13, 1000);
  observe(17, 4000);
  observe(16, 7000);
  assert.equal(observe(15, 10000).alert, "watch");
  assert.equal(r.burstMemory, null);
  assert.equal(observe(15, 13000).alert, "watch");
  assert.equal(observe(15, 16000).alert, "watch");
});

test("a drop of two or more removes a burst and legacy grace immediately, retaining history", () => {
  for (const loss of [2, 3, 5]) {
    const { r, observe } = fixture();
    observe(13, 1000);
    observe(18, 4000);
    const dropped = observe(18 - loss, 7000);
    assert.equal(dropped.alert, "watch");
    assert.equal(dropped.notificationEligible, false);
    assert.equal(dropped.signalHoldPollsRemaining, 0);
    assert.equal(dropped.burstRemainingMs, 0);
    assert.equal(r.burstMemory, null);
    assert.equal(r.signalHold, null);
    assert.equal(r.history.length, 3);
  }
});

test("new qualifying growth after a drop starts a new burst using only the post-drop baseline", () => {
  const { r, observe } = fixture();
  observe(13, 1000);
  observe(16, 4000);
  observe(15, 7000);
  const renewed = observe(17, 10000);
  assert.equal(renewed.signalState, "growing");
  assert.equal(renewed.notificationEligible, true);
  assert.equal(renewed.growth15s, 2);
  assert.equal(r.burstMemory.startedAt, 10000);
  assert.equal(r.burstMemory.decliningAt, null);
  assert.equal(r.burstMemory.baselinePlayers, 15);
  assert.equal(observe(17, 13000).signalState, "holding");
});

test("stale recovery and capacity changes discard burst memory; full plateaus never alert", () => {
  const { r, observe } = fixture();
  observe(17, 1000);
  const full = observe(20, 4000);
  assert.equal(signalLabel({ ...r, ...full }), "Full · recent burst");
  assert.equal(full.notificationEligible, false);
  for (let at = 7000; at <= 64000; at += 3000) {
    const held = observe(20, at);
    assert.equal(held.signalState, "full");
    assert.equal(held.notificationEligible, false);
  }
  const returned = observe(20, 84001);
  assert.equal(returned.awaitingFreshSample, true);
  assert.equal(returned.alert, "warmup");
  assert.equal(r.burstMemory, null);
  observe(16, 87001);
  observe(18, 90001);
  assert.ok(r.burstMemory);
  assert.equal(observe(18, 93001, 25).alert, "warmup");
  assert.equal(r.burstMemory, null);
});

test("active early growth ranks ahead of retained high-population bursts even with stronger peer context", () => {
  const row = (id, signalState, percentile) => ({
    id,
    signalState,
    alert: "potential",
    players: 17,
    capacity: 20,
    isFresh: true,
    peerGrowth: { percentile },
  });
  const rows = [row("held", "holding", 100), row("growing", "growing", 10)];
  assert.deepEqual(
    rows.sort(compareSignals).map((r) => r.id),
    ["growing", "held"],
  );
});
