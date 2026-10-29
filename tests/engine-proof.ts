/**
 * Engine proof (headless, same PDFium WASM as the browser), per fixture:
 *   open (normal, /Rotate 90, CropBox offset, /Rotate 270 pages)
 *   → FreeText tiếng Việt + Highlight on real text rects + PNG signature stamp
 *   → EmbedPDF saveAsCopy (raw) → ezPDF finalizeExport (embedded VN font)
 *   → reopen with EmbedPDF and compare every annotation against what was written.
 * Fixtures: plain, owner-password AES-256, owner-password RC4-128.
 * Writes out/<fixture>/{raw,final}.pdf + expected.json for scripts/verify_export.py.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  FontCharset,
  PdfAnnotationSubtype,
  PdfStandardFont,
  PdfTextAlignment,
  PdfVerticalAlignment,
  type PdfAnnotationObject,
  type PdfDocumentObject,
  type Rect,
  type Task,
} from '@embedpdf/models';
import { finalizeExport, EZ_MARK } from '../src/engine/vn-freetext-export';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = <T>(t: Task<T, any, any>) => new Promise<T>((res, rej) => t.wait(res, (e) => rej(new Error(JSON.stringify(e)))));
const toAB = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const fontBytes = new Uint8Array(readFileSync(join(root, 'public/fonts/ezSansVN-Regular.ttf')));
const pdfium = await init({ wasmBinary: toAB(readFileSync(join(root, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm'))) });
const engine = new PdfiumNative(pdfium, {
  fontFallback: {
    fonts: { [FontCharset.VIETNAMESE]: 'ezSansVN-Regular.ttf' },
    defaultFont: 'ezSansVN-Regular.ttf',
    fontLoader: (p) => {
      try {
        return new Uint8Array(readFileSync(join(root, 'public/fonts', p)));
      } catch {
        return null;
      }
    },
  },
});

const VI_TEXT = 'Xin chào! Tiếng Việt có dấu: ắ ằ ẳ ẵ ặ, ơ ư đ, Ư Ơ Đ. Ghi chú ở trang này — Nguyễn Văn Ấn';
const SEARCH = 'Cộng hòa xã hội chủ nghĩa Việt Nam';
const sig = new Uint8Array(readFileSync(join(root, 'tests/fixtures/signature.png')));
type Expect = { page: number; id: string; type: number; contents?: string; rect: Rect; rotation?: number };

async function proveFixture(file: string): Promise<number> {
  const stem = basename(file, '.pdf');
  const out = join(root, 'out', stem);
  mkdirSync(out, { recursive: true });
  console.log(`\n=== ${stem}`);
  const doc: PdfDocumentObject = await run(
    engine.openDocumentBuffer({ id: stem, content: toAB(readFileSync(file)) }, { normalizeRotation: true }),
  );
  const expected: Expect[] = [];

  for (const page of doc.pages) {
    const pi = page.index;
    // 1) Highlight anchored to real text (search hit rects from PDFium's text layer)
    const hits = await run(engine.searchInPage(doc, page, SEARCH, 0));
    if (!hits.length) throw new Error(`search miss on page ${pi + 1}`);
    const rects = hits[0].rects;
    const b = rects.reduce(
      (a, r) => ({
        x0: Math.min(a.x0, r.origin.x),
        y0: Math.min(a.y0, r.origin.y),
        x1: Math.max(a.x1, r.origin.x + r.size.width),
        y1: Math.max(a.y1, r.origin.y + r.size.height),
      }),
      { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
    );
    const hl = {
      type: PdfAnnotationSubtype.HIGHLIGHT, id: `hl-${pi}`, pageIndex: pi,
      rect: { origin: { x: b.x0, y: b.y0 }, size: { width: b.x1 - b.x0, height: b.y1 - b.y0 } },
      segmentRects: rects, strokeColor: '#FFD43B', opacity: 0.6, contents: 'Đoạn cần chú ý',
      custom: { [EZ_MARK]: 1 },
    } as PdfAnnotationObject;
    await run(engine.createPageAnnotation(doc, page, hl));
    expected.push({ page: pi, id: hl.id, type: hl.type, contents: hl.contents, rect: hl.rect });

    // 2) FreeText; on /Rotate 90|270 counter-rotated like EmbedPDF's insertUpright
    const box = { origin: { x: 72, y: 230 }, size: { width: 300, height: 60 } };
    const rotation = page.rotation === 1 ? 270 : page.rotation === 3 ? 90 : 0;
    const cx = box.origin.x + box.size.width / 2, cy = box.origin.y + box.size.height / 2;
    const aabb = rotation % 180
      ? { origin: { x: cx - box.size.height / 2, y: cy - box.size.width / 2 }, size: { width: box.size.height, height: box.size.width } }
      : box;
    const ft = {
      type: PdfAnnotationSubtype.FREETEXT, id: `ft-${pi}`, pageIndex: pi,
      rect: aabb, ...(rotation ? { rotation, unrotatedRect: box } : {}),
      contents: VI_TEXT, fontFamily: PdfStandardFont.Helvetica, fontSize: 13, fontColor: '#B42318',
      textAlign: PdfTextAlignment.Left, verticalAlign: PdfVerticalAlignment.Top, opacity: 1,
      color: pi === 2 ? '#FFF8D6' : 'transparent', custom: { [EZ_MARK]: 1 },
    } as PdfAnnotationObject;
    await run(engine.createPageAnnotation(doc, page, ft));
    expected.push({ page: pi, id: ft.id, type: ft.type, contents: VI_TEXT, rect: aabb, rotation });

    // 3) Signature image as Stamp (PNG with alpha)
    const st = {
      type: PdfAnnotationSubtype.STAMP, id: `sig-${pi}`, pageIndex: pi,
      rect: { origin: { x: 330, y: 300 }, size: { width: 180, height: 60 } },
      contents: 'Chữ ký', custom: { [EZ_MARK]: 1 },
    } as PdfAnnotationObject;
    await run(engine.createPageAnnotation(doc, page, st, { data: toAB(sig) } as any));
    expected.push({ page: pi, id: st.id, type: st.type, contents: 'Chữ ký', rect: st.rect });
  }

  const raw = new Uint8Array(await run(engine.saveAsCopy(doc)));
  writeFileSync(join(out, 'raw.pdf'), raw);
  await run(engine.closeDocument(doc));

  const t0 = performance.now();
  const { bytes, report } = await finalizeExport(pdfium, raw, { font: fontBytes });
  const ms = performance.now() - t0;
  writeFileSync(join(out, 'final.pdf'), bytes);
  console.log('finalize', JSON.stringify(report), `${ms.toFixed(1)} ms`, `raw ${raw.byteLength} B → final ${bytes.byteLength} B`);

  const doc2 = await run(engine.openDocumentBuffer({ id: `${stem}-final`, content: toAB(bytes) }, { normalizeRotation: true }));
  let failures = report.rewritten === 4 ? 0 : 1;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
  for (const e of expected) {
    const annots: PdfAnnotationObject[] = await run(engine.getPageAnnotations(doc2, doc2.pages[e.page]));
    const a = annots.find((x) => x.id === e.id);
    const problems: string[] = [];
    if (!a) problems.push('missing');
    else {
      if (a.type !== e.type) problems.push(`type ${a.type}≠${e.type}`);
      if (e.contents !== undefined && a.contents !== e.contents) problems.push(`contents ${JSON.stringify(a.contents)}`);
      const r = a.rect, x = e.rect;
      if (!(near(r.origin.x, x.origin.x) && near(r.origin.y, x.origin.y) && near(r.size.width, x.size.width) && near(r.size.height, x.size.height)))
        problems.push(`rect ${JSON.stringify(r)} ≠ ${JSON.stringify(x)}`);
      if (e.rotation && Math.round(a.rotation ?? 0) !== e.rotation) problems.push(`rotation ${a.rotation}≠${e.rotation}`);
      if (!a.custom?.[EZ_MARK]) problems.push('ez mark lost');
    }
    if (problems.length) failures++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} p${e.page + 1} ${e.id.padEnd(6)} ${problems.join('; ')}`);
  }
  await run(engine.closeDocument(doc2));
  writeFileSync(
    join(out, 'expected.json'),
    JSON.stringify({ text: VI_TEXT, search: SEARCH, expected, pages: doc.pages.map((p) => ({ w: p.size.width, h: p.size.height, rotation: p.rotation })) }, null, 2),
  );
  console.log(failures ? `${failures} FAILURE(S)` : 'all annotations round-trip');
  return failures;
}

let total = 0;
for (const f of ['sample.pdf', 'sample-aes256-owner.pdf', 'sample-rc4-owner.pdf']) {
  total += await proveFixture(join(root, 'tests/fixtures', f));
}
console.log(total ? `\nENGINE PROOF: ${total} FAILURE(S)` : '\nENGINE PROOF: PASS');
process.exit(total ? 1 : 0);
