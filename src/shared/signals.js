export const signalLabels = {
  cluster: "Rapid filling",
  potential: "Early lead",
  watch: "Watching",
  warmup: "Awaiting samples",
};

export const isCandidate = (row) =>
  ["cluster", "potential"].includes(row.alert);
export const hasOpenSlot = (row) => row.players < row.capacity;
export const isActionable = (row) =>
  row.isFresh !== false &&
  (hasOpenSlot(row) || (row.alert === "cluster" && row.signalState === "full"));

// Keep urgency (freshness + an available slot) separate from evidence strength.
export function compareSignals(a, b) {
  const bucket = (row) =>
    !isCandidate(row)
      ? 0
      : row.isFresh === false
        ? 1
        : hasOpenSlot(row)
          ? 3
          : 2;
  const tier = (row) =>
    ({ cluster: 3, potential: 2, watch: 1, warmup: 0 })[row.alert] ?? 0;
  const active = (row) =>
    row.signalState
      ? Number(row.signalState === "growing")
      : Number(row.notificationEligible !== false);
  // Use a fixed neutral ordering key for missing data (not a displayed score).
  // A pairwise "skip peers if either is missing" comparator is non-transitive.
  const peerDifference =
    (b.peerGrowth?.percentile ?? 50) - (a.peerGrowth?.percentile ?? 50);
  return (
    bucket(b) - bucket(a) ||
    active(b) - active(a) ||
    tier(b) - tier(a) ||
    peerDifference ||
    Number(Boolean(b.followUpConfirmed)) -
      Number(Boolean(a.followUpConfirmed)) ||
    (b.growthPer10s ?? 0) - (a.growthPer10s ?? 0) ||
    (b.lastSeen ?? 0) - (a.lastSeen ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

export function signalLabel(row) {
  if (row.isFresh === false) return "Falling off · stale";
  if (row.awaitingFreshSample) return "Awaiting fresh sample";
  if (row.signalState === "full")
    return row.alert === "cluster"
      ? row.notificationEligible === false
        ? "Full · rapid burst"
        : "Full · rapid filling"
      : "Full · recent burst";
  if (row.signalState === "holding")
    return row.alert === "cluster"
      ? "Holding · rapid burst"
      : "Holding population";
  if (isCandidate(row) && !hasOpenSlot(row)) return "Full · recent filling";
  if (isCandidate(row) && row.notificationEligible === false)
    return row.alert === "cluster" ? "Recent · rapid burst" : "Recent lead";
  return signalLabels[row.alert] ?? row.alert;
}
