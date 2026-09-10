import { mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32") {
  console.log("Skipping the Windows screen helper on this platform.");
  process.exit(0);
}

const root = fileURLToPath(new URL("../", import.meta.url));
const windows = process.env.WINDIR || "C:\\Windows";
const programFilesX86 =
  process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
const framework = join(windows, "Microsoft.NET", "Framework64", "v4.0.30319");
const metadata = join(windows, "System32", "WinMetadata");
const csc = join(framework, "csc.exe");
const runtime = join(framework, "System.Runtime.WindowsRuntime.dll");
for (const path of [csc, runtime, metadata])
  if (!existsSync(path))
    throw new Error(`Required Windows OCR component is missing: ${path}`);

const references = (await readdir(metadata))
  .filter((name) =>
    [
      "Windows.Foundation.winmd",
      "Windows.Graphics.winmd",
      "Windows.Media.winmd",
      "Windows.Storage.winmd",
    ].includes(name),
  )
  .map((name) => join(metadata, name));
references.push(
  runtime,
  join(framework, "System.Runtime.dll"),
  join(framework, "System.Drawing.dll"),
  join(framework, "System.Web.Extensions.dll"),
);
const outputDirectory = join(root, "native");
await mkdir(outputDirectory, { recursive: true });
const output = join(outputDirectory, "solseer-screen-helper.exe");
const result = spawnSync(
  csc,
  [
    "/nologo",
    "/target:exe",
    "/optimize+",
    `/out:${output}`,
    ...references.map((path) => `/reference:${path}`),
    join(root, "scripts", "windows-screen-helper.cs"),
  ],
  { stdio: "inherit", windowsHide: true },
);
if (result.status !== 0)
  throw new Error("Unable to compile the Windows screen helper.");
console.log(`Windows screen helper ready: ${output}`);
