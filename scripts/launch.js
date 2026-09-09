import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const child = spawn(
  process.execPath,
  [fileURLToPath(new URL("../src/server/index.js", import.meta.url))],
  {
    cwd: root,
    windowsHide: true,
    stdio: ["inherit", "pipe", "inherit"],
    env: { ...process.env, PORT: process.env.PORT || "3000" },
  },
);
let opened = false;
let output = "";
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  output = (output + chunk.toString()).slice(-4096);
  const match = output.match(/Signal is ready at (http:\/\/localhost:\d+)/);
  if (!opened && match) {
    opened = true;
    console.log(
      "Keep this window open while using solseer. Press Ctrl+C to stop.\nYour cookie can be entered in Settings; never paste it into this window.",
    );
    if (process.env.SOLSEER_NO_BROWSER !== "1") {
      const browser = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Start-Process '${match[1]}'`,
        ],
        { windowsHide: true, stdio: "ignore" },
      );
      browser.on("error", () =>
        console.log(`Open ${match[1]} in your browser.`),
      );
    }
  }
});
child.on("error", () => {
  console.error(
    "Unable to start solseer. Extract the entire ZIP before opening Start solseer.cmd.",
  );
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
