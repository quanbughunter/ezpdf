"""Median 3×3 colour at points of a screenshot.

Usage: python3 scripts/sample_pixels.py shot.png '[[x, y], ...]'   (CSS px × scale given as 3rd arg, default 1)
Prints a JSON list of [r, g, b].
"""
import json, sys
from PIL import Image

img = Image.open(sys.argv[1]).convert('RGB')
pts = json.loads(sys.argv[2])
k = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
px = img.load()
out = []
for x, y in pts:
    vals = []
    for ox in (-1, 0, 1):
        for oy in (-1, 0, 1):
            xx = min(max(int(round(x * k)) + ox, 0), img.width - 1)
            yy = min(max(int(round(y * k)) + oy, 0), img.height - 1)
            vals.append(px[xx, yy])
    out.append([sorted(c[i] for c in vals)[4] for i in range(3)])
print(json.dumps(out))
