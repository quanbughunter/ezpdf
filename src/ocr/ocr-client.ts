/**
 * OCR from the page's side: renders each page (ezPDF's PDFium worker),
 * hands its pixels to the OCR worker, relays the worker's reading requests
 * to Tesseract, then has the Word file and the searchable PDF written.
 *
 * Resolution: a scan is read at twice its own resolution up to 300 dpi, at
 * least 200 dpi (tests on scans of about 130 dpi read best at 200 to 250
 * dpi, docs/13-ocr.md); a page with no scan on it at 250 dpi.
 */
import { closeRenderSession, openRenderSession, pageScanInfo, renderPageRgba, writeTextLayer } from '@/engine/export-client';
import type { OcrTextPage } from '@/engine/ocr-pdf';
import type { PageLayout } from './model';
import type { OcrWorkerMessage, OcrWorkerRequest } from './ocr.worker';
import { readImage, warmUp } from './tesseract';
import { textPage } from './text-layer';

export type OcrInput =
  /** a PDF (the open document as it would be exported, or a file picked) */
  | { kind: 'pdf'; bytes: ArrayBuffer; base: string }
  /** pictures: one page each (a TIFF may hold several) */
  | { kind: 'pictures'; files: { name: string; bytes: Uint8Array }[]; base: string };

export interface OcrOptions {
  /** 0-based; null: every page */
  pages: number[] | null;
  word: boolean;
  pdf: boolean;
}

export interface OcrProgress {
  stage: 'prepare' | 'read' | 'write';
  done: number;
  total: number;
}

export interface OcrResult {
  base: string;
  docx?: Uint8Array;
  pdf?: Uint8Array;
  /** pages read */
  pages: number;
  /** pages that already had text: the searchable PDF leaves them as they are */
  hadText: number[];
  /** words laid into the PDF */
  words: number;
  /** what each page read, for the dialog's summary */
  layouts: PageLayout[];
}

/** a page with at least this many characters already has its text */
const HAS_TEXT = 40;

export function ocrDpi(scanDpi: number, size: { w: number; h: number }): number {
  let dpi = scanDpi >= 200 ? Math.min(scanDpi, 300) : scanDpi > 0 ? Math.min(300, Math.max(200, scanDpi * 2)) : 250;
  // a big sheet: at most about 16 million pixels
  const px = ((size.w / 72) * dpi) * ((size.h / 72) * dpi);
  if (px > 16e6) dpi = Math.floor(dpi * Math.sqrt(16e6 / px));
  return Math.max(100, Math.round(dpi));
}

const aborted = () => new DOMException('Đã dừng.', 'AbortError');

/** An error whose message is for the user as is (a picture that cannot be read). */
export class OcrUserError extends Error {}

type WithId = Extract<OcrWorkerRequest, { id: number }>;
/** a request without its id (distributes over the union) */
type Job = WithId extends infer R ? (R extends WithId ? Omit<R, 'id'> : never) : never;

class OcrWorker {
  private w = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;
  private waiting = new Map<number, { resolve: (m: OcrWorkerMessage) => void; reject: (e: Error) => void }>();

  constructor() {
    this.w.onmessage = (e: MessageEvent<OcrWorkerMessage>) => {
      const m = e.data;
      if (m.kind === 'read') {
        readImage(m.pgm, m.dpi, m.mode).then(
          (blocks) => this.post({ kind: 'read-done', rid: m.rid, blocks }),
          (err) => this.post({ kind: 'read-failed', rid: m.rid, error: err instanceof Error ? err.message : String(err) }),
        );
        return;
      }
      const p = this.waiting.get(m.id);
      if (!p) return;
      this.waiting.delete(m.id);
      if (m.kind === 'failed') p.reject(m.userError ? new OcrUserError(m.error) : new Error(m.error));
      else p.resolve(m);
    };
    this.w.onerror = (e) => this.fail(new Error(e.message || 'Bộ nhận dạng chữ gặp lỗi.'));
  }

  private post(m: OcrWorkerRequest, transfer: Transferable[] = []) {
    try {
      this.w.postMessage(m, transfer);
    } catch {
      // stopped meanwhile
    }
  }

  ask<K extends OcrWorkerMessage['kind']>(req: Job, transfer: Transferable[] = []): Promise<Extract<OcrWorkerMessage, { kind: K }>> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (m: OcrWorkerMessage) => void, reject });
      this.post({ ...req, id } as OcrWorkerRequest, transfer);
    });
  }

  fail(e: Error) {
    for (const p of this.waiting.values()) p.reject(e);
    this.waiting.clear();
  }

  stop() {
    this.fail(aborted());
    this.w.terminate();
  }
}

export async function runOcr(input: OcrInput, opts: OcrOptions, hooks: { signal?: AbortSignal; onProgress?: (p: OcrProgress) => void } = {}): Promise<OcrResult> {
  if (!opts.word && !opts.pdf) throw new OcrUserError('Chọn ít nhất một kết quả: Word hoặc PDF.');
  const { signal } = hooks;
  const worker = new OcrWorker();
  const onAbort = () => worker.stop();
  signal?.addEventListener('abort', onAbort);
  // Tesseract and its model load while the first page is drawn
  const ready = warmUp();
  ready.catch(() => {});
  let session: number | null = null;
  try {
    hooks.onProgress?.({ stage: 'prepare', done: 0, total: 0 });
    let pdf: ArrayBuffer;
    if (input.kind === 'pictures') {
      const r = await worker.ask<'pictures-done'>({ kind: 'pictures', files: input.files, title: input.base });
      pdf = r.bytes.buffer.slice(r.bytes.byteOffset, r.bytes.byteOffset + r.bytes.byteLength) as ArrayBuffer;
    } else pdf = input.bytes;
    if (signal?.aborted) throw aborted();
    const opened = await openRenderSession(pdf.slice(0));
    session = opened.session;
    const sizes = opened.pages;
    const list = opts.pages ?? sizes.map((_, i) => i);
    if (!list.length) throw new OcrUserError('Chưa chọn trang nào.');
    if (list.some((p) => p < 0 || p >= sizes.length)) throw new OcrUserError('Trang đã chọn không còn trong tài liệu.');
    await ready;
    const layouts: PageLayout[] = [];
    const textPages: OcrTextPage[] = [];
    const hadText: number[] = [];
    hooks.onProgress?.({ stage: 'read', done: 0, total: list.length });
    for (let k = 0; k < list.length; k++) {
      if (signal?.aborted) throw aborted();
      const index = list[k];
      const scan = await pageScanInfo(session, index);
      const texty = scan.chars >= HAS_TEXT;
      if (texty) hadText.push(index);
      if (texty && !opts.word) {
        hooks.onProgress?.({ stage: 'read', done: k + 1, total: list.length });
        continue;
      }
      const dpi = ocrDpi(scan.scanDpi, sizes[index]);
      const img = await renderPageRgba(session, index, dpi);
      if (signal?.aborted) throw aborted();
      const r = await worker.ask<'page-done'>(
        { kind: 'page', rgba: img.rgba.buffer as ArrayBuffer, w: img.width, h: img.height, dpi, widthPt: sizes[index].w, heightPt: sizes[index].h },
        [img.rgba.buffer as ArrayBuffer],
      );
      layouts.push(r.layout);
      if (opts.pdf && !texty) textPages.push(textPage(index, r.layout));
      hooks.onProgress?.({ stage: 'read', done: k + 1, total: list.length });
    }
    hooks.onProgress?.({ stage: 'write', done: list.length, total: list.length });
    const result: OcrResult = { base: input.base, pages: layouts.length, hadText, words: 0, layouts };
    if (opts.word) {
      if (!layouts.length) throw new OcrUserError('Các trang đã chọn đều đã có chữ, không có gì để nhận dạng.');
      const d = await worker.ask<'docx-done'>({ kind: 'docx', pages: layouts, title: input.base });
      result.docx = d.bytes;
    }
    if (signal?.aborted) throw aborted();
    if (opts.pdf) {
      const out = textPages.length ? await writeTextLayer(pdf, textPages) : { bytes: pdf, words: 0 };
      result.pdf = new Uint8Array(out.bytes);
      result.words = out.words;
    }
    if (signal?.aborted) throw aborted();
    return result;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    worker.stop();
    if (session !== null) void closeRenderSession(session);
  }
}
