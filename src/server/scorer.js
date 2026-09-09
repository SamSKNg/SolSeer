export const THRESHOLDS = {
  minimumPlayers: 13,
  earlyMaximumPlayers: 18,
  earlyGain: 2,
  earlyWindowMs: 15000,
  rapidGain: 3,
  rapidWindowMs: 10000,
  freshnessMs: 20000,
  signalHoldPolls: 2,
  sustainedMs: 60000,
};

// Counts reveal net movement, not individual arrivals. Compare elapsed time,
// never global poll IDs; another page or a failed request is not a sample.
function growthIn(record, windowMs) {
  const { history, players, capacity, lastSeen } = record;
  let best = null;
  for (let i = history.length - 2; i >= 0; i--) {
    const previous = history[i],
      next = history[i + 1];
    const elapsed = lastSeen - previous.at;
    if (
      elapsed > windowMs ||
      (previous.capacity ?? capacity) !== capacity ||
      next.players < previous.players ||
      previous.at < (record.growthFloorAt ?? -Infinity)
    )
      break;
    if (elapsed <= 0) continue;
    const gain = players - previous.players;
    if (!best || gain > best.gain)
      best = { gain, elapsed, baselineAt: previous.at };
  }
  return best;
}

export function score(
  record,
  currentPoll = record.history.at(-1)?.poll ?? record.history.length - 1,
  now = record.lastSeen,
) {
  const { history, players, capacity, lastSeen } = record;
  const observationAgeMs = Math.max(0, now - lastSeen);
  const isFresh = observationAgeMs <= THRESHOLDS.freshnessMs;
  const observedThisPoll =
    currentPoll === (history.at(-1)?.poll ?? history.length - 1);
  const openSlots = Math.max(0, capacity - players);
  const early = growthIn(record, THRESHOLDS.earlyWindowMs);
  const rapid = growthIn(record, THRESHOLDS.rapidWindowMs);
  const growthQualifies =
    isFresh &&
    openSlots > 0 &&
    players >= THRESHOLDS.minimumPlayers &&
    players <= THRESHOLDS.earlyMaximumPlayers &&
    (early?.gain ?? 0) >= THRESHOLDS.earlyGain;
  const strongGrowth =
    isFresh &&
    openSlots > 0 &&
    players >= THRESHOLDS.minimumPlayers &&
    (rapid?.gain ?? 0) >= THRESHOLDS.rapidGain;
  // A burst first observed at capacity is a missed-entry lead, never a join alert.
  const filledBurst =
    isFresh &&
    openSlots === 0 &&
    players >= THRESHOLDS.minimumPlayers &&
    (early?.gain ?? 0) >= THRESHOLDS.earlyGain;
  const evidence = strongGrowth ? rapid : early;
  const signalHoldPollsRemaining = Math.max(
    0,
    (record.signalHold?.expiresAtPoll ?? currentPoll) - currentPoll,
  );
  const liveRule =
    observedThisPoll && (growthQualifies || strongGrowth || filledBurst);
  const previous = history.at(-2);
  const deltaPoll =
    previous &&
    lastSeen - previous.at <= THRESHOLDS.freshnessMs &&
    (previous.capacity ?? capacity) === capacity
      ? players - previous.players
      : null;

  let alert = deltaPoll === null ? "warmup" : "watch";
  if (liveRule) alert = strongGrowth ? "cluster" : "potential";
  else if (signalHoldPollsRemaining > 0) alert = "potential";
  const candidate = ["potential", "cluster"].includes(alert);
  const followUpConfirmed =
    candidate &&
    isFresh &&
    record.signalHold?.confirmedAt != null &&
    !record.signalHold.confirmationBroken &&
    players >= record.signalHold.triggerPlayers &&
    capacity === record.signalHold.capacity;

  let nearFullSince = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i],
      next = history[i + 1];
    if (
      (h.capacity ?? capacity) !== 20 ||
      h.players < 19 ||
      h.players > 20 ||
      (next && next.at - h.at > THRESHOLDS.freshnessMs)
    )
      break;
    nearFullSince = h.at;
  }
  const nearFullDurationMs =
    nearFullSince === null ? 0 : lastSeen - nearFullSince;
  const sustainedNearFull = nearFullDurationMs >= THRESHOLDS.sustainedMs;
  const reasons = [];
  if (liveRule)
    reasons.push(
      `+${evidence.gain} net players in ${Number((evidence.elapsed / 1000).toFixed(1))}s`,
    );
  else if (candidate)
    reasons.push(
      `Recent ${record.signalHold.reason}; ${signalHoldPollsRemaining} hold polls remaining`,
    );
  if (followUpConfirmed)
    reasons.push("Population held on follow-up (not biome confirmation)");
  if (sustainedNearFull)
    reasons.push(
      `Sustained occupancy: 19–20/20 observed for ${Math.floor(nearFullDurationMs / 1000)}s (context only)`,
    );
  if (candidate && !openSlots)
    reasons.push("Full at last observation; no open-slot notification");
  if (!isFresh) reasons.push("Stale observation; awaiting a new sample");

  const growthPer10s = evidence
    ? (Math.max(0, evidence.gain) * 10000) / evidence.elapsed
    : null;
  return {
    deltaPoll,
    growth15s: early?.gain ?? null,
    growth10s: rapid?.gain ?? null,
    growthWindowMs: evidence?.elapsed ?? null,
    growthPer10s,
    growthQualifies,
    strongGrowth,
    filledBurst,
    signalHoldPollsRemaining,
    followUpConfirmed: Boolean(followUpConfirmed),
    observationAgeMs,
    isFresh,
    openSlots,
    notificationEligible: Boolean(
      observedThisPoll && (growthQualifies || strongGrowth),
    ),
    nearFullDurationMs,
    sustainedNearFull,
    reasons,
    alert,
  };
}

// Only real observations update evidence. Flat follow-ups may retain a burst
// while its baseline is in the timed window; holds alone never renew it.
export function updateSignalHold(record, previousPlayers, poll) {
  const previous = record.history.at(-2);
  const dropped =
    previousPlayers !== undefined && record.players < previousPlayers;
  const capacityChanged =
    previous && (previous.capacity ?? record.capacity) !== record.capacity;
  if (dropped || capacityChanged) record.growthFloorAt = record.lastSeen;
  if (capacityChanged) record.signalHold = null;
  const hold = record.signalHold;
  if (
    hold &&
    (dropped ||
      record.lastSeen - (previous?.at ?? -Infinity) > THRESHOLDS.freshnessMs)
  ) {
    hold.confirmedAt = null;
    hold.confirmationBroken = true;
  } else if (
    hold &&
    !hold.confirmationBroken &&
    record.lastSeen > hold.triggerAt &&
    record.lastSeen - hold.triggerAt <= THRESHOLDS.freshnessMs &&
    record.players >= hold.triggerPlayers &&
    record.capacity === hold.capacity
  ) {
    hold.confirmedAt ??= record.lastSeen;
  }
  const current = score(record, poll);
  if (current.growthQualifies || current.strongGrowth || current.filledBurst) {
    const continueEpisode =
      hold &&
      hold.expiresAtPoll >= poll &&
      !dropped &&
      !hold.confirmationBroken &&
      record.lastSeen - (previous?.at ?? -Infinity) <= THRESHOLDS.freshnessMs;
    record.signalHold = {
      detectedAtPoll: poll,
      expiresAtPoll: poll + THRESHOLDS.signalHoldPolls,
      triggerAt: continueEpisode ? hold.triggerAt : record.lastSeen,
      triggerPlayers: continueEpisode ? hold.triggerPlayers : record.players,
      capacity: record.capacity,
      confirmedAt: continueEpisode ? hold.confirmedAt : null,
      reason: current.strongGrowth
        ? "rapid filling"
        : current.filledBurst
          ? "filling to capacity"
          : "early growth",
    };
  }
}
