import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  createBiomeWorker,
  recognizeBiome,
} from "../../src/server/tesseract-biome.js";
const inputs = JSON.parse(await readFile(process.argv[2], "utf8"));
const baseRss = process.memoryUsage().rss;
const initStart = performance.now();
const worker = await createBiomeWorker();
const startupMs = performance.now() - initStart;
const results = [];
try {
  for (const id of ["heaven-low-contrast", "background-negative"]) {
    const item = inputs.find((x) => x.id === id && x.variant === "original");
    const pixels = await readFile(item.rawPath);
    await recognizeBiome(worker, pixels, item.width, item.height);
    const cpu = process.cpuUsage();
    const start = performance.now();
    let peakRss = process.memoryUsage().rss;
    let passes = 0;
    const timings = [];
    for (let i = 0; i < 20; i++) {
      const result = await recognizeBiome(
        worker,
        pixels,
        item.width,
        item.height,
      );
      passes += result.passes;
      timings.push(result.elapsedMs);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      await delay(500);
    }
    const wallMs = performance.now() - start;
    const usedCpu = process.cpuUsage(cpu);
    results.push({
      id,
      scans: 20,
      passes,
      medianOcrMs: timings.sort((a, b) => a - b)[10],
      wallMs,
      cpuPercentOfOneCore:
        ((usedCpu.user + usedCpu.system) / 1000 / wallMs) * 100,
      peakRssMiB: peakRss / 1048576,
      incrementalRssMiB: (peakRss - baseRss) / 1048576,
    });
  }
} finally {
  await worker.terminate();
}
const report = { startupMs, baselineRssMiB: baseRss / 1048576, results };
await writeFile(process.argv[3], JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
