"""Checks the scan filters' pages (tests/scan-filter-test.ts) against the document.

Usage: python3 scripts/verify_scan_filters.py out/scan-filter/expected.json [--sheet]

For "Màu sạch" (clean), in every case:
  - paper: at least 99 % of the paper (5 px or more from anything printed)
    is pure white (every channel >= 245), at most 0.5 % is visibly dirty
    (a channel below 215; a coffee ring, being coloured, stays faintly);
  - black print and the bold title stay black (L* <= 35);
  - the red stamp, the blue signature, the blue and green ink keep their
    hue (within 12-18 degrees of the document's) and stay as colourful;
  - the yellow highlighter stays yellow, the pale blue fill stays visible
    and blue, the colour picture keeps its colours (mean colour within
    Delta E 25), the pencil note stays visible.
"Xám" must be grey with the same white paper; "Đen trắng" only black and
white, the print black. The light grey table fill (10 % grey) is reported,
not required: "Màu sạch" turns it white on purpose.
--sheet also writes a contact sheet (PNG) per filter.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy.ndimage import binary_erosion, distance_transform_edt

exp_path = sys.argv[1] if len(sys.argv) > 1 else 'out/scan-filter/expected.json'
sheet = '--sheet' in sys.argv
exp = json.load(open(exp_path))
out_dir = os.path.dirname(exp_path)
fix = exp['fixtures']
meta = json.load(open(os.path.join(fix, 'cases.json')))
truth = np.asarray(Image.open(os.path.join(fix, meta['truth'])).convert('RGB')).astype(np.float32)
labels = np.asarray(Image.open(os.path.join(fix, meta['labels'])))
ids = meta['label_ids']


def lab(rgb):
    c = np.asarray(rgb, np.float64) / 255
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def hue_deg(l):
    return np.degrees(np.arctan2(l[2], l[1])) % 360


def hue_gap(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


nonpaper = labels != 0
paper_far = (labels == 0) & (distance_transform_edt(~nonpaper) >= 5)
truth_lum = truth @ np.array([0.299, 0.587, 0.114])


def element(name):
    m = labels == ids[name]
    if name in ('grey_fill', 'blue_fill', 'picture', 'highlight', 'photo_bw', 'dark_box'):
        m = binary_erosion(m, iterations=3)
    else:
        m = m & (truth_lum < 150) if name != 'pencil' else m
    return m


ELEMENTS = ['print', 'title', 'stamp', 'signature', 'blue_ink', 'green_ink', 'highlight', 'grey_fill', 'blue_fill', 'picture', 'photo_bw', 'dark_box', 'pencil']
masks = {k: element(k) for k in ELEMENTS}
truth_lab = {k: lab(truth[masks[k]].mean(0)) for k in ELEMENTS}
WHITE = lab([255, 255, 255])

failures = []
checks = 0


def check(ok, what):
    global checks
    checks += 1
    if not ok:
        failures.append(what)


# how visible the pale blue fill is in the photo itself: its brightness against the
# paper just around the table. Fainter than ~8 % it is below the dirt threshold and
# turns white by design (the faded "aged" page).
ys, xs = np.nonzero(labels == ids['blue_fill'])
box = np.zeros_like(paper_far)
box[max(0, ys.min() - 60):ys.max() + 60, max(0, xs.min() - 60):xs.max() + 60] = True
fill_contrast = {}
for case in exp['cases']:
    W, H = case['width'], case['height']
    ph = np.fromfile(os.path.join(out_dir, case['filters']['original']['file']), np.uint8).reshape(H, W, 4)[..., :3].astype(np.float32)
    lum = ph @ np.array([0.299, 0.587, 0.114])
    fill_contrast[case['name']] = float(lum[masks['blue_fill']].mean() / lum[box & paper_far].mean())

report = []
pages = {}
for case in exp['cases']:
    W, H = case['width'], case['height']
    assert (W, H) == tuple(meta['size']), 'case size differs from the document'
    row = {'case': case['name']}
    for fname, f in case['filters'].items():
        img = np.fromfile(os.path.join(out_dir, f['file']), np.uint8).reshape(H, W, 4)[..., :3].astype(np.float32)
        pages.setdefault(fname, []).append((case['name'], img))
        mn = img.min(-1)
        white = float((mn[paper_far] >= 245).mean())
        dirty = float((mn[paper_far] < 215).mean())
        r = {'white': round(white * 100, 2), 'dirty': round(dirty * 100, 3), 'ms': f.get('ms')}
        el = {}
        for k in ELEMENTS:
            got = lab(img[masks[k]].mean(0))
            want = truth_lab[k]
            e = {'L': round(float(got[0]), 1), 'dE': round(float(np.linalg.norm(got - want)), 1)}
            cw, cg = float(np.hypot(*want[1:])), float(np.hypot(*got[1:]))
            if cw > 5:
                e['hue'] = round(hue_gap(hue_deg(got), hue_deg(want)), 1)
                e['chroma'] = round(cg / cw, 2)
            e['seen'] = round(float(np.linalg.norm(got - WHITE)) / max(1e-6, float(np.linalg.norm(want - WHITE))), 2)
            el[k] = e
        r['el'] = el
        row[fname] = r
        tag = f'{case["name"]}/{fname}'
        if fname in ('clean', 'gray', 'bw'):
            check(white >= 0.99, f'{tag}: paper white {white:.2%} < 99 %')
            check(dirty <= 0.005, f'{tag}: dirty paper {dirty:.2%} > 0.5 %')
            check(el['print']['L'] <= 35 and el['title']['L'] <= 35, f'{tag}: print not black (L* {el["print"]["L"]}, {el["title"]["L"]})')
        if fname == 'clean':
            for k, lim in (('stamp', 12), ('signature', 15), ('blue_ink', 15), ('green_ink', 18), ('highlight', 12), ('blue_fill', 25)):
                check(el[k].get('hue', 99) <= lim, f'{tag}: {k} hue off by {el[k].get("hue")}° (> {lim})')
            # thin strokes lose colour in the photo itself (blur, JPEG's halved colour
            # resolution): the filter must not lose more, and broad marks keep 80 %
            photo = row['original']['el']
            for k in ('stamp', 'signature', 'blue_ink', 'green_ink', 'highlight'):
                need = 0.8 if k in ('stamp', 'highlight') else min(0.8, photo[k].get('chroma', 0))
                check(el[k].get('chroma', 0) >= need, f'{tag}: {k} lost colour (chroma x{el[k].get("chroma")} < x{need:.2f})')
            if fill_contrast[case['name']] < 0.92:
                check(el['blue_fill']['seen'] >= 0.5, f'{tag}: pale blue fill faded (x{el["blue_fill"]["seen"]})')
            check(el['picture']['dE'] <= 25, f'{tag}: picture colours off (dE {el["picture"]["dE"]})')
            check(el['photo_bw']['dE'] <= 25, f'{tag}: black-and-white photo off (dE {el["photo_bw"]["dE"]})')
            check(el['dark_box']['dE'] <= 20, f'{tag}: dark box off (dE {el["dark_box"]["dE"]})')
            check(el['pencil']['seen'] >= 0.4, f'{tag}: pencil note faded (x{el["pencil"]["seen"]})')
        if fname == 'gray':
            chroma = np.abs(img[..., 0] - img[..., 1]).max() + np.abs(img[..., 1] - img[..., 2]).max()
            check(chroma <= 2, f'{tag}: not grey')
        if fname == 'bw':
            levels = np.unique(img)
            check(set(levels.tolist()) <= {0.0, 255.0}, f'{tag}: not only black and white')
    report.append(row)

# print a table
cols = ['original', 'brighten', 'clean', 'gray', 'bw']
print(f'{"case":9s} ' + ' '.join(f'{c:>16s}' for c in cols))
for row in report:
    print(f'{row["case"]:9s} ' + ' '.join(f'{row[c]["white"]:7.2f}%/{row[c]["dirty"]:5.2f}%' if c in row else ' ' * 16 for c in cols))
print('\ndocument: ' + ' | '.join(f'{k[:5]} L{v[0]:.0f}' for k, v in truth_lab.items()))
for fname in ('original', 'brighten', 'clean'):
    print(f'\n{fname}, per element (L*, dE, hue gap, chroma ratio, seen):')
    for row in report:
        el = row[fname]['el']
        print(f'{row["case"]:9s} ' + ' | '.join(f'{k[:5]} L{v["L"]:.0f} dE{v["dE"]:.0f}' + (f' h{v["hue"]:.0f} c{v["chroma"]:.2f}' if 'hue' in v else '') + f' s{v["seen"]:.2f}' for k, v in el.items()))

json.dump(report, open(os.path.join(out_dir, 'report.json'), 'w'), indent=1)
if sheet:
    for fname, imgs in pages.items():
        tw, th = 413, 584
        s = Image.new('RGB', (tw * len(imgs), th), 'white')
        for i, (_, im) in enumerate(imgs):
            s.paste(Image.fromarray(im.astype(np.uint8)).resize((tw, th), Image.LANCZOS), (i * tw, 0))
        s.save(os.path.join(out_dir, f'sheet-{fname}.png'))
print(f'\n{checks - len(failures)}/{checks} checks passed')
for f in failures:
    print('  FAIL', f)
sys.exit(1 if failures else 0)
