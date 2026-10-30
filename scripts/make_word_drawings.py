#!/usr/bin/env python3
"""
word-draw.docx: the parts of a Word file that are drawn rather than typed,
for tests/word-probe.ts and scripts/e2e-word.cjs.

  - a flowchart as a DrawingML group (wpg) of shapes with text and arrow
    connectors, floating and centred, with a VML fallback beside it
  - a single shape (wps) with text, inline
  - a drawing canvas (wpc) with an ellipse, a line and a picture
  - a VML-only drawing (w:pict): a group with a rectangle, an oval, a line
    and a text box
  - Office Math equations: inline (a fraction in a sentence) and an equation
    paragraph (a sum with limits, a square root, a matrix)
  - an equation as an OLE object (Equation.DSMT4, MathType) whose picture is
    a WMF with Times New Roman italic, Symbol (π) and a fraction bar
  - an EMF picture with text, a rectangle and a polyline
  - a column chart (two series, cached values)
  - a SmartArt with its saved drawing (dsp)
  - a footnote and an endnote

python-docx makes the package (styles, theme, settings); the body and the
extra parts are written as XML, so every construct is exactly what Word
writes. Usage: python3 scripts/make_word_drawings.py
"""
import io
import os
import struct
import zipfile

from docx import Document
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tests', 'fixtures', 'word-draw.docx')

NS = (
    'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" '
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:o="urn:schemas-microsoft-com:office:office" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
    'xmlns:v="urn:schemas-microsoft-com:vml" '
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
    'xmlns:w10="urn:schemas-microsoft-com:office:word" '
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
    'xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" '
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" '
    'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" '
    'xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" '
    'mc:Ignorable="w14 wp14"'
)
EMU = 12700  # per pt


def para(inner, ppr=''):
    return f'<w:p>{ppr}{inner}</w:p>'


def run(text, rpr=''):
    return f'<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r>'


# ---- DrawingML -----------------------------------------------------------------

def shape(id_, name, x, y, w, h, prst, text=None, connector=False, line_only=False, arrow=False, fill=None):
    """a wps:wsp in a group (child coordinates in EMU)"""
    nv = '<wps:cNvCnPr/>' if connector else '<wps:cNvSpPr/>'
    geom = f'<a:prstGeom prst="{prst}"><a:avLst/></a:prstGeom>'
    if connector or line_only:
        ln = '<a:ln w="12700"><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill>' + ('<a:tailEnd type="triangle"/>' if arrow else '') + '</a:ln>'
        sppr = f'<wps:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm>{geom}<a:noFill/>{ln}</wps:spPr>'
        style = ''
    else:
        fill_xml = f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>' if fill else ''
        sppr = f'<wps:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm>{geom}{fill_xml}</wps:spPr>'
        style = (
            '<wps:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef>'
            '<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>'
            '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></wps:style>'
        )
    txbx = ''
    body = '<wps:bodyPr/>'
    if text:
        txbx = (
            '<wps:txbx><w:txbxContent>'
            + para(run(text, '<w:rPr><w:color w:val="FFFFFF"/><w:sz w:val="20"/></w:rPr>'), '<w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr>')
            + '</w:txbxContent></wps:txbx>'
        )
        body = '<wps:bodyPr rot="0" vert="horz" wrap="square" lIns="45720" tIns="45720" rIns="45720" bIns="45720" anchor="ctr"/>'
    return f'<wps:wsp><wps:cNvPr id="{id_}" name="{name}"/>{nv}{sppr}{style}{txbx}{body}</wps:wsp>'


def flowchart():
    W, H = 180 * EMU, 250 * EMU
    bw, bh = 110 * EMU, 36 * EMU
    x = (W - bw) // 2
    kids = [
        shape(11, 'Start', x, 0, bw, bh, 'flowChartTerminator', 'Bắt đầu'),
        shape(12, 'Read', x, 70 * EMU, bw, bh, 'flowChartProcess', 'Đọc tệp'),
        shape(13, 'Check', x, 140 * EMU, bw, 48 * EMU, 'flowChartDecision', 'Hợp lệ?'),
        shape(14, 'End', x, 214 * EMU, bw, bh, 'flowChartTerminator', 'Kết thúc'),
        shape(15, 'A1', W // 2, bh, 0, 34 * EMU, 'straightConnector1', connector=True, arrow=True),
        shape(16, 'A2', W // 2, 106 * EMU, 0, 34 * EMU, 'straightConnector1', connector=True, arrow=True),
        shape(17, 'A3', W // 2, 188 * EMU, 0, 26 * EMU, 'straightConnector1', connector=True, arrow=True),
    ]
    group = (
        '<wpg:wgp><wpg:cNvGrpSpPr/><wpg:grpSpPr>'
        f'<a:xfrm><a:off x="0" y="0"/><a:ext cx="{W}" cy="{H}"/><a:chOff x="0" y="0"/><a:chExt cx="{W}" cy="{H}"/></a:xfrm>'
        '</wpg:grpSpPr>' + ''.join(kids) + '</wpg:wgp>'
    )
    anchor = (
        '<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" '
        'behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'
        '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH>'
        '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'
        f'<wp:extent cx="{W}" cy="{H}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapTopAndBottom/>'
        '<wp:docPr id="1" name="Lưu đồ"/><wp:cNvGraphicFramePr/>'
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup">'
        + group + '</a:graphicData></a:graphic></wp:anchor>'
    )
    fallback = (
        '<w:pict><v:group id="g1" style="position:absolute;margin-left:0;margin-top:0;width:180pt;height:250pt;z-index:1" coordsize="1800,2500">'
        '<v:rect style="position:absolute;left:350;top:0;width:1100;height:360" fillcolor="#4472c4"/></v:group></w:pict>'
    )
    return (
        '<w:r><mc:AlternateContent><mc:Choice Requires="wpg"><w:drawing>' + anchor + '</w:drawing></mc:Choice>'
        '<mc:Fallback>' + fallback + '</mc:Fallback></mc:AlternateContent></w:r>'
    )


def inline_shape():
    W, H = 120 * EMU, 40 * EMU
    sp = shape(21, 'Hộp', 0, 0, W, H, 'roundRect', 'Hộp chữ inline', fill='ED7D31').replace('<wps:wsp>', '<wps:wsp>', 1)
    return (
        '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{W}" cy="{H}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="2" name="Hộp"/><wp:cNvGraphicFramePr/>'
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
        + sp + '</a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice>'
        '<mc:Fallback><w:pict><v:roundrect style="width:120pt;height:40pt" arcsize="10923f" fillcolor="#ed7d31"/></w:pict></mc:Fallback></mc:AlternateContent></w:r>'
    )


def canvas(pic_rid):
    W, H = 200 * EMU, 90 * EMU
    oval = shape(31, 'Oval', 10 * EMU, 10 * EMU, 70 * EMU, 70 * EMU, 'ellipse', fill='70AD47')
    line = shape(32, 'Line', 90 * EMU, 45 * EMU, 40 * EMU, 0, 'line', line_only=True, arrow=True)
    pic = (
        '<pic:pic><pic:nvPicPr><pic:cNvPr id="33" name="Ảnh"/><pic:cNvPicPr/></pic:nvPicPr>'
        f'<pic:blipFill><a:blip r:embed="{pic_rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="{140 * EMU}" y="{20 * EMU}"/><a:ext cx="{50 * EMU}" cy="{50 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
    )
    wpc = '<wpc:wpc><wpc:bg><a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill></wpc:bg><wpc:whole/>' + oval + line + pic + '</wpc:wpc>'
    return (
        '<w:r><mc:AlternateContent><mc:Choice Requires="wpc"><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{W}" cy="{H}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="3" name="Canvas"/><wp:cNvGraphicFramePr/>'
        '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas">'
        + wpc + '</a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice>'
        '<mc:Fallback><w:pict><v:rect style="width:200pt;height:90pt"/></w:pict></mc:Fallback></mc:AlternateContent></w:r>'
    )


def vml_group():
    return (
        '<w:r><w:pict><v:group id="vg" style="width:200pt;height:80pt" coordsize="2000,800" coordorigin="0,0">'
        '<v:rect style="position:absolute;left:0;top:0;width:900;height:800" fillcolor="#ffc000" strokecolor="#7f6000" strokeweight="1pt">'
        '<v:textbox inset="4pt,4pt,4pt,4pt"><w:txbxContent>' + para(run('VML hộp chữ')) + '</w:txbxContent></v:textbox></v:rect>'
        '<v:oval style="position:absolute;left:1100;top:100;width:600;height:600" fillcolor="#5b9bd5" stroked="f"/>'
        '<v:line from="900,400" to="1100,400" strokecolor="black" strokeweight="1.5pt"><v:stroke endarrow="block"/></v:line>'
        '</v:group></w:pict></w:r>'
    )


# ---- Office Math ------------------------------------------------------------------

def mr(text, sty=None):
    rpr = f'<m:rPr><m:sty m:val="{sty}"/></m:rPr>' if sty else ''
    return f'<m:r>{rpr}<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t>{text}</m:t></m:r>'


def inline_math():
    return '<m:oMath><m:f><m:num>' + mr('a+b') + '</m:num><m:den>' + mr('2') + '</m:den></m:f></m:oMath>'


def display_math():
    total = (
        '<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/></m:naryPr>'
        '<m:sub>' + mr('i=1') + '</m:sub><m:sup>' + mr('n') + '</m:sup>'
        '<m:e><m:sSup><m:e><m:sSub><m:e>' + mr('x') + '</m:e><m:sub>' + mr('i') + '</m:sub></m:sSub></m:e><m:sup>' + mr('2') + '</m:sup></m:sSup></m:e></m:nary>'
    )
    root = '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>' + mr('y') + '</m:e></m:rad>'
    matrix = (
        '<m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:m>'
        '<m:mr><m:e>' + mr('1') + '</m:e><m:e>' + mr('0') + '</m:e></m:mr>'
        '<m:mr><m:e>' + mr('0') + '</m:e><m:e>' + mr('1') + '</m:e></m:mr>'
        '</m:m></m:e></m:d>'
    )
    return '<m:oMathPara><m:oMath>' + total + mr('=') + root + mr('+') + matrix + '</m:oMath></m:oMathPara>'


# ---- Windows metafiles -------------------------------------------------------------

def wmf_equation():
    """a MathType-like WMF: x over π, then = 1; 1440 units per inch, 60 × 30 pt"""
    recs = []

    def rec(fn, payload=b''):
        if len(payload) % 2:
            payload += b'\0'
        recs.append(struct.pack('<IH', 3 + len(payload) // 2, fn) + payload)

    def font(height, italic, charset, face, family=0x12):
        name = face.encode('latin-1')[:31] + b'\0'
        name += b'\0' * (32 - len(name))
        rec(0x02FB, struct.pack('<hhhhhBBBBBBBB', height, 0, 0, 0, 400, italic, 0, 0, charset, 0, 0, 0, family) + name)

    rec(0x020B, struct.pack('<hh', 0, 0))        # SetWindowOrg
    rec(0x020C, struct.pack('<hh', 600, 1200))   # SetWindowExt (y, x)
    rec(0x0102, struct.pack('<h', 1))            # SetBkMode transparent
    rec(0x012E, struct.pack('<H', 24))           # SetTextAlign baseline
    rec(0x0209, struct.pack('<BBBB', 0, 0, 0, 0))
    font(-280, 1, 0, 'Times New Roman')          # object 0
    rec(0x012D, struct.pack('<H', 0))
    rec(0x0521, struct.pack('<h', 1) + b'x\0' + struct.pack('<hh', 250, 140))  # TextOut 'x' (y=250, x=140)
    font(-280, 0, 2, 'Symbol')                   # object 1
    rec(0x012D, struct.pack('<H', 1))
    # ExtTextOut 'p' (π) with its advance
    rec(0x0A32, struct.pack('<hhhH', 540, 130, 1, 0) + b'p\0' + struct.pack('<h', 150))
    rec(0x02FA, struct.pack('<HhhBBBB', 0, 16, 0, 0, 0, 0, 0))  # CreatePenIndirect solid 16 units, object 2
    rec(0x012D, struct.pack('<H', 2))
    rec(0x0214, struct.pack('<hh', 330, 80))     # MoveTo (y, x)
    rec(0x0213, struct.pack('<hh', 330, 340))    # LineTo
    font(-280, 0, 0, 'Times New Roman')          # object 3
    rec(0x012D, struct.pack('<H', 3))
    rec(0x0A32, struct.pack('<hhhH', 400, 470, 3, 0) + b'= 1\0' + struct.pack('<hhh', 200, 90, 160))
    rec(0x0000)
    body = b''.join(recs)
    size_words = (18 + len(body)) // 2
    max_rec = max(len(r) // 2 for r in recs)
    header = struct.pack('<HHHIHIH', 1, 9, 0x0300, size_words, 4, max_rec, 0)
    placeable = struct.pack('<IHhhhhHI', 0x9AC6CDD7, 0, 0, 0, 1200, 600, 1440, 0)
    checksum = 0
    for i in range(0, 20, 2):
        checksum ^= struct.unpack('<H', placeable[i:i + 2])[0]
    return placeable + struct.pack('<H', checksum) + header + body


def emf_picture():
    recs = []

    def rec(t, payload):
        while len(payload) % 4:
            payload += b'\0'
        recs.append(struct.pack('<II', t, 8 + len(payload)) + payload)

    face = 'Arial'.encode('utf-16-le')
    face += b'\0' * (64 - len(face))
    logfont = struct.pack('<iiiiiBBBBBBBB', -22, 0, 0, 0, 700, 0, 0, 0, 0, 0, 0, 0, 0x22) + face
    rec(39, struct.pack('<IIII', 3, 0, 0xE1F2FF, 0))                 # CreateBrushIndirect solid #FFF2E1 (BGR order in COLORREF: r,g,b bytes)
    rec(37, struct.pack('<I', 3))
    rec(38, struct.pack('<IIiiI', 2, 0, 2, 0, 0x00C00000 >> 16 | 0))  # CreatePen width 2, red
    rec(37, struct.pack('<I', 2))
    rec(43, struct.pack('<iiii', 10, 10, 190, 90))                   # Rectangle
    rec(87, struct.pack('<iiiiI', 20, 70, 180, 85, 3) + struct.pack('<hhhhhh', 20, 85, 100, 70, 180, 85))  # Polyline16
    rec(82, struct.pack('<I', 1) + logfont)                          # ExtCreateFontIndirectW
    rec(37, struct.pack('<I', 1))
    rec(24, struct.pack('<BBBB', 0x0b, 0x6e, 0x69, 0))               # SetTextColor
    rec(22, struct.pack('<I', 24))                                    # SetTextAlign baseline
    text = 'EMF chữ'
    s = text.encode('utf-16-le')
    n = len(text)
    off_string = 8 + 16 + 4 + 4 + 4 + 8 + 4 + 4 + 4 + 16 + 4  # = 76
    off_dx = off_string + len(s) + (len(s) % 4 and 4 - len(s) % 4)
    dx = struct.pack(f'<{n}i', *([13] * n))
    payload = struct.pack('<iiii', 0, 0, 200, 100) + struct.pack('<Iff', 1, 1.0, 1.0)
    payload += struct.pack('<iiIIIiiiiI', 30, 55, n, off_string, 0, 0, 0, 200, 100, off_dx)
    payload += s + b'\0' * ((4 - len(s) % 4) % 4) + dx
    rec(84, payload)
    rec(14, struct.pack('<III', 0, 0, 20))
    body = b''.join(recs)
    hdr_size = 108
    total = hdr_size + len(body)
    header = struct.pack('<II', 1, hdr_size)
    header += struct.pack('<iiii', 0, 0, 199, 99)          # bounds (device px)
    header += struct.pack('<iiii', 0, 0, 5292, 2646)       # frame (0.01 mm)
    header += struct.pack('<IIIIHHIII', 0x464D4520, 0x10000, total, len(recs) + 1, 4, 0, 0, 0, 0)
    header += struct.pack('<ii', 1920, 1080) + struct.pack('<ii', 508, 286)
    header += struct.pack('<III', 0, 0, 0) + struct.pack('<ii', 508000, 286000)
    assert len(header) == hdr_size, len(header)
    return header + body


# ---- chart, SmartArt, notes -----------------------------------------------------------

CHART = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>Doanh thu theo quý</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>
<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>
{series}
<c:gapWidth val="150"/><c:axId val="1"/><c:axId val="2"/></c:barChart>
<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="1"/></c:valAx>
</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>'''


def chart_xml():
    cats = ['Quý 1', 'Quý 2', 'Quý 3']
    series = []
    for i, (name, vals) in enumerate([('2025', [4.3, 2.5, 3.5]), ('2026', [2.4, 4.4, 1.8])]):
        cat = ''.join(f'<c:pt idx="{k}"><c:v>{c}</c:v></c:pt>' for k, c in enumerate(cats))
        val = ''.join(f'<c:pt idx="{k}"><c:v>{v}</c:v></c:pt>' for k, v in enumerate(vals))
        series.append(
            f'<c:ser><c:idx val="{i}"/><c:order val="{i}"/><c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>{name}</c:v></c:pt></c:strCache></c:strRef></c:tx>'
            f'<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$4</c:f><c:strCache><c:ptCount val="3"/>{cat}</c:strCache></c:strRef></c:cat>'
            f'<c:val><c:numRef><c:f>Sheet1!$B$2:$B$4</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="3"/>{val}</c:numCache></c:numRef></c:val></c:ser>'
        )
    return CHART.replace('{series}', ''.join(series))


def smartart_data(drawing_rid):
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<dgm:ptLst><dgm:pt modelId="{0}" type="doc"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:endParaRPr/></a:p></dgm:t></dgm:pt>'
        '<dgm:pt modelId="{1}"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:r><a:t>Ý tưởng</a:t></a:r></a:p></dgm:t></dgm:pt>'
        '<dgm:pt modelId="{2}"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:r><a:t>Thực hiện</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst>'
        '<dgm:cxnLst/><dgm:bg/><dgm:whole/>'
        '<dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram">'
        f'<dsp:dataModelExt xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" relId="{drawing_rid}" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/>'
        '</a:ext></dgm:extLst></dgm:dataModel>'
    )


def smartart_drawing():
    def sp(i, x, text):
        return (
            f'<dsp:sp modelId="{{{i}}}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr>'
            f'<dsp:spPr><a:xfrm><a:off x="{x}" y="0"/><a:ext cx="{90 * EMU}" cy="{50 * EMU}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>'
            '<a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></dsp:spPr>'
            '<dsp:style><a:lnRef idx="2"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef>'
            '<a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dsp:style>'
            '<dsp:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>'
            f'<a:r><a:rPr lang="vi-VN" sz="1400"/><a:t>{text}</a:t></a:r></a:p></dsp:txBody></dsp:sp>'
        )

    arrow = (
        '<dsp:sp modelId="{9}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr>'
        f'<dsp:spPr><a:xfrm><a:off x="{100 * EMU}" y="{15 * EMU}"/><a:ext cx="{30 * EMU}" cy="{20 * EMU}"/></a:xfrm>'
        '<a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent2"><a:tint val="60000"/></a:schemeClr></a:solidFill></dsp:spPr></dsp:sp>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<dsp:drawing xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:dsp="http://schemas.microsoft.com/office/drawing/2008/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        '<dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>'
        + sp(1, 0, 'Ý tưởng') + arrow + sp(2, 140 * EMU, 'Thực hiện') + '</dsp:spTree></dsp:drawing>'
    )


NOTES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:{kind}s xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:{kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:{kind}>
<w:{kind} w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:{kind}>
<w:{kind} w:id="1"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:{kind}Ref/></w:r><w:r><w:t xml:space="preserve"> {text}</w:t></w:r></w:p></w:{kind}>
</w:{kind}s>'''


def build():
    doc = Document()
    doc.add_paragraph('placeholder')
    tmp = io.BytesIO()
    doc.save(tmp)
    zin = zipfile.ZipFile(io.BytesIO(tmp.getvalue()))
    files = {n: zin.read(n) for n in zin.namelist()}

    png = io.BytesIO()
    Image.new('RGB', (50, 50), (11, 110, 105)).save(png, 'PNG')
    files['word/media/canvas.png'] = png.getvalue()
    files['word/media/eq1.wmf'] = wmf_equation()
    files['word/media/pic1.emf'] = emf_picture()
    files['word/embeddings/oleObject1.bin'] = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + b'\0' * 504
    files['word/charts/chart1.xml'] = chart_xml().encode()
    files['word/diagrams/data1.xml'] = smartart_data('rIdD5').encode()
    files['word/diagrams/drawing1.xml'] = smartart_drawing().encode()
    lo = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><dgm:layoutDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" uniqueId="urn:microsoft.com/office/officeart/2005/8/layout/process1"><dgm:layoutNode name="Name0"/></dgm:layoutDef>'
    qs = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><dgm:styleDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" uniqueId="urn:microsoft.com/office/officeart/2005/8/quickstyle/simple1"/>'
    cs = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><dgm:colorsDef xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" uniqueId="urn:microsoft.com/office/officeart/2005/8/colors/accent1_2"/>'
    files['word/diagrams/layout1.xml'] = lo.encode()
    files['word/diagrams/quickStyle1.xml'] = qs.encode()
    files['word/diagrams/colors1.xml'] = cs.encode()
    files['word/footnotes.xml'] = NOTES.format(kind='footnote', text='Chú thích cuối trang về lưu đồ.').encode()
    files['word/endnotes.xml'] = NOTES.format(kind='endnote', text='Chú thích cuối tài liệu.').encode()

    R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    rels = [
        ('rIdP1', f'{R}/image', 'media/canvas.png'),
        ('rIdW1', f'{R}/image', 'media/eq1.wmf'),
        ('rIdE1', f'{R}/image', 'media/pic1.emf'),
        ('rIdO1', f'{R}/oleObject', 'embeddings/oleObject1.bin'),
        ('rIdC1', f'{R}/chart', 'charts/chart1.xml'),
        ('rIdD1', f'{R}/diagramData', 'diagrams/data1.xml'),
        ('rIdD2', f'{R}/diagramLayout', 'diagrams/layout1.xml'),
        ('rIdD3', f'{R}/diagramQuickStyle', 'diagrams/quickStyle1.xml'),
        ('rIdD4', f'{R}/diagramColors', 'diagrams/colors1.xml'),
        ('rIdD5', 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing', 'diagrams/drawing1.xml'),
        ('rIdF1', f'{R}/footnotes', 'footnotes.xml'),
        ('rIdF2', f'{R}/endnotes', 'endnotes.xml'),
    ]
    rel_xml = files['word/_rels/document.xml.rels'].decode()
    add = ''.join(f'<Relationship Id="{i}" Type="{t}" Target="{g}"/>' for i, t, g in rels)
    files['word/_rels/document.xml.rels'] = rel_xml.replace('</Relationships>', add + '</Relationships>').encode()

    ct = files['[Content_Types].xml'].decode()
    O = 'application/vnd.openxmlformats-officedocument'
    extra = (
        '<Default Extension="wmf" ContentType="image/x-wmf"/><Default Extension="emf" ContentType="image/x-emf"/>'
        f'<Default Extension="bin" ContentType="{O}.oleObject"/>'
        f'<Override PartName="/word/charts/chart1.xml" ContentType="{O}.drawingml.chart+xml"/>'
        f'<Override PartName="/word/diagrams/data1.xml" ContentType="{O}.drawingml.diagramData+xml"/>'
        f'<Override PartName="/word/diagrams/layout1.xml" ContentType="{O}.drawingml.diagramLayout+xml"/>'
        f'<Override PartName="/word/diagrams/quickStyle1.xml" ContentType="{O}.drawingml.diagramStyle+xml"/>'
        f'<Override PartName="/word/diagrams/colors1.xml" ContentType="{O}.drawingml.diagramColors+xml"/>'
        '<Override PartName="/word/diagrams/drawing1.xml" ContentType="application/vnd.ms-office.drawingml.diagramDrawing+xml"/>'
        f'<Override PartName="/word/footnotes.xml" ContentType="{O}.wordprocessingml.footnotes+xml"/>'
        f'<Override PartName="/word/endnotes.xml" ContentType="{O}.wordprocessingml.endnotes+xml"/>'
    )
    if 'Extension="png"' not in ct:
        extra = '<Default Extension="png" ContentType="image/png"/>' + extra
    files['[Content_Types].xml'] = ct.replace('</Types>', extra + '</Types>').encode()

    ole = (
        '<w:r><w:object w:dxaOrig="1200" w:dyaOrig="600">'
        '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>'
        '<v:shape id="_x0000_i1025" type="#_x0000_t75" style="width:60pt;height:30pt" o:ole=""><v:imagedata r:id="rIdW1" o:title=""/></v:shape>'
        '<o:OLEObject Type="Embed" ProgID="Equation.DSMT4" ShapeID="_x0000_i1025" DrawAspect="Content" ObjectID="_1700000001" r:id="rIdO1"/>'
        '</w:object></w:r>'
    )
    emf = (
        '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{150 * EMU}" cy="{75 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="5" name="EMF"/><wp:cNvGraphicFramePr/>'
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="pic1.emf"/><pic:cNvPicPr/></pic:nvPicPr>'
        '<pic:blipFill><a:blip r:embed="rIdE1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{150 * EMU}" cy="{75 * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
        '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    )
    chart = (
        '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{300 * EMU}" cy="{180 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="6" name="Biểu đồ 1"/><wp:cNvGraphicFramePr/>'
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rIdC1"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    )
    smart = (
        '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{230 * EMU}" cy="{50 * EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="7" name="SmartArt 1"/><wp:cNvGraphicFramePr/>'
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram">'
        '<dgm:relIds r:dm="rIdD1" r:lo="rIdD2" r:qs="rIdD3" r:cs="rIdD4"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
    )
    note_ref = '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r>'
    end_ref = '<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:endnoteReference w:id="1"/></w:r>'

    body = ''.join([
        para(run('Hình vẽ trong Word'), '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'),
        para(run('Lưu đồ dưới đây là một nhóm hình') + note_ref + run('.')),
        para(flowchart()),
        para(run('Hình inline: ') + inline_shape() + run(' ở giữa câu.')),
        para(canvas('rIdP1')),
        para(vml_group()),
        para(run('Công thức ') + inline_math() + run(' là trung bình cộng.') + end_ref),
        para(display_math()),
        para(run('MathType: ') + ole + run(' (OLE).')),
        para(emf),
        para(chart),
        para(smart),
        para(run('Hết.')),
    ])
    sect = files['word/document.xml'].decode()
    sect_pr = sect[sect.index('<w:sectPr'):sect.index('</w:body>')]
    files['word/document.xml'] = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document {NS}><w:body>{body}{sect_pr}</w:body></w:document>'
    ).encode()

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        order = ['[Content_Types].xml'] + [n for n in files if n != '[Content_Types].xml']
        for n in order:
            z.writestr(n, files[n])
    print('wrote', OUT)


if __name__ == '__main__':
    build()
