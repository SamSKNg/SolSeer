import { createWorker, PSM } from "tesseract.js";
import english from "@tesseract.js-data/eng";
import { join, dirname } from "node:path";
import { matchBiome } from "./screen-automation.js";

// Encode the native helper's BGRA crop as an uncompressed 24-bit BMP in memory.
export function cropBmp(pixels, width, height, channel = null) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 800 ||
    height > 300 ||
    pixels.length !== width * height * 4 ||
    (channel !== null && ![0, 1, 2].includes(channel))
  )
    throw new Error("Invalid OCR crop");
  let low = 0,
    high = 255;
  if (channel !== null) {
    const hist = new Uint32Array(256);
    for (let i = channel; i < pixels.length; i += 4) hist[pixels[i]]++;
    const count = width * height;
    let cumulative = 0;
    low = -1;
    for (let value = 0; value < 256; value++) {
      cumulative += hist[value];
      if (low < 0 && cumulative >= Math.max(1, Math.floor(count / 100)))
        low = value;
      if (cumulative >= count - Math.floor(count / 100)) {
        high = value;
        break;
      }
    }
    if (high <= low) {
      low = 0;
      high = 255;
      while (low < 255 && hist[low] === 0) low++;
      while (high > low && hist[high] === 0) high--;
    }
  }
  const stride = (width * 3 + 3) & ~3;
  const bmp = Buffer.alloc(54 + stride * height);
  bmp.write("BM");
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = 54 + (height - 1 - y) * stride + x * 3;
      if (channel === null) pixels.copy(bmp, to, from, from + 3);
      else {
        const gray =
          high > low
            ? Math.max(
                0,
                Math.min(
                  255,
                  Math.floor(
                    ((pixels[from + channel] - low) * 255) / (high - low),
                  ),
                ),
              )
            : 255;
        bmp.fill(gray, to, to + 3);
      }
    }
  return bmp;
}

export async function recognizeBiome(worker, pixels, width, height) {
  const start = performance.now();
  let passes = 0;
  for (const channel of [null, 2, 1, 0]) {
    const { data } = await worker.recognize(
      cropBmp(pixels, width, height, channel),
    );
    passes++;
    if (matchBiome(data.text))
      return {
        text: data.text,
        channel:
          channel === null ? "original" : ["blue", "green", "red"][channel],
        engineConfidence: data.confidence / 100,
        passes,
        elapsedMs: performance.now() - start,
      };
  }
  return {
    text: "",
    channel: "none",
    engineConfidence: null,
    passes,
    elapsedMs: performance.now() - start,
  };
}

export async function createBiomeWorker() {
  const worker = await createWorker("eng", 1, {
    langPath: join(dirname(english.langPath), "4.0.0_best_int"),
    gzip: true,
    cacheMethod: "none",
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE });
  return worker;
}

export function matchesPlay(text) {
  return String(text ?? "")
    .split(/\s+/)
    .some((word) => {
      const candidate = word.replace(/[^a-z]/gi, "").toUpperCase();
      // One edit in a four-letter label is 75%; two edits cannot reach 70%.
      if (candidate === "PLAY") return true;
      if (candidate.length === 4)
        return [...candidate].filter((c, i) => c !== "PLAY"[i]).length <= 1;
      if (candidate.length === 3)
        return [..."PLAY"].some(
          (_, i) => "PLAY".slice(0, i) + "PLAY".slice(i + 1) === candidate,
        );
      if (candidate.length === 5)
        return [...candidate].some(
          (_, i) => candidate.slice(0, i) + candidate.slice(i + 1) === "PLAY",
        );
      return false;
    });
}

export async function recognizeFrame(worker, frame) {
  const play = frame.play;
  const playPixels = Buffer.from(play.pixels, "base64");
  const { data } = await worker.recognize(
    cropBmp(playPixels, play.width, play.height),
  );
  const playFound = matchesPlay(data.text);
  // Play is a marker, not a biome. Avoid classifying menu scenery as a biome.
  if (playFound)
    return { text: "", channel: "none", playText: data.text, playFound };
  const biome = frame.biome;
  const result = await recognizeBiome(
    worker,
    Buffer.from(biome.pixels, "base64"),
    biome.width,
    biome.height,
  );
  return { ...result, playText: data.text, playFound };
}
