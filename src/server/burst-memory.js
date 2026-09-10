export const BURST_MEMORY = Object.freeze({
  retainedFraction: 0.5,
});

export const retainedPlayersRequired = (burst) =>
  burst.baselinePlayers +
  Math.floor(burst.gain * BURST_MEMORY.retainedFraction) +
  1;

// Called only for real observations. UI heartbeats, errors and other pages
// cannot manufacture retained population or count as evidence of a decline.
export function updateBurstMemory(record, current) {
  const at = record.lastSeen;
  let burst = record.burstMemory;
  const newGrowth =
    current.deltaPoll > 0 &&
    (current.growthQualifies || current.strongGrowth || current.filledBurst);
  if (burst && record.players < retainedPlayersRequired(burst)) {
    record.burstMemory = null;
    record.signalHold = null;
    return;
  }
  if (burst) {
    burst.peakPlayers = Math.max(burst.peakPlayers, record.players);
    burst.retainedObserved = true;
    if (current.strongGrowth && burst.tier !== "cluster") {
      const gain = current.growth10s;
      Object.assign(burst, {
        startedAt: at,
        triggerPlayers: record.players,
        baselinePlayers: record.players - gain,
        gain,
        tier: "cluster",
        windowMs: current.growthWindowMs,
        retainedObserved: false,
      });
    }
  }
  if (newGrowth && !burst) {
    const gain = current.strongGrowth ? current.growth10s : current.growth15s;
    burst = {
      startedAt: at,
      triggerPlayers: record.players,
      capacity: record.capacity,
      baselinePlayers: record.players - gain,
      gain,
      tier: current.strongGrowth ? "cluster" : "potential",
      windowMs: current.growthWindowMs,
      peakPlayers: record.players,
      retainedObserved: false,
    };
  }
  record.burstMemory = burst;
}
