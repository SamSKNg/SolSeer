import test from "node:test";
import assert from "node:assert/strict";
import { launchRoblox } from "../src/server/auto-join.js";

test("Windows auto-join passes the validated URL directly to the protocol dispatcher", async () => {
  const calls = [];
  const handlers = {};
  const child = {
    once: (event, handler) => {
      handlers[event] = handler;
    },
  };
  const url = "roblox://placeId=15532962292&gameInstanceId=test-job";
  const launched = launchRoblox(url, {
    platform: "win32",
    spawnFn: (...args) => {
      calls.push(args);
      return child;
    },
  });
  const [command, args, options] = calls[0];
  assert.equal(command, "rundll32.exe");
  assert.deepEqual(args, ["url.dll,FileProtocolHandler", url]);
  assert.equal(options.windowsHide, true);
  assert.equal(options.stdio, "ignore");
  handlers.exit(0);
  assert.equal(await launched, true);
});

test("auto-join rejects untrusted URLs and reports unsupported platforms", async () => {
  await assert.rejects(
    launchRoblox("https://example.test/", { platform: "win32" }),
    /Invalid Roblox join URL/,
  );
  const errors = [];
  assert.equal(
    await launchRoblox("roblox://placeId=15532962292&gameInstanceId=test-job", {
      platform: "linux",
      onError: (error) => errors.push(error.message),
    }),
    false,
  );
  assert.match(errors[0], /Windows/);
});

test("auto-join reports dispatcher failures instead of logging a false join", async () => {
  const errors = [];
  let exit;
  const result = launchRoblox(
    "roblox://placeId=15532962292&gameInstanceId=test-job",
    {
      platform: "win32",
      spawnFn: () => ({
        once: (event, handler) => {
          if (event === "exit") exit = handler;
        },
      }),
      onError: (error) => errors.push(error.message),
    },
  );
  exit(1);
  assert.equal(await result, false);
  assert.match(errors[0], /exited with 1/);
});
