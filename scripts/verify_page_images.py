#!/usr/bin/env python3
"""Checks the pictures "Xuất thành ảnh" made against the exported PDF.

ezPDF draws the pages of the finished PDF with PDFium and encodes them in its
worker (PNG, JPEG, WebP, or TIFF with its own LZW writer). This script reads
them back with Pillow (libtiff for TIFF) and tifffile, and with MuPDF (an
engine independent of PDFium) checks:

  - the format is the one asked for; a TIFF is LZW with the horizontal
    predictor, and holds as many pages as asked
  - each picture has the page's size at the chosen dpi (rotation applied),
    within 1 px, and says that dpi in the file (PNG pHYs, JPEG JFIF, TIFF)
  - grey pictures are grey (one channel, or three equal ones)
  - each picture looks like its page: both at 50 dpi, softened (Gaussian
    σ 1.5 px), mean absolute difference <= 10/255 (JPEG and WebP 14/255),
    correlation >= 0.97 and far above the correlation with the page upside down

Usage: python3 scripts/verify_page_images.py exported.pdf FORMAT DPI PAGES GRAY FILE... [--report r.json]
  PAGES: 1-based, comma separated, in the order of the pictures (a multi-page
  TIFF is one FILE holding them all); GRAY: 0 or 1
"""
import json
import sys

import numpy as np
import pymupdf
import tifffile
from PIL import Image
from scipy.ndimage import gaussian_filter

args = sys.argv[1:]
report_path = None
if "--report" in args:
    i = args.index("--report")
    report_path = args[i + 1]
    args = args[:i] + args[i + 2:]
exported_path, fmt, dpi, pages_arg, gray_arg, *files = args
dpi = int(dpi)
pages = [int(p) for p in pages_arg.split(",")]
gray = gray_arg == "1"
doc = pymupdf.open(exported_path)
checks = []


def check(name, ok, detail=""):
    checks.append({"name": name, "ok": bool(ok), "detail": str(detail)})


def soft(a):
    return gaussian_filter(a.astype(np.float64), 1.5)


def page_gray(page_no, w, h):
    """the exported page as MuPDF draws it, grey, at the picture's aspect, 50 dpi"""
    pix = doc[page_no - 1].get_pixmap(dpi=50, colorspace=pymupdf.csGRAY, alpha=False)
    ref = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)
    return ref


def look(img, page_no):
    small = img.convert("L").resize(page_gray(page_no, 0, 0).shape[::-1], Image.LANCZOS)
    a = soft(np.asarray(small))
    ref = soft(page_gray(page_no, 0, 0))
    mad = float(np.mean(np.abs(a - ref)))
    corr = float(np.corrcoef(a.ravel(), ref.ravel())[0, 1]) if a.std() > 0 and ref.std() > 0 else 1.0
    flipped = ref[::-1, ::-1]
    corr_flip = float(np.corrcoef(a.ravel(), flipped.ravel())[0, 1]) if a.std() > 0 and flipped.std() > 0 else 1.0
    return mad, corr, corr_flip


frames = []  # (page number, PIL image, dpi said by the file, file name)
expect_kind = {"png": "PNG", "jpeg": "JPEG", "webp": "WEBP", "tiff": "TIFF"}[fmt]
for f in files:
    im = Image.open(f)
    check(f"{f.split('/')[-1]}: a {expect_kind} file", im.format == expect_kind, im.format)
    if fmt == "tiff":
        t = tifffile.TiffFile(f)
        comp = {p.compression.name for p in t.pages}
        pred = {p.predictor.name for p in t.pages}
        check(f"{f.split('/')[-1]}: LZW with the horizontal predictor", comp == {"LZW"} and pred == {"HORIZONTAL"}, f"{comp} {pred}")
        n = getattr(im, "n_frames", 1)
        for k in range(n):
            im.seek(k)
            frames.append((None, im.copy(), im.info.get("dpi"), f))
    else:
        im.load()
        frames.append((None, im, im.info.get("dpi"), f))

check("one picture per page asked", len(frames) == len(pages), f"{len(frames)} pictures, {len(pages)} pages")
for (_, im, said, f), page_no in zip(frames, pages):
    tag = f"page {page_no}"
    rect = doc[page_no - 1].rect  # MuPDF: the page as shown (/Rotate applied)
    want = (round(rect.width * dpi / 72), round(rect.height * dpi / 72))
    check(f"{tag}: {want[0]} × {want[1]} px at {dpi} dpi", abs(im.width - want[0]) <= 1 and abs(im.height - want[1]) <= 1, f"{im.width} × {im.height}")
    if fmt != "webp":
        check(f"{tag}: the file says {dpi} dpi", said is not None and abs(said[0] - dpi) < 0.6 and abs(said[1] - dpi) < 0.6, said)
    if gray:
        arr = np.asarray(im.convert("RGB")).astype(int)
        spread = int(np.max(np.abs(arr[..., 0] - arr[..., 1])) + np.max(np.abs(arr[..., 1] - arr[..., 2])))
        # JPEG and WebP store colour as Y Cb Cr: a grey picture comes back within a step or two
        limit = 0 if fmt in ("png", "tiff") else 6
        check(f"{tag}: grey", im.mode == "L" or spread <= limit, f"mode {im.mode}, channel spread {spread}")
    mad, corr, corr_flip = look(im, page_no)
    limit = 10 if fmt in ("png", "tiff") else 14
    check(
        f"{tag}: looks like the exported page (MuPDF)",
        mad <= limit and corr >= 0.97 and corr - corr_flip >= 0.2,
        f"mad {mad:.2f}, corr {corr:.3f}, upside down {corr_flip:.3f}",
    )

failed = [c for c in checks if not c["ok"]]
for c in checks:
    print(("ok   " if c["ok"] else "FAIL ") + c["name"] + (f"  — {c['detail']}" if c["detail"] else ""))
if report_path:
    with open(report_path, "w") as fh:
        json.dump(checks, fh, ensure_ascii=False, indent=1)
sys.exit(1 if failed else 0)
