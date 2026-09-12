// Run with Electron, optionally pointing at a staged/packaged app directory.
// Uses isolated settings, no Roblox requests, and never clicks or joins.
import { app, dialog } from "electron";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import net from "node:net";

const folder = await mkdtemp(join(tmpdir(), "solseer-desktop-test-"));
app.once("will-quit", () => { if (process.exitCode) app.exit(process.exitCode); });
app.setPath("userData", folder);
process.env.SOLSEER_CONFIG_DIR = folder;
process.env.ROBLOX_SECURITY_COOKIE = "";
process.env.CLUSTER_NO_POLL = "1";
// Assert no Node server opens a TCP listener anywhere during initialization.
net.Server.prototype.listen = () => {
  throw new Error("Desktop attempted to listen on a port");
};
const root = resolve(process.argv[2] || ".");
const exportPath = join(folder, "history-export.json");
dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
dialog.showErrorBox = (_title, message) => {
  console.error(message);
  process.exitCode = 1;
  app.exit(1);
};
const timeout = setTimeout(() => {
  console.error("Desktop smoke timed out");
  app.exit(1);
}, 30000);
app.on("browser-window-created", (_event, window) => {
  if (process.argv.includes("--portrait")) window.setContentSize(1080, 1800);
  if (!process.argv.includes("--visible")) window.show = () => {};
  window.webContents.once("did-finish-load", async () => {
    try {
      const result = await window.webContents.executeJavaScript(`(async () => {
        const bridge = window.solseerDesktop;
        if (!bridge || typeof require !== 'undefined' || typeof process !== 'undefined') throw new Error('Renderer isolation failed');
        const settings = await bridge.request({path:'/api/settings'});
        const initial = JSON.parse(settings.body);
        const saved = await bridge.request({path:'/api/settings', method:'POST', token:initial.token,
          body:JSON.stringify({notifications:{...initial.notifications,pollIntervalSeconds:3}})});
        if (saved.status !== 200) throw new Error('Settings IPC failed');
        const rejected = await bridge.request({path:'/api/settings',method:'POST',body:'{}'});
        if (rejected.status !== 403) throw new Error('Token validation bypassed');
        let blocked = false;
        try { await bridge.request({path:'/.env'}); } catch { blocked = true; }
        if (!blocked) throw new Error('Route allowlist bypassed');
        const update = await new Promise((resolve) => { const stop = bridge.onSnapshot(value => { stop(); resolve(value); }); });
        if (update.pollIntervalMs !== 3000) throw new Error('Polling change not applied');
        if (!await bridge.exportHistory()) throw new Error('Export failed');
        return {url:location.href, title:document.title, rendered:!!document.querySelector('.shell'),
          rows:update.rows.length, polling:update.pollIntervalMs, ocrStatus:update.automation.status};
      })()`);
      assert.equal(result.rendered, true);
      if (process.argv.includes("--portrait")) {
        const heroHeight = await window.webContents.executeJavaScript(
          "document.querySelector('.page-heading').getBoundingClientRect().height",
        );
        assert.ok(heroHeight >= 540 && heroHeight <= 760, `Portrait hero height: ${heroHeight}`);
        console.log("Portrait hero height:", heroHeight);
      }
      assert.equal(result.url, "solseer://app/");
      JSON.parse(await readFile(exportPath, "utf8"));
      const prefs = window.webContents.getLastWebPreferences();
      assert.equal(prefs.sandbox, true);
      assert.equal(prefs.contextIsolation, true);
      assert.equal(prefs.nodeIntegration, false);
      // Allow the existing entrance animations to complete before visual QA.
      await new Promise((resolve) => setTimeout(resolve, 1800));
      const screenshot = await window.webContents.capturePage();
      const screenshotPath = join(folder, "desktop.png");
      await writeFile(screenshotPath, screenshot.toPNG());
      console.log("Desktop smoke passed:", JSON.stringify(result));
      console.log("Screenshot:", screenshotPath);
      clearTimeout(timeout);
      app.quit();
    } catch (error) {
      console.error(error);
      clearTimeout(timeout);
      process.exitCode = 1;
      app.quit();
    }
  });
});
await import(pathToFileURL(join(root, "src/desktop/main.js")).href);
