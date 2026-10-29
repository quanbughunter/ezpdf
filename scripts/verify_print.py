#!/usr/bin/env python3
"""Checks what ezPDF's "In" button sends to the printer against the exported PDF.

The browser/desktop print path draws every page of the finished PDF with
PDFium and prints those pictures. scripts/e2e-share-print.cjs saves the print
output of Chromium (page.pdf with the print styles, i.e. what the print
dialog gets) and the PDF exported from the same state. This script, with
MuPDF (an engine independent of PDFium), checks:

  - same number of pages, in the same order
  - every printed page has the size and orientation of the exported page as
    a reader shows it (/Rotate applied), within 1 pt
  - each printed page is one picture covering the page, at >= the expected dpi
  - the printed page looks like the exported page: both rendered at 50 dpi
    and softened a little (Gaussian σ 1.5 px: a raster and a vector page
    never land on the same sub-pixel), mean absolute difference <= 8/255,
    correlation >= 0.97, and far above the correlation with the exported
    page turned upside down (the orientation is right, not just "mostly white")

Usage: python3 scripts/verify_print.py printed.pdf exported.pdf MIN_DPI [report.json]
"""
import json
import sys

import numpy as np
import pikepdf
import pymupdf
from scipy.ndimage import gaussian_filter

printed_path, exported_path = sys.argv[1], sys.argv[2]
min_dpi = float(sys.argv[3])
report_path = sys.argv[4] if len(sys.argv) > 4 else None

printed = pymupdf.open(printed_path)
exported = pymupdf.open(exported_path)
checks = []


def check(name, ok, detail=""):
    checks.append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(("PASS" if ok else "FAIL") + "  " + name + (("  — " + str(detail)) if detail else ""))


check("same page count", len(printed) == len(exported), f"printed {len(printed)}, exported {len(exported)}")

sizes = []
for i in range(min(len(printed), len(exported))):
    p, e = printed[i], exported[i]
    # page.rect is the page as displayed (rotation applied) in MuPDF
    pw, ph = p.rect.width, p.rect.height
    ew, eh = e.rect.width, e.rect.height
    sizes.append(((round(pw, 1), round(ph, 1)), (round(ew, 1), round(eh, 1))))
check(
    "each printed page has the exported page's size and orientation (±1 pt)",
    all(abs(a[0] - b[0]) <= 1 and abs(a[1] - b[1]) <= 1 for a, b in sizes),
    "; ".join(f"{a[0]}×{a[1]} vs {b[0]}×{b[1]}" for a, b in sizes),
)

# one picture per printed page, its resolution
pk = pikepdf.open(printed_path)
dpis = []
pictures_ok = True
for i, page in enumerate(pk.pages):
    imgs = []
    for name, obj in (page.Resources.get("/XObject") or {}).items():
        if obj.get("/Subtype") == "/Image":
            imgs.append(obj)
        elif obj.get("/Subtype") == "/Form":
            for _, inner in (obj.get("/Resources", {}).get("/XObject") or {}).items():
                if inner.get("/Subtype") == "/Image":
                    imgs.append(inner)
    if not imgs:
        pictures_ok = False
        dpis.append(0)
        continue
    big = max(imgs, key=lambda im: int(im.Width) * int(im.Height))
    w_in = printed[i].rect.width / 72
    h_in = printed[i].rect.height / 72
    dpis.append(round(min(int(big.Width) / w_in, int(big.Height) / h_in)))
check("every printed page carries its page picture", pictures_ok, dpis)
check(f"the pictures are at least {min_dpi:g} dpi", all(d >= min_dpi - 1 for d in dpis), dpis)


def raster(doc, i, dpi=50):
    pix = doc[i].get_pixmap(dpi=dpi, alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].mean(axis=2).astype(np.float32)


diffs = []
for i in range(min(len(printed), len(exported))):
    a, b = raster(printed, i), raster(exported, i)
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    a, b = a[:h, :w], b[:h, :w]
    mad = float(np.abs(a - b).mean())
    sa, sb = gaussian_filter(a, 1.5), gaussian_filter(b, 1.5)
    corr = float(np.corrcoef(sa.ravel(), sb.ravel())[0, 1]) if sa.std() > 0 and sb.std() > 0 else 1.0
    flipped = float(np.corrcoef(sa.ravel(), sb[::-1, ::-1].ravel())[0, 1]) if sa.std() > 0 and sb.std() > 0 else 0.0
    diffs.append({"page": i + 1, "mad": round(mad, 2), "corr": round(corr, 4), "corr_upside_down": round(flipped, 4)})
check(
    "printed pages look like the exported pages (MuPDF, 50 dpi, σ 1.5: MAD <= 8, correlation >= 0.97, upside-down far lower)",
    all(d["mad"] <= 8 and d["corr"] >= 0.97 and d["corr"] - d["corr_upside_down"] > 0.5 for d in diffs),
    diffs,
)

if report_path:
    with open(report_path, "w") as f:
        json.dump({"checks": checks, "dpi": dpis, "sizes": sizes, "diffs": diffs}, f, indent=2, ensure_ascii=False)
sys.exit(0 if all(c["ok"] for c in checks) else 1)
