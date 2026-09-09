import React from "react";

export function Sparkline({ history = [], large = false, capacity = 20, now }) {
  const width = large ? 600 : 130;
  const height = large ? 160 : 34;
  const left = large ? 34 : 4,
    right = width - 4;
  const top = large ? 12 : 4,
    bottom = height - (large ? 12 : 4);
  const counts = history.map((point) => point.players);
  const minimum = counts.length ? Math.min(...counts) : 0;
  const maximum = counts.length ? Math.max(...counts) : 0;
  // One player of padding, with a minimum two-player range to avoid overstating
  // tiny movements or dividing by zero for a flat population history.
  let low = Math.max(0, minimum - 1);
  const high = Math.min(
    Math.max(capacity, maximum, 2),
    Math.max(maximum + 1, low + 2),
  );
  if (high - low < 2) low = Math.max(0, high - 2);
  const start = history[0]?.at ?? 0;
  const last = history.at(-1);
  const end = Math.max(last?.at ?? start, Number.isFinite(now) ? now : start);
  const span = end - start;
  const x = (at) =>
    span > 0
      ? left + ((at - start) / span) * (right - left)
      : (left + right) / 2;
  const y = (players) =>
    bottom - ((players - low) / (high - low)) * (bottom - top);
  const points = history
    // Hold each reading until the next observation, then step to the new count.
    .flatMap((point, index) => [
      ...(index ? [`${x(point.at)},${y(history[index - 1].players)}`] : []),
      `${x(point.at)},${y(point.players)}`,
    ])
    .join(" ");
  const ticks = [...new Set([high, Math.round((high + low) / 2), low])];
  return (
    <svg
      className={`sparkline ${large ? "large" : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Observed player population over time"
    >
      <title>{`Auto-zoomed scale: ${low}–${high} players. Each chart uses its own vertical scale. Steps hold the last reading between observations; dashed extension is last known, not a new reading.`}</title>
      {large &&
        ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              y1={y(tick)}
              x2={right}
              y2={y(tick)}
              stroke="currentColor"
              opacity=".12"
            />
            <text
              x={left - 8}
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fill="currentColor"
              fontSize="12"
              opacity=".65"
            >
              {tick}
            </text>
          </g>
        ))}
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={large ? 2 : 1.8}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {last && end > last.at && (
        <line
          data-last-known="true"
          x1={x(last.at)}
          y1={y(last.players)}
          x2={right}
          y2={y(last.players)}
          stroke="currentColor"
          strokeWidth={large ? 2 : 1.8}
          strokeDasharray="3 3"
          opacity=".6"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {history.length === 1 && (
        <circle
          cx={x(history[0].at)}
          cy={y(history[0].players)}
          r="2"
          fill="currentColor"
        />
      )}
    </svg>
  );
}
