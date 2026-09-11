import { readFile, writeFile } from "node:fs/promises";
import { biomeCandidate } from "../../src/server/screen-automation.js";
import { normalizeBiome } from "../../src/shared/biomes.js";
const [output, ...files] = process.argv.slice(2);
const results = [];
for (const file of files) {
  const result = JSON.parse(await readFile(file, "utf8"));
  for (const row of result.rows) {
    const candidate = biomeCandidate(row.text);
    const accepted = candidate?.confidence >= 0.7 ? candidate.biome : null;
    results.push({
      engine: result.engine,
      ...row,
      candidate,
      accepted,
      correct: accepted === row.expected,
      exact:
        row.expected != null &&
        normalizeBiome(row.text) === normalizeBiome(row.expected),
    });
  }
}
await writeFile(output, JSON.stringify(results, null, 2));
console.table(
  results.map((r) => ({
    engine: r.engine,
    id: r.id,
    variant: r.variant,
    text: r.text.trim(),
    match: r.accepted,
    correct: r.correct,
    ms: Math.round(r.medianMs),
  })),
);
