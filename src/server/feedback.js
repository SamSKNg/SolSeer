import { readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BIOMES } from "../shared/biomes.js";

const MAX_EXAMPLES = 2000;

const validDocument = (value) =>
  value?.version === 2 &&
  Array.isArray(value.examples) &&
  value.examples.every(
    (example) =>
      typeof example?.feedbackId === "string" &&
      BIOMES.includes(example.biome) &&
      ["windows_ocr", "tesseract"].includes(example.source),
  );

export class FeedbackCollector {
  #examples = new Map();
  #write = Promise.resolve();

  constructor(directory) {
    this.directory = directory;
    this.path = join(directory, "biome-observations.json");
    try {
      const document = JSON.parse(readFileSync(this.path, "utf8"));
      if (validDocument(document))
        for (const example of document.examples)
          this.#examples.set(example.feedbackId, example);
    } catch {
      /* Missing or invalid collections start empty without affecting polling. */
    }
  }

  save(example) {
    this.#write = this.#write
      .catch(() => {})
      .then(async () => {
        this.#examples.delete(example.feedbackId);
        this.#examples.set(example.feedbackId, example);
        while (this.#examples.size > MAX_EXAMPLES)
          this.#examples.delete(this.#examples.keys().next().value);
        const temporary = join(
          this.directory,
          `biome-observation-${randomUUID()}.tmp`,
        );
        try {
          await mkdir(this.directory, { recursive: true, mode: 0o700 });
          await writeFile(
            temporary,
            JSON.stringify({
              version: 2,
              examples: [...this.#examples.values()],
            }),
            { flag: "wx", mode: 0o600 },
          );
          await rename(temporary, this.path);
        } finally {
          await unlink(temporary).catch(() => {});
        }
      });
    return this.#write;
  }
}
