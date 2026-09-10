import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Store } from "./store.js";
import { Tracker } from "./tracker.js";
import { LocalSettings } from "./local-settings.js";
import { EventStreams } from "./event-streams.js";
import { Notifications } from "./notifications.js";
import { pollingFor } from "./polling-config.js";
import { launchRoblox } from "./auto-join.js";
import { FeedbackCollector } from "./feedback.js";
import { joinUrl } from "../shared/roblox-links.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dev = process.argv.includes("--dev");
const port = Number(process.env.PORT || 3000);
let settings;
try {
  settings = new LocalSettings({ legacyPath: resolve(root, ".env") });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const store = new Store();
const feedback = new FeedbackCollector(settings.directory);
const robloxFetch = settings.request;
const settingsToken = randomBytes(32).toString("hex");
const tracker = new Tracker(store, {
  fetchFn: robloxFetch,
  ...pollingFor(robloxFetch.hasCookie),
});
const notifications = new Notifications(settings.directory, {
  onAutoJoin: async ({ id }) => {
    const launched = await launchRoblox(joinUrl(id), {
      onError: () => console.error("Unable to launch Roblox automatically."),
    });
    if (launched) tracker.recordJoin(id);
  },
});
const snapshot = () => {
  const value = tracker.snapshot();
  return { ...value, notifications: notifications.update(value) };
};
const streams = new EventStreams(snapshot);
const vite = dev
  ? await (
      await import("vite")
    ).createServer({ root, server: { middlewareMode: true }, appType: "spa" })
  : null;
const broadcast = () => {
  if (!streams.clients.size) snapshot();
  streams.broadcast();
};
tracker.onUpdate = broadcast;
const server = http.createServer(async (req, res) => {
  try {
    // Loopback-only Host allowlist also blocks browser DNS-rebinding access.
    const actualPort = server.address()?.port;
    const allowedHosts = [`localhost:${actualPort}`, `127.0.0.1:${actualPort}`];
    if (
      !allowedHosts.includes(req.headers.host) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const url = new URL(req.url, "http://localhost");
    // Never serve secret files, including through Vite's /@fs/ routes.
    if (
      /(?:^|[\\/])\.env(?:[.\\/]|$)/i.test(decodeURIComponent(url.pathname))
    ) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // Keep same-origin form POST origins usable; disclose no referrer to Roblox.
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    const feedbackRoute = url.pathname.match(
      /^\/api\/joins\/([1-9]\d*)\/outcome$/,
    );
    if (
      ["/api/settings", "/api/notifications/claim"].includes(url.pathname) ||
      feedbackRoute
    ) {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "GET" && url.pathname === "/api/settings") {
        res.end(
          JSON.stringify({
            ...settings.status(),
            notifications: notifications.preferences,
            token: settingsToken,
          }),
        );
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405).end("{}");
        return;
      }
      if (
        req.headers.origin !== `http://${req.headers.host}` ||
        req.headers["x-solseer-token"] !== settingsToken ||
        req.headers["content-type"]?.split(";")[0].trim() !== "application/json"
      ) {
        res.writeHead(403).end(
          JSON.stringify({
            error: "Refresh settings and try again from this app.",
          }),
        );
        return;
      }
      if (url.pathname === "/api/notifications/claim") {
        snapshot();
        res.end(JSON.stringify({ events: notifications.claim() }));
        broadcast();
        return;
      }
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk.toString("utf8");
          if (Buffer.byteLength(body) > 65536) {
            res
              .writeHead(413)
              .end(JSON.stringify({ error: "Cookie value is too long." }));
            return;
          }
        }
        let payload;
        try {
          payload = JSON.parse(body);
        } catch {
          throw Object.assign(new Error("Invalid JSON request."), {
            status: 400,
          });
        }
        if (feedbackRoute) {
          if (!Object.hasOwn(payload ?? {}, "outcome"))
            throw Object.assign(new Error("Choose a biome outcome."), {
              status: 400,
            });
          const id = Number(feedbackRoute[1]);
          const example = store.feedbackExample(
            id,
            payload?.outcome ?? null,
            tracker.records.get(
              store.joins().find((entry) => entry.id === id)?.jobId,
            ),
          );
          await feedback.save(example);
          const join = store.setJoinOutcome(id, example.outcome);
          res.end(JSON.stringify({ join }));
          broadcast();
          return;
        }
        if (payload?.notifications !== undefined) {
          if (Object.hasOwn(payload, "cookie"))
            throw Object.assign(
              new Error("Save notification and cookie settings separately."),
              { status: 400 },
            );
          const preferences = await notifications.save(payload.notifications);
          res.end(JSON.stringify({ notifications: preferences }));
          broadcast();
          return;
        }
        if (
          typeof payload?.cookie !== "string" ||
          payload.confirmLocalStorage !== true
        ) {
          throw Object.assign(
            new Error("Confirm local plaintext storage before saving."),
            { status: 400 },
          );
        }
        const status = await settings.save(payload.cookie, (request) =>
          tracker.configureFetch(request),
        );
        res.end(JSON.stringify(status));
      } catch (error) {
        res.writeHead(error.status || 500).end(
          JSON.stringify({
            error: error.status
              ? error.message
              : feedbackRoute
                ? "Unable to save biome feedback."
                : "Unable to update settings.",
          }),
        );
      }
      return;
    }
    if (url.pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      streams.add(res);
      return;
    }
    if (url.pathname === "/api/snapshot" && req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(snapshot()));
      return;
    }
    if (url.pathname.startsWith("/api/join/") && req.method === "POST") {
      const origin = req.headers.origin;
      const site = req.headers["sec-fetch-site"];
      const expectedOrigin = `http://${req.headers.host}`;
      // Older open pages may still submit Origin: null under no-referrer.
      // Accept those only with the browser's same-origin Fetch Metadata signal.
      // Compare serialized origins rather than parsing untrusted/null values.
      const originAllowed =
        origin === undefined ||
        origin === expectedOrigin ||
        (origin === "null" && site === "same-origin");
      if (
        !originAllowed ||
        (site && site !== "same-origin" && site !== "none")
      ) {
        res.writeHead(403).end("Invalid origin");
        return;
      }
      const id = decodeURIComponent(url.pathname.slice("/api/join/".length));
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) {
        res.writeHead(400).end("Invalid Job ID");
        return;
      }
      res.writeHead(303, { Location: tracker.recordJoin(id) });
      res.end();
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(404).end("Not found");
      return;
    }
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    const pathname =
      url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const path = resolve(root, "dist", "." + pathname);
    if (
      !path.startsWith(
        resolve(root, "dist") + (process.platform === "win32" ? "\\" : "/"),
      )
    ) {
      res.writeHead(403).end();
      return;
    }
    try {
      const content = await readFile(path);
      res.setHeader(
        "Content-Type",
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
        }[extname(path)] || "application/octet-stream",
      );
      res.end(content);
    } catch {
      res.writeHead(404).end("Not found. Run npm run build first.");
    }
  } catch (error) {
    console.error("Unable to complete local HTTP request");
    if (!res.headersSent) res.writeHead(500);
    res.end("Unable to complete request");
  }
});
server.on("error", async (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Stop the other app first.`
      : error,
  );
  await vite?.close();
  store.close();
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Signal is ready at http://localhost:${server.address().port}`);
  if (process.env.CLUSTER_NO_POLL !== "1") tracker.start();
});
const heartbeat = setInterval(broadcast, 1000);
async function shutdown() {
  tracker.stop();
  clearInterval(heartbeat);
  streams.close();
  server.close();
  await vite?.close();
  // Allow an aborted in-flight request to finish its bookkeeping before exit.
  setTimeout(() => {
    store.close();
    process.exit(0);
  }, 100);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
