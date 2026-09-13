import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { UpdateController } from "../src/desktop/updates.js";
function fixture(supported = true) {
  const updater = new EventEmitter(); const calls = [];
  updater.checkForUpdates = async () => { calls.push("check"); updater.emit("update-not-available"); };
  updater.quitAndInstall = (...args) => calls.push(["install", ...args]);
  const controller = new UpdateController({ updater, supported, version: "0.5.5", confirm: async () => true, shutdown: async () => { calls.push("shutdown"); } });
  return { updater, calls, controller };
}
test("development and portable builds never check or install", async () => {
  const { controller, calls } = fixture(false);
  controller.start(); await controller.check(); await controller.install(); controller.stop();
  assert.deepEqual(calls, []); assert.equal(controller.snapshot().status, "unsupported");
});
test("checks are throttled and downloads never install on normal quit", async () => {
  const { controller, calls, updater } = fixture();
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowPrerelease, false); assert.equal(updater.allowDowngrade, false);
  await controller.check(); await controller.check();
  assert.deepEqual(calls, ["check"]); assert.equal(controller.snapshot().status, "current");
});
test("restart requires downloaded update and native confirmation, then stops backend first", async () => {
  const { controller, calls, updater } = fixture();
  assert.equal(await controller.install(), false);
  updater.emit("update-downloaded", { version: "0.6.0" });
  controller.confirm = async () => false;
  assert.equal(await controller.install(), false); assert.deepEqual(calls, []);
  controller.confirm = async () => true;
  assert.equal(await controller.install(), true);
  assert.deepEqual(calls, ["shutdown", ["install", false, true]]);
});
test("network failures are nonfatal and do not expose response content", async () => {
  const { controller, updater } = fixture();
  updater.checkForUpdates = async () => { throw new Error("secret response"); };
  await controller.check(); assert.equal(controller.snapshot().status, "error");
  assert.equal(JSON.stringify(controller.snapshot()).includes("secret"), false);
});
