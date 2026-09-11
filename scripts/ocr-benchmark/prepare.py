"""Prepare identical lossless inputs for all engines; no screenshot uploads."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageOps

parser = argparse.ArgumentParser()
parser.add_argument("manifest", help="JSON list: id, path, expected (null for negatives), optional crop [x,y,w,h]")
parser.add_argument("output")
args = parser.parse_args()
out = Path(args.output).resolve()
out.mkdir(parents=True, exist_ok=True)
inputs = []
for index, case in enumerate(json.loads(Path(args.manifest).read_text(encoding="utf-8-sig"))):
    image = Image.open(case["path"]).convert("RGB")
    if "crop" in case:
        x, y, w, h = case["crop"]
        if min(x, y) < 0 or min(w, h) <= 0 or x + w > image.width or y + h > image.height:
            raise ValueError(f"Crop outside image: {case['id']}")
        image = image.crop((x, y, x + w, y + h))
    variants = {"original": image}
    for channel in ("R", "G", "B"):
        # Same percentile stretch as the native helper, preserving faint ranges.
        gray = image.getchannel(channel)
        histogram = gray.histogram()
        count = gray.width * gray.height
        cumulative, low, high = 0, None, 255
        for value, frequency in enumerate(histogram):
            cumulative += frequency
            if low is None and cumulative >= max(1, count // 100):
                low = value
            if cumulative >= count - count // 100:
                high = value
                break
        if high <= low:
            low, high = gray.getextrema()
        gray = gray.point([max(0, min(255, (v-low)*255//(high-low))) if high > low else 255 for v in range(256)])
        variants[channel] = gray.convert("RGB")
    for name, variant in list(variants.items()):
        variants[name + "-3x"] = ImageOps.expand(variant.resize((variant.width*3, variant.height*3), Image.Resampling.NEAREST), border=12, fill="white")
    for name, variant in variants.items():
        path = out / f"{index}-{name}.png"
        variant.save(path)
        raw_path = out / f"{index}-{name}.bgra"
        raw_path.write_bytes(variant.convert("RGBA").tobytes("raw", "BGRA"))
        inputs.append({"id": case["id"], "variant": name, "expected": case["expected"], "path": str(path), "rawPath":str(raw_path), "width":variant.width, "height":variant.height})
(out / "inputs.json").write_text(json.dumps(inputs, indent=2), encoding="utf-8")
print(f"Prepared {len(inputs)} inputs in {out}")
