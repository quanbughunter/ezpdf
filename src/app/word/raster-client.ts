/**
 * The page's side of the picture worker (word/raster.worker.ts): one
 * picture at a time; a picture that takes longer than `timeoutMs` stops
 * the worker (a new one takes the next picture) and shows as a chip.
 * `dispose` (the Word screen closed, or the file is open) stops the worker
 * and answers every picture still asked with null at once.
 */
import type { RasterRequest, RasterResponse } from '@/word/raster.worker';

export function makeRasterizer(timeoutMs = 12000) {
  let worker: Worker | null = null;
  let seq = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;
  let current: ((png: null) => void) | null = null;
  const stop = (w: Worker) => {
    w.terminate();
    if (worker === w) worker = null;
  };
  const one = (bytes: Uint8Array, side: number) =>
    new Promise<Uint8Array | null>((resolve) => {
      if (disposed) {
        resolve(null);
        return;
      }
      let w: Worker;
      try {
        w = worker ??= new Worker(new URL('../../word/raster.worker.ts', import.meta.url), { type: 'module' });
      } catch {
        resolve(null);
        return;
      }
      const id = ++seq;
      const done = (png: Uint8Array | null) => {
        clearTimeout(timer);
        w.onmessage = w.onerror = w.onmessageerror = null;
        current = null;
        resolve(png);
      };
      current = done;
      const timer = setTimeout(() => (stop(w), done(null)), timeoutMs);
      w.onmessage = (e: MessageEvent<RasterResponse>) => e.data.id === id && done(e.data.png);
      w.onerror = (e) => {
        e.preventDefault();
        stop(w);
        done(null);
      };
      w.onmessageerror = () => (stop(w), done(null));
      const req: RasterRequest = { id, bytes, side };
      w.postMessage(req); // a copy: the bytes stay in the document
    });
  return {
    rasterize(bytes: Uint8Array, side: number): Promise<Uint8Array | null> {
      if (disposed) return Promise.resolve(null);
      const p = queue.then(() => one(bytes, side));
      queue = p.catch(() => null);
      return p;
    },
    dispose() {
      disposed = true;
      if (worker) stop(worker);
      current?.(null);
    },
  };
}
