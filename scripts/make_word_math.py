#!/usr/bin/env python3
"""
word-math.docx: equations as MathType draws them in a Word file (WMF
pictures), the kind a Vietnamese maths exam is full of (0.8.6). Each one
asks for its fonts the way MathType does and builds its brackets the way
MathType does:

  - BE/FC = (AB/AC)^3: parentheses taller than a line, built from Symbol's
    pieces (top, extender, bottom: e6 e7 e8 and f6 f7 f8)
  - a system of two equations under a brace built from Symbol's pieces
    (top, extenders, middle, bottom: ec ef ed ee)
  - x(2x - 1) + 4x - 2 = 0: parentheses a little taller than the text, asked
    with a font width (lfWidth) so they stay narrow
  - the angle B^AC = 20 degrees: MT Extra's wide hat over three letters

The device screenshots (scripts/device-shots.cjs) open it on an Android
emulator and an iPhone simulator. python-docx makes the package; the body is
written as XML.
Usage: python3 scripts/make_word_math.py
"""
import io
import os
import struct
import zipfile

from docx import Document

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'fixtures', 'word-math.docx')
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


class Wmf:
    """a placeable WMF written record by record, as MathType writes one"""

    def __init__(self, width, height):
        self.w, self.h = width, height
        self.recs = []
        self.objs = 0
        self.rec(0x020B, struct.pack('<hh', 0, 0))              # SetWindowOrg
        self.rec(0x020C, struct.pack('<hh', height, width))     # SetWindowExt (y, x)
        self.rec(0x0102, struct.pack('<h', 1))                  # transparent text background
        self.rec(0x012E, struct.pack('<H', 25))                 # baseline, update the current point

    def rec(self, fn, payload=b''):
        if len(payload) % 2:
            payload += b'\0'
        self.recs.append(struct.pack('<IH', 3 + len(payload) // 2, fn) + payload)

    def font(self, height, face, italic=0, charset=0, width=0):
        name = face.encode('latin-1')[:31] + b'\0'
        name += b'\0' * (32 - len(name))
        self.rec(0x02FB, struct.pack('<hhhhhBBBBBBBB', height, width, 0, 0, 400, italic, 0, 0, charset, 0, 0, 0, 0x12) + name)
        self.rec(0x012D, struct.pack('<H', self.objs))       # select it (each font its own slot)
        self.objs += 1

    def text(self, x, y, s, dx):
        data = bytes(s) if isinstance(s, (bytes, bytearray)) else s.encode('latin-1')
        self.rec(0x0214, struct.pack('<hh', y, x))             # MoveTo (y, x)
        payload = struct.pack('<hhhH', 0, 0, len(data), 0) + data + (b'\0' if len(data) % 2 else b'') + struct.pack(f'<{len(dx)}h', *dx)
        self.rec(0x0A32, payload)

    def line(self, x0, y0, x1, y1):
        self.rec(0x0214, struct.pack('<hh', y0, x0))
        self.rec(0x0213, struct.pack('<hh', y1, x1))

    def bytes(self):
        recs = self.recs + [struct.pack('<IH', 3, 0)]
        body = b''.join(recs)
        header = struct.pack('<HHHIHIH', 1, 9, 0x0300, (18 + len(body)) // 2, max(1, self.objs), max(len(r) // 2 for r in recs), 0)
        placeable = struct.pack('<IHhhhhHI', 0x9AC6CDD7, 0, 0, 0, self.w, self.h, 2304, 0)
        checksum = 0
        for i in range(0, 20, 2):
            checksum ^= struct.unpack('<H', placeable[i:i + 2])[0]
        return placeable + struct.pack('<H', checksum) + header + body


def parens():
    """BE/FC = (AB/AC)^3"""
    m = Wmf(2208, 1184)
    m.line(64, 640, 628, 640)
    m.line(1224, 640, 1806, 640)
    m.font(-268, 'Times New Roman')
    m.text(2012, 275, '3', [536])
    m.font(-384, 'Times New Roman', italic=1)
    m.text(112, 494, 'BEAB', [234, 950, 234, 768])
    m.text(100, 1036, 'FCAC', [234, 944, 234, 768])
    m.font(-384, 'Symbol', charset=1)
    m.text(730, 736, b'=', [768])
    m.text(1018, 524, b'\xe6\xf6', [844, 768])
    m.text(1018, 839, b'\xe7\xf7', [844, 768])
    m.text(1018, 1080, b'\xe8\xf8', [844, 768])
    return m.bytes()


def system():
    """{ 7x - 2y = 1 ; 3x + y = 6 }"""
    m = Wmf(2300, 1344)
    m.font(-384, 'Times New Roman')
    m.text(260, 446, '721', [846, 876, 768])
    m.text(222, 1052, '36', [1760, 768])
    m.font(-384, 'Times New Roman', italic=1)
    m.text(452, 446, 'xy', [828, 768])
    m.text(402, 1052, 'xy', [672, 768])
    m.font(-384, 'Symbol', charset=1)
    for y, k in ((352, 0xEC), (420, 0xEF), (624, 0xEF), (813, 0xED), (1025, 0xEF), (1271, 0xEF), (1280, 0xEE)):
        m.text(34, y, bytes([k]), [768])
    m.text(746, 446, b'\x2d', [852])
    m.text(1646, 446, b'=', [768])
    m.text(708, 1052, b'+', [684])
    m.text(1646, 1052, b'=', [768])
    return m.bytes()


def stretched():
    """x(2x - 1) + 4x - 2 = 0, the parentheses a little taller than the text"""
    m = Wmf(3616, 640)
    m.font(-545, 'Symbol', charset=1, width=246)
    m.text(305, 446, b'(', [0])
    m.text(1431, 446, b')', [0])
    m.font(-416, 'Times New Roman')
    m.text(477, 416, '21420', [757, 716, 803, 607, 832])
    m.font(-416, 'Times New Roman', italic=1)
    m.text(77, 416, 'xxx', [634, 1473, 832])
    m.font(-416, 'Symbol', charset=1)
    m.text(976, 416, b'-+-=', [663, 810, 598, 832])
    return m.bytes()


def angle():
    """B^AC = 20 degrees, the hat over three letters"""
    m = Wmf(2100, 640)
    m.font(-384, 'MT Extra', charset=1)
    m.text(82, 348, b'\xb7', [0])
    m.font(-384, 'Times New Roman', italic=1)
    m.text(70, 480, 'BAC', [234, 234, 768])
    m.font(-384, 'Symbol', charset=1)
    m.text(900, 480, b'=', [400])
    m.font(-384, 'Times New Roman')
    m.text(1300, 480, '20', [192, 192])
    m.font(-384, 'Symbol', charset=1)
    m.text(1700, 330, b'\xb0', [200])
    return m.bytes()


EQUATIONS = [('eq1.wmf', parens(), 2208, 1184), ('eq2.wmf', system(), 2300, 1344), ('eq3.wmf', stretched(), 3616, 640), ('eq4.wmf', angle(), 2100, 640)]


def t(text, bold=False):
    rpr = '<w:rPr><w:b/></w:rPr>' if bold else ''
    return f'<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r>'


def ole(i, w, h):
    # MathType's own units: 1/2304 inch; points = units / 2304 * 72
    wpt, hpt = w / 32, h / 32
    return (
        f'<w:r><w:object w:dxaOrig="{w * 20 // 32}" w:dyaOrig="{h * 20 // 32}">'
        f'<v:shape id="_x0000_i{1025 + i}" type="#_x0000_t75" style="width:{wpt:.1f}pt;height:{hpt:.1f}pt" o:ole=""><v:imagedata r:id="rIdW{i}" o:title=""/></v:shape>'
        f'<o:OLEObject Type="Embed" ProgID="Equation.DSMT4" ShapeID="_x0000_i{1025 + i}" DrawAspect="Content" ObjectID="_170000000{i}" r:id="rIdO{i}"/>'
        '</w:object></w:r>'
    )


def body():
    shapetype = (
        '<w:r><w:pict><v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f">'
        '<v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype></w:pict></w:r>'
    )
    p = lambda inner: f'<w:p>{inner}</w:p>'
    out = [
        p(shapetype + t('Công thức MathType (ngoặc, mũ góc)', bold=True)),
        p(t('Câu 1. Chứng minh ') + ole(1, 2208, 1184)),
        p(t('Câu 2. Giải hệ phương trình ') + ole(2, 2300, 1344)),
        p(t('Câu 3. Giải phương trình ') + ole(3, 3616, 640)),
        p(t('Câu 4. Cho tam giác ABC có ') + ole(4, 2100, 640) + t('. Tính góc còn lại.')),
    ]
    return ''.join(out)


def build():
    doc = Document()
    doc.add_paragraph('placeholder')
    tmp = io.BytesIO()
    doc.save(tmp)
    zin = zipfile.ZipFile(io.BytesIO(tmp.getvalue()))
    files = {n: zin.read(n) for n in zin.namelist()}
    R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    rels = []
    for i, (name, data, _, _) in enumerate(EQUATIONS, 1):
        files[f'word/media/{name}'] = data
        files[f'word/embeddings/oleObject{i}.bin'] = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + b'\0' * 504
        rels += [(f'rIdW{i}', f'{R}/image', f'media/{name}'), (f'rIdO{i}', f'{R}/oleObject', f'embeddings/oleObject{i}.bin')]
    rel_xml = files['word/_rels/document.xml.rels'].decode()
    files['word/_rels/document.xml.rels'] = rel_xml.replace('</Relationships>', ''.join(f'<Relationship Id="{i}" Type="{t_}" Target="{g}"/>' for i, t_, g in rels) + '</Relationships>').encode()
    ct = files['[Content_Types].xml'].decode()
    O = 'application/vnd.openxmlformats-officedocument'
    files['[Content_Types].xml'] = ct.replace('</Types>', f'<Default Extension="wmf" ContentType="image/x-wmf"/><Default Extension="bin" ContentType="{O}.oleObject"/></Types>').encode()
    # Times New Roman for the text, as in the exams this is for
    styles = files['word/styles.xml'].decode()
    files['word/styles.xml'] = styles.replace('<w:rPrDefault><w:rPr>', '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>', 1).encode()

    xml = files['word/document.xml'].decode()
    start = xml.index('<w:body>') + len('<w:body>')
    sect = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>'
    xml = xml[:start] + body() + sect + '</w:body></w:document>'
    for pref, uri in (('o', 'urn:schemas-microsoft-com:office:office'), ('v', 'urn:schemas-microsoft-com:vml')):
        if f'xmlns:{pref}=' not in xml[: xml.index('<w:body>')]:
            xml = xml.replace('<w:document ', f'<w:document xmlns:{pref}="{uri}" ', 1)
    files['word/document.xml'] = xml.encode()

    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    print('wrote', OUT)


if __name__ == '__main__':
    build()
