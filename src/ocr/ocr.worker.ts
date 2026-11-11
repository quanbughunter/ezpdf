/// <reference lib="webworker" />
/**
 * OCR's worker: the page's pixels in, its structure out (pipeline.ts), the
 * Word file written, pictures turned into a PDF. Tesseract itself runs in
 * its own worker, which the page drives (tesseract.ts): when a page needs
 * reading, this worker asks the page, the page asks Tesseract and hands the
 * answer back. Everything stays on the device.
 */
import { ocrPage } from './pipeline';
import { writeDocx } from './docx';
import { picturePages, picturesToPdf, PictureError, type PictureFile } from './images-pdf';
import type { PageLayout } from './model';
import type { TessBlock } from './tess-result';

export type OcrWorkerRequest =
  | { kind: 'page'; id: number; rgba: ArrayBuffer; w: number; h: number; dpi: number; widthPt: number; heightPt: number }
  | { kind: 'read-done'; rid: number; blocks: TessBlock[] }
  | { kind: 'read-failed'; rid: number; error: string }
  | { kind: 'docx'; id: number; pages: PageLayout[]; title: string }
  | { kind: 'pictures'; id: number; files: PictureFile[]; title: string };

export type OcrWorkerMessage =
  | { kind: 'read'; rid: number; pgm: Uint8Array; dpi: number; mode: 'page' | 'block' | 'line' }
  | { kind: 'page-done'; id: number; layout: PageLayout }
  | { kind: 'docx-done'; id: number; bytes: Uint8Array }
  | { kind: 'pictures-done'; id: number; bytes: Uint8Array; pages: number }
  | { kind: 'failed'; id: number; error: string; userError?: boolean };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: OcrWorkerMessage, transfer: Transferable[] = []) => scope.postMessage(m, transfer);

let nextRead = 1;
const reads = new Map<number, { resolve: (b: TessBlock[]) => void; reject: (e: Error) => void }>();

function read(pgm: Uint8Array, dpi: number, mode: 'page' | 'block' | 'line'): Promise<TessBlock[]> {
  const rid = nextRead++;
  return new Promise((resolve, reject) => {
    reads.set(rid, { resolve, reject });
    post({ kind: 'read', rid, pgm, dpi, mode }, [pgm.buffer as ArrayBuffer]);
  });
}

/** the pictures' PNGs, to hand over without copying */
function pngsOf(p: PageLayout): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const b of [...p.blocks, ...p.header, ...p.footer]) if (b.kind === 'picture') out.push(b.png.buffer as ArrayBuffer);
  return out;
}

scope.onmessage = async (e: MessageEvent<OcrWorkerRequest>) => {
  const req = e.data;
  if (req.kind === 'read-done' || req.kind === 'read-failed') {
    const r = reads.get(req.rid);
    reads.delete(req.rid);
    if (req.kind === 'read-done') r?.resolve(req.blocks);
    else r?.reject(new Error(req.error));
    return;
  }
  try {
    if (req.kind === 'page') {
      const layout = await ocrPage({ rgba: new Uint8ClampedArray(req.rgba), w: req.w, h: req.h, dpi: req.dpi, widthPt: req.widthPt, heightPt: req.heightPt }, read);
      post({ kind: 'page-done', id: req.id, layout }, pngsOf(layout));
    } else if (req.kind === 'docx') {
      const bytes = writeDocx(req.pages, { title: req.title });
      post({ kind: 'docx-done', id: req.id, bytes }, [bytes.buffer as ArrayBuffer]);
    } else if (req.kind === 'pictures') {
      const pages = await picturePages(req.files);
      const bytes = picturesToPdf(pages, req.title);
      post({ kind: 'pictures-done', id: req.id, bytes, pages: pages.length }, [bytes.buffer as ArrayBuffer]);
    }
  } catch (err) {
    post({ kind: 'failed', id: req.id, error: err instanceof Error ? err.message : String(err), userError: err instanceof PictureError });
  }
};
