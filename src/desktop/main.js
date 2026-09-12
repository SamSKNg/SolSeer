import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
} from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";
import { dispatch } from "./dispatch.js";
import { assetPath, isAppPage } from "./security.js";
import { launchRoblox } from "../server/auto-join.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "solseer",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
]);
app.setName("SolSeer");
app.setAppUserModelId("com.solseer.desktop");
let window,
  backend,
  unsubscribe,
  quitting = false;

function validateSender(event) {
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    !isAppPage(event.senderFrame.url)
  )
    throw new Error("Untrusted desktop sender");
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitting || !backend) return;
    event.preventDefault();
    quitting = true;
    unsubscribe?.();
    backend.dispose().finally(() => app.quit());
  });
  app
    .whenReady()
    .then(async () => {
      protocol.handle("solseer", async (request) => {
        try {
          if (request.method !== "GET")
            return new Response("Method not allowed", { status: 405 });
          const path = assetPath(join(root, "dist"), request.url);
          return new Response(await readFile(path), {
            headers: {
              "Content-Type": {
                ".html": "text/html",
                ".js": "text/javascript",
                ".css": "text/css",
                ".svg": "image/svg+xml",
                ".png": "image/png",
                ".ico": "image/x-icon",
                ".woff": "font/woff",
                ".woff2": "font/woff2",
              }[extname(path)],
              "Content-Security-Policy":
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'",
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      });
      session.defaultSession.setPermissionRequestHandler(
        (contents, permission, callback, details) => {
          callback(
            contents === window?.webContents &&
              isAppPage(details.requestingUrl ?? contents.getURL()) &&
              ["notifications", "clipboard-sanitized-write"].includes(
                permission,
              ),
          );
        },
      );
      session.defaultSession.setPermissionCheckHandler(
        (contents, permission) =>
          contents === window?.webContents &&
          isAppPage(contents.getURL()) &&
          ["notifications", "clipboard-sanitized-write"].includes(permission),
      );
      process.env.SOLSEER_DESKTOP = "1";
      backend = await import("../server/index.js");
      ipcMain.handle("solseer:request", async (event, message) => {
        validateSender(event);
        const result = await dispatch(backend.handleRequest, message);
        if (result.status === 303) {
          const launched = await launchRoblox(result.headers.location);
          return {
            status: launched ? 200 : 500,
            body: JSON.stringify({ launched }),
            headers: { "content-type": "application/json" },
          };
        }
        return result;
      });
      let exporting = false;
      ipcMain.handle("solseer:export-history", async (event) => {
        validateSender(event);
        if (exporting) return false;
        exporting = true;
        try {
          const result = await dialog.showSaveDialog(window, {
            title: "Export join history",
            defaultPath: "solseer-join-history.json",
            filters: [{ name: "JSON", extensions: ["json"] }],
          });
          if (result.canceled || !result.filePath) return false;
          const data = await dispatch(backend.handleRequest, {
            path: "/api/joins/export",
          });
          if (data.status !== 200) throw new Error("Export failed");
          await writeFile(result.filePath, data.body, "utf8");
          return true;
        } finally {
          exporting = false;
        }
      });
      window = new BrowserWindow({
        icon: join(root, "dist/solseer.ico"),
        title: "SolSeer",
        width: 1360,
        height: 900,
        minWidth: 850,
        minHeight: 620,
        backgroundColor: "#090b0e",
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(root, "src/desktop/preload.cjs"),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          backgroundThrottling: false,
        },
      });
      window.removeMenu();
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        if (!isAppPage(url)) event.preventDefault();
      });
      window.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      unsubscribe = backend.subscribe((value) => {
        if (!window.isDestroyed() && !window.webContents.isLoadingMainFrame())
          window.webContents.send("solseer:snapshot", value);
      });
      window.once("ready-to-show", () => window.show());
      await window.loadURL("solseer://app/");
      backend.startDesktop();
    })
    .catch(async () => {
      dialog.showErrorBox(
        "SolSeer could not start",
        "Unable to initialize the desktop app. Check that the complete package was extracted and the settings folder is writable.",
      );
      app.quit();
    });
}
