#!/usr/bin/env python3
"""
word-images.docx: one picture of every format a Word file may hold, for
tests/word-probe.ts and scripts/e2e-word.cjs. Each paragraph names its
picture ("TIFF LZW: ▢").

  TIFF: uncompressed, LZW, PackBits, CCITT Group 4 (a scanned page, black
        and white), JPEG (RGB and YCbCr), Deflate, palette, CMYK, two pages (the first shown)
  EPS:  DOS EPS with a TIFF preview, EPS with an EPSI preview
  PICT: a Mac PICT holding a JPEG
  PNG with transparency, JPEG, GIF, BMP, WebP, ICO, SVG, AVIF
  a PNG named .jpg, a TIFF named .png (pictures are known by their bytes)
  .wmz (a gzipped WMF)
  HEIC and JPEG XR (headers only: shown where the browser can, else a chip)

Also writes tests/fixtures/word-images/<name>.png: what each picture should
look like, for comparing what ezPDF decodes.
Usage: python3 scripts/make_word_images.py
"""
import gzip
import io
import os
import struct
import zipfile

from docx import Document
from docx.shared import Pt
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'fixtures', 'word-images.docx')
REF = os.path.join(ROOT, 'tests', 'fixtures', 'word-images')


def picture(w=240, h=160, mode='RGB'):
    """four colour blocks and a black diagonal: easy to compare after decoding"""
    img = Image.new('RGB', (w, h), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w // 2 - 1, h // 2 - 1], fill=(220, 40, 40))
    d.rectangle([w // 2, 0, w - 1, h // 2 - 1], fill=(40, 160, 60))
    d.rectangle([0, h // 2, w // 2 - 1, h - 1], fill=(40, 70, 200))
    d.rectangle([w // 2, h // 2, w - 1, h - 1], fill=(250, 210, 40))
    d.line([0, 0, w - 1, h - 1], fill=(0, 0, 0), width=6)
    return img.convert(mode) if mode != 'RGB' else img


def scan(w=400, h=280):
    """a black-and-white 'scanned page': text-like bars"""
    img = Image.new('1', (w, h), 1)
    d = ImageDraw.Draw(img)
    for i in range(10):
        d.rectangle([30, 30 + i * 24, 30 + (i * 37) % 300 + 60, 42 + i * 24], fill=0)
    d.rectangle([5, 5, w - 6, h - 6], outline=0, width=3)
    return img


def save(img, fmt, **kw):
    b = io.BytesIO()
    img.save(b, fmt, **kw)
    return b.getvalue()


def tiff_two_pages():
    """a two-page TIFF: page 1 the picture, page 2 something else"""
    b = io.BytesIO()
    picture().save(b, 'TIFF', compression='tiff_lzw', save_all=True, append_images=[Image.new('RGB', (60, 40), (0, 0, 0))])
    return b.getvalue()


def dos_eps(tiff):
    ps = b'%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 240 160\nnewpath 0 0 moveto 240 160 lineto stroke\nshowpage\n%%EOF\n'
    head_len = 30
    ps_at = head_len
    tiff_at = ps_at + len(ps)
    header = struct.pack('<IIIIIIIH', 0xC6D3D0C5, ps_at, len(ps), 0, 0, tiff_at, len(tiff), 0xFFFF)
    return header + ps + tiff


def epsi(img):
    """EPS with an EPSI preview: 1-bit hex rows, 0 white, 1 black"""
    g = img.convert('1')
    w, h = g.size
    lines = []
    for y in range(h):
        row = 0
        bits = ''
        for x in range(w):
            bits += '1' if g.getpixel((x, y)) == 0 else '0'
        bits += '0' * ((8 - len(bits) % 8) % 8)
        lines.append('%' + ''.join(f'{int(bits[i:i + 8], 2):02x}' for i in range(0, len(bits), 8)))
    head = f'%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 {w} {h}\n%%EndComments\n%%BeginPreview: {w} {h} 1 {h}\n'
    return (head + '\n'.join(lines) + '\n%%EndPreview\nshowpage\n%%EOF\n').encode('latin1')


def pict(jpeg):
    """a version-2 PICT (512-byte file header) with a QuickTime JPEG inside"""
    body = struct.pack('>HhhhhHH', 0, 0, 0, 160, 240, 0x0011, 0x02FF) + b'\x0c\x00' + b'\0' * 24 + b'\x82\x00' + b'\0' * 40 + jpeg + b'\x00\xff'
    return b'\0' * 512 + body


def build():
    pic = picture()
    jpeg = save(pic, 'JPEG', quality=92)
    items = [
        ('TIFF không nén', 'a.tif', save(pic, 'TIFF', compression='raw'), pic),
        ('TIFF LZW', 'b.tif', save(pic, 'TIFF', compression='tiff_lzw'), pic),
        ('TIFF PackBits', 'c.tif', save(pic, 'TIFF', compression='packbits'), pic),
        ('TIFF CCITT G4 (bản quét)', 'd.tif', save(scan(), 'TIFF', compression='group4'), scan().convert('RGB')),
        ('TIFF JPEG', 'e.tif', save(pic, 'TIFF', compression='jpeg', quality=90), pic),
        ('TIFF JPEG YCbCr', 'e2.tif', save(pic.convert('YCbCr'), 'TIFF', compression='jpeg', quality=90), pic),
        ('TIFF Deflate', 'f.tif', save(pic, 'TIFF', compression='tiff_adobe_deflate'), pic),
        ('TIFF bảng màu', 'g.tif', save(pic.convert('P', palette=Image.ADAPTIVE, colors=16), 'TIFF', compression='tiff_lzw'), pic.convert('P', palette=Image.ADAPTIVE, colors=16).convert('RGB')),
        ('TIFF CMYK', 'h.tif', save(pic.convert('CMYK'), 'TIFF', compression='tiff_lzw'), pic.convert('CMYK').convert('RGB')),
        ('TIFF hai trang', 'i.tif', tiff_two_pages(), pic),
        ('EPS có ảnh xem trước TIFF', 'j.eps', dos_eps(save(pic, 'TIFF', compression='tiff_lzw')), pic),
        ('EPS có ảnh xem trước EPSI', 'k.eps', epsi(pic), pic.convert('1').convert('RGB')),
        ('PICT', 'l.pict', pict(jpeg), pic),
        ('PNG trong suốt', 'm.png', save(pic.convert('RGBA'), 'PNG'), pic),
        ('JPEG', 'n.jpeg', jpeg, pic),
        ('GIF', 'o.gif', save(pic.convert('P', palette=Image.ADAPTIVE), 'GIF'), pic.convert('P', palette=Image.ADAPTIVE).convert('RGB')),
        ('BMP', 'p.bmp', save(pic, 'BMP'), pic),
        ('WebP', 'q.webp', save(pic, 'WEBP', quality=95), pic),
        ('ICO', 'r.ico', save(picture(64, 64), 'ICO', sizes=[(64, 64)]), picture(64, 64)),
        ('SVG', 's.svg', b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="120" height="80" fill="#dc2828"/><rect x="120" width="120" height="80" fill="#28a03c"/><rect y="80" width="120" height="80" fill="#2846c8"/><rect x="120" y="80" width="120" height="80" fill="#fad228"/></svg>', None),
        ('AVIF', 't.avif', save(pic, 'AVIF', quality=90), pic),
        ('PNG đặt tên .jpg', 'u.jpg', save(pic, 'PNG'), pic),
        ('TIFF đặt tên .png', 'v.png', save(pic, 'TIFF', compression='tiff_lzw'), pic),
        ('WMZ (WMF nén)', 'w.wmz', gzip.compress(zipfile.ZipFile(os.path.join(ROOT, 'tests', 'fixtures', 'word-draw.docx')).read('word/media/eq1.wmf')), None),
        ('HEIC', 'x.heic', b'\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic' + b'\0' * 64, None),
        ('JPEG XR', 'y.jxr', b'II\xbc\x01' + b'\0' * 64, None),
    ]
    items = [it for it in items if it[2] is not None]

    doc = Document()
    doc.add_heading('Ảnh mọi định dạng', 1)
    for label, _, _, _ in items:
        p = doc.add_paragraph(f'{label}: ')
        p.add_run('[[IMG]]')
    tmp = io.BytesIO()
    doc.save(tmp)
    zin = zipfile.ZipFile(io.BytesIO(tmp.getvalue()))
    files = {n: zin.read(n) for n in zin.namelist()}

    R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    rels = files['word/_rels/document.xml.rels'].decode()
    x = files['word/document.xml'].decode()
    exts = set()
    for i, (label, name, data, _) in enumerate(items):
        files[f'word/media/{name}'] = data
        exts.add(name.rsplit('.', 1)[1])
        rid = f'rIdImg{i}'
        rels = rels.replace('</Relationships>', f'<Relationship Id="{rid}" Type="{R}/image" Target="media/{name}"/></Relationships>')
        emu_w, emu_h = 120 * 12700, 80 * 12700
        drawing = (
            '<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">'
            f'<wp:extent cx="{emu_w}" cy="{emu_h}"/><wp:docPr id="{100 + i}" name="{name}"/>'
            '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:nvPicPr><pic:cNvPr id="0" name="{name}"/><pic:cNvPicPr/></pic:nvPicPr>'
            f'<pic:blipFill><a:blip xmlns:r="{R}" r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{emu_w}" cy="{emu_h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
            '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
        )
        x = x.replace('<w:t>[[IMG]]</w:t>', drawing, 1)
    files['word/document.xml'] = x.encode()
    files['word/_rels/document.xml.rels'] = rels.encode()
    ct = files['[Content_Types].xml'].decode()
    mime = {'tif': 'image/tiff', 'eps': 'application/postscript', 'pict': 'image/pict', 'png': 'image/png', 'jpeg': 'image/jpeg', 'jpg': 'image/jpeg', 'gif': 'image/gif',
            'bmp': 'image/bmp', 'webp': 'image/webp', 'ico': 'image/x-icon', 'svg': 'image/svg+xml', 'avif': 'image/avif', 'wmz': 'image/x-wmz', 'heic': 'image/heic', 'jxr': 'image/vnd.ms-photo'}
    for e in sorted(exts):
        if f'Extension="{e}"' not in ct:
            ct = ct.replace('</Types>', f'<Default Extension="{e}" ContentType="{mime[e]}"/></Types>')
    files['[Content_Types].xml'] = ct.encode()
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        for n in ['[Content_Types].xml'] + [n for n in files if n != '[Content_Types].xml']:
            z.writestr(n, files[n])

    os.makedirs(REF, exist_ok=True)
    for label, name, _, ref in items:
        if ref is not None:
            ref.convert('RGB').save(os.path.join(REF, name.rsplit('.', 1)[0] + '.png'))
    print('wrote', OUT, len(items), 'pictures')


if __name__ == '__main__':
    build()
