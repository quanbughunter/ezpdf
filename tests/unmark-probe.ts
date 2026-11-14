/**
 * Probe for "Bỏ tô sáng" (src/engine/marks.ts, TextEditor.removeMarks),
 * headless, with the same PDFium WASM as the app.
 *
 * On tests/fixtures/highlight.pdf (scripts/make_highlight_fixture.py):
 *  - which lines the tool offers to take a highlight off, and how far the
 *    passage goes; boxes, cell backgrounds, white words on a dark band, an
 *    opaque box over a word and a thin underline are never offered
 *  - the cells of a table row are separate lines, so editing one cell does
 *    not move the next one
 *  - taking highlights off: the filled rectangles leave the page content,
 *    a highlight annotation leaves the page, the text objects stay
 * Writes out/unmark/<name>.pdf plus expected.json for scripts/verify_unmark.py,
 * which checks the files without PDFium (Poppler, MuPDF, qpdf).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { TextEditor, TextEditError, type TextLine } from '../src/engine/text-edit';
import { Wasm } from '../src/engine/wasm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const toAB = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const m: WrappedPdfiumModule = await init({ wasmBinary: toAB(readFileSync(join(root, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm'))) });
m.PDFiumExt_Init();
const w = new Wasm(m);
const fonts = {
  regular: new Uint8Array(readFileSync(join(root, 'public/fonts/ezSansVN-Regular.ttf'))),
  bold: new Uint8Array(readFileSync(join(root, 'public/fonts/ezSansVN-Bold.ttf'))),
};
const out = join(root, 'out', 'unmark');
mkdirSync(out, { recursive: true });
const source = new Uint8Array(readFileSync(join(root, 'tests/fixtures/highlight.pdf')));

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

function open() {
  const ptr = w.copyIn(source);
  const doc = m.FPDF_LoadMemDocument(ptr, source.byteLength, '');
  if (!doc) throw new Error('cannot open');
  const ed = new TextEditor(m, doc, fonts);
  return { doc, ed, close: () => (ed.dispose(), m.FPDF_CloseDocument(doc), w.free(ptr)) };
}

function save(doc: number, name: string) {
  const writer = m.PDFiumExt_OpenFileWriter();
  try {
    if (!m.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error('save failed');
    const size = m.PDFiumExt_GetFileWriterSize(writer);
    const ptr = w.malloc(size);
    try {
      m.PDFiumExt_GetFileWriterData(writer, ptr, size);
      writeFileSync(join(out, name), w.heap.slice(ptr, ptr + size));
    } finally {
      w.free(ptr);
    }
  } finally {
    m.PDFiumExt_CloseFileWriter(writer);
  }
}

const find = (lines: TextLine[], text: string, nth = 0) => {
  const hits = lines.filter((l) => l.text === text || l.text.startsWith(text));
  if (!hits[nth]) throw new Error(`no line “${text}” #${nth}: ${lines.map((l) => l.text).join(' | ')}`);
  return hits[nth];
};
const pageObjects = (doc: number, p: number) => {
  const page = m.FPDF_LoadPage(doc, p);
  try {
    return m.FPDFPage_CountObjects(page);
  } finally {
    m.FPDF_ClosePage(page);
  }
};
const annots = (doc: number, p: number) => {
  const page = m.FPDF_LoadPage(doc, p);
  try {
    return m.FPDFPage_GetAnnotCount(page);
  } finally {
    m.FPDF_ClosePage(page);
  }
};

// ── what is offered ──
{
  const { ed, close } = open();
  // [page, line text, passage lines] — 0: no highlight offered
  const expected: [number, string, number][] = [
    [0, 'TT', 0],
    [0, 'Nội dung', 0],
    [0, 'Báo cáo số lượng', 3],
    [0, 'đoàn viên có mặt tại', 3],
    [0, 'Đại hội', 3],
    [0, '(13h22 – 13h25)', 0],
    [0, 'Đ/c Nguyễn Thị Hường: Kính thưa Đại hội!', 0],
    [0, 'Ô có nền xám', 0],
    [0, 'Văn bản thường có một cụm tô xanh ở giữa.', 1],
    [0, 'Đoạn văn này có một phần', 2],
    [0, 'Dòng này không tô gì cả.', 0],
    [0, 'Còn đây là một từ riêng được tô.', 1],
    [1, 'A plain start', 2],
    [1, 'again.', 0],
    [1, 'Green cell text', 1],
    [1, 'Grey cell', 0],
    [1, 'Shaded run after it.', 1],
    [2, 'Annotated line with a highlight annotation.', 1],
    [2, 'This word is covered by a black box.', 0],
    [2, 'A flattened highlight drawn over the text.', 1],
    [2, 'White on dark', 0],
    [2, 'A callout box behind three lines,', 0],
    [2, 'tinted light blue, which is a box', 0],
    [2, 'Underlined by a thin bar.', 0],
  ];
  const pages = [0, 1, 2].map((p) => ed.lines(p));
  for (const [p, text, n] of expected) {
    const l = find(pages[p], text);
    check(
      n ? `p${p + 1} “${text}”: highlight offered, passage of ${n} line${n > 1 ? 's' : ''}` : `p${p + 1} “${text}”: nothing offered`,
      (l.marks?.lines ?? 0) === n,
      l.marks ? JSON.stringify(l.marks) : 'no marks',
    );
  }
  const thu = pages[0].filter((l) => l.text === 'Thư ký');
  check('the same word highlighted in two cells, one above the other: two passages, not one', thu.length === 2 && thu.every((l) => l.marks?.lines === 1), JSON.stringify(thu.map((l) => l.marks)));
  const p6 = find(pages[0], 'Báo cáo số lượng').marks!;
  check('the passage is named by its first and last line', p6.first === 'Báo cáo số lượng' && p6.last === 'Đại hội' && p6.color.join() === '255,255,0', JSON.stringify(p6));
  const row = ['6', 'Báo cáo số lượng', 'Đ/c Nguyễn Thị Hường: Kính thưa Đại hội!', 'Đoàn Chủ tịch'].map((t) => pages[0].some((l) => l.text === t));
  check('the cells of a table row are separate lines (vertical rules split a line)', row.every(Boolean), JSON.stringify(row));
  close();
}

// ── editing one cell leaves the next cell where it is ──
{
  const { ed, close } = open();
  const before = ed.lines(0);
  const next = find(before, 'Báo cáo số lượng').box;
  ed.replaceLine(0, find(before, '6').key, '16');
  const after = ed.lines(0);
  const moved = find(after, 'Báo cáo số lượng').box;
  check(
    'editing the number in the first cell does not move the text of the next cell',
    after.some((l) => l.text === '16') && Math.abs(moved.left - next.left) < 0.01,
    `left ${next.left.toFixed(2)} → ${moved.left.toFixed(2)}`,
  );
  close();
}

// ── taking highlights off ──
const expectations: object[] = [];
{
  // a: the three-line passage, from its middle line; then one of the two “Thư ký”
  const { doc, ed, close } = open();
  const objs = pageObjects(doc, 0);
  const r1 = ed.removeMarks(0, find(ed.lines(0), 'đoàn viên có mặt tại').key);
  check('p1: from the middle line, the whole passage goes: 3 rectangles, 3 lines', r1.removedFills === 3 && r1.lines === 3 && r1.removedAnnots === 0, JSON.stringify(r1));
  const after = ed.lines(0);
  check(
    'p1: the passage lines have no highlight left, the other highlights are still offered',
    ['Báo cáo số lượng', 'đoàn viên có mặt tại', 'Đại hội'].every((t) => !find(after, t).marks) &&
      !!find(after, 'Văn bản thường có').marks &&
      !!find(after, 'Đoạn văn này').marks &&
      !!find(after, 'Còn đây là').marks,
  );
  const r2 = ed.removeMarks(0, find(ed.lines(0), 'Thư ký', 0).key);
  const thu = ed.lines(0).filter((l) => l.text === 'Thư ký');
  check('p1: the first “Thư ký” loses its highlight, the one in the cell below keeps it', r2.removedFills === 1 && !thu[0].marks && !!thu[1].marks, JSON.stringify(r2));
  check('p1: four objects fewer on the page, all of them filled rectangles', pageObjects(doc, 0) === objs - 4, `${objs} → ${pageObjects(doc, 0)}`);
  let refused = '';
  try {
    ed.removeMarks(0, find(ed.lines(0), 'Dòng này không tô gì cả.').key);
  } catch (e) {
    refused = e instanceof TextEditError ? e.message : `other error: ${e}`;
  }
  check('a line with no highlight is refused, with a reason', refused.includes('không có màu tô'), refused);
  save(doc, 'unmark-a.pdf');
  expectations.push({
    file: 'unmark-a.pdf',
    source: 'highlight.pdf',
    pages: {
      0: {
        removed: ['Báo cáo số lượng', 'đoàn viên có mặt tại', 'Đại hội#1', 'Thư ký#0'],
        kept: ['một cụm tô xanh', 'Thư ký#1', 'riêng', 'nhiều dòng để kiểm tra', 'TT', 'Ô có nền xám'],
      },
    },
    annots: { 2: 1 },
  });
  close();
}
{
  // b: LibreOffice: the two-line passage and the shaded run
  const { doc, ed, close } = open();
  const r1 = ed.removeMarks(1, find(ed.lines(1), 'processor has to paint').key);
  const r2 = ed.removeMarks(1, find(ed.lines(1), 'Shaded run after it.').key);
  const after = ed.lines(1);
  check(
    'p2 (LibreOffice): the passage (2 lines) and the shaded run go; the green cell text keeps its highlight',
    r1.lines === 2 && r1.removedFills >= 2 && r2.lines === 1 && !find(after, 'A plain start').marks && !!find(after, 'Green cell text').marks,
    `${JSON.stringify(r1)} ${JSON.stringify(r2)}`,
  );
  save(doc, 'unmark-b.pdf');
  expectations.push({
    file: 'unmark-b.pdf',
    source: 'highlight.pdf',
    pages: { 1: { removed: ['highlighted passage', 'processor has to paint', 'Shaded run'], kept: ['Green cell text', 'Grey cell'] } },
    annots: { 2: 1 },
  });
  close();
}
{
  // c: the highlight annotation and the see-through band
  const { doc, ed, close } = open();
  const before = annots(doc, 2);
  const r1 = ed.removeMarks(2, find(ed.lines(2), 'Annotated line').key);
  const r2 = ed.removeMarks(2, find(ed.lines(2), 'A flattened highlight').key);
  check(
    'p3: the highlight annotation leaves the page, the see-through band leaves the content',
    r1.removedAnnots === 1 && r1.removedFills === 0 && annots(doc, 2) === before - 1 && r2.removedFills === 1,
    `${JSON.stringify(r1)} ${JSON.stringify(r2)} annots ${before} → ${annots(doc, 2)}`,
  );
  save(doc, 'unmark-c.pdf');
  expectations.push({
    file: 'unmark-c.pdf',
    source: 'highlight.pdf',
    pages: { 2: { removed: ['highlight annotation', 'A flattened highlight drawn over the text.'], kept: ['covered', 'White on dark', 'A callout box', 'thin bar'] } },
    annots: { 2: 0 },
  });
  close();
}
writeFileSync(join(out, 'expected.json'), JSON.stringify(expectations, null, 2));
console.log(failures ? `\n${failures} probe check(s) failed` : '\nall probe checks passed');
process.exit(failures ? 1 : 0);
