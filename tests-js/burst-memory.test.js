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

test("a fresh burst stays in the in-app notice without replaying a desktop alert", () => {
  const { r, observe } = fixture();
  observe(13, 1000);
  const burst = observe(16, 4000);
  assert.equal(burst.notificationEligible, true);
  assert.equal(burst.noticeEligible, true);
  const before = JSON.stringify(r);
  const recent = score(r, 100, 10000);
  assert.equal(recent.signalState, "recent");
  assert.equal(recent.notificationEligible, false);
  assert.equal(recent.noticeEligible, true);
  const stale = score(r, 101, 24001);
  assert.equal(signalLabel({ ...r, ...stale }), "Falling off · stale");
  assert.equal(stale.notificationEligible, false);
  assert.equal(stale.noticeEligible, false);
  assert.equal(stale.alert, "watch");
  assert.equal(JSON.stringify(r), before);
});

test("real flat readings retain a burst beyond the old two-minute limit", () => {
  const { r, observe } = fixture();
  observe(13, 1000);
  observe(16, 4000);
  for (let at = 7000; at <= 184000; at += 3000) {
    const held = observe(16, at);
    assert.equal(held.signalState, "holding");
    assert.equal(held.notificationEligible, false);
    assert.equal(held.noticeEligible, true);
    assert.equal(r.burstMemory.startedAt, 4000);
  }
});

test("an early burst promoted to rapid replaces its +2 evidence with the qualifying +3 window", () => {
  const { r, observe } = fixture();
  observe(13, 1000);
  const early = observe(15, 7000);
  assert.equal(early.alert, "potential");
  assert.equal(r.burstMemory.gain, 2);
  const rapid = observe(16, 10000);
  assert.equal(rapid.alert, "cluster");
  assert.equal(r.burstMemory.tier, "cluster");
  assert.equal(r.burstMemory.gain, 3);
  assert.equal(r.burstMemory.baselinePlayers, 13);
  assert.equal(r.burstMemory.windowMs, 9000);
  const held = observe(16, 13000);
  assert.equal(signalLabel({ ...r, ...held }), "Holding · rapid burst");
  assert.ok(held.reasons.some((reason) => reason.includes("burst +3 in 9s")));
  assert.ok(held.reasons.every((reason) => !reason.includes("burst +2")));
});

test("even bursts clear exactly when at least half of the original gain leaves", () => {
  const { r, observe } = fixture();
  observe(13, 1000);
  observe(17, 4000);
  const retained = observe(16, 7000);
  assert.equal(retained.signalState, "holding");
  assert.equal(retained.burstGainRetained, 3);
  assert.equal(retained.noticeEligible, true);
  const cleared = observe(15, 10000);
  assert.equal(cleared.alert, "watch");
  assert.equal(cleared.noticeEligible, false);
  assert.equal(r.burstMemory, null);
  assert.equal(r.signalHold, null);
});

test("odd bursts require the next whole-player loss to reach half", () => {
  const { r, observe } = fixture();
  observe(13, 1000);
  observe(16, 4000);
  assert.equal(observe(15, 7000).signalState, "holding");
  const cleared = observe(14, 10000);
  assert.equal(cleared.alert, "watch");
  assert.equal(r.burstMemory, null);
});

test("the retention threshold uses the detected burst gain, not a later peak", () => {
  const { r, observe } = fixture();
  observe(13, 1000);
  observe(16, 4000);
  observe(19, 7000);
  assert.equal(r.burstMemory.gain, 3);
  assert.equal(r.burstMemory.peakPlayers, 19);
  assert.equal(observe(15, 10000).signalState, "holding");
  assert.equal(observe(14, 13000).alert, "watch");
  assert.equal(r.burstMemory, null);
});

test("qualifying growth after the half-loss threshold starts a new burst", () => {
  const { r, observe } = fixture();
  observe(13, 1000);
  observe(17, 4000);
  observe(15, 7000);
  assert.equal(r.burstMemory, null);
  const renewed = observe(17, 10000);
  assert.equal(renewed.signalState, "growing");
  assert.equal(renewed.notificationEligible, true);
  assert.equal(r.burstMemory.startedAt, 10000);
  assert.equal(r.burstMemory.baselinePlayers, 15);
});

test("stale recovery and capacity changes discard burst memory; full rapid plateaus do not repeat", () => {
  const { r, observe } = fixture();
  observe(17, 1000);
  const full = observe(20, 4000);
  assert.equal(signalLabel({ ...r, ...full }), "Full · rapid filling");
  assert.equal(full.notificationEligible, true);
  assert.equal(full.noticeEligible, true);
  const plateau = observe(20, 7000);
  assert.equal(signalLabel({ ...r, ...plateau }), "Full · rapid burst");
  assert.equal(plateau.notificationEligible, false);
  assert.equal(plateau.noticeEligible, true);
  const returned = observe(20, 28001);
  assert.equal(returned.awaitingFreshSample, true);
  assert.equal(returned.alert, "warmup");
  assert.equal(r.burstMemory, null);
  observe(16, 31001);
  observe(18, 34001);
  assert.ok(r.burstMemory);
  assert.equal(observe(18, 37001, 25).alert, "warmup");
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
