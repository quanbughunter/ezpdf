import type { EditRequest, EditResponse, ExportRequest, ExportResponse, OcrPdfRequest, OcrPdfResponse, PageEncoding, PagesRequest, PagesResponse, RenderRequest, RenderResponse } from './export.worker';
import type { OcrTextPage, PageScan } from './ocr-pdf';
import type { TiffPage } from './tiff-write';
import type { PageInfo, PlanPage } from './page-ops';
import type { FinalizeReport } from './vn-freetext-export';
import type { EditReport, TextLine } from './text-edit';
import { PDFIUM_WASM_URL, VN_FONT_URL, VN_BOLD_FONT_URL } from './config';

type Response = ExportResponse | EditResponse | RenderResponse | PagesResponse | OcrPdfResponse;
type Request = ExportRequest | EditRequest | RenderRequest | PagesRequest | OcrPdfRequest;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: Response & { ok: true }) => void; reject: (e: Error) => void }>();

/** An error whose message is meant for the user as is (TextEditError in the worker). */
export class UserFacingError extends Error {}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<Response>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data as Response & { ok: true });
    else p.reject(e.data.userError ? new UserFacingError(e.data.error) : new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'PDFium worker crashed'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

type Payload<R> = R extends unknown ? Omit<R, 'id'> : never;

function call<T extends Response & { ok: true }>(msg: Payload<Request>, transfer: Transferable[] = []): Promise<T> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: Response & { ok: true }) => void, reject });
    getWorker().postMessage({ ...msg, id } as Request, transfer);
  });
}

export interface FinalizedPdf {
  bytes: ArrayBuffer;
  report: FinalizeReport;
  ms: number;
}

/** Transfers `bytes` to the export worker (the caller's buffer is detached). */
export async function finalizePdf(bytes: ArrayBuffer, opts: { pageRotations?: Record<number, number> } = {}): Promise<FinalizedPdf> {
  const r = await call<{ id: number; ok: true; bytes: ArrayBuffer; report: FinalizeReport; ms: number }>(
    { kind: 'export', bytes, wasmUrl: PDFIUM_WASM_URL, fontUrl: VN_FONT_URL, pageRotations: opts.pageRotations },
    [bytes],
  );
  return { bytes: r.bytes, report: r.report, ms: r.ms };
}

// ---- editing existing text --------------------------------------------------

/** Opens a copy of the document in the worker (the caller's buffer is detached). */
export async function openTextEditSession(bytes: ArrayBuffer): Promise<number> {
  const r = await call<{ id: number; ok: true; session: number }>(
    { kind: 'edit-open', bytes, wasmUrl: PDFIUM_WASM_URL, fontUrl: VN_FONT_URL, boldFontUrl: VN_BOLD_FONT_URL },
    [bytes],
  );
  return r.session;
}

export async function textLines(session: number, pageIndex: number): Promise<TextLine[]> {
  const r = await call<{ id: number; ok: true; lines: TextLine[] }>({ kind: 'edit-lines', session, pageIndex });
  return r.lines;
}

/** Replaces one line; returns the whole document after the change. */
export async function replaceTextLine(session: number, pageIndex: number, key: string, text: string) {
  return call<{ id: number; ok: true; bytes: ArrayBuffer; report: EditReport; ms: number }>({ kind: 'edit-replace', session, pageIndex, key, text });
}

export function closeTextEditSession(session: number): Promise<unknown> {
  return call({ kind: 'edit-close', session }).catch(() => undefined);
}

// ---- printing ---------------------------------------------------------------

/**
 * Opens a copy for rendering (the caller's buffer is detached). pages: sizes
 * in points with /Rotate applied; infos: unrotated sizes and each /Rotate.
 */
export async function openRenderSession(bytes: ArrayBuffer) {
  const r = await call<{ id: number; ok: true; session: number; pages: { w: number; h: number }[]; infos: PageInfo[] }>(
    { kind: 'render-open', bytes, wasmUrl: PDFIUM_WASM_URL },
    [bytes],
  );
  return { session: r.session, pages: r.pages, infos: r.infos };
}

/** A page as JPEG; unrotated: without its /Rotate. */
export async function renderPageImage(session: number, pageIndex: number, dpi: number, unrotated = false) {
  const r = await call<{ id: number; ok: true; image: Blob; width: number; height: number }>({ kind: 'render-page', session, pageIndex, dpi, unrotated });
  return { image: r.image, width: r.width, height: r.height };
}

/**
 * A page encoded for Xuất thành ảnh: an image file (PNG, JPEG, WebP, with
 * the resolution written in PNG and JPEG), or a TIFF page to put in a file
 * with tiffFile().
 */
export async function renderPageEncoded(session: number, pageIndex: number, dpi: number, encode: PageEncoding) {
  const r = await call<{ id: number; ok: true; image?: Blob; tiff?: TiffPage; width: number; height: number }>({ kind: 'render-page', session, pageIndex, dpi, encode });
  return { image: r.image, tiff: r.tiff, width: r.width, height: r.height };
}

/** A page's pixels (RGBA) at `dpi`, as the reader sees it: for OCR. */
export async function renderPageRgba(session: number, pageIndex: number, dpi: number) {
  const r = await call<{ id: number; ok: true; rgba: ArrayBuffer; width: number; height: number }>({ kind: 'render-page', session, pageIndex, dpi, encode: { format: 'rgba' } });
  return { rgba: new Uint8ClampedArray(r.rgba), width: r.width, height: r.height };
}

/** What a page holds for OCR: text already, the resolution of its scan. */
export async function pageScanInfo(session: number, pageIndex: number): Promise<PageScan> {
  const r = await call<{ id: number; ok: true; scan: PageScan }>({ kind: 'render-scan', session, pageIndex });
  return r.scan;
}

/** OCR's searchable PDF: `bytes` with the words laid over their pages as invisible text (a copy is sent). */
export async function writeTextLayer(bytes: ArrayBuffer, pages: OcrTextPage[]) {
  const copy = bytes.slice(0);
  const r = await call<{ id: number; ok: true; bytes: ArrayBuffer; words: number }>({ kind: 'ocr-pdf', bytes: copy, pages, wasmUrl: PDFIUM_WASM_URL, fontUrl: VN_FONT_URL }, [copy]);
  return { bytes: r.bytes, words: r.words };
}

export function closeRenderSession(session: number): Promise<unknown> {
  return call({ kind: 'render-close', session }).catch(() => undefined);
}

// ---- pages ------------------------------------------------------------------

/**
 * A document put together from pages (page-ops.ts). `base` is the open
 * document (src 0), `extras` the other PDFs (src 1…); copies are sent, the
 * caller keeps its buffers. in-place: the open document rearranged; new: a
 * file with only the planned pages, finished like an export.
 */
export async function buildPages(base: ArrayBuffer, extras: ArrayBuffer[], plan: PlanPage[], mode: 'in-place' | 'new') {
  const bytes = base.slice(0);
  const copies = extras.map((e) => e.slice(0));
  const r = await call<{ id: number; ok: true; bytes: ArrayBuffer; ms: number }>(
    { kind: 'pages-build', bytes, extras: copies, plan, mode, wasmUrl: PDFIUM_WASM_URL, fontUrl: VN_FONT_URL },
    [bytes, ...copies],
  );
  return { bytes: r.bytes, ms: r.ms };
}
