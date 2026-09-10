import {
  mkdir,
  mkdtemp,
  copyFile,
  cp,
  readFile,
  writeFile,
  readdir,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

if (process.platform !== "win32" || !["x64", "arm64"].includes(process.arch))
  throw new Error("Build this portable package on Windows x64 or arm64.");
const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
await readFile(join(root, "dist", "index.html"));
const releases = join(root, "release");
await mkdir(releases, { recursive: true });
const workspace = await mkdtemp(join(releases, "build-"));
const app = join(workspace, "solseer");
await mkdir(app);
const official = "https://nodejs.org/dist/latest-v22.x/";
async function download(path) {
  const response = await fetch(official + path, {
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok || new URL(response.url).origin !== "https://nodejs.org")
    throw new Error("Official Node download failed.");
  return Buffer.from(await response.arrayBuffer());
}
console.log(
  "Downloading and verifying the current Node 22 runtime from nodejs.org…",
);
const checksums = (await download("SHASUMS256.txt")).toString();
const match = checksums.match(
  new RegExp(
    `^([a-f0-9]{64})\\s+(node-v22\\.[0-9]+\\.[0-9]+-win-${process.arch}\\.zip)$`,
    "m",
  ),
);
if (!match) throw new Error("Official runtime checksum not found.");
const runtimeZip = await download(match[2]);
if (createHash("sha256").update(runtimeZip).digest("hex") !== match[1])
  throw new Error("Runtime checksum mismatch.");
const archive = join(workspace, "node-runtime.zip");
await writeFile(archive, runtimeZip);
const extracted = join(workspace, "runtime-source");
function powershell(command, env) {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true, stdio: "inherit", env: { ...process.env, ...env } },
  );
  if (result.status !== 0) throw new Error("Windows archive operation failed.");
}
powershell(
  "Expand-Archive -LiteralPath $env:SOLSEER_ARCHIVE -DestinationPath $env:SOLSEER_EXTRACT",
  { SOLSEER_ARCHIVE: archive, SOLSEER_EXTRACT: extracted },
);
await mkdir(join(app, "runtime"));
const runtime = join(extracted, match[2].slice(0, -4));
await copyFile(join(runtime, "node.exe"), join(app, "runtime", "node.exe"));
await mkdir(join(app, "licenses"));
await copyFile(
  join(runtime, "LICENSE"),
  join(app, "licenses", "Node-LICENSE.txt"),
);
for (const name of ["react", "react-dom", "scheduler", "lucide-react"]) {
  await copyFile(
    join(root, "node_modules", name, "LICENSE"),
    join(app, "licenses", `${name}-LICENSE.txt`),
  );
}
// Explicit allowlist. Never copy a project root, .env, profile, session data or node_modules.
for (const folder of ["server", "shared"]) {
  const destination = join(app, "src", folder);
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(join(root, "src", folder))) {
    if (name.endsWith(".js"))
      await copyFile(join(root, "src", folder, name), join(destination, name));
  }
}
await cp(join(root, "dist"), join(app, "dist"), {
  recursive: true,
  filter: (source) =>
    !/(?:^|[\\/])\.env(?:[.\\/]|$)/i.test(source) && !source.endsWith(".map"),
});
await mkdir(join(app, "scripts"));
await copyFile(
  join(root, "scripts", "launch.js"),
  join(app, "scripts", "launch.js"),
);
await copyFile(
  join(root, "scripts", "Start solseer.cmd"),
  join(app, "Start solseer.cmd"),
);
await mkdir(join(app, "native"));
await copyFile(
  join(root, "native", "solseer-screen-helper.exe"),
  join(app, "native", "solseer-screen-helper.exe"),
);
await writeFile(
  join(app, "package.json"),
  JSON.stringify(
    {
      name: "solseer-portable",
      version,
      private: true,
      type: "module",
    },
    null,
    2,
  ),
);
await writeFile(
  join(app, "START-HERE.txt"),
  `SOLSEER — WINDOWS PORTABLE\r\n\r\nExtract the entire ZIP. Double-click Start solseer.cmd. No Node installation or npm command needed.\r\nYour browser opens at http://localhost:3000. Keep the console open; Ctrl+C stops the app.\r\nIf port 3000 is busy, stop the previous app first.\r\nJoining requires Roblox installed and signed in. Join and copied server links use roblox:// direct-app links; allow the browser launch prompt if you intended to join. Account presence marks the exact current server when Roblox exposes its Job ID.\r\n\r\nBiome OCR runs whenever solseer is open and requires foreground, maximized Roblox at the 1920x1080 or 2560x1440 resolution selected in Settings. Auto-Start is optional and off by default; it adds zooming with O after repeated unclear in-game reads and clicks Play through Windows SendInput after two fuzzy matches. Configure biome targets and OCR matching in Settings. Every join pauses further auto-joins for up to 60 seconds while Play and the game view load.\r\n\r\nPaste your own Roblox cookie only in Settings. It is saved as plaintext at %LOCALAPPDATA%\\solseer\\.env, outside this folder. Never share that file.\r\nNo cookie, join history, or biome feedback is included in this distribution. Clearing settings disables the cookie but does not erase older project .env files or backups.\r\nServer observations and joins last only for the running session. Biome labels, Auto-Start, and target preferences are saved locally outside this folder.\r\n\r\nRuntime: ${match[2]} (SHA-256 verified against nodejs.org). Third-party notices are in licenses.\r\nThis is a portable launcher with an unsigned local OCR helper, not a signed installer or native desktop window.\r\n`,
);
const zip = resolve(
  releases,
  `solseer-v${version}-windows-${process.arch}.zip`,
);
console.log("Creating portable Windows ZIP…");
powershell(
  "Compress-Archive -LiteralPath $env:SOLSEER_APP -DestinationPath $env:SOLSEER_OUTPUT",
  { SOLSEER_APP: app, SOLSEER_OUTPUT: zip },
);
console.log(`Portable package ready: ${zip}\nUnpacked copy: ${app}`);
