#!/usr/bin/env python3
"""
word-pages.docx: how a Word file falls into pages and lines up at tab stops,
for tests/word-probe.ts and scripts/e2e-word.cjs (0.8.3). Written as Word
writes it (an exam paper, the kind of file this was made for):

  - a header, and a footer "Trang {PAGE} / {NUMPAGES}" (fields)
  - answer lines at custom left tab stops (A. B. C. D. in four columns), a
    style with its own stops, a paragraph adding one and clearing another
  - a right tab stop with a dotted leader, a centre tab stop
  - a MathType-like equation picture (WMF) whose fonts are asked for the way
    MathType asks: Symbol with DEFAULT_CHARSET (≥, ∈), MT Extra (ℝ, and the
    pieces of two arrows over two letters, in one string)
  - an equation inside a QUOTE field's instruction (Word does not show it)
  - enough text for several pages, and a 40-row table that crosses a page end
  - a page break after a line of text, "page break before", a section break
    that starts a new page and one that does not (continuous)

python-docx makes the package; the body is written as XML.
Usage: python3 scripts/make_word_pages.py
"""
import io
import os
import struct
import zipfile

from docx import Document

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'fixtures', 'word-pages.docx')

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = (
    'xmlns:o="urn:schemas-microsoft-com:office:office" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
    'xmlns:v="urn:schemas-microsoft-com:vml" '
    f'xmlns:w="{W}"'
)
TABS4 = '<w:tabs><w:tab w:val="left" w:pos="283"/><w:tab w:val="left" w:pos="2835"/><w:tab w:val="left" w:pos="5386"/><w:tab w:val="left" w:pos="7937"/></w:tabs>'
HF = '<w:headerReference w:type="default" r:id="rIdH1"/><w:footerReference w:type="default" r:id="rIdF1"/>'
SECT = '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>'


def t(text):
    return f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>'


def tab():
    return '<w:r><w:tab/></w:r>'


def b(text):
    return f'<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>'


def p(inner, ppr=''):
    return f'<w:p><w:pPr>{ppr}</w:pPr>{inner}</w:p>'


def wmf():
    """an equation as MathType draws it: x ≥ 0, x ∈ ℝ, and two vectors a b (one MT Extra string with both arrows)"""
    recs = []

    def rec(fn, payload=b''):
        if len(payload) % 2:
            payload += b'\0'
        recs.append(struct.pack('<IH', 3 + len(payload) // 2, fn) + payload)

    objs = []

    def font(height, italic, charset, face):
        name = face.encode('latin-1')[:31] + b'\0'
        name += b'\0' * (32 - len(name))
        rec(0x02FB, struct.pack('<hhhhhBBBBBBBB', height, 0, 0, 0, 400, italic, 0, 0, charset, 0, 0, 0, 0x12) + name)
        objs.append(face)
        rec(0x012D, struct.pack('<H', len(objs) - 1))

    def text(x, y, s, dx):
        data = bytes(s) if isinstance(s, (bytes, bytearray)) else s.encode('latin-1')
        payload = struct.pack('<hhhH', y, x, len(data), 0) + data + (b'\0' if len(data) % 2 else b'') + struct.pack(f'<{len(dx)}h', *dx)
        rec(0x0A32, payload)

    rec(0x020B, struct.pack('<hh', 0, 0))        # SetWindowOrg
    rec(0x020C, struct.pack('<hh', 700, 3600))   # SetWindowExt (y, x)
    rec(0x0102, struct.pack('<h', 1))            # transparent
    rec(0x012E, struct.pack('<H', 24))           # baseline
    font(-416, 1, 0, 'Times New Roman')
    text(60, 480, 'x', [200])
    font(-416, 0, 1, 'Symbol')                   # DEFAULT_CHARSET, as MathType asks
    text(300, 480, b'\xb3', [300])                # ≥
    font(-416, 0, 0, 'Times New Roman')
    text(640, 480, '0,', [210, 200])
    font(-416, 1, 0, 'Times New Roman')
    text(1100, 480, 'x', [200])
    font(-416, 0, 1, 'Symbol')
    text(1340, 480, b'\xce', [320])               # ∈
    font(-416, 0, 1, 'MT Extra')
    text(1700, 480, b'\xa1', [320])               # ℝ
    font(-416, 1, 0, 'Times New Roman')
    text(2300, 480, 'a', [600])
    text(2900, 480, 'b', [200])
    font(-416, 0, 1, 'MT Extra')
    text(2310, 110, 'rr', [600, 832])             # an arrow over a, one over b
    rec(0x0000)
    body = b''.join(recs)
    size_words = (18 + len(body)) // 2
    max_rec = max(len(r) // 2 for r in recs)
    header = struct.pack('<HHHIHIH', 1, 9, 0x0300, size_words, len(objs), max_rec, 0)
    placeable = struct.pack('<IHhhhhHI', 0x9AC6CDD7, 0, 0, 0, 3600, 700, 1440, 0)
    checksum = 0
    for i in range(0, 20, 2):
        checksum ^= struct.unpack('<H', placeable[i:i + 2])[0]
    return placeable + struct.pack('<H', checksum) + header + body


def body():
    out = []
    out.append(p(b('Đề kiểm tra phân trang'), '<w:pStyle w:val="Heading1"/>'))
    out.append(p(t('Họ và tên:') + tab() + t('Lớp: 10A'), '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs>'))
    out.append(p(tab() + t('Giữa trang') + tab() + t('Phải'), '<w:tabs><w:tab w:val="center" w:pos="4819"/><w:tab w:val="right" w:pos="9638"/></w:tabs>'))
    ole = (
        '<w:r><w:object w:dxaOrig="3600" w:dyaOrig="700">'
        '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>'
        '<v:shape id="_x0000_i1025" type="#_x0000_t75" style="width:180pt;height:35pt" o:ole=""><v:imagedata r:id="rIdW1" o:title=""/></v:shape>'
        '<o:OLEObject Type="Embed" ProgID="Equation.DSMT4" ShapeID="_x0000_i1025" DrawAspect="Content" ObjectID="_1700000001" r:id="rIdO1"/>'
        '</w:object></w:r>'
    )
    out.append(p(t('Công thức MathType: ') + ole))
    # an equation inside a QUOTE field's instruction, the field's result empty: Word shows nothing there
    quote = (
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> QUOTE </w:instrText></w:r>'
        '<m:oMath><m:r><m:t>y=2x</m:t></m:r></m:oMath>'
        '<w:r><w:instrText xml:space="preserve"> </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'
    )
    out.append(p(t('Trước trường') + quote + t(' sau trường.')))
    for k in range(1, 4):
        out.append(p(tab() + b('A.') + t(f' {k}9.') + tab() + b('B.') + t(f' {k}60.') + tab() + b('C.') + t(f' {k}2.') + tab() + b('D.') + t(f' {k}7.'), TABS4 + '<w:spacing w:after="0"/>'))
    # the style's stops (2835, 5386) plus 7937, minus 5386: stops at 2835 and 7937
    out.append(p(t('Kiểu') + tab() + t('một') + tab() + t('hai'), '<w:pStyle w:val="DapAn"/><w:tabs><w:tab w:val="clear" w:pos="5386"/><w:tab w:val="left" w:pos="7937"/></w:tabs>'))
    for k in range(1, 46):
        # paragraph 7 has its own space before (18 pt): it must keep it while the pages are laid out again
        out.append(p(t(f'Đoạn văn số {k}. Một đoạn văn bình thường để lấp đầy trang, đủ dài để xuống dòng một lần khi trang có khổ A4 và lề hai xăng-ti-mét.'), '<w:spacing w:before="360"/>' if k == 7 else ''))
    rows = ''.join(
        f'<w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>{p(t(f"Hàng {k}"))}</w:tc><w:tc><w:tcPr><w:tcW w:w="7000" w:type="dxa"/></w:tcPr>{p(t("Nội dung của hàng"))}</w:tc></w:tr>'
        for k in range(1, 41)
    )
    out.append(
        '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>'
        + ''.join(f'<w:{s} w:val="single" w:sz="4" w:space="0" w:color="000000"/>' for s in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
        + '</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="7000"/></w:tblGrid>'
        + rows
        + '</w:tbl>'
    )
    out.append(p(b('------ HẾT ------') + '<w:r><w:br w:type="page"/></w:r>', '<w:jc w:val="center"/>'))
    out.append(p(b('ĐỀ 02'), '<w:jc w:val="center"/>'))
    out.append(p(t('Câu 1. Câu hỏi đầu tiên của đề hai.')))
    out.append(p(t('Bắt đầu trang mới (ngắt trang trước đoạn).'), '<w:pageBreakBefore/>'))
    out.append(p(t('Cuối section một.'), f'<w:sectPr>{HF}{SECT}</w:sectPr>'))
    out.append(p(t('Section hai bắt đầu trang mới.')))
    out.append(p(t('Cuối section hai.'), f'<w:sectPr>{HF}<w:type w:val="nextPage"/>{SECT}</w:sectPr>'))
    out.append(p(t('Section ba nối tiếp, cùng trang.')))
    return ''.join(out)


HEADER = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr {NS}>' + p(t('Đề kiểm tra · đầu trang'), '<w:jc w:val="center"/>') + '</w:hdr>'
FOOTER = (
    f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr {NS}>'
    + p(
        t('Trang ')
        + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>'
        + t(' / ')
        + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>',
        '<w:jc w:val="center"/>',
    )
    + '</w:ftr>'
)


def build():
    doc = Document()
    doc.add_paragraph('placeholder')
    tmp = io.BytesIO()
    doc.save(tmp)
    zin = zipfile.ZipFile(io.BytesIO(tmp.getvalue()))
    files = {n: zin.read(n) for n in zin.namelist()}
    files['word/media/eq1.wmf'] = wmf()
    files['word/embeddings/oleObject1.bin'] = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + b'\0' * 504
    files['word/header1.xml'] = HEADER.encode()
    files['word/footer1.xml'] = FOOTER.encode()

    styles = files['word/styles.xml'].decode()
    style = (
        '<w:style w:type="paragraph" w:customStyle="1" w:styleId="DapAn"><w:name w:val="DapAn"/><w:basedOn w:val="Normal"/>'
        '<w:pPr><w:tabs><w:tab w:val="left" w:pos="2835"/><w:tab w:val="left" w:pos="5386"/></w:tabs></w:pPr></w:style>'
    )
    files['word/styles.xml'] = styles.replace('</w:styles>', style + '</w:styles>').encode()

    R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    rels = [
        ('rIdW1', f'{R}/image', 'media/eq1.wmf'),
        ('rIdO1', f'{R}/oleObject', 'embeddings/oleObject1.bin'),
        ('rIdH1', f'{R}/header', 'header1.xml'),
        ('rIdF1', f'{R}/footer', 'footer1.xml'),
    ]
    rel_xml = files['word/_rels/document.xml.rels'].decode()
    files['word/_rels/document.xml.rels'] = rel_xml.replace('</Relationships>', ''.join(f'<Relationship Id="{i}" Type="{t_}" Target="{g}"/>' for i, t_, g in rels) + '</Relationships>').encode()
    ct = files['[Content_Types].xml'].decode()
    O = 'application/vnd.openxmlformats-officedocument'
    extra = (
        '<Default Extension="wmf" ContentType="image/x-wmf"/>'
        f'<Default Extension="bin" ContentType="{O}.oleObject"/>'
        f'<Override PartName="/word/header1.xml" ContentType="{O}.wordprocessingml.header+xml"/>'
        f'<Override PartName="/word/footer1.xml" ContentType="{O}.wordprocessingml.footer+xml"/>'
    )
    files['[Content_Types].xml'] = ct.replace('</Types>', extra + '</Types>').encode()

    xml = files['word/document.xml'].decode()
    start = xml.index('<w:body>') + len('<w:body>')
    final = f'<w:sectPr>{HF}<w:type w:val="continuous"/>{SECT}</w:sectPr>'
    xml = xml[:start] + body() + final + '</w:body></w:document>'
    head = xml[: xml.index('<w:body>')]
    if 'xmlns:m=' not in head:
        xml = xml.replace('<w:document ', '<w:document xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" ', 1)
    for pref, uri in (('o', 'urn:schemas-microsoft-com:office:office'), ('v', 'urn:schemas-microsoft-com:vml')):
        if f'xmlns:{pref}=' not in xml[: xml.index('<w:body>')]:
            xml = xml.replace('<w:document ', f'<w:document xmlns:{pref}="{uri}" ', 1)
    files['word/document.xml'] = xml.encode()

    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
    print('wrote', OUT)


if __name__ == '__main__':
    build()
