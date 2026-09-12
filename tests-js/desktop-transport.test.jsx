import { test, expect, vi, afterEach } from "vitest";
import { apiFetch, snapshotStream } from "../src/client/transport.js";

afterEach(() => {
  delete window.solseerDesktop;
  vi.unstubAllGlobals();
});

test("desktop requests use IPC, preserve response errors and exclude browser-only options", async () => {
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  const request = vi.fn(async () => ({
    status: 400,
    body: '{"error":"invalid"}',
    headers: { "content-type": "application/json" },
  }));
  window.solseerDesktop = { request };
  const response = await apiFetch("/api/settings", {
    method: "POST",
    body: "{}",
    headers: { "X-Solseer-Token": "test" },
    signal: new AbortController().signal,
  });
  expect(response.ok).toBe(false);
  expect(await response.json()).toEqual({ error: "invalid" });
  expect(request).toHaveBeenCalledWith({
    path: "/api/settings",
    method: "POST",
    body: "{}",
    token: "test",
  });
  expect(network).not.toHaveBeenCalled();
});

test("desktop snapshot subscriptions remove listeners and ignore late responses after close", async () => {
  let finish, push;
  const remove = vi.fn();
  window.solseerDesktop = {
    request: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    onSnapshot: (callback) => {
      push = callback;
      return remove;
    },
  };
  const stream = snapshotStream();
  const receive = vi.fn();
  stream.onmessage = receive;
  push({ now: 2 });
  expect(JSON.parse(receive.mock.calls[0][0].data)).toEqual({ now: 2 });
  stream.close();
  finish({ status: 200, body: '{"now":1}', headers: {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  push({ now: 3 });
  expect(remove).toHaveBeenCalledOnce();
  expect(receive).toHaveBeenCalledOnce();
});

test("an aborted desktop request is not sent", async () => {
  const request = vi.fn();
  window.solseerDesktop = { request };
  const controller = new AbortController();
  controller.abort();
  await expect(
    apiFetch("/api/settings", { signal: controller.signal }),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
