"""Check "Bỏ tô sáng" results with tools that don't use PDFium.

Usage: python3 scripts/verify_unmark.py out/unmark/expected.json

expected.json (written by tests/unmark-probe.ts and scripts/e2e-edit.cjs):
  [{file, source, pages: {page: {removed: [text], kept: [text]}}, annots: {page: n}}]
  file/source are relative to the json's folder / tests/fixtures. A text is
  found with MuPDF's search; "text#k" is its k-th hit from the top.

For every file:
  - qpdf --check passes
  - Poppler and MuPDF read exactly the same text on every page as in the
    source: the words were not touched
  - pages other than those listed render as in the source (MuPDF)
  - on a listed page, every pixel that changed lies on the highlight band
    of a "removed" text (the coloured area around it in the source), and no
    highlight colour is left there (MuPDF and Poppler)
  - the words on those bands are still drawn (as much ink as before), and
    the band is gone from the page's drawings rather than covered: no fill
    of its colour is left there and no new fill was added over it (MuPDF's
    list of drawings)
  - on "kept" texts nothing changed: their highlight, or their box, is still
    there
  - the page has as many highlight annotations as expected

"Changed" means by more than 3 levels (of 255): PDFium writes colours back
as 32-bit floats (.85 → .85000002), which can move a flat colour by one
level when rendered; nothing a reader can see.
"""
import json, os, re, subprocess, sys, tempfile
import fitz
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZOOM = 2
TOL = 3
results = []


def check(name, ok, detail=''):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  — ' + str(detail) if detail else ''}")


def norm(s):
    return re.sub(r'\s+', ' ', s).strip()


def poppler_text(pdf, page):
    return norm(subprocess.run(['pdftotext', '-f', str(page + 1), '-l', str(page + 1), pdf, '-'], capture_output=True, text=True, check=True).stdout)


def render(pdf, page):
    with fitz.open(pdf) as d:
        pix = d[page].get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), alpha=False)
        return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)[:, :, :3].astype(int)


def poppler_render(pdf, page):
    with tempfile.TemporaryDirectory() as t:
        subprocess.run(['pdftoppm', '-r', str(72 * ZOOM), '-f', str(page + 1), '-l', str(page + 1), '-png', pdf, os.path.join(t, 'p')], check=True)
        f = [x for x in os.listdir(t) if x.endswith('.png')][0]
        return np.array(Image.open(os.path.join(t, f)).convert('RGB')).astype(int)


def colour(img):
    """Highlight-coloured pixels: clearly saturated and light (yellow, green, orange)."""
    return (img.max(axis=2) - img.min(axis=2) > 80) & (img.max(axis=2) > 150)


def boxes(pdf, page, spec):
    """Pixel boxes of a text on the page, from MuPDF's search."""
    text, _, k = spec.partition('#')
    with fitz.open(pdf) as d:
        pg = d[page]
        hits = sorted(pg.search_for(text), key=lambda r: (round(r.y0), r.x0))
    if k:
        hits = hits[int(k):int(k) + 1]
    return [(max(0, int(r.x0 * ZOOM)), max(0, int(r.y0 * ZOOM)), int(r.x1 * ZOOM) + 1, int(r.y1 * ZOOM) + 1) for r in hits]


def bands(img, bx):
    """
    The highlight band around a text, as a mask: the box around the areas of
    its colour that touch it (the glyphs cut a band into pieces, so pieces
    beside each other on the same rows join), grown by 3 px.
    """
    x0, y0, x1, y1 = bx
    inside = img[y0:y1, x0:x1][colour(img[y0:y1, x0:x1])]
    mask = np.zeros(img.shape[:2], bool)
    if not len(inside):
        return mask, None
    hue = np.median(inside, axis=0)
    lab, _ = ndimage.label(of(img, hue))
    pieces = ndimage.find_objects(lab)
    box = None
    for k in set(np.unique(lab[y0:y1, x0:x1])) - {0}:
        sy, sx = pieces[k - 1]
        b = (sx.start, sy.start, sx.stop, sy.stop)
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    if box is None:
        return mask, None
    grew = True
    while grew:
        grew = False
        for sl in pieces:
            if sl is None:
                continue
            sy, sx = sl
            over = min(box[3], sy.stop) - max(box[1], sy.start)
            gap = max(sx.start - box[2], box[0] - sx.stop)
            inside_box = sx.start >= box[0] and sx.stop <= box[2] and sy.start >= box[1] and sy.stop <= box[3]
            if not inside_box and over >= 0.5 * (sy.stop - sy.start) and gap <= 16:
                box = (min(box[0], sx.start), min(box[1], sy.start), max(box[2], sx.stop), max(box[3], sy.stop))
                grew = True
    mask[max(0, box[1] - 3):box[3] + 3, max(0, box[0] - 3):box[2] + 3] = True
    return mask, hue


def of(img, hue):
    """Pixels of the highlight colour `hue`."""
    return colour(img) & (np.abs(img - hue).max(axis=2) <= 40)


def drawings(pdf, page):
    """Filled shapes of the page (MuPDF): (rect in pixels, fill colour 0–255)."""
    with fitz.open(pdf) as d:
        out = []
        for g in d[page].get_drawings():
            if g.get('fill') is None:
                continue
            r = g['rect'] * fitz.Matrix(ZOOM, ZOOM)
            out.append(((round(r.x0, 1), round(r.y0, 1), round(r.x1, 1), round(r.y1, 1)), tuple(round(c * 255) for c in g['fill'])))
        return out


def overlaps(rect, mask_box):
    x0, y0, x1, y1 = rect
    return min(x1, mask_box[2]) > max(x0, mask_box[0]) and min(y1, mask_box[3]) > max(y0, mask_box[1])


def highlight_annots(pdf, page):
    with fitz.open(pdf) as d:
        return sum(1 for a in d[page].annots() or [] if a.type[1] == 'Highlight')


def main(path):
    base = os.path.dirname(os.path.abspath(path))
    for case in json.load(open(path)):
        pdf = os.path.join(base, case['file'])
        src = os.path.join(ROOT, 'tests', 'fixtures', case['source'])
        name = case['file']
        q = subprocess.run(['qpdf', '--check', pdf], capture_output=True, text=True)
        check(f'{name}: qpdf --check', q.returncode == 0, q.stdout.strip().splitlines()[-1] if q.stdout else q.stderr.strip())
        with fitz.open(src) as d:
            n = d.page_count
        same_p = all(poppler_text(pdf, p) == poppler_text(src, p) for p in range(n))
        with fitz.open(pdf) as a, fitz.open(src) as b:
            same_m = all(norm(a[p].get_text()) == norm(b[p].get_text()) for p in range(n))
        check(f'{name}: Poppler and MuPDF read exactly the same text as in the source, every page', same_p and same_m, f'poppler {same_p}, mupdf {same_m}')
        listed = {int(k): v for k, v in case['pages'].items()}
        for p in range(n):
            a, b = render(src, p), render(pdf, p)
            changed = (np.abs(a - b).max(axis=2) > TOL) if a.shape == b.shape else np.ones(a.shape[:2], bool)
            if p not in listed:
                annots_changed = str(p) in case.get('annots', {}) and highlight_annots(src, p) != case['annots'][str(p)]
                if not annots_changed:
                    check(f'{name} p{p + 1}: not touched, renders as before', not changed.any(), f'{int(changed.sum())} changed px')
                continue
            spec = listed[p]
            allowed = np.zeros(a.shape[:2], bool)
            pop = poppler_render(pdf, p)
            src_fills, out_fills = drawings(src, p), drawings(pdf, p)
            left, faded, covered = [], [], []
            for t in spec['removed']:
                hits = boxes(src, p, t)
                if not hits:
                    left.append(f'{t}: not found')
                for bx in hits:
                    band, hue = bands(a, bx)
                    if hue is None:
                        left.append(f'{t}: no highlight in the source')
                        continue
                    allowed |= band
                    before, after_m, after_p = (int((of(x, hue) & band).sum()) for x in (a, b, pop))
                    if before == 0 or after_m > 0 or after_p > 0:
                        left.append(f'{t}: {before}→{after_m}/{after_p}')
                    ink_a, ink_b = int((a.max(axis=2)[band] < 100).sum()), int((b.max(axis=2)[band] < 100).sum())
                    if ink_b < 0.95 * ink_a:
                        faded.append(f'{t}: ink {ink_a}→{ink_b}')
                    ys, xs = np.nonzero(band)
                    mb = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
                    for rect, fill in out_fills:
                        if not overlaps(rect, mb):
                            continue
                        if max(abs(fill[i] - hue[i]) for i in range(3)) <= 40 or (rect, fill) not in src_fills:
                            covered.append(f'{t}: fill {fill} at {rect}')
            outside = int((changed & ~allowed).sum())
            check(f'{name} p{p + 1}: every changed pixel lies on the highlight of a text that lost it', changed.any() and outside == 0, f'{int(changed.sum())} changed px, {outside} outside')
            check(f'{name} p{p + 1}: the highlight colour is gone from {len(spec["removed"])} texts (MuPDF and Poppler)', not left, '; '.join(left))
            check(f'{name} p{p + 1}: the words on those bands are drawn as before (no ink lost)', not faded, '; '.join(faded))
            check(f'{name} p{p + 1}: the bands left the drawings; nothing new was painted over them', not covered, '; '.join(covered[:4]))
            moved = []
            for t in spec['kept']:
                hits = boxes(src, p, t)
                if not hits:
                    moved.append(f'{t}: not found')
                for x0, y0, x1, y1 in hits:
                    if changed[y0:y1, x0:x1].any():
                        moved.append(t)
            check(f'{name} p{p + 1}: {len(spec["kept"])} texts that keep their highlight or box are unchanged', not moved, ', '.join(moved))
        for p, want in case.get('annots', {}).items():
            got = highlight_annots(pdf, int(p))
            check(f'{name} p{int(p) + 1}: {want} highlight annotation(s) on the page', got == want, f'{highlight_annots(src, int(p))} → {got}')
    print('\nall checks passed' if all(results) else f'\n{results.count(False)} check(s) failed')
    sys.exit(0 if all(results) else 1)


if __name__ == '__main__':
    main(sys.argv[1])
