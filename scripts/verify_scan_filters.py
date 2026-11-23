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

The passport page (security paper, a colour photo, a soft shadow running
down beside the photo): with "Màu sạch" the patterned paper turns white
(97 %), the hair and the suit stay black (L* <= 35), the face is neither
burnt out nor drained of colour, the stamp keeps its hue, the MRZ is black;
with "Làm sáng" the shadow is gone (the paper in it within 6 levels of the
paper beside it) and the hair stays black too.
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


ELEMENTS = {
    'report': ['print', 'title', 'stamp', 'signature', 'blue_ink', 'green_ink', 'highlight', 'grey_fill', 'blue_fill', 'picture', 'photo_bw', 'dark_box', 'pencil'],
    'passport': ['print', 'mrz', 'stamp', 'signature', 'photo_face', 'photo_hair', 'photo_suit', 'photo_ground'],
}
BROAD = ('grey_fill', 'blue_fill', 'picture', 'highlight', 'photo_bw', 'dark_box', 'photo_face', 'photo_hair', 'photo_suit', 'photo_ground')


class Doc:
    def __init__(self, name, spec):
        self.name = name
        self.truth = np.asarray(Image.open(os.path.join(fix, spec['truth'])).convert('RGB')).astype(np.float32)
        self.labels = np.asarray(Image.open(os.path.join(fix, spec['labels'])))
        self.ids = spec['label_ids']
        nonpaper = self.labels != 0
        self.paper_far = (self.labels == 0) & (distance_transform_edt(~nonpaper) >= 5)
        lum = self.truth @ np.array([0.299, 0.587, 0.114])
        self.elements = ELEMENTS[name]
        self.masks = {}
        for k in self.elements:
            m = self.labels == self.ids[k]
            if k in BROAD:
                m = binary_erosion(m, iterations=3)
            elif k != 'pencil':
                m = m & (lum < 150)
            self.masks[k] = m
        self.truth_lab = {k: lab(self.truth[self.masks[k]].mean(0)) for k in self.elements}


fixture_cases = {c['name']: c for c in meta['cases']}
for case in exp['cases']:
    for k in ('doc', 'band'):
        if k in fixture_cases.get(case['name'], {}):
            case[k] = fixture_cases[case['name']][k]
docs = {k: Doc(k, v) for k, v in meta.get('docs', {'report': {'truth': meta['truth'], 'labels': meta['labels'], 'label_ids': meta['label_ids']}}).items()}
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
rep = docs['report']
ys, xs = np.nonzero(rep.labels == rep.ids['blue_fill'])
box = np.zeros_like(rep.paper_far)
box[max(0, ys.min() - 60):ys.max() + 60, max(0, xs.min() - 60):xs.max() + 60] = True
fill_contrast = {}
for case in exp['cases']:
    if case.get('doc', 'report') != 'report':
        continue
    W, H = case['width'], case['height']
    ph = np.fromfile(os.path.join(out_dir, case['filters']['original']['file']), np.uint8).reshape(H, W, 4)[..., :3].astype(np.float32)
    lum = ph @ np.array([0.299, 0.587, 0.114])
    fill_contrast[case['name']] = float(lum[rep.masks['blue_fill']].mean() / lum[box & rep.paper_far].mean())


def band_gap(img, case, doc):
    """How much darker the paper is in the shadow band than beside it (0–255)."""
    b = case['band']
    H, W = doc.labels.shape
    yy, xx = np.mgrid[0:H, 0:W]
    centre = (b['x0'] + b['dx'] * yy / H) * W
    off = np.abs(xx - centre) / (b['sigma'] * W)
    lum = img @ np.array([0.299, 0.587, 0.114])
    return float(np.median(lum[(off < 0.6) & doc.paper_far]) - np.median(lum[(off > 3) & doc.paper_far]))

report = []
pages = {}
for case in exp['cases']:
    doc = docs[case.get('doc', 'report')]
    W, H = case['width'], case['height']
    assert (H, W) == doc.labels.shape, 'case size differs from the document'
    row = {'case': case['name'], 'doc': doc.name}
    for fname, f in case['filters'].items():
        img = np.fromfile(os.path.join(out_dir, f['file']), np.uint8).reshape(H, W, 4)[..., :3].astype(np.float32)
        pages.setdefault(fname, []).append((case['name'], img))
        mn = img.min(-1)
        white = float((mn[doc.paper_far] >= 245).mean())
        dirty = float((mn[doc.paper_far] < 215).mean())
        r = {'white': round(white * 100, 2), 'dirty': round(dirty * 100, 3), 'ms': f.get('ms')}
        if 'band' in case:
            r['band'] = round(band_gap(img, case, doc), 1)
        el = {}
        for k in doc.elements:
            got = lab(img[doc.masks[k]].mean(0))
            want = doc.truth_lab[k]
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
        if doc.name == 'report':
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
        else:
            face_L = doc.truth_lab['photo_face'][0]
            if fname in ('clean', 'gray', 'bw'):
                check(white >= 0.97, f'{tag}: patterned paper white {white:.2%} < 97 %')
                check(el['mrz']['L'] <= 35, f'{tag}: MRZ not black (L* {el["mrz"]["L"]})')
            if fname in ('clean', 'brighten'):
                check(el['photo_hair']['L'] <= 35 and el['photo_suit']['L'] <= 35, f'{tag}: hair or suit burnt (L* {el["photo_hair"]["L"]}, {el["photo_suit"]["L"]})')
                check(el['photo_face']['L'] <= face_L + 12 and el['photo_face'].get('chroma', 0) >= 0.5, f'{tag}: face burnt out (L* {el["photo_face"]["L"]} vs {face_L:.0f}, chroma x{el["photo_face"].get("chroma")})')
            if fname == 'clean':
                check(el['stamp'].get('hue', 99) <= 12, f'{tag}: stamp hue off by {el["stamp"].get("hue")}°')
            if fname == 'brighten':
                check(abs(r['band']) <= 6, f'{tag}: shadow still there (paper {r["band"]:+.1f} levels against beside it)')
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
    print(f'{row["case"]:9s} ' + ' '.join(f'{row[c]["white"]:7.2f}%/{row[c]["dirty"]:5.2f}%' if c in row else ' ' * 16 for c in cols)
          + (f'   shadow band: photo {row["original"]["band"]:+.0f}, Làm sáng {row["brighten"]["band"]:+.1f}' if 'band' in row['original'] else ''))
for d in docs.values():
    print(f'\ndocument {d.name}: ' + ' | '.join(f'{k[:5]} L{v[0]:.0f}' for k, v in d.truth_lab.items()))
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
