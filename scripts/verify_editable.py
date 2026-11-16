#!/usr/bin/env python3
"""
"PDF sửa được chữ": the checks of tests/editable-test.ts done again with
other readers (qpdf, pikepdf, MuPDF), from what that test wrote:

  python3 scripts/verify_editable.py out/editable/expected.json

- qpdf finds the files sound;
- each page draws one picture and text, nothing else: no shapes, no
  fills, and each word's glyph draws only its picture (nothing painted
  over the scan, in the page or in the font);
- MuPDF draws the page as it draws the scan;
- MuPDF reads the words back, in order;
- the picture itself has no ink where the words were (read straight from
  the file), and still has the page's rules; with the text taken out of
  the page, MuPDF draws the words' places empty;
- the edited file reads with the new word and is still built the same way;
- the file with a line moved ("Kéo chữ"): MuPDF finds the line's words at
  the new place and draws the old place empty, still one picture and text;
- the opposite test: a copy of the scan with white boxes drawn over the
  words and the text laid on top (what "covering" would be) fails.
"""
import json
import os
import subprocess
import sys

import fitz  # PyMuPDF
import numpy as np
import pikepdf
from PIL import Image

PAINT = {'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'S', 's', 'sh', 'BI'}
failed = 0


def check(name, ok, detail=''):
    global failed
    if not ok:
        failed += 1
    print(('PASS' if ok else 'FAIL') + '  ' + name + (('  — ' + detail) if detail else ''))


def qpdf_ok(path):
    r = subprocess.run(['qpdf', '--check', path], capture_output=True, text=True)
    return r.returncode in (0, 3) and 'No syntax or stream encoding errors' in r.stdout


def structure(pdf, page_no):
    """what a page draws: pictures, text, painting; and what its fonts' glyphs draw"""
    page = pdf.pages[page_no]
    images = text = paint = 0
    for operands, op in pikepdf.parse_content_stream(page):
        o = str(op)
        if o == 'Do':
            x = page.Resources.XObject[str(operands[0])]
            if x.get('/Subtype') == '/Image':
                images += 1
            else:
                paint += 1  # a form: could hold anything
        elif o in ('Tj', 'TJ', "'", '"'):
            text += 1
        elif o in PAINT:
            paint += 1
    fonts = page.Resources.get('/Font', {})
    kinds = set()
    glyph_paint = 0
    for _, f in fonts.items():
        kinds.add((str(f.get('/Subtype')), str(f.get('/BaseFont'))))
        if f.get('/Subtype') == '/Type3':
            for _, proc in f.CharProcs.items():
                for operands, op in pikepdf.parse_content_stream(proc):
                    if str(op) in PAINT:
                        glyph_paint += 1
    return images, text, paint, kinds, glyph_paint


def render(doc, page_no, dpi):
    pix = doc[page_no].get_pixmap(dpi=dpi, alpha=False)
    return np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(np.int16)


def dark_share(img, box_pt, dpi, height_pt, below=140):
    """share of pixels darker than `below` in a box given in PDF points (y up)"""
    s = dpi / 72
    x0, y0, x1, y1 = box_pt
    c0, c1 = int(np.floor(x0 * s)), int(np.ceil(x1 * s))
    r0, r1 = int(np.floor((height_pt - y1) * s)), int(np.ceil((height_pt - y0) * s))
    part = img[max(0, r0):r1, max(0, c0):c1]
    if part.size == 0:
        return 0.0
    lum = 0.299 * part[:, :, 0] + 0.587 * part[:, :, 1] + 0.114 * part[:, :, 2]
    return float((lum < below).mean())


def without_text(src, dst):
    """the same file with every text object taken out of the pages' content"""
    pdf = pikepdf.open(src)
    for page in pdf.pages:
        out = []
        inside = False
        for operands, op in pikepdf.parse_content_stream(page):
            o = str(op)
            if o == 'BT':
                inside = True
            if not inside:
                out.append((operands, op))
            if o == 'ET':
                inside = False
        page.Contents = pdf.make_stream(pikepdf.unparse_content_stream(out))
    pdf.save(dst)


def picture(pdf, page_no):
    """the page's picture, as stored in the file"""
    page = pdf.pages[page_no]
    for _, x in page.Resources.XObject.items():
        if x.get('/Subtype') == '/Image':
            return np.asarray(pikepdf.PdfImage(x).as_pil_image().convert('RGB')).astype(np.int16)
    return None


def lcs_ratio(a, b):
    prev = [0] * (len(b) + 1)
    for i in range(1, len(a) + 1):
        cur = [0]
        for j in range(1, len(b) + 1):
            cur.append(prev[j - 1] + 1 if a[i - 1] == b[j - 1] else max(prev[j], cur[j - 1]))
        prev = cur
    return prev[len(b)] / max(1, len(a), len(b))


def verify_pages(base, exp, result_name, label):
    """the checks on one result file; returns how many failed"""
    global failed
    before = failed
    path = os.path.join(base, result_name)
    pdf = pikepdf.open(path)
    doc = fitz.open(path)
    orig = fitz.open(os.path.join(base, exp['original']))
    bare = os.path.join(base, f'{label}-bare.pdf')
    without_text(path, bare)
    bare_doc = fitz.open(bare)
    for k, p in enumerate(exp['pages']):
        n = p['page']
        tag = f'{label} page {n + 1}'
        images, text, paint, kinds, glyph_paint = structure(pdf, n)
        check(f'{tag}: draws one picture and {len(p["words"])} words as text, no shapes or fills', images == 1 and text == len(p['words']) and paint == 0, f'{images} pictures, {text} texts, {paint} painting')
        check(f'{tag}: its fonts are the OCR word fonts, their glyphs draw only the word\'s picture', all(kd == ('/Type3', '/' + exp['font']) for kd in kinds) and glyph_paint == 0, f'{kinds}, glyph painting {glyph_paint}')
        dpi = p['dpi']
        a = render(orig, k, dpi)
        b = render(doc, n, dpi)
        if a.shape == b.shape:
            d = np.abs(a - b).max(axis=2)
            check(f'{tag}: MuPDF draws it as it draws the scan (mean {d.mean():.2f}, {(d > 48).mean() * 100:.2f}% off by > 48)', d.mean() <= 4 and (d > 48).mean() <= 0.02)
        else:
            check(f'{tag}: same size as the scan when drawn', False, f'{a.shape} / {b.shape}')
        words = [w[4] for w in doc[n].get_text('words', sort=False)]
        want = [w['text'] for w in p['words']]
        r = lcs_ratio(words, want)
        check(f'{tag}: MuPDF reads the words back in order ({r * 100:.1f}%)', r >= 0.95, ' '.join(words[:12]))
        pic = picture(pdf, n)
        empty_page = render(bare_doc, n, dpi)
        inked = cleared = 0
        worst = 0.0
        bare_empty = 0
        for w in p['words']:
            had = dark_share(a, w['box'], dpi, p['heightPt'])
            if had < 0.03:
                continue
            inked += 1
            left = dark_share(pic, w['box'], dpi, p['heightPt'])
            worst = max(worst, left)
            if left <= 0.01:
                cleared += 1
            if dark_share(empty_page, w['box'], dpi, p['heightPt']) <= 0.01:
                bare_empty += 1
        check(f'{tag}: the picture in the file has no ink where the words were ({cleared} of {inked}; worst {worst * 100:.1f}%)', inked > 0 and cleared >= inked * 0.98)
        check(f'{tag}: with the text taken out, MuPDF draws the words\' places empty ({bare_empty} of {inked})', bare_empty >= inked * 0.98)
        if p['rules']:
            on = along = 0
            s = dpi / 72
            for x0, y0, x1, y1 in p['rules']:
                length = np.hypot(x1 - x0, y1 - y0) * s
                for t in np.arange(4, length - 4, 2):
                    x = x0 + (x1 - x0) * t / length
                    y = y0 + (y1 - y0) * t / length
                    c, rr = int(round(x * s)), int(round((p['heightPt'] - y) * s))
                    vertical = abs(y1 - y0) > abs(x1 - x0)
                    best = 255
                    for e in range(-2, 3):
                        cc, r2 = (c + e, rr) if vertical else (c, rr + e)
                        if 0 <= r2 < pic.shape[0] and 0 <= cc < pic.shape[1]:
                            best = min(best, 0.299 * pic[r2, cc, 0] + 0.587 * pic[r2, cc, 1] + 0.114 * pic[r2, cc, 2])
                    along += 1
                    on += best < 170
            check(f'{tag}: the page\'s lines are still in the picture ({on / max(1, along) * 100:.1f}%)', on >= along * 0.9)
    return failed - before


def covered_copy(base, exp, dst):
    """the opposite: the scan kept, white boxes drawn over the words, the words written on top"""
    pdf = pikepdf.open(os.path.join(base, exp['original']))
    font = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica))
    for k, p in enumerate(exp['pages']):
        page = pdf.pages[k]
        ops = ['q 1 1 1 rg']
        for w in p['words']:
            x0, y0, x1, y1 = w['box']
            ops.append(f'{x0:.2f} {y0:.2f} {x1 - x0:.2f} {y1 - y0:.2f} re f')
        ops.append('Q BT /Fcov 10 Tf')
        for w in p['words']:
            ops.append(f'1 0 0 1 {w["box"][0]:.2f} {w["box"][1]:.2f} Tm (x) Tj')
        ops.append('ET')
        page.contents_add(pdf.make_stream('\n'.join(ops).encode()), prepend=False)
        res = page.Resources
        if '/Font' not in res:
            res.Font = pikepdf.Dictionary()
        res.Font.Fcov = font
    pdf.save(dst)


def main():
    exp_path = sys.argv[1] if len(sys.argv) > 1 else 'out/editable/expected.json'
    base = os.path.dirname(os.path.abspath(exp_path))
    exp = json.load(open(exp_path))
    check('qpdf: the result is sound', qpdf_ok(os.path.join(base, exp['result'])))
    verify_pages(base, exp, exp['result'], 'result')
    if exp.get('edited'):
        path = os.path.join(base, exp['edited'])
        check('qpdf: the edited file is sound', qpdf_ok(path))
        e = exp['edit']
        doc = fitz.open(path)
        text = doc[e['page']].get_text()
        check(f'the edited file reads "{e["to"]}" where "{e["from"]}" was', e['result'].split(' ')[0] in text and e['to'] in text and ' '.join(e['result'].split(' ')[:3]) in ' '.join(text.split()), e['result'][:60])
        images, _, paint, _, glyph_paint = structure(pikepdf.open(path), e['page'])
        check('the edited page still draws one picture and text only', images == 1 and paint == 0 and glyph_paint == 0, f'{images} pictures, {paint} painting')
    if exp.get('moved'):
        mv = exp['moved']
        path = os.path.join(base, 'moved.pdf')
        check('qpdf: the file with a moved line is sound', qpdf_ok(path))
        doc = fitz.open(path)
        page = doc[mv['page']]
        H = page.rect.height
        first = mv['text'].split(' ')[0]
        words = [w for w in page.get_text('words') if w[4] == first]
        at_new = any(abs((H - w[3]) - mv['to']['bottom']) < 4 and abs(w[0] - mv['to']['left']) < 4 for w in words)
        dpi = exp['pages'][0]['dpi']
        img = render(doc, mv['page'], dpi)
        f = mv['from']
        empty = dark_share(img, [f['left'], f['bottom'], f['right'], f['top']], dpi, H)
        images, _, paint, _, glyph_paint = structure(pikepdf.open(path), mv['page'])
        check(f'the moved line: MuPDF finds "{first}…" where it was dropped, the old place is empty ({empty * 100:.2f}% dark), one picture and text only', at_new and empty <= 0.01 and images == 1 and paint == 0 and glyph_paint == 0, f'{len(words)} "{first}" words')
    # the opposite test
    fake = os.path.join(base, 'covered.pdf')
    covered_copy(base, exp, fake)
    global failed
    keep = failed
    print('      (the opposite test: a copy that covers the words with white boxes; its checks must fail)')
    caught = verify_pages(base, dict(exp, pages=[dict(p, page=k) for k, p in enumerate(exp['pages'])]), 'covered.pdf', 'covered')
    failed = keep
    check(f'the opposite test is caught: covering the words fails {caught} check(s)', caught >= 2)
    print(f'\n{failed} check(s) FAILED' if failed else '\nall checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
