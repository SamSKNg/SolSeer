import { spawn } from "node:child_process";
import electron from "electron";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, process.argv.slice(2), {
  env,
  // This is the interactive GUI, not a background helper. SW_HIDE can suppress
  // Electron's first ShowWindow call on Windows, leaving the app invisible.
  // The OCR helper and its worker still launch with hidden windows separately.
  windowsHide: false,
  stdio: "inherit",
});
child.on("error", () => {
  console.error("Unable to start Electron");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
