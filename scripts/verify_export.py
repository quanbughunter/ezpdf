#!/usr/bin/env python3
"""Independent check of an exported PDF with tools that do not use PDFium.

  - qpdf --check            structure
  - pdffonts (Poppler)      fonts used, embedded or not
  - PyMuPDF (MuPDF)         annotation types/rects + text drawn by each appearance
  - pdftoppm (Poppler)      page renders with annotations  -> out/render/poppler-*.png
  - PyMuPDF pixmaps         page renders with annotations  -> out/render/mupdf-*.png

Usage: python3 scripts/verify_export.py out/final.pdf [out/expected.json]
Exit code 1 if any check fails.
"""
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

import pymupdf

pdf_path = Path(sys.argv[1] if len(sys.argv) > 1 else "out/final.pdf")
exp_path = Path(sys.argv[2] if len(sys.argv) > 2 else pdf_path.parent / "expected.json")
render_dir = pdf_path.parent / "render"
render_dir.mkdir(parents=True, exist_ok=True)
fails = []


def norm(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", s or "")).strip()


print(f"== {pdf_path}")
q = subprocess.run(["qpdf", "--check", str(pdf_path)], capture_output=True, text=True)
qpdf_ok = q.returncode in (0, 3)  # 3 = warnings only
print("qpdf:", "OK" if qpdf_ok else "ERROR", (q.stdout + q.stderr).strip().splitlines()[-1])
if not qpdf_ok:
    fails.append("qpdf")

pf = subprocess.run(["pdffonts", str(pdf_path)], capture_output=True, text=True).stdout
print(pf.rstrip())
vn_rows = [l for l in pf.splitlines() if "ezPDFSansVN" in l]
if not vn_rows:
    fails.append("ezPDF Sans VN font not found")
for row in vn_rows:
    cols = row.split()
    # name type... encoding emb sub uni objID gen -> emb is 5th from the end
    if cols[-5] != "yes":
        fails.append(f"font not embedded: {row}")

expected = json.loads(exp_path.read_text()) if exp_path.exists() else None
doc = pymupdf.open(pdf_path)
TYPE = {"FreeText": 3, "Highlight": 9, "Stamp": 13}
for pno, page in enumerate(doc):
    annots = list(page.annots())
    print(f"-- page {pno + 1}: /Rotate {page.rotation}, {len(annots)} annots")
    for a in annots:
        info = a.info
        ap_text = norm(a.get_text()) if a.type[1] == "FreeText" else ""
        print(f"   {a.type[1]:<9} rect={tuple(round(v, 1) for v in a.rect)} contents={info.get('content')!r}")
        if a.type[1] == "FreeText":
            print(f"   appearance text: {ap_text!r}")
            if expected and ap_text != norm(expected["text"]):
                fails.append(f"p{pno + 1} FreeText appearance text differs: {ap_text!r}")
    pix = page.get_pixmap(dpi=110, annots=True)
    pix.save(render_dir / f"mupdf-{pno + 1}.png")
    if expected:
        want = [e for e in expected["expected"] if e["page"] == pno]
        got_types = sorted(TYPE.get(a.type[1], -1) for a in annots)
        if got_types != sorted(e["type"] for e in want):
            fails.append(f"p{pno + 1}: annotation types {got_types}")

subprocess.run(["pdftoppm", "-r", "110", "-png", str(pdf_path), str(render_dir / "poppler")], check=True)
print("renders:", ", ".join(sorted(p.name for p in render_dir.glob("*.png"))))
print("RESULT:", "PASS" if not fails else "FAIL")
for f in fails:
    print("  -", f)
sys.exit(1 if fails else 0)
