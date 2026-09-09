import { setTimeout as sleep } from "node:timers/promises";
import { PLACE_ID } from "./tracker.js";

// Report only numeric quota values, never arbitrary response headers or bodies.
export function quotaHeaders(headers) {
  return Object.fromEntries(
    [
      "x-ratelimit-limit",
      "x-ratelimit-remaining",
      "x-ratelimit-reset",
      "retry-after",
    ].map((name) => {
      const value = headers.get(name);
      return [
        name,
        value !== null &&
        /^\d+(?:\.\d+)?$/.test(value) &&
        Number.isFinite(Number(value))
          ? Number(value)
          : null,
      ];
    }),
  );
}

export async function runPollingProbe({
  store,
  request,
  now = Date.now,
  wait = sleep,
  report = console.log,
}) {
  // Let previous traffic expire so this is an isolated five-second trial.
  let initialWait;
  while ((initialWait = store.availableIn(now(), 1)) > 0) {
    report(
      `Waiting ${Math.ceil(initialWait / 1000)}s for previous traffic/cooldown to clear.`,
    );
    await wait(initialWait);
  }
  const results = [];
  let nextAt = now();
  for (let i = 0; i < 12; i++) {
    if (nextAt > now()) await wait(nextAt - now());
    const quotaWait = store.reserve(now(), 12);
    if (quotaWait) {
      report(
        "Stopped: the shared request budget or cooldown requires waiting.",
      );
      break;
    }
    const started = now();
    nextAt = started + 5000;
    let response, payload;
    try {
      response = await request(
        `https://games.roblox.com/v1/games/${PLACE_ID}/servers/Public?sortOrder=Desc&excludeFullGames=false&limit=100`,
        { signal: AbortSignal.timeout(15000) },
      );
      if (response.ok) payload = await response.json();
      else await response.body?.cancel();
    } catch {
      report(
        "Stopped: network, timeout, redirect, or response parsing failure. No raw error is logged.",
      );
      break;
    }
    const headers = quotaHeaders(response.headers);
    const result = {
      poll: i + 1,
      at: new Date(started).toISOString(),
      status: response.status,
      durationMs: now() - started,
      servers: Array.isArray(payload?.data) ? payload.data.length : null,
      headers,
    };
    results.push(result);
    report(JSON.stringify(result));
    if (response.status === 429 || headers["x-ratelimit-remaining"] === 0) {
      const retryDate = Date.parse(response.headers.get("retry-after"));
      const cooldown = Math.max(
        60000,
        (headers["retry-after"] ?? 0) * 1000,
        (headers["x-ratelimit-reset"] ?? 0) * 1000,
        Number.isFinite(retryDate) ? retryDate - now() : 0,
      );
      store.cooldown(now() + cooldown + 250);
      report(
        "Stopped: Roblox reported throttling or exhausted quota. Wait for Roblox's reset before starting another session; cooldowns are not persisted.",
      );
      break;
    }
    if (!response.ok || !Array.isArray(payload?.data)) {
      report(
        "Stopped: unsuccessful response; no authentication refresh or CSRF retries attempted.",
      );
      break;
    }
  }
  report(
    `Trial finished: ${results.filter((r) => r.status === 200 && r.servers !== null).length}/12 successful responses. This is an observation, not a guaranteed ongoing rate limit.`,
  );
  return results;
}
