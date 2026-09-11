import { copyOcrRuntime } from "../copy-ocr-runtime.js";
import { mkdtemp, cp, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
const stage = await mkdtemp(resolve(".data/ocr-benchmark/package-"));
await copyOcrRuntime(process.cwd(), stage);
await cp("package.json", join(stage, "package.json"));
for (const folder of ["server", "shared"])
  await cp(`src/${folder}`, join(stage, "src", folder), { recursive: true });
const cases = JSON.parse(await readFile(process.argv[2], "utf8"));
const item = cases.find(
  (x) => x.id === "heaven-low-contrast" && x.variant === "original",
);
const pixels = (await readFile(item.rawPath)).toString("base64");
const child = spawn(
  process.execPath,
  [join(stage, "src/server/tesseract-worker.js")],
  { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
);
const exit = new Promise((resolve) =>
  child.once("exit", (code) => resolve(code)),
);
child.stderr.resume();
const timeout = setTimeout(() => child.kill(), 30000);
let received = false;
try {
  for await (const line of createInterface({ input: child.stdout })) {
    const result = JSON.parse(line);
    if (result.ready)
      child.stdin.write(
        JSON.stringify({ width: item.width, height: item.height, pixels }) +
          "\n",
      );
    else {
      assert.match(result.text, /HEAVEN/);
      received = true;
      child.stdin.end();
    }
  }
  assert.ok(received, "Copied runtime returned a crop result");
  assert.equal(await exit, 0);
  console.log("Copied offline OCR runtime and pipe shutdown passed:", stage);
} finally {
  clearTimeout(timeout);
  child.kill();
}
