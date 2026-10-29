#!/usr/bin/env node
/**
 * Builds tests/fixtures/edit-text.pdf: one page per common way PDF writers
 * store text, for the "edit existing text" engine (src/engine/text-edit.ts).
 *
 *  1. Chromium / Skia   CID TrueType subsets, Identity-H, ToUnicode
 *                       (Vietnamese body, bold heading, italic, red, two columns)
 *  2. LibreOffice       simple TrueType subsets with custom encodings
 *  3. ReportLab         standard Helvetica, WinAnsi, not embedded
 *  4. pdfLaTeX          Type 1 subsets, words placed by TJ kerning (no space glyph)
 *  5. ReportLab         DejaVu subset on a page with /Rotate 90
 *  6. ReportLab         lines the tool must refuse, with a reason: hidden text
 *                       over a picture (as an OCR layer) and text inside a
 *                       Form XObject; one ordinary line for contrast
 *  7. Chromium / Skia   a Russian form: bold labels, regular values, a bold
 *                       unit after a number (lines with two fonts; Cyrillic
 *                       the line's own font lacks)
 *
 * Usage: node scripts/make_edit_fixture.cjs [out.pdf]
 * Needs: playwright (Chromium), soffice, python3 with reportlab, pdflatex, qpdf.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'tests', 'fixtures', 'edit-text.pdf'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ezpdf-edit-'));
const p = (n) => path.join(tmp, n);

const html = `<!doctype html><meta charset="utf-8"><style>
@page { size: A4; margin: 0 }
body { margin: 64px 72px; font: 16px/1.6 'Liberation Serif'; color: #000 }
h1 { font: bold 26px/1.3 'Liberation Sans'; margin: 0 0 18px }
p { margin: 0 }
.i { font-style: italic }
.r { color: #c00000 }
.cols { display: flex; justify-content: space-between; margin-top: 18px }
</style>
<h1>Biên bản bàn giao thiết bị</h1>
<p>Hôm nay, ngày 12 tháng 3 năm 2026, tại văn phòng công ty.</p>
<p>Bên giao: Phòng hành chính, đại diện là ông Trần Văn Bình.</p>
<p>Bên nhận: Phòng kỹ thuật, đại diện là bà Lê Thị Hoa.</p>
<p class="i">Ghi chú: thiết bị còn nguyên tem, chưa qua sửa chữa.</p>
<p class="r">Số lượng: 03 máy tính xách tay.</p>
<div class="cols"><span>Người giao</span><span>Người nhận</span></div>
`;

(async () => {
  // 1. Chromium
  fs.writeFileSync(p('chromium.html'), html);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + p('chromium.html'));
  await page.pdf({ path: p('1-chromium.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  await browser.close();

  // 7. Chromium: Russian form
  fs.writeFileSync(
    p('ru.html'),
    `<!doctype html><meta charset="utf-8"><style>
@page { size: A4; margin: 0 } body { margin: 60px 64px; font: 17px/1.9 'Liberation Sans' } b { font-weight: 700 } p { margin: 0 }
</style>
<p><b>Автор:</b> Иванов Иван Иванович -</p>
<p><b>Документ:</b> АБ-2026-001</p>
<p><b>Итого:</b> 1 250 <b>руб.</b></p>
<p>Отчёт подготовлен для внутреннего использования.</p>`,
  );
  {
    const b2 = await chromium.launch();
    const pg = await b2.newPage();
    await pg.goto('file://' + p('ru.html'));
    await pg.pdf({ path: p('7-russian.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
    await b2.close();
  }

  // 2. LibreOffice, from the same HTML minus the page CSS
  fs.writeFileSync(
    p('lo.html'),
    `<!doctype html><meta charset="utf-8"><body style="font-family:'Liberation Sans';font-size:12pt">
<p><b>Thông báo lịch họp</b></p>
<p>Cuộc họp tổng kết quý được tổ chức vào sáng thứ Hai.</p>
<p>Địa điểm: phòng họp tầng 5, tòa nhà A.</p>
<p>Thành phần: toàn thể nhân viên phòng kinh doanh.</p></body>`,
  );
  execFileSync('soffice', ['--headless', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', tmp, p('lo.html')], { stdio: 'ignore' });
  fs.renameSync(p('lo.pdf'), p('2-libreoffice.pdf'));

  // 3. + 5. ReportLab
  fs.writeFileSync(
    p('rl.py'),
    `
import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(TTFont('DejaVu', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
W, H = A4
c = canvas.Canvas(sys.argv[1], pagesize=A4)
c.setFont('Helvetica-Bold', 18); c.drawString(72, H - 90, 'Invoice 2026-031')
c.setFont('Helvetica', 12)
y = H - 130
for line in ['Customer: Northwind Traders', 'Amount due: 1,250.00 USD', 'Payment terms: 30 days']:
    c.drawString(72, y, line); y -= 20
c.showPage()
c.save()
c = canvas.Canvas(sys.argv[2], pagesize=A4)
c.setFont('DejaVu', 14)
c.drawString(72, H - 90, 'Trang xoay: dòng chữ đầu tiên.')
c.drawString(72, H - 120, 'Dòng thứ hai trên trang xoay.')
c.showPage()
c.save()
c = canvas.Canvas(sys.argv[3], pagesize=A4)
c.setFont('DejaVu', 14)
c.drawString(72, H - 90, 'Dòng thường có thể sửa.')
c.setFillGray(0.85); c.rect(66, H - 150, 300, 30, stroke=0, fill=1); c.setFillGray(0)
t = c.beginText(72, H - 140); t.setFont('DejaVu', 14); t.setTextRenderMode(3); t.textLine('Chữ ẩn của lớp nhận dạng.'); c.drawText(t)
c.beginForm('khoi'); c.setFont('DejaVu', 14); c.drawString(72, H - 190, 'Chữ nằm trong khối đồ họa.'); c.endForm()
c.doForm('khoi')
c.showPage()
c.save()
`,
  );
  execFileSync('python3', [p('rl.py'), p('3-reportlab.pdf'), p('5-rotated-src.pdf'), p('6-refused.pdf')]);
  execFileSync('qpdf', [p('5-rotated-src.pdf'), '--rotate=+90', p('5-rotated.pdf')]);

  // 4. pdfLaTeX
  fs.writeFileSync(
    p('tex.tex'),
    String.raw`\documentclass[12pt]{article}
\usepackage[a4paper,margin=2.5cm]{geometry}
\pagestyle{empty}
\begin{document}
\noindent The committee approved the budget for next year.\\
Meetings will be held every second Tuesday.\\
Contact the secretary for further details.
\end{document}
`,
  );
  execFileSync('pdflatex', ['-interaction=nonstopmode', '-output-directory', tmp, p('tex.tex')], { stdio: 'ignore' });
  fs.renameSync(p('tex.pdf'), p('4-pdflatex.pdf'));

  execFileSync('qpdf', [
    '--empty',
    '--pages',
    p('1-chromium.pdf'),
    '1',
    p('2-libreoffice.pdf'),
    '1',
    p('3-reportlab.pdf'),
    p('4-pdflatex.pdf'),
    p('5-rotated.pdf'),
    p('6-refused.pdf'),
    p('7-russian.pdf'),
    '--',
    out,
  ]);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('wrote', out);
})();
