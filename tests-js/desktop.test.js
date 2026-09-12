import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { allowedRequest, dispatch } from "../src/desktop/dispatch.js";
import { isAppPage, assetPath } from "../src/desktop/security.js";

test("desktop bridge only accepts fixed app routes and bounded messages", async () => {
  for (const path of ["/api/settings", "/api/snapshot", "/api/joins/export"])
    assert.equal(allowedRequest(path, "GET"), true);
  assert.equal(allowedRequest("/api/join/test-job", "POST"), true);
  for (const message of [
    { path: "https://example.com" },
    { path: "/api/events" },
    { path: "/.env" },
    { path: "/api/join/../../file", method: "POST" },
    { path: "/api/settings", method: "DELETE" },
    { path: "/api/settings", body: "x".repeat(65537) },
    { path: "/api/settings", body: {} },
  ])
    await assert.rejects(
      dispatch(() => assert.fail("Must not dispatch"), message),
    );
});

test("in-process requests preserve backend method, JSON, token and response status", async () => {
  const result = await dispatch(
    async (req, res) => {
      assert.equal(req.url, "/api/settings");
      assert.equal(req.method, "POST");
      assert.equal(req.headers["x-solseer-token"], "test-token");
      let body = "";
      for await (const chunk of req) body += chunk;
      assert.equal(body, '{"notifications":{}}');
      res.setHeader("Content-Type", "application/json");
      res.writeHead(400).end('{"error":"invalid"}');
    },
    {
      path: "/api/settings",
      method: "POST",
      token: "test-token",
      body: '{"notifications":{}}',
    },
  );
  assert.deepEqual(result, {
    status: 400,
    headers: { "content-type": "application/json" },
    body: '{"error":"invalid"}',
  });
});

test("desktop origin and asset resolution reject other origins and filesystem escapes", () => {
  assert.equal(isAppPage("solseer://app/"), true);
  assert.equal(isAppPage("solseer://app/index.html#main-content"), true);
  for (const value of [
    "https://app/",
    "file:///index.html",
    "solseer://evil/",
    "solseer://user@app/",
    "solseer://app/assets/a.js",
  ])
    assert.equal(isAppPage(value), false);
  const dist = resolve("test-dist");
  assert.equal(
    assetPath(dist, "solseer://app/assets/ui.js"),
    resolve(dist, "assets/ui.js"),
  );
  for (const value of [
    "file:///secret.js",
    "solseer://evil/a.js",
    "solseer://app/%2e%2e%2fsecret.js",
    "solseer://app/%5c..%5csecret.js",
    "solseer://app/.env",
    "solseer://app/config.json",
  ])
    assert.throws(() => assetPath(dist, value));
});
