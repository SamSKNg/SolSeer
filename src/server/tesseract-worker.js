import { createInterface } from "node:readline";
import { createBiomeWorker, recognizeBiome } from "./tesseract-biome.js";

// Private pipe protocol: one request at a time; no HTTP or screenshot files.
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
let worker;
input.once("close", () => {
  void worker?.terminate();
  process.exit(0);
});
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
try {
  worker = await createBiomeWorker();
  emit({ ready: true });
  for await (const line of input) {
    try {
      if (line.length > 1500000) throw new Error("Oversized OCR request");
      const request = JSON.parse(line);
      const result = await recognizeBiome(
        worker,
        Buffer.from(request.pixels, "base64"),
        request.width,
        request.height,
      );
      emit(result);
    } catch {
      emit({ error: "Tesseract could not read this crop." });
    }
  }
} catch {
  emit({ error: "Tesseract could not initialize." });
  process.exitCode = 1;
} finally {
  await worker?.terminate();
  input.close();
}
