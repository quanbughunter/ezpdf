"""Check placed pictures and page rotation in viewers that don't use PDFium.

Usage: python3 scripts/verify_images.py EXPECTED.json [--pdfjs DIR]

EXPECTED.json (written by tests/m3-engine-probe.ts and scripts/e2e-m3.cjs):
  pages:   [{w, h}]                      page size in points (unrotated)
  outputs: [{pdf, rotations, pdfjs?}]    files to check, page rotation per page
                                         (quarter turns) and the prefix of
                                         pdf.js renders: DIR/<prefix>-<n>.png
  placed:  [{id, page, kind, box, rotation}]
           kind 'png' = tests/fixtures/quadrants.png, 'jpg' = photo.jpg;
           box = the upright picture's box in unrotated page space (y down),
           rotation = clockwise degrees it is turned on the unrotated page
  paper:   [{id, page, rect}]            optional: signature photos whose paper
                                         must be gone (rect in page space)

For every picture it samples the quadrants at the position where they must
appear on the displayed page (after the picture's own turn and the page's
/Rotate) and compares colours: TL red, TR green, BL blue; PNG BR-top must
show the page (alpha 0), PNG BR-bottom magenta at alpha 0.5 over white;
JPEG BR yellow. Points near the edges catch stretching or cropping; points
just outside must show the page.
"""
import json, math, os, subprocess, sys, tempfile
from PIL import Image
import fitz

RED, GREEN, BLUE, YELLOW = (220, 30, 30), (30, 160, 60), (30, 70, 200), (240, 200, 20)
WHITE, HALF_MAGENTA = (255, 255, 255), (255, 128, 255)


def samples(kind):
    s = [((0.25, 0.25), RED), ((0.75, 0.25), GREEN), ((0.25, 0.75), BLUE)]
    s += [((0.06, 0.08), RED), ((0.94, 0.08), GREEN), ((0.06, 0.92), BLUE)]
    if kind == 'png':
        s += [((0.75, 0.62), WHITE), ((0.75, 0.88), HALF_MAGENTA), ((0.94, 0.95), HALF_MAGENTA)]
    else:
        s += [((0.75, 0.75), YELLOW), ((0.94, 0.92), YELLOW)]
    s += [((0.5, -0.12), WHITE), ((0.5, 1.12), WHITE), ((-0.1, 0.5), WHITE), ((1.1, 0.5), WHITE)]
    return s


def to_display(page, rot_q, x, y):
    W, H = page['w'], page['h']
    return {0: (x, y), 1: (H - y, x), 2: (W - x, H - y), 3: (y, W - x)}[rot_q % 4]


def display_point(page, rot_q, item, u, v):
    b = item['box']
    w, h = b['size']['width'], b['size']['height']
    cx, cy = b['origin']['x'] + w / 2, b['origin']['y'] + h / 2
    dx, dy = (u - 0.5) * w, (v - 0.5) * h
    t = math.radians(item['rotation'])
    return to_display(page, rot_q, cx + dx * math.cos(t) - dy * math.sin(t), cy + dx * math.sin(t) + dy * math.cos(t))


def color_at(img, x, y):
    px = img.load()
    vals = []
    for ox in (-1, 0, 1):
        for oy in (-1, 0, 1):
            xx = min(max(int(round(x)) + ox, 0), img.width - 1)
            yy = min(max(int(round(y)) + oy, 0), img.height - 1)
            vals.append(px[xx, yy][:3])
    return tuple(sorted(c[i] for c in vals)[4] for i in range(3))


def check(exp, name, images, scale, rotations):
    fails = 0
    for item in exp['placed']:
        page = exp['pages'][item['page']]
        img = images[item['page']]
        bad = []
        for (u, v), want in samples(item['kind']):
            x, y = display_point(page, rotations[item['page']], item, u, v)
            got = color_at(img, x * scale, y * scale)
            if max(abs(a - b) for a, b in zip(got, want)) > 45:
                bad.append(f'({u},{v}) {got}≠{want}')
        fails += bool(bad)
        print(f"{'FAIL' if bad else 'ok  '} {name:28} p{item['page'] + 1} {item['id'][:12]:12} {'; '.join(bad)}")
    for item in exp.get('paper', []):
        page = exp['pages'][item['page']]
        img = images[item['page']]
        r = item['rect']
        white = dark = total = 0
        for i in range(24):
            for j in range(12):
                x, y = to_display(page, rotations[item['page']], r['origin']['x'] + (i + 0.5) / 24 * r['size']['width'], r['origin']['y'] + (j + 0.5) / 12 * r['size']['height'])
                c = color_at(img, x * scale, y * scale)
                total += 1
                white += min(c) >= 248
                dark += max(c) < 150
        ok = white / total > 0.75 and dark > 0
        fails += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {name:28} p{item['page'] + 1} paper gone   {white}/{total} samples page-white, {dark} ink")
    return fails


def poppler(pdf, dpi):
    d = tempfile.mkdtemp()
    subprocess.run(['pdftoppm', '-cropbox', '-r', str(dpi), '-png', pdf, os.path.join(d, 'p')], check=True)
    files = sorted((f for f in os.listdir(d) if f.endswith('.png')), key=lambda f: int(f.split('-')[-1][:-4]))
    return [Image.open(os.path.join(d, f)).convert('RGB') for f in files]


def mupdf(pdf, dpi):
    out = []
    for p in fitz.open(pdf):
        pix = p.get_pixmap(dpi=dpi, alpha=False)
        out.append(Image.frombytes('RGB', (pix.width, pix.height), pix.samples))
    return out


def main():
    exp = json.load(open(sys.argv[1]))
    pdfjs = sys.argv[sys.argv.index('--pdfjs') + 1] if '--pdfjs' in sys.argv else None
    total = 0
    for o in exp['outputs']:
        pdf, rots = o['pdf'], o['rotations']
        short = os.path.basename(pdf)
        total += check(exp, f'poppler {short}', poppler(pdf, 144), 2.0, rots)
        total += check(exp, f'mupdf {short}', mupdf(pdf, 144), 2.0, rots)
        for i, p in enumerate(fitz.open(pdf)):
            pg = exp['pages'][i]
            want = (pg['h'], pg['w']) if rots[i] % 2 else (pg['w'], pg['h'])
            if abs(p.rect.width - want[0]) > 0.5 or abs(p.rect.height - want[1]) > 0.5 or p.rotation != (rots[i] % 4) * 90:
                total += 1
                print(f'FAIL mupdf {short} page {i + 1}: size {(p.rect.width, p.rect.height)} rot {p.rotation} ≠ {want} {rots[i] * 90}')
        if pdfjs and o.get('pdfjs'):
            imgs = [Image.open(os.path.join(pdfjs, f"{o['pdfjs']}-{i + 1}.png")).convert('RGB') for i in range(len(exp['pages']))]
            total += check(exp, f'pdfjs {short}', imgs, 1.25, rots)
    print(f'\nIMAGE/ROTATION CHECK: {"PASS" if not total else f"{total} FAILURE(S)"}')
    sys.exit(1 if total else 0)


if __name__ == '__main__':
    main()
