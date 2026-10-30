/**
 * Probe for page management (src/engine/page-ops.ts), headless, with the
 * same PDFium WASM as the app. Builds documents from tests/fixtures/pages-a
 * and pages-b, then reads them back with MuPDF (a different PDF library):
 * page order (each page's "A-n"/"B-n" mark), /Rotate, sizes, the sticky
 * note, the form field, bookmarks, and that qpdf finds the file clean.
 *
 *   npx tsx tests/page-ops-probe.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { assembleInPlace, assembleNew, openPdf, pageInfos, PageOpsError, type PlanPage } from '../src/engine/page-ops';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const toAB = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const m: WrappedPdfiumModule = await init({ wasmBinary: toAB(readFileSync(join(root, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm'))) });
m.PDFiumExt_Init();
const out = join(root, 'out', 'page-ops');
mkdirSync(out, { recursive: true });
const A = new Uint8Array(readFileSync(join(root, 'tests/fixtures/pages-a.pdf')));
const B = new Uint8Array(readFileSync(join(root, 'tests/fixtures/pages-b.pdf')));

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

interface Read {
  pages: { mark: string; rotation: number; w: number; h: number; notes: string[]; fields: string[] }[];
  toc: [number, string, number][];
}

/** MuPDF's reading of a file: page marks, /Rotate, unrotated size, notes, fields, bookmarks. */
function mupdf(file: string): Read {
  const code = `
import json, sys, pymupdf
d = pymupdf.open(sys.argv[1])
pages = []
for p in d:
    words = p.get_text().split()
    mark = next((w for w in words if len(w) == 3 and w[1] == '-'), '')
    pages.append({'mark': mark, 'rotation': p.rotation, 'w': round(p.mediabox.width), 'h': round(p.mediabox.height),
                  'notes': [a.info.get('content', '') for a in p.annots() if a.type[0] == pymupdf.PDF_ANNOT_TEXT],
                  'fields': [w.field_name for w in p.widgets()]})
print(json.dumps({'pages': pages, 'toc': d.get_toc()}))
`;
  return JSON.parse(execFileSync('python3', ['-c', code, file], { encoding: 'utf8' }));
}

const qpdfClean = (file: string) => {
  try {
    return execFileSync('qpdf', ['--check', file], { encoding: 'utf8' }).includes('No syntax or stream encoding errors');
  } catch {
    return false;
  }
};

function write(name: string, bytes: Uint8Array) {
  const f = join(out, name);
  writeFileSync(f, bytes);
  return f;
}

// ---- the source as PDFium sees it -------------------------------------------
{
  const a = openPdf(m, A);
  const info = pageInfos(m, a.doc);
  a.close();
  check(
    'page sizes come unrotated, with /Rotate apart',
    info.length === 5 && info[2].rotation === 1 && Math.round(info[2].w) === 595 && Math.round(info[2].h) === 842 && Math.round(info[4].w) === 842,
    JSON.stringify(info.map((p) => [Math.round(p.w), Math.round(p.h), p.rotation])),
  );
}

// ---- rearranging the open document in place ----------------------------------
{
  // A-4 dropped; A-3 first and upright; B-2 imported; a blank page; A-5 turned;
  // A-1, and a copy of A-1 upside down
  const plan: PlanPage[] = [
    { src: 0, page: 2, rotation: 0 },
    { src: 0, page: 1, rotation: 0 },
    { src: 1, page: 1, rotation: 0 },
    { src: -1, page: 0, rotation: 0, size: { w: 595.28, h: 841.89 } },
    { src: 0, page: 4, rotation: 1 },
    { src: 0, page: 0, rotation: 0 },
    { src: 0, page: 0, rotation: 2 },
  ];
  const t0 = performance.now();
  const bytes = assembleInPlace(m, A, [B], plan);
  const ms = performance.now() - t0;
  const f = write('in-place.pdf', bytes);
  const r = mupdf(f);
  const marks = r.pages.map((p) => p.mark).join(' ');
  check('in place: pages in the planned order', marks === 'A-3 A-2 B-2  A-5 A-1 A-1', `${marks} · ${ms.toFixed(0)} ms`);
  check('in place: rotations written as /Rotate', r.pages.map((p) => p.rotation).join(',') === '0,0,0,0,90,0,180');
  check('in place: the blank page is empty and A4', r.pages[3].mark === '' && r.pages[3].w === 595 && r.pages[3].h === 842);
  check('in place: the imported page keeps its size (Letter)', r.pages[2].w === 612 && r.pages[2].h === 792);
  check('in place: the sticky note travels with A-2', r.pages[1].notes.join() === 'Ghi chu tren A-2' && r.pages.filter((p) => p.notes.length).length === 1);
  check('in place: the deleted page’s field is gone from the pages', r.pages.every((p) => !p.fields.length));
  check('in place: bookmarks kept (document parts stay)', r.toc.length === 2, JSON.stringify(r.toc));
  check('in place: qpdf finds the file clean', qpdfClean(f));
}

// ---- keeping a form page: the field stays fillable ----------------------------
{
  const bytes = assembleInPlace(m, A, [], [
    { src: 0, page: 3, rotation: 0 },
    { src: 0, page: 0, rotation: 0 },
  ]);
  const f = write('form-first.pdf', bytes);
  const r = mupdf(f);
  check('in place: a form page moved first keeps its field', r.pages[0].mark === 'A-4' && r.pages[0].fields.join() === 'ho_ten', JSON.stringify(r.pages.map((p) => [p.mark, p.fields])));
}

// ---- a new file from some pages ------------------------------------------------
{
  const bytes = assembleNew(m, A, [B], [
    { src: 0, page: 1, rotation: 0 },
    { src: 1, page: 0, rotation: 3 },
    { src: 0, page: 2, rotation: 1 },
  ]);
  const f = write('new-file.pdf', bytes);
  const r = mupdf(f);
  check('new file: only the planned pages, in order', r.pages.map((p) => p.mark).join(' ') === 'A-2 B-1 A-3');
  check('new file: rotations', r.pages.map((p) => p.rotation).join(',') === '0,270,90');
  check('new file: the sticky note comes along', r.pages[0].notes.join() === 'Ghi chu tren A-2');
  check('new file: smaller than the whole source', bytes.byteLength < A.byteLength + B.byteLength, `${bytes.byteLength} B`);
  check('new file: qpdf finds the file clean', qpdfClean(f));
}

// ---- a split: every 2 pages ------------------------------------------------------
{
  const parts = [[0, 1], [2, 3], [4]].map((pages) => assembleNew(m, A, [], pages.map((page) => ({ src: 0, page, rotation: page === 2 ? 1 : 0 }))));
  const marks = parts.map((b, i) => mupdf(write(`split-${i + 1}.pdf`, b)).pages.map((p) => p.mark).join('+'));
  check('split into 3 files: each holds its pages', marks.join(' | ') === 'A-1+A-2 | A-3+A-4 | A-5', marks.join(' | '));
}

// ---- what is refused -------------------------------------------------------------
{
  const refuses = (plan: PlanPage[]) => {
    try {
      assembleInPlace(m, A, [], plan);
      return false;
    } catch (e) {
      return e instanceof PageOpsError;
    }
  };
  check('refused: no pages left', refuses([]));
  check('refused: a page that does not exist', refuses([{ src: 0, page: 9, rotation: 0 }]));
  check('refused: a file that was not given', refuses([{ src: 2, page: 0, rotation: 0 }]));
}

// ---- a big document: 300 pages reversed ------------------------------------------
{
  const big = new Uint8Array(readFileSync(join(root, 'tests/fixtures/long-300.pdf')));
  const n = 300;
  const t0 = performance.now();
  const bytes = assembleInPlace(m, big, [], Array.from({ length: n }, (_, i) => ({ src: 0, page: n - 1 - i, rotation: 0 })));
  const ms = performance.now() - t0;
  const back = openPdf(m, bytes);
  const count = m.FPDF_GetPageCount(back.doc);
  back.close();
  check('300 pages reversed in place', count === n && ms < 20000, `${count} pages, ${ms.toFixed(0)} ms`);
}

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'}`);
process.exit(failures ? 1 : 0);
