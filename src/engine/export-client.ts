import type { EditRequest, EditResponse, ExportRequest, ExportResponse, RenderRequest, RenderResponse } from './export.worker';
import type { FinalizeReport } from './vn-freetext-export';
import type { EditReport, TextLine } from './text-edit';
import { PDFIUM_WASM_URL, VN_FONT_URL, VN_BOLD_FONT_URL } from './config';

type Response = ExportResponse | EditResponse | RenderResponse;
type Request = ExportRequest | EditRequest | RenderRequest;

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

/** Opens a copy for rendering (the caller's buffer is detached); page sizes in points, /Rotate applied. */
export async function openRenderSession(bytes: ArrayBuffer) {
  const r = await call<{ id: number; ok: true; session: number; pages: { w: number; h: number }[] }>(
    { kind: 'render-open', bytes, wasmUrl: PDFIUM_WASM_URL },
    [bytes],
  );
  return { session: r.session, pages: r.pages };
}

export async function renderPageImage(session: number, pageIndex: number, dpi: number) {
  const r = await call<{ id: number; ok: true; image: Blob; width: number; height: number }>({ kind: 'render-page', session, pageIndex, dpi });
  return { image: r.image, width: r.width, height: r.height };
}

export function closeRenderSession(session: number): Promise<unknown> {
  return call({ kind: 'render-close', session }).catch(() => undefined);
}
