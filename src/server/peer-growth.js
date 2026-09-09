import { THRESHOLDS } from "./scorer.js";

export const PEER_GROWTH = Object.freeze({
  windowMs: 15000,
  minimumDurationMs: 3000,
  durationToleranceMs: 3000,
  populationTolerance: 2,
  minimumPeers: 20,
});

// Endpoint slope over the longest available continuous 3–15s window. Keep
// flat and negative movement; never use rendered/extended graph points or
// maximize over several windows to make a peer's growth look more unusual.
export function populationSlope(record, now) {
  if (now - record.lastSeen > THRESHOLDS.freshnessMs) return null;
  const latest = record.history.at(-1);
  if (!latest) return null;
  let baseline = null;
  for (let i = record.history.length - 2; i >= 0; i--) {
    const point = record.history[i],
      next = record.history[i + 1];
    const durationMs = latest.at - point.at;
    if (
      durationMs > PEER_GROWTH.windowMs ||
      next.at - point.at > THRESHOLDS.freshnessMs ||
      (point.capacity ?? record.capacity) !== record.capacity
    )
      break;
    if (durationMs >= PEER_GROWTH.minimumDurationMs) baseline = point;
  }
  if (!baseline) return null;
  const durationMs = latest.at - baseline.at;
  return {
    startPlayers: baseline.players,
    durationMs,
    netGain: record.players - baseline.players,
    per10s: ((record.players - baseline.players) * 10000) / durationMs,
    endedAt: latest.at,
  };
}

// Rank context only: this never changes detection/notification eligibility.
// One sample per other server, matched by capacity, starting population,
// duration and recency. Insufficient peers stay null, never a made-up score.
export function addPeerGrowth(rows, now) {
  const samples = rows.map((row) => ({
    row,
    sample: populationSlope(row, now),
  }));
  const byCapacity = new Map();
  for (const item of samples) {
    if (!item.sample) continue;
    const group = byCapacity.get(item.row.capacity) ?? [];
    group.push(item);
    byCapacity.set(item.row.capacity, group);
  }
  for (const { row, sample } of samples) {
    const peers = !sample
      ? []
      : (byCapacity.get(row.capacity) ?? [])
          .filter(
            (item) =>
              item.row.id !== row.id &&
              Math.abs(item.sample.startPlayers - sample.startPlayers) <=
                PEER_GROWTH.populationTolerance &&
              Math.abs(item.sample.durationMs - sample.durationMs) <=
                PEER_GROWTH.durationToleranceMs &&
              Math.abs(item.sample.endedAt - sample.endedAt) <=
                PEER_GROWTH.windowMs,
          )
          .map((item) => item.sample.per10s);
    const sufficient = peers.length >= PEER_GROWTH.minimumPeers;
    const sorted = sufficient ? [...peers].sort((a, b) => a - b) : [];
    const middle = Math.floor(sorted.length / 2);
    row.peerGrowth = {
      slopePer10s: sample?.per10s ?? null,
      durationMs: sample?.durationMs ?? null,
      count: peers.length,
      minimumPeers: PEER_GROWTH.minimumPeers,
      // Strictly lower peers: a completely flat cohort does not get P50/P100
      // merely by tying. Percentile is descriptive, not biome probability.
      percentile: sufficient
        ? Math.round(
            (100 * peers.filter((rate) => rate < sample.per10s).length) /
              peers.length,
          )
        : null,
      medianPer10s: sufficient
        ? sorted.length % 2
          ? sorted[middle]
          : (sorted[middle - 1] + sorted[middle]) / 2
        : null,
    };
  }
  return rows;
}
