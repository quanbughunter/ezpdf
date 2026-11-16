/**
 * "PDF sửa được chữ" end to end in Node, through the app's own steps: the
 * page read by OCR (tesseract.js, the bundled Vietnamese model), drawn again
 * at the scan's resolution, its words cut out of the picture (editable.ts),
 * the pages written (editable-pdf.ts) and put in place of the scanned ones
 * (page-ops.ts, as the app does). Then checks, with PDFium:
 *  - the page looks as the scan did (drawn at the scan's resolution and at
 *    twice it);
 *  - the page holds one picture and the words as text, nothing drawn over;
 *  - the text reads back as OCR read it, word by word, in the page's order,
 *    with spaces;
 *  - with the text taken off, the words' places in the picture are empty:
 *    the ink is gone from the picture itself (what lets a moved word leave
 *    its place empty); the table's rules are still there;
 *  - ezPDF's edit tool sees the words as lines; changing one word rewrites
 *    only that word, the words before it stay as they were; deleting a word
 *    leaves its place empty;
 *  - "Kéo chữ": moving a line (the edit tool's drag) takes all its words to
 *    the new place, drawn as they were, and leaves the old place empty; the
 *    text still reads; a line of an ordinary PDF moves the same way.
 * Writes out/editable/{original,result,edited}.pdf and expected.json for
 * scripts/verify_editable.py (the same checks done again with other readers).
 *
 *   npx tsx tests/editable-test.ts                      the OCR fixture (tests/fixtures/ocr/scan.pdf)
 *   npx tsx tests/editable-test.ts <file.pdf> <pages> [out-dir]   any scanned PDF, pages from 1 (e.g. 2,9,31)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zlibSync } from 'fflate';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { createWorker } from 'tesseract.js';
import { ocrPage } from '../src/ocr/pipeline';
import { pageText, type PageLayout } from '../src/ocr/model';
import { pageScan } from '../src/engine/ocr-pdf';
import { assembleNew } from '../src/engine/page-ops';
import { TextEditor } from '../src/engine/text-edit';
import { WORD_PICTURES_FONT } from '../src/engine/word-pictures';
import { Wasm } from '../src/engine/wasm';
import { cutPage, flateSamples, isGrey, markRule, sourceRules, type CutWord } from '../src/ocr/editable';
import { EditablePdf } from '../src/ocr/editable-pdf';
import { editableDpi, ocrDpi } from '../src/ocr/dpi';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [fileArg, pagesArg, outArg] = process.argv.slice(2);
const FILE = fileArg ?? join(root, 'tests/fixtures/ocr/scan.pdf');
const PAGES = (pagesArg ?? '1').split(',').map((n) => Number(n) - 1);
const OUT = outArg ?? join(root, 'out/editable');
mkdirSync(OUT, { recursive: true });
const fixture = !fileArg;
const expectedLines: string[] | null = fixture ? JSON.parse(readFileSync(join(root, 'tests/fixtures/ocr/expected.json'), 'utf8')).lines : null;

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const toAB = (b: Buffer | Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const m: WrappedPdfiumModule = await init({ wasmBinary: toAB(readFileSync(join(root, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm'))) });
m.PDFiumExt_Init();
const wasm = new Wasm(m);
const fonts = {
  regular: new Uint8Array(readFileSync(join(root, 'public/fonts/ezSansVN-Regular.ttf'))),
  bold: new Uint8Array(readFileSync(join(root, 'public/fonts/ezSansVN-Bold.ttf'))),
};

function openPdf(bytes: Uint8Array) {
  const ptr = wasm.copyIn(bytes);
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, '');
  if (!doc) throw new Error('PDFium cannot open it');
  return { doc, close: () => (m.FPDF_CloseDocument(doc), wasm.free(ptr)) };
}

/** the page as the app draws it (annotations, /Rotate, white paper), RGBA */
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

/** the page's text, as PDFium reads it */
function pageTextOf(doc: number, index: number): string {
  const page = m.FPDF_LoadPage(doc, index);
  const tp = m.FPDFText_LoadPage(page);
  const n = m.FPDFText_CountChars(tp);
  const buf = wasm.malloc((n + 1) * 2);
  m.FPDFText_GetText(tp, 0, n, buf);
  const s = wasm.p.UTF16ToString(buf);
  wasm.free(buf);
  m.FPDFText_ClosePage(tp);
  m.FPDF_ClosePage(page);
  return s;
}

/** the page's objects by kind */
function objectKinds(doc: number, index: number) {
  const page = m.FPDF_LoadPage(doc, index);
  const kinds: Record<number, number> = {};
  for (let i = 0; i < m.FPDFPage_CountObjects(page); i++) {
    const t = m.FPDFPageObj_GetType(m.FPDFPage_GetObject(page, i));
    kinds[t] = (kinds[t] ?? 0) + 1;
  }
  m.FPDF_ClosePage(page);
  return { text: kinds[1] ?? 0, path: kinds[2] ?? 0, image: kinds[3] ?? 0, shading: kinds[4] ?? 0, form: kinds[5] ?? 0 };
}

/** takes text objects off a page: all of them, or those `which` picks (index among the text objects) */
function removeText(doc: number, index: number, which: (k: number) => boolean = () => true) {
  const page = m.FPDF_LoadPage(doc, index);
  const objs: number[] = [];
  for (let i = 0; i < m.FPDFPage_CountObjects(page); i++) {
    const o = m.FPDFPage_GetObject(page, i);
    if (m.FPDFPageObj_GetType(o) === 1) objs.push(o);
  }
  objs.forEach((o, k) => {
    if (!which(k)) return;
    m.FPDFPage_RemoveObject(page, o);
    m.FPDFPageObj_Destroy(o);
  });
  m.FPDFPage_GenerateContent(page);
  m.FPDF_ClosePage(page);
}

const lum = (d: Uint8Array, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** share of a box's pixels darker than `below` (those of `skip`, the page's lines, left out) */
function darkShare(img: { rgba: Uint8Array; w: number; h: number }, b: { x0: number; y0: number; x1: number; y1: number }, below: number, skip?: Uint8Array) {
  let n = 0;
  let all = 0;
  for (let y = Math.max(0, Math.floor(b.y0)); y < Math.min(img.h, Math.ceil(b.y1)); y++)
    for (let x = Math.max(0, Math.floor(b.x0)); x < Math.min(img.w, Math.ceil(b.x1)); x++) {
      if (skip?.[y * img.w + x]) continue;
      all++;
      if (lum(img.rgba, (y * img.w + x) * 4) < below) n++;
    }
  return all ? n / all : 0;
}

/** how two drawings of one page differ: mean of the largest channel difference, share above 48 */
function difference(a: { rgba: Uint8Array; w: number; h: number }, b: { rgba: Uint8Array; w: number; h: number }) {
  // (the page's size is the picture's, so it may be a pixel off the scan's at another resolution)
  if (Math.abs(a.w - b.w) > 1 || Math.abs(a.h - b.h) > 1) return { mean: Infinity, big: 1 };
  const w = Math.min(a.w, b.w);
  const h = Math.min(a.h, b.h);
  let sum = 0;
  let big = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * a.w + x) * 4;
      const j = (y * b.w + x) * 4;
      const d = Math.max(Math.abs(a.rgba[i] - b.rgba[j]), Math.abs(a.rgba[i + 1] - b.rgba[j + 1]), Math.abs(a.rgba[i + 2] - b.rgba[j + 2]));
      sum += d;
      if (d > 48) big++;
    }
  return { mean: sum / (w * h), big: big / (w * h) };
}

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

/** a page's /Rotate, quarter turns */
function rotationOf(doc: number, index: number) {
  const page = m.FPDF_LoadPage(doc, index);
  const r = ((m.FPDFPage_GetRotation(page) % 4) + 4) % 4;
  m.FPDF_ClosePage(page);
  return r;
}

/** longest common subsequence of two word lists, over the longer */
function sameWords(a: string[], b: string[]) {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = [0];
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length] / Math.max(1, a.length, b.length);
}

const worker = await createWorker('vie', 1, { langPath: join(root, 'node_modules/@tesseract.js-data/vie/4.0.0_best_int'), cacheMethod: 'none', gzip: true });
const read = async (pgm: Uint8Array, dpi: number, mode: 'page' | 'block' | 'line') => {
  await worker.setParameters({ tessedit_pageseg_mode: ({ page: '3', block: '6', line: '7' } as const)[mode] as never, preserve_interword_spaces: '1', user_defined_dpi: String(dpi) });
  const r = await worker.recognize(Buffer.from(pgm), {}, { blocks: true });
  return (r.data.blocks ?? []) as never;
};

interface Done {
  index: number;
  dpi: number;
  layout: PageLayout;
  words: CutWord[];
  left: number;
  widthPt: number;
  heightPt: number;
}

try {
  const original = new Uint8Array(readFileSync(FILE));
  const src = openPdf(original);
  const count = m.FPDF_GetPageCount(src.doc);
  const writer = new EditablePdf();
  const done: Done[] = [];
  for (const index of PAGES) {
    const scan = pageScan(m, src.doc, index);
    const probe = render(src.doc, index, 72);
    const t0 = Date.now();
    const layout = await ocrPage(render(src.doc, index, ocrDpi(scan.scanDpi, { w: probe.widthPt, h: probe.heightPt })), read);
    const t1 = Date.now();
    const dpi = editableDpi(scan.scanDpi, { w: probe.widthPt, h: probe.heightPt });
    const pic = render(src.doc, index, dpi);
    const cut = cutPage(layout, pic);
    const grey = isGrey(pic.rgba);
    const widthPt = (pic.w * 72) / dpi;
    const heightPt = (pic.h * 72) / dpi;
    writer.addPage({ widthPt, heightPt, dpi, background: { kind: 'flate', bytes: flateSamples(pic.rgba, grey, (b) => zlibSync(b, { level: 6 })), w: pic.w, h: pic.h, gray: grey }, words: cut.words });
    console.log(`      page ${index + 1}: scan ${scan.scanDpi} dpi, picture ${dpi} dpi, ${cut.words.length} words cut, ${cut.left} left in the picture; OCR ${t1 - t0} ms, cut ${Date.now() - t1} ms`);
    done.push({ index, dpi, layout, words: cut.words, left: cut.left, widthPt, heightPt });
  }
  const editable = writer.finish('OCR');
  // as the app does: the scanned pages replaced, the others as they were
  const plan = Array.from({ length: count }, (_, i) => {
    const k = PAGES.indexOf(i);
    return k >= 0 ? { src: 1, page: k, rotation: 0 } : { src: 0, page: i, rotation: rotationOf(src.doc, i) };
  });
  const result = assembleNew(m, original, [editable], plan);
  writeFileSync(join(OUT, 'result.pdf'), result);
  // the scanned pages alone, to compare with
  const only = m.FPDF_CreateNewDocument();
  m.FPDF_ImportPages(only, src.doc, PAGES.map((p) => p + 1).join(','), 0);
  writeFileSync(join(OUT, 'original.pdf'), save(only));
  m.FPDF_CloseDocument(only);
  console.log(`      sizes: scanned pages ${(readFileSync(join(OUT, 'original.pdf')).length / 1024).toFixed(0)} KB, editable pages ${(editable.length / 1024).toFixed(0)} KB`);

  const res = openPdf(result);
  check('the result has every page, the scanned ones in place', m.FPDF_GetPageCount(res.doc) === count, `${m.FPDF_GetPageCount(res.doc)} / ${count}`);
  const expected: object[] = [];
  for (const d of done) {
    const tag = `page ${d.index + 1}`;
    const all = d.words.length + d.left;
    check(`${tag}: most words cut out (${d.words.length} of ${all})`, d.words.length >= all * (fixture ? 0.9 : 0.75));

    // looks as the scan did
    const a = render(src.doc, d.index, d.dpi);
    const b = render(res.doc, d.index, d.dpi);
    const same = difference(a, b);
    check(`${tag}: looks as the scan did at ${d.dpi} dpi (mean ${same.mean.toFixed(2)}, ${(same.big * 100).toFixed(2)}% pixels off by > 48)`, same.mean <= 3 && same.big <= 0.006);
    const a2 = render(src.doc, d.index, d.dpi * 2);
    const b2 = render(res.doc, d.index, d.dpi * 2);
    const same2 = difference(a2, b2);
    check(`${tag}: and at ${d.dpi * 2} dpi (mean ${same2.mean.toFixed(2)}, ${(same2.big * 100).toFixed(2)}% off by > 48)`, same2.mean <= 4.5 && same2.big <= 0.02);

    // one picture, the words as text, nothing else
    const kinds = objectKinds(res.doc, d.index);
    check(`${tag}: one picture and ${d.words.length} words as text, no shapes drawn`, kinds.image === 1 && kinds.text === d.words.length && kinds.path === 0 && kinds.form === 0 && kinds.shading === 0, JSON.stringify(kinds));

    // the text reads back word by word, with spaces, in the page's order
    const text = pageTextOf(res.doc, d.index).replace(/￾/g, '');
    const got = text.split(/\s+/).filter(Boolean);
    const want = d.words.map((w) => w.text);
    const ratio = sameWords(got, want);
    check(`${tag}: the text reads back as OCR read it, word for word (${(ratio * 100).toFixed(1)}%)`, ratio >= 0.98, ratio < 0.98 ? text.slice(0, 200) : '');
    if (expectedLines) {
      const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
      // (a heading in two columns comes out as one line, its two halves side by side)
      const norm = (t: string) => t.normalize('NFC').replace(/\s+/g, ' ').trim();
      const hits = expectedLines.filter((l) => lines.some((g) => norm(g).includes(norm(l)) || cer(g, l) <= 0.05)).length;
      check(`${tag}: each line of the fixture comes out whole, its words in order (${hits} of ${expectedLines.length})`, hits === expectedLines.length);
    }

    // with the text taken off, the words' places are empty; the rules are still there
    const bare = openPdf(result);
    removeText(bare.doc, d.index);
    const c = render(bare.doc, d.index, d.dpi);
    bare.close();
    // (a line through a word, an underline, stays in the picture: its pixels are left out)
    const lineMask = new Uint8Array(c.w * c.h);
    for (const r of sourceRules(d.layout, d.dpi / d.layout.dpi)) markRule(lineMask, c.w, c.h, r);
    let inked = 0;
    let emptied = 0;
    let worst = 0;
    for (const w of d.words) {
      const before = darkShare(a, w.box, 140, lineMask);
      const after = darkShare(c, w.box, 140, lineMask);
      if (before >= 0.03) {
        inked++;
        if (after <= 0.01) emptied++;
        worst = Math.max(worst, after);
      }
    }
    check(`${tag}: with the text taken off, the words' places are empty (${emptied} of ${inked}; worst ${(worst * 100).toFixed(1)}% dark)`, inked > 0 && emptied >= inked * 0.98);
    const rules = sourceRules(d.layout, d.dpi / d.layout.dpi).filter((r) => Math.hypot(r.x1 - r.x0, r.y1 - r.y0) > 40);
    // what is a rule's ink in the scan is still ink in the picture
    const darkAcross = (img: { rgba: Uint8Array; w: number; h: number }, r: (typeof rules)[number], x: number, y: number) => {
      let dark = 255;
      for (let s = -2; s <= 2; s++) {
        const vertical = Math.abs(r.y1 - r.y0) > Math.abs(r.x1 - r.x0);
        const xx = vertical ? x + s : x;
        const yy = vertical ? y : y + s;
        if (xx >= 0 && yy >= 0 && xx < img.w && yy < img.h) dark = Math.min(dark, lum(img.rgba, (yy * img.w + xx) * 4));
      }
      return dark;
    };
    let kept = 0;
    let ruled = 0;
    for (const r of rules) {
      const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
      for (let k = 4; k < len - 4; k += 2) {
        const x = Math.round(r.x0 + ((r.x1 - r.x0) * k) / len);
        const y = Math.round(r.y0 + ((r.y1 - r.y0) * k) / len);
        if (darkAcross(a, r, x, y) >= 170) continue;
        ruled++;
        if (darkAcross(c, r, x, y) < 170) kept++;
      }
    }
    if (rules.length) check(`${tag}: the page's ${rules.length} lines (rules) stay in the picture (${((kept / Math.max(1, ruled)) * 100).toFixed(1)}% of their ink)`, kept >= ruled * 0.95);
    else if (fixture) check(`${tag}: the fixture's table rules were found`, false);
    if (process.env.EDITABLE_DEBUG) {
      const bad = d.words.filter((w) => darkShare(a, w.box, 140, lineMask) >= 0.03 && darkShare(c, w.box, 140, lineMask) > 0.01);
      writeFileSync(join(OUT, `p${d.index + 1}-notempty.json`), JSON.stringify(bad.map((w) => ({ text: w.text, box: w.box, after: darkShare(c, w.box, 140, lineMask) }))));
      writeFileSync(join(OUT, `p${d.index + 1}-bare.rgba`), c.rgba);
      writeFileSync(join(OUT, `p${d.index + 1}-scan.rgba`), a.rgba);
      console.log(`      debug: ${c.w}x${c.h}`);
    }

    expected.push({
      page: d.index,
      dpi: d.dpi,
      widthPt: d.widthPt,
      heightPt: d.heightPt,
      left: d.left,
      // boxes in PDF points, y up
      words: d.words.map((w) => ({ text: w.text, box: [(w.box.x0 * 72) / d.dpi, d.heightPt - (w.box.y1 * 72) / d.dpi, (w.box.x1 * 72) / d.dpi, d.heightPt - (w.box.y0 * 72) / d.dpi] })),
      rules: rules.map((r) => [(r.x0 * 72) / d.dpi, d.heightPt - (r.y0 * 72) / d.dpi, (r.x1 * 72) / d.dpi, d.heightPt - (r.y1 * 72) / d.dpi]),
    });
  }

  // ---- ezPDF's edit tool on the result ------------------------------------------
  const d = done[0];
  const ed = new TextEditor(m, res.doc, fonts);
  const lines = ed.lines(d.index);
  const ocrLines = lines.filter((l) => l.fontName === WORD_PICTURES_FONT);
  check(`the edit tool sees the words as lines in the OCR font (${ocrLines.length} lines, all editable)`, ocrLines.length > 0 && ocrLines.every((l) => l.editable));
  const line = ocrLines.filter((l) => l.parts.length >= 4).sort((x, y) => y.parts.length - x.parts.length)[0];
  check('a line of several words is one line to the edit tool', !!line, line ? `${line.parts.length} words: ${line.text}` : '');
  let edit: object | null = null;
  if (line) {
    const k = 1;
    const word = line.text.slice(line.parts[k].start, line.parts[k].end).trim();
    const nextText = line.text.slice(0, line.parts[k].start) + 'ĐỔI' + line.text.slice(line.parts[k].start + word.length);
    const before = render(res.doc, d.index, d.dpi);
    const report = ed.replaceLine(d.index, line.key, nextText);
    check(`changing one word ("${word}" → "ĐỔI") rewrites that word only, its ${line.parts.length - 1} neighbours kept`, report.removedObjects === 1 && report.addedObjects === 1 && report.keptObjects === line.parts.length - 1, JSON.stringify(report));
    const after = ed.lines(d.index).find((l) => l.text.includes('ĐỔI'));
    check('the line reads with the new word', after?.text === nextText.replace(/\s+/g, ' ').trim(), after?.text ?? '');
    const now = render(res.doc, d.index, d.dpi);
    // the first word of the line, before the change, is drawn exactly as before
    const first = d.words.find((w) => w.text === line.text.slice(line.parts[0].start, line.parts[0].end).trim());
    if (first) {
      const box = { x0: first.box.x0 - 1, y0: first.box.y0 - 1, x1: first.box.x1 + 1, y1: first.box.y1 + 1 };
      let diff = 0;
      for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) for (let ch = 0; ch < 3; ch++) diff = Math.max(diff, Math.abs(before.rgba[(y * before.w + x) * 4 + ch] - now.rgba[(y * now.w + x) * 4 + ch]));
      check(`the word before it ("${first.text}") is drawn as it was (largest difference ${diff})`, diff <= 2);
    }
    const saved = save(res.doc);
    writeFileSync(join(OUT, 'edited.pdf'), saved);
    edit = { page: d.index, from: word, to: 'ĐỔI', line: line.text, result: nextText.replace(/\s+/g, ' ').trim() };
  }

  // deleting a word (as moving it away would) leaves its place empty
  const del = openPdf(result);
  const victim = d.words.findIndex((w) => w.text.length >= 3 && darkShare(render(src.doc, d.index, d.dpi), w.box, 140) > 0.05);
  removeText(del.doc, d.index, (k) => k === victim);
  const gone = render(del.doc, d.index, d.dpi);
  const w = d.words[victim];
  check(`deleting a word ("${w.text}") leaves its place empty (${(darkShare(gone, w.box, 140) * 100).toFixed(2)}% dark)`, darkShare(gone, w.box, 140) <= 0.01);
  del.close();

  // "Kéo chữ": a line moved to the foot of the page
  let moved: object | null = null;
  {
    const mv = openPdf(result);
    const med = new TextEditor(m, mv.doc, fonts);
    const target = med
      .lines(d.index)
      .filter((l) => l.fontName === WORD_PICTURES_FONT && l.parts.length >= 4)
      .sort((x, y) => y.parts.length - x.parts.length)[0];
    if (target) {
      const before = render(mv.doc, d.index, d.dpi);
      const px = (b: { left: number; bottom: number; right: number; top: number }) => ({ x0: (b.left * d.dpi) / 72, x1: (b.right * d.dpi) / 72, y0: ((d.heightPt - b.top) * d.dpi) / 72, y1: ((d.heightPt - b.bottom) * d.dpi) / 72 });
      const dy = 6 - target.box.bottom;
      const dx = 0;
      const report = med.moveLine(d.index, target.key, dx, dy);
      const after = render(mv.doc, d.index, d.dpi);
      const oldBox = px(target.box);
      const newBox = px(report.box);
      const inkBefore = darkShare(before, oldBox, 140);
      check(`moving a line ("${target.text.slice(0, 30)}…") takes its ${target.parts.length} words, to where it was dropped`, report.moved === target.parts.length && Math.abs(report.box.bottom - (target.box.bottom + dy)) < 0.05 && Math.abs(report.box.left - (target.box.left + dx)) < 0.05, JSON.stringify(report));
      check(`the old place is empty (${(darkShare(after, oldBox, 140) * 100).toFixed(2)}% dark, was ${(inkBefore * 100).toFixed(1)}%)`, inkBefore > 0.03 && darkShare(after, oldBox, 140) <= 0.01);
      // the words drawn at the new place as they were at the old one (the picture under them is plain paper)
      let diff = 0;
      let n = 0;
      const sh = Math.round(newBox.y0 - oldBox.y0);
      for (let y = Math.ceil(oldBox.y0); y < Math.floor(oldBox.y1); y++)
        for (let x = Math.ceil(oldBox.x0); x < Math.floor(oldBox.x1); x++) {
          if (y + sh >= after.h) continue;
          diff += Math.abs(lum(before.rgba, (y * before.w + x) * 4) - lum(after.rgba, ((y + sh) * after.w + x) * 4));
          n++;
        }
      check(`the line is drawn at its new place as it was (mean difference ${(diff / Math.max(1, n)).toFixed(1)})`, n > 0 && diff / n <= 12);
      const text = pageTextOf(mv.doc, d.index).replace(/\s+/g, ' ');
      check('the moved line still reads as text', text.includes(target.text));
      writeFileSync(join(OUT, 'moved.pdf'), save(mv.doc));
      moved = { page: d.index, text: target.text, from: target.box, to: report.box };
    } else check('a line to move', false);
    mv.close();
  }
  if (fixture) {
    // a line of an ordinary PDF (text in a TrueType font)
    const plain = openPdf(new Uint8Array(readFileSync(join(root, 'tests/fixtures/edit-text.pdf'))));
    const ped = new TextEditor(m, plain.doc, fonts);
    const line = ped.lines(0).find((l) => l.editable && l.text.length > 10)!;
    const r = ped.moveLine(0, line.key, 40, -30);
    const again = ped.lines(0).find((l) => l.text === line.text);
    check(`a line of an ordinary PDF moves the same way ("${line.text.slice(0, 24)}…" by 40, −30 pt)`, r.moved === line.parts.length && !!again && Math.abs(again.box.left - line.box.left - 40) < 0.1 && Math.abs(again.box.bottom - line.box.bottom + 30) < 0.1);
    plain.close();
  }

  writeFileSync(join(OUT, 'expected.json'), JSON.stringify({ original: 'original.pdf', result: 'result.pdf', edited: edit ? 'edited.pdf' : null, moved, pages: expected, edit, fixture, font: WORD_PICTURES_FONT }, null, 1));
  res.close();
  src.close();
} finally {
  await worker.terminate();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
