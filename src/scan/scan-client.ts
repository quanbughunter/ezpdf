import type { ScanRequest, ScanResponse } from './scan.worker';
import type { Quad } from './geometry';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: ScanResponse & { ok: true }) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<ScanResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'scan worker crashed'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

type Payload<R> = R extends unknown ? Omit<R, 'id'> : never;

function call<T>(msg: Payload<ScanRequest>): Promise<T> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: ScanResponse & { ok: true }) => void, reject });
    getWorker().postMessage({ ...msg, id });
  });
}

/** Size of the photo as shown (EXIF orientation applied) and the sheet's corners, 0–1. */
export function detectSheetIn(file: Blob) {
  return call<{ width: number; height: number; quad: Quad; found: boolean }>({ kind: 'detect', file });
}

/** The flat page as a JPEG. `quad` is 0–1 in the photo as shown. */
export function processPage(file: Blob, quad: Quad, rotation: number, enhance: boolean) {
  return call<{ jpeg: Blob; width: number; height: number; a4: boolean; ms: number }>({ kind: 'process', file, quad, rotation, enhance });
}
