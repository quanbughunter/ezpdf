/**
 * OCR end to end in Node, through the app's own steps (src/ocr/pipeline.ts):
 * PDF pages rendered by PDFium, read by tesseract.js with the bundled
 * Vietnamese model, laid out, written as Word.
 *
 *   npx tsx tests/ocr-probe.ts <file.pdf> <pages, e.g. 8,15,30> [dpi] [out-dir]
 *
 * Writes out-dir/ocr.docx and out-dir/pNNN.json (the layout without pictures).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '@embedpdf/pdfium';
import { createWorker } from 'tesseract.js';
import { ocrPage } from '../src/ocr/pipeline';
import { Wasm } from '../src/engine/wasm';
import { writeDocx } from '../src/ocr/docx';
import { pageText, type PageLayout } from '../src/ocr/model';
import { addTextLayer } from '../src/engine/ocr-pdf';
import { textPage } from '../src/ocr/text-layer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [file, pagesArg, dpiArg, outArg] = process.argv.slice(2);
const dpi = Number(dpiArg || 250);
const out = outArg || join(root, 'out/ocr/probe');
mkdirSync(out, { recursive: true });
const toAB = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const m = await init({ wasmBinary: toAB(readFileSync(join(root, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm'))) });
m.PDFiumExt_Init();
const bytes = readFileSync(file);
const wasm = new Wasm(m);
const ptr = wasm.copyIn(new Uint8Array(bytes));
const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, '');
if (!doc) throw new Error('cannot open ' + file);
const worker = await createWorker('vie', 1, { langPath: join(root, 'node_modules/@tesseract.js-data/vie/4.0.0_best_int'), cacheMethod: 'none', gzip: true });
await worker.setParameters({ tessedit_pageseg_mode: '3' as never, preserve_interword_spaces: '1' });

const pages: PageLayout[] = [];
for (const n of pagesArg.split(',').map(Number)) {
  const page = m.FPDF_LoadPage(doc, n - 1);
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
  const t0 = Date.now();
  let reads = 0;
  const layout = await ocrPage({ rgba, w, h, dpi, widthPt: wPt, heightPt: hPt }, async (pgm, d, mode) => {
    reads++;
    await worker.setParameters({ user_defined_dpi: String(d), tessedit_pageseg_mode: ({ page: '3', block: '6', line: '7' } as const)[mode] as never });
    const r = await worker.recognize(Buffer.from(pgm), {}, { blocks: true });
    return (r.data.blocks ?? []) as never;
  });
  pages.push(layout);
  const kinds = layout.blocks.reduce<Record<string, number>>((a, b) => ((a[b.kind] = (a[b.kind] ?? 0) + 1), a), {});
  console.log(`page ${n}: ${Date.now() - t0} ms (${reads} reads), angle ${layout.angle}, blocks ${JSON.stringify(kinds)}, header ${layout.header.length}, footer ${layout.footer.length}, frame ${!!layout.frame}`);
  writeFileSync(join(out, `p${String(n).padStart(3, '0')}.docx`), writeDocx([layout]));
  writeFileSync(join(out, `p${String(n).padStart(3, '0')}.json`), JSON.stringify(layout, (k, v) => (k === 'png' ? `[${v.length} bytes]` : v), 1));
}
await worker.terminate();
writeFileSync(join(out, 'ocr.docx'), writeDocx(pages, { title: 'OCR' }));
console.log('wrote', join(out, 'ocr.docx'));

// the searchable PDF: those pages copied into a new document, the words laid over them
const nums = pagesArg.split(',').map(Number);
const dest = m.FPDF_CreateNewDocument();
if (!m.FPDF_ImportPages(dest, doc, nums.join(','), 0)) throw new Error('FPDF_ImportPages failed');
const plain = save(dest);
writeFileSync(join(out, 'pages.pdf'), plain);
const report = addTextLayer(m, dest, pages.map((p, i) => textPage(i, p)), new Uint8Array(readFileSync(join(root, 'public/fonts/ezSansVN-Regular.ttf'))));
const searchable = save(dest);
m.FPDFFont_Close(report.font);
writeFileSync(join(out, 'ocr.pdf'), searchable);
writeFileSync(join(out, 'ocr.txt'), pages.map(pageText).join('\n\f\n'));
console.log('wrote', join(out, 'ocr.pdf'), report.words, 'words');

function save(d: number): Uint8Array {
  const writer = m.PDFiumExt_OpenFileWriter();
  if (!m.PDFiumExt_SaveAsCopy(d, writer)) throw new Error('save failed');
  const size = m.PDFiumExt_GetFileWriterSize(writer);
  const ptr = wasm.malloc(size);
  m.PDFiumExt_GetFileWriterData(writer, ptr, size);
  const outb = wasm.heap.slice(ptr, ptr + size);
  wasm.free(ptr);
  m.PDFiumExt_CloseFileWriter(writer);
  return outb;
}
