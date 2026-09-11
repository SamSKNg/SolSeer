"""Persistent CPU PaddleOCR recognition-only benchmark."""
import argparse
import json
import statistics
import time
from pathlib import Path
import numpy as np
from PIL import Image
from paddleocr import TextRecognition

parser = argparse.ArgumentParser()
parser.add_argument("inputs")
parser.add_argument("output")
parser.add_argument("--model", default="en_PP-OCRv5_mobile_rec")
args = parser.parse_args()
start = time.perf_counter()
model = TextRecognition(model_name=args.model, device="cpu", enable_mkldnn=False, cpu_threads=4)
startup_ms = (time.perf_counter()-start)*1000
rows = []
for case in json.loads(Path(args.inputs).read_text(encoding="utf-8-sig")):
    pixels = np.array(Image.open(case["path"]).convert("RGB"))[:, :, ::-1].copy()
    durations = []
    for run in range(6):
        start = time.perf_counter()
        result = list(model.predict(input=pixels, batch_size=1))[0]
        elapsed = (time.perf_counter()-start)*1000
        if run:
            durations.append(elapsed)
    rows.append({**case, "text": result["rec_text"], "engineConfidence": float(result["rec_score"]), "medianMs": statistics.median(durations)})
    print(case["id"], case["variant"], repr(result["rec_text"]), flush=True)
Path(args.output).write_text(json.dumps({"engine": args.model, "startupMs": startup_ms, "rows": rows}, indent=2), encoding="utf-8")
