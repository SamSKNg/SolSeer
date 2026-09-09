import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";

test(
  "HTTP app serves React, streams snapshots, and records POST joins before redirect",
  { timeout: 25000 },
  async () => {
    const production = process.env.SIGNAL_TEST_PRODUCTION === "1";
    const configDir = await mkdtemp(join(tmpdir(), "solseer-http-settings-"));
    const portableRoot = process.env.SOLSEER_TEST_APP_ROOT;
    const child = spawn(
      portableRoot
        ? join(portableRoot, "runtime", "node.exe")
        : process.execPath,
      ["src/server/index.js", ...(production ? [] : ["--dev"])],
      {
        cwd: portableRoot || process.cwd(),
        env: {
          ...process.env,
          PORT: "3197",
          CLUSTER_NO_POLL: "1",
          ROBLOX_SECURITY_COOKIE: "synthetic-http-test-cookie",
          SOLSEER_CONFIG_DIR: configDir,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    let logs = "";
    child.stderr.on("data", (b) => (logs += b));
    child.stdout.on("data", (b) => (logs += b));
    try {
      let ready = false;
      for (let i = 0; i < 100; i++) {
        if (logs.includes("Signal is ready")) {
          ready = true;
          break;
        }
        if (child.exitCode !== null) throw new Error(logs);
        await delay(100);
      }
      assert.ok(ready, logs);
      const base = "http://127.0.0.1:3197";
      assert.equal(
        (await (await fetch(base + "/api/snapshot")).json()).totalJoins,
        0,
      );
      for (const path of [
        "/.env",
        "/%2eenv",
        "/.env.local",
        "/@fs/C:/project/.env?raw",
      ]) {
        const blocked = await fetch(base + path);
        assert.equal(blocked.status, 403);
        assert.equal(await blocked.text(), "Forbidden");
      }
      const page = await fetch(base);
      assert.equal(page.status, 200);
      assert.equal(page.headers.get("referrer-policy"), "same-origin");
      const html = await page.text();
      if (production) {
        const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)];
        assert.ok(
          assets.length >= 2,
          "Production HTML links built JavaScript and CSS",
        );
        for (const [, asset] of assets) {
          const response = await fetch(base + asset);
          assert.equal(response.status, 200);
          assert.ok((await response.text()).length > 0);
        }
      } else {
        assert.match(html, /src\/client\/main.jsx/);
      }
      const controller = new AbortController();
      const stream = await fetch(base + "/api/events", {
        signal: controller.signal,
      });
      const reader = stream.body.getReader();
      const first = await reader.read();
      assert.match(new TextDecoder().decode(first.value), /data:.*"rows":\[\]/);
      await reader.cancel();
      controller.abort();
      const joined = await fetch(base + "/api/join/test-job", {
        method: "POST",
        redirect: "manual",
      });
      assert.equal(joined.status, 303);
      assert.match(joined.headers.get("location"), /gameInstanceId=test-job/);
      const snapshot = await (await fetch(base + "/api/snapshot")).json();
      assert.equal(snapshot.totalJoins, 1);
      assert.equal(snapshot.pollIntervalMs, 5000);
      assert.equal(snapshot.requestLimit, 12);
      assert.equal(snapshot.minimumPlayers, 13);
      assert.ok(
        !JSON.stringify(snapshot).includes("synthetic-http-test-cookie"),
      );
      assert.ok(!logs.includes("synthetic-http-test-cookie"));
      assert.equal(snapshot.joins[0].jobId, "test-job");
      const forbidden = await fetch(base + "/api/join/test-job", {
        method: "POST",
        headers: { Origin: "http://other.test" },
        redirect: "manual",
      });
      assert.equal(forbidden.status, 403);
      const settingsResponse = await fetch(base + "/api/settings");
      const settings = await settingsResponse.json();
      assert.equal(settings.hasCookie, true);
      assert.equal(settingsResponse.headers.get("cache-control"), "no-store");
      assert.equal(settingsResponse.headers.get("x-frame-options"), "DENY");
      assert.ok(
        !JSON.stringify(settings).includes("synthetic-http-test-cookie"),
      );
      const dummy = "synthetic-settings-cookie";
      const headers = {
        Origin: base,
        "Content-Type": "application/json",
        "X-Solseer-Token": settings.token,
      };
      const body = JSON.stringify({ cookie: dummy, confirmLocalStorage: true });
      for (const overrides of [
        { Origin: "http://evil.test" },
        { "X-Solseer-Token": "bad" },
        { "Content-Type": "text/plain" },
        { "Sec-Fetch-Site": "cross-site" },
      ]) {
        const rejected = await fetch(base + "/api/settings", {
          method: "POST",
          headers: { ...headers, ...overrides },
          body,
        });
        assert.equal(rejected.status, 403, JSON.stringify(overrides));
      }
      const rebindingStatus = await new Promise((resolve, reject) => {
        const request = httpRequest(
          base + "/api/settings",
          { headers: { Host: "evil.test:3197" } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        request.on("error", reject);
        request.end();
      });
      assert.equal(rebindingStatus, 403);
      assert.equal(
        (
          await fetch(base + "/api/settings", {
            method: "POST",
            headers,
            body: '{"cookie":"' + dummy,
          })
        ).status,
        400,
      );
      const saved = await fetch(base + "/api/settings", {
        method: "POST",
        headers,
        body,
      });
      assert.equal(saved.status, 200);
      assert.ok(!(await saved.text()).includes(dummy));
      assert.ok(
        (await readFile(join(configDir, ".env"), "utf8")).includes(dummy),
      );
      const afterSave = await (await fetch(base + "/api/snapshot")).json();
      assert.equal(afterSave.requestLimit, 12);
      assert.equal(afterSave.totalJoins, 1);
      assert.ok(!JSON.stringify(afterSave).includes(dummy));
      const preferences = { enabled: true, potential: false, cluster: true };
      const cookieFile = await readFile(join(configDir, ".env"), "utf8");
      const notificationSave = await fetch(base + "/api/settings", {
        method: "POST",
        headers,
        body: JSON.stringify({ notifications: preferences }),
      });
      assert.equal(notificationSave.status, 200);
      assert.deepEqual(
        (await notificationSave.json()).notifications,
        preferences,
      );
      assert.equal(await readFile(join(configDir, ".env"), "utf8"), cookieFile);
      assert.deepEqual(
        JSON.parse(
          await readFile(join(configDir, "notifications.json"), "utf8"),
        ),
        preferences,
      );
      assert.deepEqual(
        (await (await fetch(base + "/api/settings")).json()).notifications,
        preferences,
      );
      assert.deepEqual(
        (await (await fetch(base + "/api/snapshot")).json()).notifications
          .preferences,
        preferences,
      );
      const claim = await fetch(base + "/api/notifications/claim", {
        method: "POST",
        headers,
      });
      assert.equal(claim.status, 200);
      assert.deepEqual(await claim.json(), { events: [] });
      assert.equal(
        (
          await fetch(base + "/api/notifications/claim", {
            method: "POST",
            headers: { ...headers, "X-Solseer-Token": "invalid" },
          })
        ).status,
        403,
      );
      assert.equal(
        (await fetch(base + "/api/notifications/claim")).status,
        405,
      );
      assert.equal(
        (
          await fetch(base + "/api/settings", {
            method: "POST",
            headers,
            body: JSON.stringify({ notifications: { enabled: "true" } }),
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await fetch(base + "/api/settings", {
            method: "POST",
            headers,
            body: JSON.stringify({ notifications: preferences, cookie: "" }),
          })
        ).status,
        400,
      );
      const cleared = await fetch(base + "/api/settings", {
        method: "POST",
        headers,
        body: JSON.stringify({ cookie: "", confirmLocalStorage: true }),
      });
      assert.equal((await cleared.json()).hasCookie, false);
      assert.equal(
        (await (await fetch(base + "/api/snapshot")).json()).requestLimit,
        3,
      );
      assert.ok(!logs.includes(dummy));
      // Browser form navigation differs from the fetch()-based join above.
      const joinsBefore = (await (await fetch(base + "/api/snapshot")).json())
        .totalJoins;
      const formHeaders = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
      };
      const cases = [
        [{ Origin: base, "Sec-Fetch-Site": "same-origin" }, 303],
        [{ Origin: "null", "Sec-Fetch-Site": "same-origin" }, 303],
        [{ "Sec-Fetch-Site": "same-origin" }, 303],
        [{ Origin: "null" }, 403],
        [{ Origin: "null", "Sec-Fetch-Site": "cross-site" }, 403],
        [{ Origin: "null", "Sec-Fetch-Site": "same-site" }, 403],
        [{ Origin: "null", "Sec-Fetch-Site": "none" }, 403],
        [{ Origin: "not-a-url", "Sec-Fetch-Site": "same-origin" }, 403],
        [{ Origin: "http://evil.test", "Sec-Fetch-Site": "same-origin" }, 403],
        [{ Origin: "https://127.0.0.1:3197" }, 403],
        [{ Origin: base + "/path" }, 403],
        [{ Origin: base, "Sec-Fetch-Site": "same-site" }, 403],
      ];
      for (const [extra, expected] of cases) {
        const result = await fetch(base + "/api/join/form-test-job", {
          method: "POST",
          redirect: "manual",
          headers: { ...formHeaders, ...extra },
          body: "",
        });
        assert.equal(result.status, expected, JSON.stringify(extra));
        if (expected === 303) {
          assert.equal(
            result.headers.get("location"),
            "https://www.roblox.com/games/start?placeId=15532962292&gameInstanceId=form-test-job",
          );
        } else assert.equal(result.headers.get("location"), null);
      }
      const joinsAfter = await (await fetch(base + "/api/snapshot")).json();
      assert.equal(joinsAfter.totalJoins, joinsBefore + 3);
      assert.equal(
        joinsAfter.joins.filter((item) => item.jobId === "form-test-job")
          .length,
        3,
      );
      // The compatibility exception is join-only, never credential/settings writes.
      assert.equal(
        (
          await fetch(base + "/api/settings", {
            method: "POST",
            headers: {
              ...headers,
              Origin: "null",
              "Sec-Fetch-Site": "same-origin",
            },
            body: JSON.stringify({ cookie: dummy, confirmLocalStorage: true }),
          })
        ).status,
        403,
      );
      assert.ok(!logs.includes("Unable to complete local HTTP request"));
    } finally {
      child.kill();
      if (child.exitCode === null)
        await new Promise((resolve) => child.once("exit", resolve));
      await rm(configDir, { recursive: true, force: true });
    }
  },
);
