"""Check edited text with tools that don't use PDFium.

Usage: python3 scripts/verify_text_edit.py out/text-edit/expected.json

expected.json (written by tests/text-edit-probe.ts and scripts/e2e-edit.cjs):
  [{file, source, edits: [{page, from, to, keep, oldBox, fontName}]}]
  file/source are relative to the json's folder / tests/fixtures; oldBox is
  the old line's box in PDF user space (unrotated, y up).

For every edit:
  - qpdf --check passes on the edited file
  - Poppler (pdftotext) and MuPDF read the new line on that page, and no
    longer read the old one: the old text is gone from the file, not covered
  - MuPDF and Poppler both draw ink where the new line is (its glyphs exist)
  - outside the old and new lines, the page renders exactly as before
    (MuPDF, 2x): nothing else on the page moved or changed
  - when the original font could not be kept, the replacement font is
    embedded (pdffonts)
"""
import json, os, re, subprocess, sys, tempfile
import fitz
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZOOM = 2

def norm(s):
    return re.sub(r'\s+', ' ', s).strip()

def poppler_text(pdf, page):
    return norm(subprocess.run(['pdftotext', '-f', str(page + 1), '-l', str(page + 1), pdf, '-'], capture_output=True, text=True, check=True).stdout)

def render(pdf, page):
    with fitz.open(pdf) as d:
        pg = d[page]
        pix = pg.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), alpha=False)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)[:, :, :3].copy()
        return img, pg.transformation_matrix, pg.rotation_matrix

def poppler_render(pdf, page):
    with tempfile.TemporaryDirectory() as t:
        subprocess.run(['pdftoppm', '-r', str(72 * ZOOM), '-f', str(page + 1), '-l', str(page + 1), '-png', pdf, os.path.join(t, 'p')], check=True)
        f = [x for x in os.listdir(t) if x.endswith('.png')][0]
        return np.array(Image.open(os.path.join(t, f)).convert('RGB'))

def to_pixels(rect, tm, rm):
    r = fitz.Rect(rect) * tm * rm * fitz.Matrix(ZOOM, ZOOM)
    r.normalize()
    return r

def ink(img, r):
    x0, y0, x1, y1 = max(0, int(r.x0)), max(0, int(r.y0)), min(img.shape[1], int(r.x1) + 1), min(img.shape[0], int(r.y1) + 1)
    if x1 <= x0 or y1 <= y0:
        return 0
    return int((img[y0:y1, x0:x1].min(axis=2) < 160).sum())

def main(path):
    base = os.path.dirname(os.path.abspath(path))
    cases = json.load(open(path))
    failures = 0
    def check(name, ok, detail=''):
        nonlocal failures
        if not ok:
            failures += 1
        print(('PASS' if ok else 'FAIL') + '  ' + name + (f'  — {detail}' if detail else ''))

    for case in cases:
        pdf = os.path.join(base, case['file'])
        src = os.path.join(ROOT, 'tests', 'fixtures', case['source'])
        q = subprocess.run(['qpdf', '--check', pdf], capture_output=True, text=True)
        check(f"{case['file']}: qpdf --check", q.returncode == 0 and 'No syntax or stream encoding errors' in q.stdout, (q.stdout + q.stderr).strip().splitlines()[-1] if (q.stdout + q.stderr).strip() else '')
        fonts = subprocess.run(['pdffonts', pdf], capture_output=True, text=True).stdout
        by_page = {}
        for e in case['edits']:
            by_page.setdefault(e['page'], []).append(e)
        for page, edits in sorted(by_page.items()):
            ptxt = poppler_text(pdf, page)
            with fitz.open(pdf) as d:
                mtxt = norm(d[page].get_text())
                new_rects = []
                for e in edits:
                    hits = d[page].search_for(e['to'])
                    if not hits:  # long lines: search the first and last words
                        words = e['to'].split()
                        hits = d[page].search_for(' '.join(words[:2])) + d[page].search_for(' '.join(words[-2:]))
                    new_rects.append(hits)
            for e, hits in zip(edits, new_rects):
                label = f"{case['file']} p{page + 1} “{e['to']}”"
                check(f'{label}: Poppler and MuPDF read the new line', e['to'] in ptxt and e['to'] in mtxt)
                gone_p = e['from'] not in ptxt
                gone_m = e['from'] not in mtxt
                check(f'{label}: the old line is gone from the file (Poppler, MuPDF)', gone_p and gone_m, f"old “{e['from']}”")
                if not e['keep']:
                    check(f'{label}: replacement font embedded', re.search(re.escape(e['fontName']) + r'\s.*\syes\s', fonts) is not None, e['fontName'])

            # pixels: everything outside the edited lines is unchanged
            before, tm, rm = render(src, page)
            after, tm2, rm2 = render(pdf, page)
            pop = poppler_render(pdf, page)
            if before.shape != after.shape:
                check(f"{case['file']} p{page + 1}: same page size", False, f'{before.shape} vs {after.shape}')
                continue
            mask = np.zeros(before.shape[:2], dtype=bool)
            pad = 3 * ZOOM
            for e, hits in zip(edits, new_rects):
                b = e['oldBox']
                # PDF user space (y up) -> MuPDF page space
                old = fitz.Rect(b['left'], b['bottom'], b['right'], b['top'])
                with fitz.open(src) as d:
                    ctm = d[page].transformation_matrix
                r = to_pixels(old, ctm, rm)
                boxes = [r] + [to_pixels_page(h, rm2) for h in hits]
                for bx in boxes:
                    mask[max(0, int(bx.y0 - pad)):int(bx.y1 + pad) + 1, max(0, int(bx.x0 - pad)):int(bx.x1 + pad) + 1] = True
                new_box = boxes[1] if len(boxes) > 1 else None
                ink_m = ink(after, new_box) if new_box else 0
                ink_p = ink(pop, new_box) if new_box is not None and pop.shape == after.shape else 0
                check(f"{case['file']} p{page + 1} “{e['to']}”: drawn by MuPDF and Poppler", ink_m > 30 and ink_p > 30, f'ink px MuPDF {ink_m}, Poppler {ink_p}')
            diff = np.abs(before.astype(int) - after.astype(int)).max(axis=2) > 48
            outside = diff & ~mask
            n = int(outside.sum())
            check(f"{case['file']} p{page + 1}: the rest of the page renders exactly as before (MuPDF)", n == 0, f'{n} changed px outside the edited lines')
            if n:
                ys, xs = np.nonzero(outside)
                print(f'      first changes at x {xs.min()}-{xs.max()}, y {ys.min()}-{ys.max()}')
    print(f'\n{failures} failure(s)' if failures else '\nall checks passed')
    sys.exit(1 if failures else 0)

def to_pixels_page(rect, rm):
    r = fitz.Rect(rect) * rm * fitz.Matrix(ZOOM, ZOOM)
    r.normalize()
    return r

if __name__ == '__main__':
    main(sys.argv[1])
