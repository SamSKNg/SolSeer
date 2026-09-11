import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(
  resolve(".data/ocr-benchmark/tesseract/package.json"),
);
const { createWorker, PSM } = require("tesseract.js");
const cases = JSON.parse(await readFile(process.argv[2], "utf8"));
const start = performance.now();
const worker = await createWorker("eng", 1, {
  cachePath: resolve(".data/ocr-benchmark/tesseract"),
});
await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
const startupMs = performance.now() - start;
const rows = [];
try {
  for (const item of cases) {
    const bytes = await readFile(item.path);
    const times = [];
    let result;
    for (let run = 0; run < 6; run++) {
      const start = performance.now();
      result = (await worker.recognize(bytes)).data;
      if (run) times.push(performance.now() - start);
    }
    rows.push({
      ...item,
      text: result.text,
      engineConfidence: result.confidence / 100,
      medianMs: times.sort((a, b) => a - b)[2],
    });
    console.log(item.id, item.variant, JSON.stringify(result.text));
  }
} finally {
  await worker.terminate();
}
await writeFile(
  process.argv[3],
  JSON.stringify(
    { engine: "Tesseract.js 6 / LSTM / single-line", startupMs, rows },
    null,
    2,
  ),
);
