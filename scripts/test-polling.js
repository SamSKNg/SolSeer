import http from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Store } from "../src/server/store.js";
import { configuredRobloxFetch } from "../src/server/roblox-fetch.js";
import { runPollingProbe } from "../src/server/poll-probe.js";
import { AUTHENTICATED_POLLING } from "../src/server/polling-config.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT || 3000);
// Claim the app's port before reading credentials or making any API calls.
// A normal instance cannot start on this port while the test is running.
const guard = http.createServer((_req, res) =>
  res
    .writeHead(503)
    .end(
      "Three-second polling test in progress. Restart the app after the test finishes.",
    ),
);
let store;
try {
  await new Promise((resolve, reject) => {
    guard.once("error", reject);
    guard.listen(port, "127.0.0.1", resolve);
  });
  const request = configuredRobloxFetch(
    process.env,
    fetch,
    resolve(root, ".env"),
    { requireCookie: true },
  );
  store = new Store();
  console.log(
    `Bounded top-page diagnostic: up to ${AUTHENTICATED_POLLING.requestLimit} requests, minimum ${AUTHENTICATED_POLLING.interval / 1000}s between starts. This matches the authenticated app's one-page cadence.`,
  );
  const results = await runPollingProbe({ store, request });
  if (
    results.length !== AUTHENTICATED_POLLING.requestLimit ||
    results.some((result) => result.status !== 200 || result.servers === null)
  )
    process.exitCode = 1;
} catch (error) {
  console.error(
    error.code === "EADDRINUSE"
      ? `Stop the app on port ${port} with Ctrl+C, then run npm run test:polling again.`
      : "Unable to run the test. Check the local cookie configuration and port. No secret or raw error is logged.",
  );
  process.exitCode = 1;
} finally {
  store?.close();
  guard.close();
}
