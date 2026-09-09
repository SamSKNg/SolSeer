export const signalLabels = {
  cluster: "Rapid filling",
  potential: "Early lead",
  watch: "Watching",
  warmup: "Awaiting samples",
};

export const isCandidate = (row) =>
  ["cluster", "potential"].includes(row.alert);
export const hasOpenSlot = (row) => row.players < row.capacity;
export const isActionable = (row) => row.isFresh !== false && hasOpenSlot(row);

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
  return (
    bucket(b) - bucket(a) ||
    tier(b) - tier(a) ||
    Number(Boolean(b.followUpConfirmed)) -
      Number(Boolean(a.followUpConfirmed)) ||
    (b.growthPer10s ?? 0) - (a.growthPer10s ?? 0) ||
    (b.lastSeen ?? 0) - (a.lastSeen ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

export function signalLabel(row) {
  if (row.isFresh === false) return "Stale observation";
  if (isCandidate(row) && !hasOpenSlot(row)) return "Full · recent filling";
  if (isCandidate(row) && row.notificationEligible === false)
    return "Recent lead";
  return signalLabels[row.alert] ?? row.alert;
}
