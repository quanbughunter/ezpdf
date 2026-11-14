#!/usr/bin/env python3
"""
Builds tests/fixtures/highlight.pdf: highlights as the common PDF writers
save them, for "Bỏ tô sáng" (src/engine/marks.ts, text-edit.ts removeMarks).

 1. Chromium / Skia (the renderer Google Docs exports with): a programme
    table like a meeting script. Dark header with white words, a bold passage
    highlighted over three lines in a narrow cell, a grey cell, a green phrase
    in the middle of a line, the same word highlighted in two cells one above
    the other, a highlighted passage in a paragraph and, one line further
    down, a separate highlighted word.
 2. LibreOffice (from a .docx with highlight and shading): a passage over
    three lines, a highlighted cell text, a grey cell, a shaded run.
 3. Drawn directly (PyMuPDF): a highlight annotation, an opaque black box
    over a word, a see-through yellow band over a line (a flattened
    highlight), white words on a dark band, a tinted box behind three lines,
    a thin underline bar.

Usage: python3 scripts/make_highlight_fixture.py [out.pdf]
Needs: playwright (Python, Chromium), python-docx, soffice, PyMuPDF.
"""
import os
import subprocess
import sys
import tempfile

import pymupdf
from docx import Document
from docx.enum.text import WD_COLOR_INDEX
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tests', 'fixtures', 'highlight.pdf'))
tmp = tempfile.mkdtemp(prefix='ezpdf-hl-')

HTML = """<!doctype html><meta charset="utf-8"><style>
@page { size: A4; margin: 0 }
body { margin: 56px 60px; font: 15px/1.35 'Liberation Serif'; color: #000 }
table { border-collapse: collapse; width: 100% }
th, td { border: 1px solid #000; vertical-align: top; padding: 4px 6px; text-align: left }
th { background: #1f3864; color: #fff }
.y { background: #ffff00 }
.g { background: #00ff00 }
.grey { background: #d9d9d9 }
p { margin: 14px 0 0 }
</style>
<table>
<tr><th style="width:28px">TT</th><th style="width:130px">Nội dung</th><th>Chi tiết</th><th style="width:110px">Thực hiện</th></tr>
<tr><td>6</td><td><b class="y">Báo cáo số lượng đoàn viên có mặt tại Đại hội</b><br><i>(13h22 – 13h25)</i></td>
<td><b>Đ/c Nguyễn Thị Hường:</b> Kính thưa Đại hội!</td><td>Đoàn Chủ tịch</td></tr>
<tr><td class="grey">7</td><td class="grey">Ô có nền xám</td><td>Văn bản thường có <span class="g">một cụm tô xanh</span> ở giữa.</td><td><span class="y">Thư ký</span></td></tr>
<tr><td>8</td><td>Bầu Ban chấp hành</td><td>Biểu quyết bằng giơ tay.</td><td><span class="y">Thư ký</span></td></tr>
</table>
<p>Đoạn văn này có một phần <span class="y">được tô vàng kéo dài qua nhiều dòng để kiểm tra xem các dải màu của từng dòng có được nhận ra là một đoạn liền nhau</span> rồi trở lại chữ thường như bình thường, viết thêm cho đủ một dòng nữa.</p>
<p>Dòng này không tô gì cả.</p>
<p>Còn đây là một từ <span class="y">riêng</span> được tô.</p>
"""


def chromium_page(path):
    html = os.path.join(tmp, 'p1.html')
    with open(html, 'w', encoding='utf-8') as f:
        f.write(HTML)
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.goto('file://' + html)
        pg.pdf(path=path, format='A4', print_background=True, prefer_css_page_size=True)
        b.close()


def shade(el, fill):
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:fill'), fill)
    el.append(shd)


def libreoffice_page(path):
    d = Document()
    st = d.styles['Normal']
    st.font.name = 'Liberation Serif'
    st.font.size = Pt(12)
    p = d.add_paragraph('A plain start, then ')
    r = p.add_run('a highlighted passage that runs over several lines so that the word processor has to paint one band for every line it covers on the page')
    r.font.highlight_color = WD_COLOR_INDEX.YELLOW
    p.add_run(' and then plain text again.')
    t = d.add_table(rows=1, cols=2)
    t.style = 'Table Grid'
    c = t.cell(0, 0)
    c.paragraphs[0].add_run('Green cell text').font.highlight_color = WD_COLOR_INDEX.BRIGHT_GREEN
    t.cell(0, 1).paragraphs[0].add_run('Grey cell')
    shade(t.cell(0, 1)._tc.get_or_add_tcPr(), 'D9D9D9')
    p = d.add_paragraph()
    r = p.add_run('Shaded run')
    shade(r._r.get_or_add_rPr(), 'FFC000')
    p.add_run(' after it.')
    src = os.path.join(tmp, 'p2.docx')
    d.save(src)
    subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', tmp, src], check=True, capture_output=True)
    os.replace(os.path.join(tmp, 'p2.pdf'), path)


def drawn_page(doc):
    pg = doc.new_page(width=595, height=842)
    fs = 13

    def text(y, s, color=(0, 0, 0)):
        pg.insert_text((72, y), s, fontname='helv', fontsize=fs, color=color)
        return pymupdf.get_text_length(s, fontname='helv', fontsize=fs)

    def word_box(y, line, word):
        x0 = 72 + pymupdf.get_text_length(line[: line.index(word)], fontname='helv', fontsize=fs)
        x1 = x0 + pymupdf.get_text_length(word, fontname='helv', fontsize=fs)
        return pymupdf.Rect(x0, y - fs * 0.9, x1, y + fs * 0.25)

    a = 'Annotated line with a highlight annotation.'
    text(100, a)
    pg.add_highlight_annot(word_box(100, a, 'highlight annotation'))

    b = 'This word is covered by a black box.'
    text(140, b)
    pg.draw_rect(word_box(140, b, 'covered'), color=None, fill=(0, 0, 0), overlay=True)

    c = 'A flattened highlight drawn over the text.'
    w = text(180, c)
    pg.draw_rect(pymupdf.Rect(70, 180 - fs * 0.95, 74 + w, 180 + fs * 0.3), color=None, fill=(1, 1, 0), fill_opacity=0.35, overlay=True)

    d = 'White on dark'
    pg.draw_rect(pymupdf.Rect(68, 220 - fs * 1.0, 76 + pymupdf.get_text_length(d, fontname='helv', fontsize=fs), 220 + fs * 0.35), color=None, fill=(0.12, 0.22, 0.39))
    text(220, d, color=(1, 1, 1))

    pg.draw_rect(pymupdf.Rect(64, 262 - fs * 1.1, 400, 298 + fs * 0.5), color=None, fill=(0.85, 0.93, 1))
    text(262, 'A callout box behind three lines,')
    text(280, 'tinted light blue, which is a box')
    text(298, 'and not a highlight.')

    f = 'Underlined by a thin bar.'
    text(340, f)
    u = word_box(340, f, 'thin bar')
    pg.draw_rect(pymupdf.Rect(u.x0, 342, u.x1, 343), color=None, fill=(0, 0, 0))


chromium_page(os.path.join(tmp, '1.pdf'))
libreoffice_page(os.path.join(tmp, '2.pdf'))
doc = pymupdf.open()
for n in ('1.pdf', '2.pdf'):
    doc.insert_pdf(pymupdf.open(os.path.join(tmp, n)), from_page=0, to_page=0)
drawn_page(doc)
doc.save(OUT, garbage=3, deflate=True)
print(OUT, doc.page_count, 'pages')
