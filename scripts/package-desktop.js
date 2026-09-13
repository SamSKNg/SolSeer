import { mkdtemp, mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { packager } from "@electron/packager";
import { copyOcrRuntime } from "./copy-ocr-runtime.js";

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("Build this desktop package on Windows x64.");
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const installer = process.argv.includes("--installer");
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
    solseerInstaller: installer,
    description: "SolSeer desktop radar for Sol's RNG",
    dependencies: installer ? Object.fromEntries(["tesseract.js", "@tesseract.js-data/eng", "electron-updater"].map(name => [name, manifest.dependencies[name]])) : undefined,
  }),
);
await copyOcrRuntime(root, stage, installer ? ["electron-updater"] : []);
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
if (installer) {
  // Electron extraction renames directories; avoid OneDrive locking that step.
  const buildOutput = await mkdtemp(join(tmpdir(), "solseer-installer-"));
  const { build, Platform } = await import("electron-builder");
  const artifacts = await build({
    projectDir: stage,
    targets: Platform.WINDOWS.createTarget("nsis"),
    publish: "never",
    config: {
      appId: "com.solseer.desktop",
      productName: "SolSeer",
      electronVersion: manifest.devDependencies.electron,
      directories: { output: buildOutput },
      // Stage contains only explicitly copied application/runtime files.
      files: ["**/*"],
      asar: false,
      npmRebuild: false,
      artifactName: "SolSeer-Setup-${version}.${ext}",
      publish: [{ provider: "github", owner: "SamSKNg", repo: "SolSeer", releaseType: "draft" }],
      win: { icon: join(stage, "dist/solseer.ico"), target: ["nsis"] },
      nsis: { oneClick: true, perMachine: false, deleteAppDataOnUninstall: false, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: "SolSeer", runAfterFinish: true },
    },
  });
  await cp(buildOutput, join(root, "release", "installer"), { recursive: true });
  console.log("Installer artifacts:", artifacts.join("\n"));
  process.exit(0);
}
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
