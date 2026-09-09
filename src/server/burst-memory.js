export const BURST_MEMORY = Object.freeze({
  retainMs: 60000,
  maximumMs: 120000,
});

// Called only for real observations. UI heartbeats, errors and other pages
// cannot extend a burst or count as evidence of a decline.
export function updateBurstMemory(record, current, poll) {
  const at = record.lastSeen;
  let burst = record.burstMemory;
  const newGrowth =
    current.deltaPoll > 0 &&
    (current.growthQualifies || current.strongGrowth || current.filledBurst);
  if (current.deltaPoll <= -2) {
    record.burstMemory = null;
    record.signalHold = null;
    return;
  }
  if (
    burst &&
    (at >= burst.expiresAt || poll >= (burst.removeAtPoll ?? Infinity))
  ) {
    burst = null;
    if (!newGrowth) record.signalHold = null;
  }
  // Only new qualifying growth after the dip may start a new episode.
  // A flat reading or a small bounce must not revive the old plateau.
  if (burst?.decliningAt != null && newGrowth) burst = null;
  if (burst) {
    if (current.deltaPoll < 0 && burst.decliningAt == null) {
      burst.decliningAt = at;
      burst.removeAtPoll = poll + 1;
    }
    burst.peakPlayers = Math.max(burst.peakPlayers, record.players);
    if (burst.decliningAt == null) {
      burst.retainedObserved = true;
      burst.expiresAt = Math.min(
        at + BURST_MEMORY.retainMs,
        burst.startedAt + BURST_MEMORY.maximumMs,
      );
    }
  }
  if (newGrowth && !burst) {
    const gain = current.strongGrowth ? current.growth10s : current.growth15s;
    burst = {
      startedAt: at,
      expiresAt: at + BURST_MEMORY.retainMs,
      triggerPlayers: record.players,
      capacity: record.capacity,
      baselinePlayers: record.players - gain,
      gain,
      windowMs: current.growthWindowMs,
      peakPlayers: record.players,
      decliningAt: null,
      retainedObserved: false,
    };
  }
  record.burstMemory = burst;
}
