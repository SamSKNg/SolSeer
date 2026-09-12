import { mkdtemp, mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { packager } from "@electron/packager";
import { copyOcrRuntime } from "./copy-ocr-runtime.js";

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("Build this desktop package on Windows x64.");
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
await mkdir(join(root, "release"), { recursive: true });
const workspace = await mkdtemp(join(root, "release", "desktop-"));
const stage = join(workspace, "source");
await mkdir(stage);
// An explicit allowlist: never copy settings, recordings, .env, or the worktree.
for (const folder of ["dist", "src/server", "src/shared", "src/desktop"])
  await cp(join(root, folder), join(stage, folder), { recursive: true });
await mkdir(join(stage, "scripts"));
for (const file of ["build-screen-helper.js", "windows-screen-helper.cs"])
  await cp(join(root, "scripts", file), join(stage, "scripts", file));
await writeFile(
  join(stage, "package.json"),
  JSON.stringify({
    name: "solseer",
    author: "SolSeer contributors",
    productName: "SolSeer",
    version: manifest.version,
    type: "module",
    main: "src/desktop/main.js",
    private: true,
  }),
);
await copyOcrRuntime(root, stage);
await mkdir(join(stage, "licenses"));
for (const name of ["react", "react-dom", "scheduler", "lucide-react"])
  await cp(
    join(root, "node_modules", name, "LICENSE"),
    join(stage, "licenses", `${name}.txt`),
  );
for (const name of ["dm-sans", "space-grotesk"])
  await cp(
    join(root, "node_modules/@fontsource", name, "LICENSE"),
    join(stage, "licenses", `${name}.txt`),
  );
const compiled = spawnSync(
  process.execPath,
  [join(stage, "scripts/build-screen-helper.js")],
  {
    windowsHide: true,
    stdio: "inherit",
  },
);
if (compiled.status !== 0) throw new Error("Desktop helper build failed");
const [output] = await packager({
  dir: stage,
  out: join(workspace, "app"),
  name: "SolSeer",
  platform: "win32",
  arch: "x64",
  electronVersion: manifest.devDependencies.electron,
  appVersion: manifest.version,
  appBundleId: "com.solseer.desktop",
  icon: join(stage, "dist/solseer.ico"),
  // OCR subprocesses need real paths to their script, model, and native helper.
  asar: false,
  prune: false,
  win32metadata: { ProductName: "SolSeer", FileDescription: "SolSeer Desktop" },
});
await writeFile(
  join(output, "START-HERE.txt"),
  "SolSeer Desktop\r\n\r\nRun SolSeer.exe. No Node installation, terminal, browser tab, or localhost port is needed.\r\nKeep the entire extracted folder together. Minimize to keep tracking; close the window to quit.\r\nExisting settings and history remain in %LOCALAPPDATA%\\solseer. Stop any old browser-based copy before starting this one.\r\nThis build is unsigned; Windows may show a publisher warning.\r\n",
);
const zip = join(
  workspace,
  `SolSeer-desktop-${manifest.version}-windows-x64.zip`,
);
const archive = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Compress-Archive -LiteralPath $env:SOLSEER_DESKTOP_SOURCE -DestinationPath $env:SOLSEER_DESKTOP_ZIP -CompressionLevel Optimal",
  ],
  {
    windowsHide: true,
    stdio: "inherit",
    env: {
      ...process.env,
      SOLSEER_DESKTOP_SOURCE: output,
      SOLSEER_DESKTOP_ZIP: zip,
    },
  },
);
if (archive.status !== 0) throw new Error("Desktop archive failed");
console.log(`Desktop executable: ${join(output, "SolSeer.exe")}`);
console.log(`Desktop ZIP: ${zip}`);
