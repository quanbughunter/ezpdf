import type { ExportRequest, ExportResponse } from './export.worker';
import type { FinalizeReport } from './vn-freetext-export';
import { PDFIUM_WASM_URL, VN_FONT_URL } from './config';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: FinalizedPdf) => void; reject: (e: Error) => void }>();

export interface FinalizedPdf {
  bytes: ArrayBuffer;
  report: FinalizeReport;
  ms: number;
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<ExportResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve({ bytes: e.data.bytes, report: e.data.report, ms: e.data.ms });
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'export worker crashed'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Transfers `bytes` to the export worker (the caller's buffer is detached). */
export function finalizePdf(bytes: ArrayBuffer, opts: { pageRotations?: Record<number, number> } = {}): Promise<FinalizedPdf> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const msg: ExportRequest = { id, bytes, wasmUrl: PDFIUM_WASM_URL, fontUrl: VN_FONT_URL, pageRotations: opts.pageRotations };
    getWorker().postMessage(msg, [bytes]);
  });
}
