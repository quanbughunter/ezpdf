/**
 * M3 engine probe (headless, same PDFium WASM as the browser), doing what
 * the app does with pictures and page rotation:
 *  - pictures are Stamp annotations, /Name /Image, never rotated as an
 *    annotation (G10); on a page displayed rotated the pixels are turned
 *    instead (fixtures quadrants-qN.png / photo-qN.jpg)
 *  - PNG with alpha and soft alpha, JPEG
 *  - resize after creation, then move (later edits keep the picture)
 *  - delete, then re-create from the exported appearance (the G11 path)
 *  - save, finalise twice: as is, and with page rotations changed (G7)
 *
 * Writes out/m3/{raw,final,final-rotated}.pdf + expected.json for
 * scripts/verify_images.py (Poppler, MuPDF; pdf.js in the e2e run).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { PdfAnnotationName, PdfAnnotationSubtype, type PdfAnnotationObject, type PdfDocumentObject, type Rect, type Task } from '@embedpdf/models';
import { finalizeExport, EZ_MARK } from '../src/engine/vn-freetext-export';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = <T>(t: Task<T, any, any>) => new Promise<T>((res, rej) => t.wait(res, (e) => rej(new Error(JSON.stringify(e)))));
const toAB = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const fx = (n: string) => new Uint8Array(readFileSync(join(root, 'tests/fixtures', n)));

const pdfium = await init({ wasmBinary: toAB(readFileSync(join(root, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm'))) });
const engine = new PdfiumNative(pdfium);
const font = new Uint8Array(readFileSync(join(root, 'public/fonts/ezSansVN-Regular.ttf')));

const out = join(root, 'out', 'm3');
mkdirSync(out, { recursive: true });
const doc: PdfDocumentObject = await run(
  engine.openDocumentBuffer({ id: 'm3', content: toAB(fx('sample.pdf')) }, { normalizeRotation: true }),
);

type Kind = 'png' | 'jpg';
type Placed = { id: string; page: number; kind: Kind; box: Rect; rotation: number };
const placed: Placed[] = [];

/** As the app's placement: centre (cx, cy) in page space, display size w × h. */
async function place(pi: number, kind: Kind, cx: number, cy: number, w: number, h: number, id: string) {
  const page = doc.pages[pi];
  const q = (4 - page.rotation) % 4; // turn the pixels back by the page rotation
  const file = kind === 'png' ? (q ? `quadrants-q${q}.png` : 'quadrants.png') : q ? `photo-q${q}.jpg` : 'photo.jpg';
  const [pw, ph] = q % 2 ? [h, w] : [w, h];
  const anno = {
    type: PdfAnnotationSubtype.STAMP,
    id,
    pageIndex: pi,
    rect: { origin: { x: cx - pw / 2, y: cy - ph / 2 }, size: { width: pw, height: ph } },
    name: PdfAnnotationName.Image,
    flags: ['print'],
    custom: { [EZ_MARK]: 1, kind: 'image' },
  } as PdfAnnotationObject;
  await run(engine.createPageAnnotation(doc, page, anno, { data: toAB(fx(file)) } as any));
  placed.push({ id, page: pi, kind, box: { origin: { x: cx - w / 2, y: cy - h / 2 }, size: { width: w, height: h } }, rotation: q * 90 });
  return anno;
}

for (const page of doc.pages) {
  await place(page.index, 'png', 200, 420, 160, 96, `png-${page.index}`);
  await place(page.index, 'jpg', 420, 420, 120, 72, `jpg-${page.index}`);
}

// Resize (corner drag, aspect kept) then move, as the plugin sends them.
{
  const page = doc.pages[0];
  let a = await place(0, 'png', 160, 620, 120, 72, 'png-edited');
  a = { ...a, rect: { origin: a.rect.origin, size: { width: 240, height: 144 } } };
  await run(engine.updatePageAnnotation(doc, page, a));
  a = { ...a, rect: { origin: { x: a.rect.origin.x + 30, y: a.rect.origin.y + 20 }, size: a.rect.size } };
  await run(engine.updatePageAnnotation(doc, page, a, { regenerateAppearance: false }));
  placed.find((x) => x.id === 'png-edited')!.box = a.rect;
}

// Delete and bring back from the exported appearance (what undo does with ezPDF's guard, G11).
{
  const page = doc.pages[1];
  const list: PdfAnnotationObject[] = await run(engine.getPageAnnotations(doc, page));
  const a = list.find((x) => x.id === 'jpg-1')!;
  const appearance = await run(engine.exportAnnotationAppearanceAsPdf(doc, page, a));
  await run(engine.removePageAnnotation(doc, page, a));
  await run(engine.createPageAnnotation(doc, page, a, { data: appearance, mimeType: 'application/pdf' } as any));
}

const raw = new Uint8Array(await run(engine.saveAsCopy(doc)));
writeFileSync(join(out, 'raw.pdf'), raw);

const r1 = await finalizeExport(pdfium, raw, { font });
writeFileSync(join(out, 'final.pdf'), r1.bytes);
const rotatedPages = [1, 0, 2, 3];
const r2 = await finalizeExport(pdfium, raw, { font, pageRotations: Object.fromEntries(rotatedPages.map((r, i) => [i, r])) });
writeFileSync(join(out, 'final-rotated.pdf'), r2.bytes);
console.log('final', JSON.stringify(r1.report));
console.log('final-rotated', JSON.stringify(r2.report));

// Reopen both outputs with EmbedPDF: rects, name, custom data and page rotation survive.
let failures = r2.report.pagesRotated === 3 ? 0 : 1;
if (failures) console.log(`FAIL pagesRotated ${r2.report.pagesRotated} ≠ 3`);
const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
for (const [name, bytes, rots] of [
  ['final', r1.bytes, doc.pages.map((p) => p.rotation)],
  ['final-rotated', r2.bytes, rotatedPages],
] as const) {
  const d = await run(engine.openDocumentBuffer({ id: name, content: toAB(bytes) }, { normalizeRotation: true }));
  d.pages.forEach((p, i) => {
    if (p.rotation !== rots[i]) {
      failures++;
      console.log(`FAIL ${name} page ${i + 1} rotation ${p.rotation} ≠ ${rots[i]}`);
    }
  });
  for (const e of placed) {
    const list: PdfAnnotationObject[] = await run(engine.getPageAnnotations(d, d.pages[e.page]));
    const a = list.find((x) => x.id === e.id);
    const q = e.rotation / 90;
    const [w, h] = q % 2 ? [e.box.size.height, e.box.size.width] : [e.box.size.width, e.box.size.height];
    const cx = e.box.origin.x + e.box.size.width / 2, cy = e.box.origin.y + e.box.size.height / 2;
    const problems: string[] = [];
    if (!a) problems.push('missing');
    else {
      if (a.type !== PdfAnnotationSubtype.STAMP) problems.push(`type ${a.type}`);
      if ((a as { name?: number }).name !== PdfAnnotationName.Image) problems.push(`name ${(a as { name?: number }).name}`);
      const r = a.rect;
      if (!(near(r.origin.x, cx - w / 2) && near(r.origin.y, cy - h / 2) && near(r.size.width, w) && near(r.size.height, h)))
        problems.push(`rect ${JSON.stringify(r)}`);
      if (a.rotation) problems.push(`rotation ${a.rotation}`);
      if (!a.custom?.[EZ_MARK]) problems.push('ez mark lost');
    }
    if (problems.length) failures++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name.padEnd(13)} p${e.page + 1} ${e.id.padEnd(12)} ${problems.join('; ')}`);
  }
  await run(engine.closeDocument(d));
}

writeFileSync(
  join(out, 'expected.json'),
  JSON.stringify(
    {
      pages: doc.pages.map((p) => ({ w: p.size.width, h: p.size.height })),
      outputs: [
        { pdf: join(out, 'final.pdf'), rotations: doc.pages.map((p) => p.rotation), pdfjs: 'final' },
        { pdf: join(out, 'final-rotated.pdf'), rotations: rotatedPages, pdfjs: 'final-rotated' },
      ],
      placed,
    },
    null,
    2,
  ),
);
console.log(failures ? `\nM3 ENGINE PROBE: ${failures} FAILURE(S)` : '\nM3 ENGINE PROBE: PASS');
process.exit(failures ? 1 : 0);
