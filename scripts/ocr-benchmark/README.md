# Local OCR comparison

These scripts compare engines independently of the live pipeline. Images remain local. The first run downloads Python/npm dependencies and OCR models. Use saved original screenshots, **not AI-generated crop illustrations**.

Tested environment: Windows, Python 3.12, Node 22, PaddleOCR 3.2.0 / PaddlePaddle 3.2.0, Tesseract.js 6 (WASM LSTM, English single-line), Windows OCR with the installed user language. Dependencies are isolated under ignored `.data/ocr-benchmark`; PaddleOCR also caches models under the user's `.paddlex` directory.

## Setup (PowerShell, repository root)

```powershell
python -m venv .data/ocr-benchmark/venv
.data/ocr-benchmark/venv/Scripts/python.exe -m pip install paddleocr==3.2.0 paddlepaddle==3.2.0 pillow
npm install --prefix .data/ocr-benchmark/tesseract --no-audit --no-fund tesseract.js@6
```

Create `.data/ocr-benchmark/cases.json` containing a list like:

```json
[
  {"id":"incinerator-1440p", "path":"C:/screenshots/incinerator.png", "crop":[5,1150,425,32], "expected":"Incinerator"},
  {"id":"blank", "path":"C:/screenshots/blank-biome-crop.png", "expected":null}
]
```

Paths refer to original local files; crop coordinates are `[x,y,width,height]` and must be within the image. Omit crop for an already-cropped biome row. `expected` is a canonical biome name or null for negative examples. Include red backgrounds, other biomes, blank regions, and unrelated text. Crops from one screenshot are correlated and are not independent accuracy samples.

## Run

```powershell
.data/ocr-benchmark/venv/Scripts/python.exe scripts/ocr-benchmark/prepare.py .data/ocr-benchmark/cases.json .data/ocr-benchmark/inputs
powershell.exe -NoProfile -File scripts/ocr-benchmark/windows.ps1 -Inputs .data/ocr-benchmark/inputs/inputs.json -Output .data/ocr-benchmark/windows.json
node scripts/ocr-benchmark/tesseract.js .data/ocr-benchmark/inputs/inputs.json .data/ocr-benchmark/tesseract.json
.data/ocr-benchmark/venv/Scripts/python.exe scripts/ocr-benchmark/run_paddle.py .data/ocr-benchmark/inputs/inputs.json .data/ocr-benchmark/paddle.json
node scripts/ocr-benchmark/report.js .data/ocr-benchmark/comparison.json .data/ocr-benchmark/windows.json .data/ocr-benchmark/tesseract.json .data/ocr-benchmark/paddle.json
```

Run engines sequentially to limit CPU contention. The Windows runner compiles a separate executable, reusing the real helper's pixel-to-OCR method without capturing the screen or sending input. It does not replace or stop the running helper. The Paddle runner uses the English PP-OCRv5 mobile recognition model, CPU only, four threads, with MKL-DNN disabled; `--model` allows another recognition model to be tested explicitly.

## Interpretation

Each input is tested as original/R/G/B and the same four variants with 3x nearest-neighbor enlargement plus 12px white padding. Channel stretching mirrors the native helper. Padding and enlargement are a combined experimental treatment, not separate ablations. Every engine sees the same saved variants.

Each engine stays loaded. One warm-up and five measured runs are performed per variant; the report uses median call duration. Image loading is excluded where possible, but Tesseract's call includes PNG decoding and worker messaging while Windows/Paddle receive decoded pixels. Thus timings describe these adapters, **not a pure model-speed ranking or full live scan latency**. Initialization/download time is recorded separately. No 500ms sleep or screen capture is included.

All outputs go through the app's same biome matcher at 70%. `exact` checks normalized text against the expected label; `correct` checks the accepted biome (or correct rejection for a negative). Engine confidence is retained separately and is not comparable across engines. Windows OCR exposes no corresponding confidence value. Do not interpret a fuzzy match score as an OCR correctness probability.

The benchmark tests all variants for comparison, unlike the live loop's early exit. Before choosing a replacement, compare raw exact reads, false biome matches on negatives, and the latency of the intended fallback ordering on a larger corpus.

References: [PaddleOCR recognition](https://www.paddleocr.ai/main/en/version3.x/module_usage/text_recognition.html), [Tesseract.js API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md).

## Live Tesseract adapter resource check

After preparing inputs, run `node scripts/ocr-benchmark/resources.js .data/ocr-benchmark/inputs/inputs.json .data/ocr-benchmark/resources.json`. This uses the actual development adapter, bundled English model, and in-memory BMP encoding. It measures 20 original-Heaven success scans and 20 background-negative scans with a 500ms delay after each, recording process CPU and RSS. CPU is expressed as a percentage of **one logical core**, not total machine capacity. RSS includes the Node test process and its worker; the incremental figure subtracts pre-worker RSS. It excludes the native capture/Play helper and main web server. Allocation peaks, game workload, and different crops can change results.

`node scripts/ocr-benchmark/smoke-runtime.js .data/ocr-benchmark/inputs/inputs.json` copies the allowlisted OCR runtime into an isolated ignored directory, verifies a Heaven read through the pipe protocol, and checks worker shutdown on input close. It does not release or modify the running application.
