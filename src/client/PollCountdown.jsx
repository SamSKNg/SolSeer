import React, { useEffect, useState } from "react";

export function PollCountdown({
  nextAt,
  serverNow,
  receivedAt,
  busy,
  connected,
}) {
  // Only this small component rerenders on ticks, not all the server charts.
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 250);
    return () => clearInterval(timer);
  }, []);
  // Use elapsed monotonic time, so client/server wall-clock differences do not matter.
  const elapsed = Math.max(0, performance.now() - receivedAt);
  const remaining = Math.max(
    0,
    Math.ceil(((nextAt ?? 0) - (serverNow ?? 0) - elapsed) / 1000),
  );
  return (
    <strong aria-label="Next poll countdown">
      {!connected ? "—" : busy ? "Requesting…" : `${remaining}s`}
    </strong>
  );
}
