# Initial comparison — 2026-09-10

Scope: one locally available low-contrast Heaven screenshot, plus DAYTIME and background-only negative crops from the same image. **The Incinerator and Singularity attachments were not available as local files and were not tested.** No generated illustration was used. This is a smoke test, not a biome accuracy benchmark.

Each engine processed 24 variants: three crops, each in original/R/G/B form, with and without 3x enlargement plus padding. Timings below are medians of five warmed calls on this machine. Engines ran sequentially, but other user applications were not stopped. See README for adapter/timing limitations.

| Engine | Original Heaven crop | Median call | Blue channel + 3x/padding | Median call |
| --- | --- | ---: | --- | ---: |
| Windows OCR, en-US | Empty | <1 ms | `[ HEAVEN ]` | 3 ms |
| Tesseract.js 6, English LSTM, single-line | `[HEAVEN]` | 26 ms | `[ HEAVEN ]` | 16 ms |
| PaddleOCR, en_PP-OCRv5_mobile_rec, CPU | `[EaVEN]` | 167 ms | `[HEAVEN]` | 120 ms |

The app's 70% fuzzy matcher accepts PaddleOCR's imperfect original read as Heaven. That is different from reading every character correctly. Fast empty Windows results should not be interpreted as successful recognition latency.

Across the eight Heaven variants, Windows produced an accepted correct match on 1, Tesseract on 4, and PaddleOCR on 3. These are preprocessing variants of **one image**, not independent accuracy samples. All three engines rejected all 16 negative variants as biomes, although some returned unrelated raw text.

## What this supports

- Tesseract single-line deserves further testing: it read this original crop without color preprocessing.
- Enlarging/padding the blue-channel crop also rescued Windows OCR, so replacing the engine is not the only possible improvement.
- The tested PaddleOCR configuration was slower here and did not outperform Tesseract on the original crop. This does not compare other Paddle models or optimized runtimes.
- No conclusion yet about Incinerator, Singularity, live shader backgrounds, or production accuracy. Add those originals and more negative examples before selecting a replacement.

Detailed machine-readable results remain in ignored `.data/ocr-benchmark/comparison.json`, along with each engine's raw output. No live OCR behavior was changed.
