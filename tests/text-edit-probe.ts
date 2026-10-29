/**
 * Probe for editing existing text (src/engine/text-edit.ts), headless, with
 * the same PDFium WASM as the app.
 *
 * Edits lines on every page of tests/fixtures/edit-text.pdf (Chromium,
 * LibreOffice, standard Helvetica, pdfLaTeX, a /Rotate 90 page) and on the
 * encrypted samples, then saves. Writes out/text-edit/<name>.pdf plus
 * expected.json for scripts/verify_text_edit.py, which checks the result with
 * Poppler, MuPDF and qpdf (old text gone from the file, new text there, the
 * rest of the page unchanged pixel for pixel).
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
const out = join(root, 'out', 'text-edit');
mkdirSync(out, { recursive: true });

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

function open(bytes: Uint8Array) {
  const ptr = w.copyIn(bytes);
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.byteLength, '');
  if (!doc) throw new Error('cannot open');
  return { doc, close: () => (m.FPDF_CloseDocument(doc), w.free(ptr)) };
}

function save(doc: number): Uint8Array {
  const writer = m.PDFiumExt_OpenFileWriter();
  try {
    if (!m.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error('save failed');
    const size = m.PDFiumExt_GetFileWriterSize(writer);
    const ptr = w.malloc(size);
    try {
      m.PDFiumExt_GetFileWriterData(writer, ptr, size);
      return w.heap.slice(ptr, ptr + size);
    } finally {
      w.free(ptr);
    }
  } finally {
    m.PDFiumExt_CloseFileWriter(writer);
  }
}

interface Edit {
  page: number;
  from: string;
  to: string;
  /** expected font outcome */
  keep: boolean;
  /** the new text should be set in the bold fallback */
  bold?: boolean;
}

interface Expected {
  file: string;
  source: string;
  edits: (Edit & { oldBox: TextLine['box']; fontName: string })[];
}

const expected: Expected[] = [];

function run(name: string, source: string, edits: Edit[]) {
  const bytes = new Uint8Array(readFileSync(join(root, 'tests/fixtures', source)));
  const { doc, close } = open(bytes);
  const editor = new TextEditor(m, doc, fonts);
  const done: Expected['edits'] = [];
  try {
    for (const e of edits) {
      const lines = editor.lines(e.page);
      const line = lines.find((l) => l.text === e.from);
      check(`${name} p${e.page + 1}: line found “${e.from}”`, !!line, line ? '' : lines.map((l) => `“${l.text}”`).join(' | '));
      if (!line) continue;
      try {
        const r = editor.replaceLine(e.page, line.key, e.to);
        const fontOk = r.fontKept === e.keep && (e.bold === undefined || /Bold/.test(r.fontName) === e.bold);
        check(
          `${name} p${e.page + 1}: “${e.to}” ${e.keep ? 'in the original font' : 'in ezSansVN'}`,
          fontOk && r.readback === e.to,
          `font ${r.fontName}${r.fallbackReason ? ` (${r.fallbackReason})` : ''}, objects −${r.removedObjects} +${r.addedObjects}`,
        );
        done.push({ ...e, oldBox: line.box, fontName: r.fontName });
        const after = editor.lines(e.page).map((l) => l.text);
        check(`${name} p${e.page + 1}: page now lists the new line, not the old one`, after.includes(e.to) && !after.includes(e.from), after.join(' | '));
      } catch (err) {
        check(`${name} p${e.page + 1}: edit “${e.to}”`, false, String(err));
      }
    }
    const file = `${name}.pdf`;
    writeFileSync(join(out, file), save(doc));
    expected.push({ file, source, edits: done });
  } finally {
    editor.dispose();
    close();
  }
}

// What each page offers
{
  const { doc, close } = open(new Uint8Array(readFileSync(join(root, 'tests/fixtures/edit-text.pdf'))));
  const editor = new TextEditor(m, doc, fonts);
  for (let p = 0; p < 6; p++) {
    console.log(`page ${p + 1}:`);
    for (const l of editor.lines(p)) {
      console.log(`   ${l.editable ? ' ' : '×'} [${l.key}] ${l.fontName} ${l.fontSize.toFixed(1)}pt${l.bold ? ' bold' : ''}${l.italic ? ' italic' : ''} “${l.text}”`);
    }
  }
  editor.dispose();
  close();
}

run('edit-text', 'edit-text.pdf', [
  // Chromium: CID subsets
  { page: 0, from: 'Bên nhận: Phòng kỹ thuật, đại diện là bà Lê Thị Hoa.', to: 'Bên nhận: Phòng kỹ thuật, đại diện là ông Lê Văn Hòa.', keep: true },
  { page: 0, from: 'Biên bản bàn giao thiết bị', to: 'Biên bản thu hồi thiết bị', keep: false, bold: true },
  { page: 0, from: 'Ghi chú: thiết bị còn nguyên tem, chưa qua sửa chữa.', to: 'Ghi chú: thiết bị đã được kiểm tra kỹ.', keep: false, bold: false },
  { page: 0, from: 'Số lượng: 03 máy tính xách tay.', to: 'Số lượng: 02 máy tính xách tay.', keep: true },
  { page: 0, from: 'Người nhận', to: 'Người duyệt', keep: true },
  // LibreOffice: simple TrueType subsets
  { page: 1, from: 'Địa điểm: phòng họp tầng 5, tòa nhà A.', to: 'Địa điểm: phòng họp tầng 5.', keep: true },
  { page: 1, from: 'Thành phần: toàn thể nhân viên phòng kinh doanh.', to: 'Thành phần: Ban giám đốc và trưởng các phòng.', keep: false },
  // Standard Helvetica, not embedded
  { page: 2, from: 'Amount due: 1,250.00 USD', to: 'Amount due: 1,350.00 USD', keep: true },
  { page: 2, from: 'Customer: Northwind Traders', to: 'Customer: Công ty Bắc Hà', keep: false },
  // not embedded: any WinAnsi character keeps the font, even one not used on the page
  { page: 2, from: 'Payment terms: 30 days', to: 'Payment terms: 45 days (Qty: ½ × €)', keep: true },
  // pdfLaTeX: no space glyph, words placed separately
  { page: 3, from: 'Meetings will be held every second Tuesday.', to: 'Meetings will be held every second Thursday.', keep: true },
  // Page shown rotated
  { page: 4, from: 'Dòng thứ hai trên trang xoay.', to: 'Dòng thứ ba trên trang xoay.', keep: false },
]);

// Encrypted documents stay encrypted and editable (owner password only).
for (const f of ['sample-aes256-owner.pdf', 'sample-rc4-owner.pdf']) {
  run(f.replace('.pdf', '-edited'), f, [
    { page: 0, from: 'The quick brown fox jumps over the lazy dog. 0123456789', to: 'The quick brown fox jumps over the lazy cat. 0123456789', keep: true },
  ]);
}

// Lines the tool must refuse say why.
{
  const { doc, close } = open(new Uint8Array(readFileSync(join(root, 'tests/fixtures/edit-text.pdf'))));
  const editor = new TextEditor(m, doc, fonts);
  const ls = editor.lines(5);
  const get = (t: string) => ls.find((l) => l.text === t);
  const plain = get('Dòng thường có thể sửa.');
  const hidden = get('Chữ ẩn của lớp nhận dạng.');
  const form = get('Chữ nằm trong khối đồ họa.');
  check('an ordinary line is editable', !!plain?.editable);
  check('hidden text (OCR layer) is listed as not editable, with the reason', !!hidden && !hidden.editable && /chữ ẩn/i.test(hidden.reason ?? ''), hidden?.reason);
  check('text inside a Form XObject is listed as not editable, with the reason', !!form && !form.editable && /Form XObject/.test(form.reason ?? ''), form?.reason);
  let msg = '';
  try {
    editor.replaceLine(5, hidden!.key, 'x');
  } catch (e) {
    msg = e instanceof TextEditError ? e.message : `wrong error ${e}`;
  }
  check('replacing hidden text is refused', /chữ ẩn/i.test(msg), msg);
  editor.dispose();
  close();
}

// Refusals are explicit.
{
  const { doc, close } = open(new Uint8Array(readFileSync(join(root, 'tests/fixtures/edit-text.pdf'))));
  const editor = new TextEditor(m, doc, fonts);
  const line = editor.lines(0)[1];
  let msg = '';
  try {
    editor.replaceLine(0, line.key, '   ');
  } catch (e) {
    msg = e instanceof TextEditError ? e.message : `wrong error ${e}`;
  }
  check('an empty line is refused with a message', msg.includes('không có chữ'), msg);
  msg = '';
  try {
    editor.replaceLine(0, '9999', 'x');
  } catch (e) {
    msg = e instanceof TextEditError ? e.message : `wrong error ${e}`;
  }
  check('a stale line is refused with a message', msg.includes('chọn lại'), msg);
  msg = '';
  try {
    editor.replaceLine(0, line.key, 'Chữ Hán 漢字');
  } catch (e) {
    msg = e instanceof TextEditError ? e.message : `wrong error ${e}`;
  }
  check('characters no font has are refused, the line stays as it was', msg.includes('漢') && editor.lines(0).some((l) => l.text === line.text), msg);
  editor.dispose();
  close();
}

writeFileSync(join(out, 'expected.json'), JSON.stringify(expected, null, 2));
console.log(failures ? `\n${failures} failure(s)` : '\nall probe checks passed');
process.exit(failures ? 1 : 0);
