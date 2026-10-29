#!/usr/bin/env python3
"""Machine-readable inspection of an exported PDF with non-PDFium tools.

Prints JSON:
  annots        every annotation as MuPDF sees it: page, type, id (/NM),
                rect (top-left page space), contents, colours, text drawn by a
                FreeText appearance, AP /Matrix and /DA (pikepdf)
  baked_lines   annotation appearances flattened by MuPDF, then read back as
                text lines with baseline origin, size, colour and font — the
                geometry an independent renderer actually draws
  fonts         pdffonts rows for the ezPDF font (embedded or not)
  rotations     /Rotate of every page
  stamps        name (/Name) and the images inside each Stamp appearance:
                filter, size, whether a soft mask (alpha) is attached
  qpdf_ok, poppler_errors
Usage: python3 scripts/inspect_export.py file.pdf
"""
import json
import re
import subprocess
import sys
import tempfile
import unicodedata

import pikepdf
import pymupdf

path = sys.argv[1]


def norm(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", s or "")).strip()


def hexcolor(c):
    if not c:
        return None
    return "#" + "".join(f"{round(v * 255):02x}" for v in c[:3])


out = {"annots": [], "baked_lines": {}, "stamps": []}
doc = pymupdf.open(path)
pk = pikepdf.open(path)
out["rotations"] = [int(p.obj.get("/Rotate", 0)) % 360 for p in pk.pages]


def images_in(xobj, seen=None):
    seen = seen if seen is not None else set()
    found = []
    res = xobj.get("/Resources")
    xs = res.get("/XObject") if res is not None else None
    if xs is None:
        return found
    for _, x in xs.items():
        key = x.objgen
        if key in seen:
            continue
        seen.add(key)
        if x.get("/Subtype") == "/Image":
            f = x.get("/Filter")
            found.append({
                "filter": str(f) if f is not None else None,
                "w": int(x.get("/Width", 0)),
                "h": int(x.get("/Height", 0)),
                "smask": "/SMask" in x,
            })
        elif x.get("/Subtype") == "/Form":
            found += images_in(x, seen)
    return found


for pno, pg in enumerate(pk.pages):
    for a in pg.get("/Annots", []):
        if a.get("/Subtype") != "/Stamp":
            continue
        n = a.AP.N if "/AP" in a else None
        out["stamps"].append({
            "page": pno + 1,
            "id": str(a.get("/NM", "")),
            "name": str(a.get("/Name")) if "/Name" in a else None,
            "images": images_in(n) if n is not None else [],
        })
for pno, page in enumerate(doc):
    by_nm = {str(a.get("/NM", "")): a for a in pk.pages[pno].get("/Annots", [])}
    for a in page.annots():
        nm = a.info.get("id", "")
        pa = by_nm.get(nm)
        entry = {
            "page": pno + 1,
            "type": a.type[1],
            "id": nm,
            "rect_device": [round(v, 2) for v in a.rect],
            "contents": a.info.get("content"),
            "stroke": hexcolor(a.colors.get("stroke")),
            "fill": hexcolor(a.colors.get("fill")),
            "da": str(pa.get("/DA")) if pa is not None and "/DA" in pa else None,
        }
        if a.type[1] == "FreeText":
            entry["ap_text"] = norm(a.get_text())
            n = pa.AP.N if pa is not None and "/AP" in pa else None
            entry["matrix"] = [float(v) for v in n.Matrix] if n is not None and "/Matrix" in n else None
        out["annots"].append(entry)

baked = pymupdf.open(path)
baked.bake(annots=True, widgets=False)
for pno, page in enumerate(baked):
    rows = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for sp in line["spans"]:
                if "ezPDF" in sp["font"]:
                    rows.append(
                        {
                            "text": sp["text"],
                            "x": round(sp["origin"][0], 3),
                            "y": round(sp["origin"][1], 3),
                            "size": round(sp["size"], 3),
                            "color": f"#{sp['color']:06x}",
                        }
                    )
    if rows:
        out["baked_lines"][str(pno + 1)] = rows

pf = subprocess.run(["pdffonts", path], capture_output=True, text=True).stdout
rows = [l.split() for l in pf.splitlines() if "ezPDFSansVN" in l]
out["vn_fonts_embedded"] = sum(1 for r in rows if r[-5] == "yes")
out["vn_fonts_not_embedded"] = sum(1 for r in rows if r[-5] != "yes")

q = subprocess.run(["qpdf", "--check", path], capture_output=True, text=True)
out["qpdf_ok"] = q.returncode in (0, 3)
msg = (q.stdout + q.stderr).strip()
out["qpdf_msg"] = msg.splitlines()[-1] if msg else ""

with tempfile.TemporaryDirectory() as td:
    r = subprocess.run(["pdftoppm", "-r", "40", "-png", path, f"{td}/p"], capture_output=True, text=True)
    out["poppler_errors"] = [l for l in r.stderr.splitlines() if "Error" in l]

print(json.dumps(out, ensure_ascii=False))
