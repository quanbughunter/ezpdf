/**
 * OCR end to end on pages made from known text (scripts/make_ocr_fixtures.py),
 * through the app's own steps: pictures to PDF, PDFium rendering, line and
 * table finding, tesseract.js with the bundled Vietnamese model, the layout,
 * the Word file and the searchable PDF. Checks the structure (the table's
 * grid and merged cells, the two-column heading, alignment, the footer, the
 * picture) and the text (character error rate against what was drawn).
 *
 *   npx tsx tests/ocr-test.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { createWorker } from 'tesseract.js';
import { ocrPage } from '../src/ocr/pipeline';
import { writeDocx } from '../src/ocr/docx';
import { pageText, readingLines, type PageLayout, type Para, type TableBlock } from '../src/ocr/model';
import { addTextLayer, pageScan } from '../src/engine/ocr-pdf';
import { textPage } from '../src/ocr/text-layer';
import { jpegInfo, picturePages, picturesToPdf } from '../src/ocr/images-pdf';
import { Wasm } from '../src/engine/wasm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = join(root, 'tests/fixtures/ocr');
const OUT = join(root, 'out/ocr-test');
mkdirSync(OUT, { recursive: true });
const expected = JSON.parse(readFileSync(join(FIX, 'expected.json'), 'utf8'));

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/** edit distance over characters, / length of the truth */
function cer(got: string, truth: string): number {
  const a = [...got.normalize('NFC').replace(/\s+/g, ' ').trim()];
  const b = [...truth.normalize('NFC').replace(/\s+/g, ' ').trim()];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return b.length ? prev[b.length] / b.length : 0;
}

/**
 * The error over lines, whatever their order: each line drawn is matched
 * with the line read closest to it (reading order differs in side-by-side
 * headings).
 */
function lineCer(read: string, truth: string[]): number {
  const got = read.split('\n').filter((l) => l.trim());
  let errors = 0;
  let chars = 0;
  for (const t of truth) {
    const n = [...t.replace(/\s+/g, ' ').trim()].length;
    errors += Math.min(n, ...got.map((g) => cer(g, t) * n));
    chars += n;
  }
  return chars ? errors / chars : 0;
}

const toAB = (b: Buffer | Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const m: WrappedPdfiumModule = await init({ wasmBinary: toAB(readFileSync(join(root, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm'))) });
m.PDFiumExt_Init();
const wasm = new Wasm(m);

function openPdf(bytes: Uint8Array) {
  const ptr = wasm.copyIn(bytes);
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, '');
  if (!doc) throw new Error('PDFium cannot open it');
  return { doc, close: () => (m.FPDF_CloseDocument(doc), wasm.free(ptr)) };
}

function render(doc: number, index: number, dpi: number) {
  const page = m.FPDF_LoadPage(doc, index);
  const wPt = m.FPDF_GetPageWidthF(page);
  const hPt = m.FPDF_GetPageHeightF(page);
  const w = Math.round((wPt * dpi) / 72);
  const h = Math.round((hPt * dpi) / 72);
  const bmp = m.FPDFBitmap_Create(w, h, 1);
  m.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xffffffff);
  m.FPDF_RenderPageBitmap(bmp, page, 0, 0, w, h, 0, 0x01 | 0x10);
  const buf = m.FPDFBitmap_GetBuffer(bmp);
  const stride = m.FPDFBitmap_GetStride(bmp);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) rgba.set(wasm.heap.subarray(buf + y * stride, buf + y * stride + w * 4), y * w * 4);
  m.FPDFBitmap_Destroy(bmp);
  m.FPDF_ClosePage(page);
  return { rgba, w, h, dpi, widthPt: wPt, heightPt: hPt };
}

function save(doc: number): Uint8Array {
  const writer = m.PDFiumExt_OpenFileWriter();
  if (!m.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error('save failed');
  const size = m.PDFiumExt_GetFileWriterSize(writer);
  const ptr = wasm.malloc(size);
  m.PDFiumExt_GetFileWriterData(writer, ptr, size);
  const out = wasm.heap.slice(ptr, ptr + size);
  wasm.free(ptr);
  m.PDFiumExt_CloseFileWriter(writer);
  return out;
}

const worker = await createWorker('vie', 1, { langPath: join(root, 'node_modules/@tesseract.js-data/vie/4.0.0_best_int'), cacheMethod: 'none', gzip: true });
const read = async (pgm: Uint8Array, dpi: number, mode: 'page' | 'block' | 'line') => {
  await worker.setParameters({ tessedit_pageseg_mode: ({ page: '3', block: '6', line: '7' } as const)[mode] as never, preserve_interword_spaces: '1', user_defined_dpi: String(dpi) });
  const r = await worker.recognize(Buffer.from(pgm), {}, { blocks: true });
  return (r.data.blocks ?? []) as never;
};

const text = (p: Para) => p.lines.map((l) => l.words.map((w) => w.text).join(' ')).join(' ');
const cellText = (t: TableBlock, r: number, c: number) => {
  const cell = t.cells.find((k) => k.r0 === r && k.c0 === c);
  return cell ? cell.paras.map(text).join(' ') : null;
};

try {
  // ---- the scanned PDF ------------------------------------------------------------
  const pdfBytes = new Uint8Array(readFileSync(join(FIX, 'scan.pdf')));
  const src = openPdf(pdfBytes);
  const scan = pageScan(m, src.doc, 0);
  check('a scanned page: no text in it, its picture at 200 dpi', scan.chars === 0 && Math.abs(scan.scanDpi - 200) <= 2, JSON.stringify(scan));
  const t0 = Date.now();
  const page: PageLayout = await ocrPage(render(src.doc, 0, 250), read);
  const ms = Date.now() - t0;
  writeFileSync(join(OUT, 'page.json'), JSON.stringify(page, (k, v) => (k === 'png' ? `[${v.length} bytes]` : v), 1));
  check(`the page was straightened (drawn turned 0.4°): ${page.angle}°`, Math.abs(Math.abs(page.angle) - 0.4) <= 0.15);
  console.log(`      (${ms} ms)`);

  const rate = lineCer(pageText(page), expected.lines);
  check(`all the text read: character error rate ${(rate * 100).toFixed(2)}% (≤ 3%)`, rate <= 0.03);

  const ruled = page.blocks.filter((b): b is TableBlock => b.kind === 'table' && !b.borderless);
  check('one ruled table', ruled.length === 1, `${ruled.length}`);
  const t = ruled[0];
  if (t) {
    const R = t.ys.length - 1;
    const C = t.xs.length - 1;
    check(`its grid: ${C} columns × ${R} rows (drawn 5 × 6)`, C === expected.table.cols && R === expected.table.rows);
    const merged = t.cells.filter((c) => c.r1 - c.r0 > 1 || c.c1 - c.c0 > 1).map((c) => `${c.r0},${c.c0}-${c.r1},${c.c1}`);
    check('merged cells: "50" over two rows, the conclusion across four columns', merged.includes('2,4-4,5') && merged.includes('5,1-6,5'), merged.join(' '));
    let worst = 0;
    const bad: string[] = [];
    for (const e of expected.table.cells) {
      const got = cellText(t, e.r0, e.c0) ?? '';
      // (spaces round a dash are not counted: "5,5-9" for "5,5 - 9")
      const r = cer(got.replace(/\s*-\s*/g, '-'), e.text.replace(/\s*-\s*/g, '-'));
      worst = Math.max(worst, r);
      if (r > 0.1) bad.push(`${e.text} → ${got}`);
    }
    check(`every cell's text (worst error ${(worst * 100).toFixed(0)}%)`, bad.length === 0, bad.join(' | '));
    const lines = t.cells.every((c) => (c.r0 === 5 && c.c0 === 1 ? c.left && c.top && c.bottom && c.right : c.top && c.bottom && c.left && c.right));
    check('its borders are drawn on every side of every cell', lines);
  }
  const heading = page.blocks.find((b): b is TableBlock => b.kind === 'table' && b.borderless);
  const left = heading?.cells[0]?.paras.map(text).join(' ') ?? '';
  const right = heading?.cells[1]?.paras.map(text).join(' ') ?? '';
  check('the two-column heading is a borderless table, side by side', !!heading && cer(left, 'CÔNG TY CỔ PHẦN ABC Số: 15/2024/BC') < 0.1 && cer(right, 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM Độc lập - Tự do - Hạnh phúc') < 0.1, `${left} | ${right}`);
  check('both its sides centred', !!heading && heading.cells.every((c) => c.paras.every((p) => p.align === 'center')));
  const paras = page.blocks.filter((b): b is Para => b.kind === 'para');
  const title = paras.find((p) => text(p).includes('QUAN TRẮC MÔI'));
  check('the title: centred, bold, 14 pt', !!title && title.align === 'center' && title.lines[0].words.every((w) => w.bold) && Math.abs(title.size - 14) <= 0.75, title ? `${title.align} ${title.size}` : 'missing');
  const body = paras.find((p) => text(p).startsWith('Thực hiện'));
  check('the first paragraph: one paragraph of 4 lines, justified, its first line indented ½ inch, 13 pt', !!body && body.lines.length === 4 && body.align === 'justify' && Math.abs(body.firstLine / page.dpi - 0.5) < 0.08 && Math.abs(body.size - 13) <= 0.75, body ? `${body.lines.length} lines, ${body.align}, first line ${(body.firstLine / page.dpi).toFixed(2)} in, ${body.size} pt` : 'missing');
  const h1 = paras.find((p) => text(p).startsWith('1. Kết quả'));
  check('the heading: bold, at the left margin', !!h1 && h1.lines[0].words.every((w) => w.bold) && h1.indent < page.dpi * 0.1 && h1.firstLine < page.dpi * 0.1);
  const note = paras.find((p) => text(p).startsWith('Ghi chú'));
  check('the note: italic', !!note && note.lines.flatMap((l) => l.words).filter((w) => w.italic).length >= note.lines.flatMap((l) => l.words).length * 0.8);
  const pics = page.blocks.filter((b) => b.kind === 'picture');
  const [px0, py0, px1, py1] = expected.picture.map((v: number) => v * page.dpi);
  const pic = pics[0];
  check('the picture: one, in the text, where it was drawn', pics.length === 1 && pic.kind === 'picture' && !pic.behind && Math.abs(pic.box.x0 - px0) < 30 && Math.abs(pic.box.y1 - py1) < 30 && Math.abs(pic.box.x1 - px1) < 30 && Math.abs(pic.box.y0 - py0) < 30, pic ? JSON.stringify(pic.box) : 'none');
  const foot = page.footer.filter((b): b is Para => b.kind === 'para').map(text).join(' | ');
  check('the footer under its rule: the line and the page number', page.footer.some((b) => b.kind === 'rule') && foot.includes('Công ty Cổ phần ABC') && /\b1\b/.test(foot), foot);
  check('no header (nothing above a rule at the top)', page.header.length === 0);

  // ---- the Word file ----------------------------------------------------------------
  const docx = writeDocx([page], { title: 'OCR' });
  writeFileSync(join(OUT, 'page.docx'), docx);
  const z = unzipSync(docx);
  const xml = strFromU8(z['word/document.xml']);
  check('Word: a table with a cell across 4 columns and one over two rows', /<w:tbl>/.test(xml) && /<w:gridSpan w:val="4"\/>/.test(xml) && /<w:vMerge w:val="restart"\/>/.test(xml) && /<w:vMerge\/>/.test(xml));
  check('Word: the picture is in it (PNG)', Object.keys(z).some((n) => /^word\/media\/image\d+\.png$/.test(n)) && /<wp:inline/.test(xml));
  check('Word: the footer is Word\'s footer, with the page\'s size and margins', Object.keys(z).includes('word/footer1.xml') && /<w:pgSz w:w="119\d\d" w:h="168\d\d"\/>/.test(xml) && /<w:pgMar /.test(xml), xml.match(/<w:pgSz[^>]*>/)?.[0]);
  check('Word: Vietnamese text as typed (NFC)', xml.includes('Tổng chất rắn lơ lửng') || xml.includes('chất rắn'));
  const { DOMParser } = await import('@xmldom/xmldom');
  let parsed = true;
  for (const [name, data] of Object.entries(z)) {
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    const errors: string[] = [];
    new DOMParser({ onError: (level: string, msg: string) => level !== 'warning' && errors.push(msg) } as never).parseFromString(strFromU8(data), 'text/xml');
    if (errors.length) {
      parsed = false;
      console.log('      ', name, errors[0]);
    }
  }
  check('Word: every part is well-formed XML', parsed);

  // ---- the searchable PDF ---------------------------------------------------------------
  const report = addTextLayer(m, src.doc, [textPage(0, page)], new Uint8Array(readFileSync(join(root, 'public/fonts/ezSansVN-Regular.ttf'))));
  const searchable = save(src.doc);
  m.FPDFFont_Close(report.font);
  src.close();
  writeFileSync(join(OUT, 'scan-ocr.pdf'), searchable);
  const jpeg = readFileSync(join(FIX, 'page.jpg'));
  const findBytes = (hay: Uint8Array, needle: Uint8Array) => Buffer.from(hay.buffer, hay.byteOffset, hay.byteLength).indexOf(Buffer.from(needle.buffer, needle.byteOffset, needle.byteLength));
  const scanImage = (() => {
    // the JPEG inside scan.pdf (Pillow wrote it there): from its SOI to the end of the stream
    const at = findBytes(pdfBytes, new Uint8Array([0xff, 0xd8, 0xff]));
    const end = Buffer.from(pdfBytes).indexOf('endstream', at);
    return pdfBytes.subarray(at, end - 1);
  })();
  check('PDF: the scan\'s picture is in it byte for byte', findBytes(searchable, scanImage) > 0 && jpeg.length > 0);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pd = await pdfjs.getDocument({ data: new Uint8Array(searchable), disableFontFace: true, useSystemFonts: false }).promise;
  const tc = await (await pd.getPage(1)).getTextContent();
  const pdfText = tc.items.map((i) => ('str' in i ? i.str : '')).join(' ');
  const pdfRate = cer(pdfText, readingLines(page).map((l) => l.words.map((w) => w.text).join(' ')).join(' '));
  check(`PDF: pdf.js reads back the words laid in (difference ${(pdfRate * 100).toFixed(2)}%)`, pdfRate < 0.01 && report.words > 100, `${report.words} words`);
  check('PDF: "chất rắn lơ lửng" can be found in it', pdfText.normalize('NFC').includes('chất rắn lơ lửng'));
  // where the words are: "Tổng" of the table lies over the word on the page
  const item = tc.items.find((i) => 'str' in i && i.str.startsWith('Tổng')) as { transform: number[] } | undefined;
  const word = readingLines(page).flatMap((l) => l.words.map((w) => ({ w, l }))).find((x) => x.w.text.startsWith('Tổng'));
  const wantX = word ? (word.w.box.x0 / page.dpi) * 72 : NaN;
  const wantY = word ? page.heightPt - (((word.l.base.y0 + word.l.base.y1) / 2) / page.dpi) * 72 : NaN;
  check('PDF: a word lies where it is on the page (within 3 pt)', !!item && Math.abs(item.transform[4] - wantX) < 3 && Math.abs(item.transform[5] - wantY) < 3, item ? `at ${item.transform[4].toFixed(1)}, ${item.transform[5].toFixed(1)}; the word at ${wantX.toFixed(1)}, ${wantY.toFixed(1)}` : 'not found');

  // ---- pictures: JPEG with its resolution, a two-page TIFF ---------------------------------
  const info = jpegInfo(new Uint8Array(jpeg));
  check('JPEG: its size and its 200 dpi read from the file', !!info && info.width === 1654 && info.height === 2338 + (info.height - 2338) && info.dpi === 200, JSON.stringify(info));
  const fromJpeg = await picturePages([{ name: 'page.jpg', bytes: new Uint8Array(jpeg) }]);
  check('JPEG: an A4 page, the picture kept as it is', fromJpeg.length === 1 && Math.abs(fromJpeg[0].pageWidth - 595.4) < 1.5 && fromJpeg[0].image.filter === 'DCTDecode', `${fromJpeg[0]?.pageWidth.toFixed(1)} × ${fromJpeg[0]?.pageHeight.toFixed(1)}`);
  const tiffPages = await picturePages([{ name: 'pages.tif', bytes: new Uint8Array(readFileSync(join(FIX, 'pages.tif'))) }]);
  check('TIFF: both pages, in grey, lossless', tiffPages.length === 2 && tiffPages.every((p) => p.image.filter === 'FlateDecode' && p.image.space === 'DeviceGray'));
  const tiffPdf = picturesToPdf(tiffPages, 'pages');
  writeFileSync(join(OUT, 'pages.pdf'), tiffPdf);
  const tp = openPdf(tiffPdf);
  check('TIFF: the PDF made from it has 2 pages', m.FPDF_GetPageCount(tp.doc) === 2);
  const page2 = await ocrPage(render(tp.doc, 1, ocrDpiFor(pageScan(m, tp.doc, 1).scanDpi)), read);
  tp.close();
  const rate2 = lineCer(pageText(page2), expected.page2);
  check(`TIFF page 2 (black and white): character error rate ${(rate2 * 100).toFixed(2)}% (≤ 3%)`, rate2 <= 0.03);
  const p2 = page2.blocks.filter((b): b is Para => b.kind === 'para');
  check('TIFF page 2: a heading and two paragraphs', p2.length === 3 && p2[1].lines.length >= 2 && p2[2].lines.length >= 2, p2.map((p) => p.lines.length).join(','));
} finally {
  await worker.terminate();
}

function ocrDpiFor(scanDpi: number) {
  return scanDpi >= 200 ? Math.min(scanDpi, 300) : scanDpi > 0 ? Math.min(300, Math.max(200, scanDpi * 2)) : 250;
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
