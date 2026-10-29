#!/usr/bin/env python3
"""A ~50 MB PDF like a phone or office scan: A4 pages, each one a 300 dpi
greyscale JPEG with text-like strokes, plus a little real text on page 1.

Usage: python3 scripts/make_big_fixture.py out/big-50mb.pdf [target MB]
"""
import io
import random
import sys

import pymupdf
from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1]
target = float(sys.argv[2]) * 1e6 if len(sys.argv) > 2 else 50e6
W, H = 2480, 3508  # A4 at 300 dpi


def scan_page(seed: int) -> bytes:
    rnd = random.Random(seed)
    im = Image.new('L', (W, H), 236)
    d = ImageDraw.Draw(im)
    y = 260
    while y < H - 260:
        x = 220
        while x < W - 260:
            w = rnd.randint(30, 160)
            d.rectangle([x, y, x + w, y + rnd.randint(26, 40)], fill=rnd.randint(20, 80))
            x += w + rnd.randint(18, 40)
        y += rnd.randint(62, 80)
    # paper grain: keeps the JPEG large, as real scans are
    noise = Image.effect_noise((W, H), 28).filter(ImageFilter.GaussianBlur(0.6))
    im = Image.blend(im, noise, 0.22)
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=88)
    return b.getvalue()


doc = pymupdf.open()
size, i = 0, 0
while size < target:
    jpg = scan_page(i)
    page = doc.new_page(width=595.28, height=841.89)
    page.insert_image(page.rect, stream=jpg)
    if i == 0:
        page.insert_text((60, 60), 'Bản quét thử 50 MB', fontsize=18, color=(0.8, 0, 0))
    size += len(jpg)
    i += 1
doc.save(out, garbage=0, deflate=False)
print(out, i, 'pages', round(len(open(out, 'rb').read()) / 1e6, 1), 'MB')
