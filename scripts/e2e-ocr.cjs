#!/usr/bin/env node
/**
 * "Nhận dạng chữ (OCR)" in real Chromium, on the dev server (the build that
 * has OCR's files besides the desktop app), with ?ocr in the address:
 *  - the start screen offers it (and does not without ?ocr: the web app has
 *    no OCR yet); the button looks like the two beside it
 *  - pictures picked on the start screen (PNG; a two-page TIFF): read on this
 *    machine, then saved as a Word file (python-docx: the table with its
 *    merged cells, the paragraphs, the picture, the footer) and as a
 *    searchable PDF (pdf.js finds the words; the page has the picture's size)
 *  - the open PDF from the top bar: the result opened on ezPDF's Word screen
 *  - "PDF sửa được chữ" from the open PDF: the page looks as the scan did
 *    (MuPDF), holds one picture (a JPEG) and the words as text in the OCR
 *    word fonts, nothing painted; opened in ezPDF, the edit tool changes one
 *    word (the bar says the other words keep their look); a line dragged with
 *    the mouse ("Kéo chữ") follows as a box and lands where dropped; the
 *    exported file reads with both, the old place of the moved line empty
 *    (MuPDF), still one picture and the words as text
 *  - nothing fetched from outside the app while it works; Dừng stops it; a
 *    file that is not a picture is refused with a message
 *
 * Usage: node scripts/e2e-ocr.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out', 'e2e-ocr');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const FIX = (f) => path.join(ROOT, 'tests/fixtures', f);
const expected = JSON.parse(fs.readFileSync(FIX('ocr/expected.json'), 'utf8'));

const results = [];
let stepName = 'start';
function check(name, ok, detail = '') {
  stepName = name;
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;
const benignRenderRace = (m) => m.type() === 'error' && /ERR_FILE_NOT_FOUND/.test(m.text()) && /^blob:/.test(m.location()?.url ?? '');
/** Tesseract reports, while loading the model, settings of its older engine that the LSTM-only model has not got: not an error */
const benignTesseract = (m) => /^Warning: Parameter not found: /.test(m.text());
const py = (code, ...args) => execFileSync('python3', ['-c', code, ...args], { encoding: 'utf8' }).trim();

async function startServer() {
  const port = 5191;
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  const kill = () => {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {}
  };
  process.on('exit', kill);
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(base)).ok) {
        const b = await chromium.launch();
        const p = await b.newPage();
        await p.goto(base + '/?e2e&ocr');
        await p.waitForSelector(tid('state-empty'), { timeout: 60000 }).catch(() => {});
        await p.waitForTimeout(2000);
        await b.close();
        return { base, stop: kill };
      }
    } catch {}
    await sleep(200);
  }
  kill();
  throw new Error('vite did not start');
}

/** reads a saved Word file with python-docx: tables (rows × columns, merged cells), text, pictures, footer */
function docxFacts(file) {
  return JSON.parse(
    py(
      `
import json, sys, docx
d = docx.Document(sys.argv[1])
body = d.element.body
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
tables = []
for t in d.tables:
    grid = len(t._tbl.tblGrid.findall('w:gridCol', ns))
    spans = [int(x.get('{%s}val' % ns['w'])) for x in t._tbl.iter('{%s}gridSpan' % ns['w'])]
    vm = [x.get('{%s}val' % ns['w']) or 'continue' for x in t._tbl.iter('{%s}vMerge' % ns['w'])]
    borders = len([x for x in t._tbl.iter('{%s}top' % ns['w']) if x.get('{%s}val' % ns['w']) == 'single'])
    text = [c.text for r in t.rows for c in r.cells]
    tables.append({'rows': len(t.rows), 'cols': grid, 'spans': spans, 'vmerge': vm, 'borders': borders, 'text': text})
paras = [p.text for p in d.paragraphs if p.text.strip()]
pics = len(d.inline_shapes)
footer = ' '.join(p.text for s in d.sections for p in s.footer.paragraphs)
sec = d.sections[0]
print(json.dumps({'tables': tables, 'paras': paras, 'pics': pics, 'footer': footer, 'sections': len(d.sections), 'w': sec.page_width.inches, 'h': sec.page_height.inches}, ensure_ascii=False))
`,
      file,
    ),
  );
}

async function pdfText(file) {
  const pdfjs = await import(path.join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), disableFontFace: true }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    const vp = p.getViewport({ scale: 1 });
    pages.push({ text: tc.items.map((it) => it.str).join(' ').normalize('NFC'), w: vp.width, h: vp.height });
  }
  return pages;
}

(async () => {
  const server = await startServer();
  const origin = new URL(server.base).origin;
  // (a UTF-8 locale: Chromium keeps the downloads' Vietnamese names)
  const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  const errors = [];
  const outside = [];
  const track = (p) => {
    p.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')) outside.push(u);
    });
    p.on('pageerror', (e) => errors.push(`${e.message} @${stepName}`));
    p.on('console', (m) => m.type() === 'error' && !benignRenderRace(m) && !benignTesseract(m) && errors.push(`${m.text()} @${stepName}`));
  };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
    const page = await ctx.newPage();
    track(page);

    // ── the start screen ──
    await page.goto(server.base + '/?e2e');
    await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
    check('the web app (no ?ocr) offers no OCR: it has not got the files', (await page.locator(tid('btn-ocr-empty')).count()) === 0);
    await page.goto(server.base + '/?e2e&ocr');
    await page.waitForSelector(tid('btn-ocr-empty'), { timeout: 60000 });
    const looks = await page.evaluate(() => ['btn-open-empty', 'btn-scan-empty', 'btn-ocr-empty'].map((id) => getComputedStyle(document.querySelector(`[data-testid="${id}"]`)).backgroundColor));
    check('the start screen: “Nhận dạng chữ” beside “Chọn tệp” and “Quét tài liệu”, the same colour', looks[0] === looks[1] && looks[1] === looks[2], looks.join(' '));
    await page.screenshot({ path: path.join(OUT, 'start.png') });

    // ── a picture ──
    await page.setInputFiles(tid('ocr-file-input'), FIX('ocr/page.png'));
    await page.waitForSelector(tid('ocr-dialog'));
    await page.waitForFunction(() => document.querySelector('[data-testid="ocr-source"]')?.textContent.includes('1 ảnh'), null, { timeout: 30000 });
    check('the dialog names the picture; Word and PDF both chosen', (await page.textContent(tid('ocr-source'))).includes('page.png') && (await page.isChecked(tid('ocr-word'))) && (await page.isChecked(tid('ocr-pdf'))));
    await page.screenshot({ path: path.join(OUT, 'options.png') });
    const t0 = Date.now();
    await page.click(tid('ocr-go'));
    await page.waitForSelector(tid('ocr-working'), { timeout: 10000 });
    await page.screenshot({ path: path.join(OUT, 'working.png') });
    await page.waitForSelector(tid('ocr-done'), { timeout: 240000 });
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const doneText = await page.textContent(tid('ocr-done-text'));
    check(`read on this machine in ${secs} s: “${doneText.trim()}”`, /1 trang/.test(doneText) && /1 bảng/.test(doneText));
    await page.screenshot({ path: path.join(OUT, 'done.png') });
    let dl = page.waitForEvent('download');
    await page.click(tid('ocr-save-docx'));
    const docxFile = path.join(OUT, 'page (OCR).docx');
    await (await dl).saveAs(docxFile);
    check('“Lưu tệp Word” gives “page (OCR).docx”', (await (await dl).suggestedFilename()) === 'page (OCR).docx');
    const facts = docxFacts(docxFile);
    fs.writeFileSync(path.join(OUT, 'docx.json'), JSON.stringify(facts, null, 1));
    const ruled = facts.tables.find((t) => t.rows === 6);
    check('Word: the table as drawn, 5 columns × 6 rows, a cell across 4 columns, one over 2 rows, lines drawn', !!ruled && ruled.cols === 5 && ruled.spans.includes(4) && ruled.vmerge.includes('restart') && ruled.borders >= 20, ruled ? JSON.stringify({ cols: ruled.cols, spans: ruled.spans, vmerge: ruled.vmerge, borders: ruled.borders }) : JSON.stringify(facts.tables.map((t) => [t.rows, t.cols])));
    check('Word: the cells hold their text (“Tổng chất rắn lơ lửng”, “Kết luận: đạt quy chuẩn”)', !!ruled && ruled.text.includes('Tổng chất rắn lơ lửng') && ruled.text.some((t) => t.startsWith('Kết luận')));
    const heading = facts.tables.find((t) => t.rows === 1 && t.cols === 2);
    check('Word: the two-column heading side by side (a borderless table)', !!heading && heading.text[0].startsWith('CÔNG TY') && heading.text[1].startsWith('CỘNG HÒA') && heading.borders === 0);
    check('Word: the paragraph whole, not cut into lines', facts.paras.some((p) => p.startsWith('Thực hiện kế hoạch') && p.endsWith('hiện hành.')));
    check('Word: the picture, the footer, an A4 page', facts.pics === 1 && facts.footer.includes('Công ty Cổ phần ABC') && Math.abs(facts.w - 8.27) < 0.05 && Math.abs(facts.h - 11.69) < 0.05, `${facts.pics} picture, footer “${facts.footer}”, ${facts.w.toFixed(2)} × ${facts.h.toFixed(2)} in`);
    dl = page.waitForEvent('download');
    await page.click(tid('ocr-save-pdf'));
    const pdfFile = path.join(OUT, 'page (OCR).pdf');
    await (await dl).saveAs(pdfFile);
    const pdfPages = await pdfText(pdfFile);
    check('PDF: one A4 page (the picture at its 200 dpi) whose words pdf.js finds', pdfPages.length === 1 && Math.abs(pdfPages[0].w - 595.4) < 1.5 && pdfPages[0].text.includes('chất rắn lơ lửng') && pdfPages[0].text.includes('QUAN TRẮC'), `${pdfPages[0]?.w.toFixed(1)} × ${pdfPages[0]?.h.toFixed(1)}`);
    await page.click(tid('ocr-finish'));
    await page.waitForSelector(tid('ocr-dialog'), { state: 'detached' });

    // ── a two-page TIFF, PDF only ──
    await page.setInputFiles(tid('ocr-file-input'), FIX('ocr/pages.tif'));
    await page.waitForSelector(tid('ocr-go'));
    await page.uncheck(tid('ocr-word'));
    await page.click(tid('ocr-go'));
    await page.waitForSelector(tid('ocr-done'), { timeout: 240000 });
    check('a two-page TIFF: both pages read', /2 trang/.test(await page.textContent(tid('ocr-done-text'))) && (await page.locator(tid('ocr-save-docx')).count()) === 0);
    dl = page.waitForEvent('download');
    await page.click(tid('ocr-save-pdf'));
    const tifPdf = path.join(OUT, 'pages (OCR).pdf');
    await (await dl).saveAs(tifPdf);
    const tp = await pdfText(tifPdf);
    check('the TIFF as a searchable PDF of 2 pages', tp.length === 2 && tp[1].text.includes('khí thải'), tp.map((p) => p.text.slice(0, 40)).join(' | '));
    await page.click(tid('ocr-finish'));

    // ── not a picture ──
    await page.setInputFiles(tid('ocr-file-input'), FIX('not-an-image.png'));
    await page.waitForSelector(tid('ocr-source-error'), { timeout: 20000 });
    check('a file that is not a picture: refused with a message, nothing to start', (await page.textContent(tid('ocr-source-error'))).includes('không phải ảnh') && (await page.isDisabled(tid('ocr-go'))));
    await page.click(tid('ocr-cancel'));

    // ── the open PDF, from the top bar; stopped once, then read and opened on the Word screen ──
    await page.setInputFiles(tid('file-input'), FIX('ocr/scan.pdf'));
    await page.waitForSelector(tid('btn-ocr'), { timeout: 60000 });
    await page.waitForTimeout(800);
    const bar = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="top-bar"]');
      return { scroll: b.scrollWidth, client: b.clientWidth };
    });
    check('the top bar at 1280 px: the OCR button fits (nothing pushed out)', bar.scroll <= bar.client + 1, JSON.stringify(bar));
    await page.click(tid('btn-ocr'));
    await page.waitForSelector(tid('ocr-dialog'));
    check('from the open PDF: its pages offered (all, the one in view, a list)', (await page.textContent(tid('ocr-dialog'))).includes('Tất cả (1 trang)') && (await page.locator(tid('ocr-pages-current')).count()) === 1);
    await page.click(tid('ocr-go'));
    await page.waitForSelector(tid('ocr-working'));
    await page.click(tid('ocr-stop'));
    await page.waitForSelector(tid('ocr-go'), { timeout: 10000 });
    check('“Dừng” stops it and goes back to the choices, no error', (await page.locator(tid('ocr-error')).count()) === 0);
    await page.uncheck(tid('ocr-pdf'));
    await page.click(tid('ocr-go'));
    await page.waitForSelector(tid('ocr-done'), { timeout: 240000 });
    await page.click(tid('ocr-open-docx'));
    await page.waitForSelector(tid('word-page'), { timeout: 60000 });
    await page.waitForTimeout(1500);
    const shown = await page.evaluate(() => ({ tables: document.querySelectorAll('[data-testid="word-page"] table').length, text: document.querySelector('[data-testid="word-page"]').innerText }));
    await page.screenshot({ path: path.join(OUT, 'word-screen.png') });
    check('“Xem trong ezPDF”: the Word file on the Word screen, its tables there', shown.tables >= 2 && shown.text.includes('Tổng chất rắn lơ lửng'), `${shown.tables} tables`);

    // ── "PDF sửa được chữ" from the open PDF, then a word changed in ezPDF ──
    await page.goto(server.base + '/?e2e&ocr');
    await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
    await page.setInputFiles(tid('file-input'), FIX('ocr/scan.pdf'));
    await page.waitForSelector(tid('btn-ocr'), { timeout: 60000 });
    await page.waitForTimeout(1200);
    // (opened before in this run: the draft banner offers the original)
    if (await page.locator(tid('btn-draft-original')).count()) await page.click(tid('btn-draft-original'));
    await page.click(tid('btn-ocr'));
    await page.waitForSelector(tid('ocr-dialog'));
    check('“PDF sửa được chữ” is offered, not chosen until asked', (await page.locator(tid('ocr-editable')).count()) === 1 && !(await page.isChecked(tid('ocr-editable'))));
    await page.uncheck(tid('ocr-word'));
    await page.uncheck(tid('ocr-pdf'));
    await page.check(tid('ocr-editable'));
    await page.screenshot({ path: path.join(OUT, 'editable-options.png') });
    await page.click(tid('ocr-go'));
    await page.waitForSelector(tid('ocr-done'), { timeout: 240000 });
    const hintE = await page.textContent(tid('ocr-hint-editable'));
    check(`the result: “${hintE.trim()}”`, /\d{2,} từ trên 1 trang/.test(hintE) && (await page.locator(tid('ocr-save-docx')).count()) === 0 && (await page.locator(tid('ocr-save-pdf')).count()) === 0);
    await page.screenshot({ path: path.join(OUT, 'editable-done.png') });
    dl = page.waitForEvent('download');
    await page.click(tid('ocr-save-editable'));
    const edFile = path.join(OUT, 'scan (OCR, sửa được).pdf');
    await (await dl).saveAs(edFile);
    check('“Lưu tệp PDF” gives “scan (OCR, sửa được).pdf”', (await (await dl).suggestedFilename()) === 'scan (OCR, sửa được).pdf', await (await dl).suggestedFilename());
    const edFacts = (file) =>
      JSON.parse(
        py(
          `
import json, sys, fitz, pikepdf, numpy as np
PAINT = {'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'S', 's', 'sh', 'BI'}
pdf = pikepdf.open(sys.argv[1]); page = pdf.pages[0]
images = paint = texts = 0; filters = []
for operands, op in pikepdf.parse_content_stream(page):
    o = str(op)
    if o == 'Do':
        x = page.Resources.XObject[str(operands[0])]
        if x.get('/Subtype') == '/Image': images += 1; filters.append(str(x.get('/Filter')))
        else: paint += 1
    elif o in ('Tj', 'TJ'): texts += 1
    elif o in PAINT: paint += 1
fonts = sorted({(str(f.get('/Subtype')), str(f.get('/BaseFont'))) for _, f in page.Resources.Font.items()})
glyph_paint = sum(1 for _, f in page.Resources.Font.items() if f.get('/Subtype') == '/Type3' for _, c in f.CharProcs.items() for _, op in pikepdf.parse_content_stream(c) if str(op) in PAINT)
def px(path, dpi=200):
    p = fitz.open(path)[0].get_pixmap(dpi=dpi, alpha=False)
    return np.frombuffer(p.samples, np.uint8).reshape(p.height, p.width, p.n)[:, :, :3].astype(np.int16)
a, b = px(sys.argv[2]), px(sys.argv[1])
h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
d = np.abs(a[:h, :w] - b[:h, :w]).max(axis=2)
text = ' '.join(fitz.open(sys.argv[1])[0].get_text().split())
print(json.dumps({'images': images, 'filters': filters, 'paint': paint, 'texts': texts, 'fonts': fonts, 'glyphPaint': glyph_paint, 'mean': float(d.mean()), 'big': float((d > 48).mean()), 'text': text}, ensure_ascii=False))
`,
          file,
          FIX('ocr/scan.pdf'),
        ),
      );
    const ef = edFacts(edFile);
    check(`the editable PDF looks as the scan did (MuPDF, mean ${ef.mean.toFixed(2)}, ${(ef.big * 100).toFixed(2)}% off by > 48)`, ef.mean <= 4 && ef.big <= 0.02);
    check(`it holds one picture (a JPEG) and ${ef.texts} words as text in the OCR word fonts, nothing painted`, ef.images === 1 && ef.filters[0] === '/DCTDecode' && ef.paint === 0 && ef.glyphPaint === 0 && ef.texts > 100 && ef.fonts.every((f) => f[0] === '/Type3' && f[1] === '/ezOCR-Words'), JSON.stringify({ ...ef, text: undefined }));
    check('MuPDF reads its words, spaced', ef.text.includes('Tổng chất rắn lơ lửng') && ef.text.includes('BÁO CÁO KẾT QUẢ QUAN TRẮC'), ef.text.slice(0, 80));
    await page.click(tid('ocr-open-editable'));
    await page.waitForFunction(() => document.querySelector('[data-testid="page-total"]')?.textContent?.includes('/ 1'), null, { timeout: 60000 });
    await page.waitForTimeout(800);
    await page.keyboard.press('e');
    await page.waitForSelector(`${tid('textedit-layer-0')}[data-ready="true"]`, { timeout: 30000 });
    const lineE = `${tid('textedit-layer-0')} [data-testid="textedit-line"][data-text^="tư vấn tiến hành"]`;
    check('the edit tool shows the OCR words as lines', (await page.locator(lineE).count()) === 1);
    await page.click(lineE);
    await page.waitForSelector(tid('textedit-input'));
    const oldLine = await page.inputValue(tid('textedit-input'));
    await page.fill(tid('textedit-input'), oldLine.replace('tư vấn', 'tư ĐỔI'));
    const noteE = await page.textContent(tid('textedit-font'));
    check('the bar says only the changed word is set again, the others keep their look', (await page.getAttribute(tid('textedit-font'), 'data-ocr')) === 'true' && noteE.includes('“vấn”') && noteE.includes('giữ nguyên hình'), noteE.trim());
    await page.screenshot({ path: path.join(OUT, 'editable-edit.png') });
    await page.press(tid('textedit-input'), 'Enter');
    await page.waitForSelector(`${tid('textedit-layer-0')} [data-testid="textedit-line"][data-text^="tư ĐỔI tiến hành"]`, { timeout: 30000 });
    // ── "Kéo chữ": drag a line down to the foot of the page ──
    await page.waitForSelector(`${tid('textedit-layer-0')}[data-ready="true"]`, { timeout: 30000 });
    const kySel = `${tid('textedit-layer-0')} [data-testid="textedit-line"][data-text^="ký. Kết quả"]`;
    await page.locator(kySel).scrollIntoViewIfNeeded();
    const oldBox = JSON.parse(await page.getAttribute(kySel, 'data-box'));
    const kb = await page.locator(kySel).boundingBox();
    const layerBox = await page.locator(tid('textedit-layer-0')).boundingBox();
    const sx = kb.x + kb.width / 2;
    const sy = kb.y + kb.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx, sy + 20, { steps: 4 });
    const dragging = (await page.locator(tid('textedit-drag')).count()) === 1 && (await page.textContent(tid('textedit-drag'))).includes('Thả để dời dòng');
    // down to the page's bottom edge, or the window's (the layer is the page)
    const ty = Math.min(layerBox.y + layerBox.height - kb.height, 860 - 24);
    await page.mouse.move(sx, ty, { steps: 8 });
    await page.screenshot({ path: path.join(OUT, 'editable-drag.png') });
    await page.mouse.up();
    await page.waitForFunction(
      ([sel, top]) => {
        const el = document.querySelector(sel);
        return el && JSON.parse(el.dataset.box).top < top - 100;
      },
      [kySel, oldBox.top],
      { timeout: 30000 },
    );
    const newBox = JSON.parse(await page.getAttribute(kySel, 'data-box'));
    const moveHint = await page.textContent(tid('tool-hint'));
    check(`dragging a line (“ký. Kết quả…”) with the mouse: it follows as a box, dropped it moves (${oldBox.top.toFixed(0)} → ${newBox.top.toFixed(0)} pt), the bar says so`, dragging && newBox.top < oldBox.top - 100 && Math.abs(newBox.left - oldBox.left) < 3 && /Đã dời dòng/.test(moveHint), moveHint.trim());
    await page.screenshot({ path: path.join(OUT, 'editable-dragged.png') });
    await page.keyboard.press('Escape');
    await page.screenshot({ path: path.join(OUT, 'editable-edited.png') });
    dl = page.waitForEvent('download');
    await page.click(tid('btn-export'));
    const exported = path.join(OUT, 'editable-exported.pdf');
    await (await dl).saveAs(exported);
    const xf = edFacts(exported);
    check('exported: reads “tư ĐỔI tiến hành”, still one picture and the words as text, nothing painted', xf.text.includes('tư ĐỔI tiến hành') && !xf.text.includes('tư vấn') && xf.images === 1 && xf.paint === 0 && xf.glyphPaint === 0, xf.text.slice(0, 120));
    const placed = JSON.parse(
      py(
        `
import json, sys, fitz, numpy as np
doc = fitz.open(sys.argv[1]); p = doc[0]; H = p.rect.height
old = json.loads(sys.argv[2]); new = json.loads(sys.argv[3])
words = [w for w in p.get_text('words') if w[4].startswith('ký.')]
pix = p.get_pixmap(dpi=144, alpha=False); a = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3].astype(int)
s = 2
r0, r1, c0, c1 = int((H - old['top']) * s), int((H - old['bottom']) * s), int(old['left'] * s), int(old['right'] * s)
part = a[r0:r1, c0:c1]; lum = 0.299 * part[:, :, 0] + 0.587 * part[:, :, 1] + 0.114 * part[:, :, 2]
print(json.dumps({'wordTop': H - words[0][3] if words else None, 'oldDark': float((lum < 140).mean())}))
`,
        exported,
        JSON.stringify(oldBox),
        JSON.stringify(newBox),
      ),
    );
    check(`exported: the moved line stands where it was dropped, its old place empty (${(placed.oldDark * 100).toFixed(2)}% dark)`, placed.wordTop !== null && Math.abs(placed.wordTop - newBox.bottom) < 6 && placed.oldDark <= 0.01, JSON.stringify(placed));

    check('nothing fetched from outside the app (Tesseract, its model: all from the app)', outside.length === 0, outside.slice(0, 3).join(' '));
    check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    void expected;
    await ctx.close();
  } catch (e) {
    check(`run: ${e.message.split('\n')[0]}`, false, errors.join(' | '));
    for (const p of browser.contexts().flatMap((c) => c.pages())) await p.screenshot({ path: path.join(OUT, 'failed.png') }).catch(() => {});
  } finally {
    await browser.close();
    server.stop();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed ? `${failed} of ${results.length} checks failed` : `${results.length}/${results.length} checks passed`}`);
  process.exit(failed ? 1 : 0);
})();
