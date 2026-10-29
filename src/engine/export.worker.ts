/// <reference lib="webworker" />
/**
 * Export worker: a second, private PDFium instance that post-processes the
 * bytes EmbedPDF saved (FreeText appearances with an embedded VN font,
 * page rotations).
 * Runs off the UI thread; the document never leaves the device.
 */
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { finalizeExport, type FinalizeReport } from './vn-freetext-export';

export interface ExportRequest {
  id: number;
  bytes: ArrayBuffer;
  wasmUrl: string;
  fontUrl: string;
  /** absolute page rotations (quarter turns) to write as /Rotate */
  pageRotations?: Record<number, number>;
}
export type ExportResponse =
  | { id: number; ok: true; bytes: ArrayBuffer; report: FinalizeReport; ms: number }
  | { id: number; ok: false; error: string };

let mod: Promise<WrappedPdfiumModule> | null = null;
let font: Promise<Uint8Array> | null = null;

async function load(wasmUrl: string) {
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error(`PDFium WASM: HTTP ${res.status}`);
  const m = await init({ wasmBinary: await res.arrayBuffer() });
  m.PDFiumExt_Init();
  return m;
}

self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  const { id, bytes, wasmUrl, fontUrl, pageRotations } = e.data;
  try {
    mod ??= load(wasmUrl);
    font ??= fetch(fontUrl).then(async (r) => {
      if (!r.ok) throw new Error(`font: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    });
    const [m, f] = await Promise.all([mod, font]);
    const t0 = performance.now();
    const out = await finalizeExport(m, new Uint8Array(bytes), { font: f, pageRotations });
    const buf = out.bytes.buffer.slice(out.bytes.byteOffset, out.bytes.byteOffset + out.bytes.byteLength) as ArrayBuffer;
    const msg: ExportResponse = { id, ok: true, bytes: buf, report: out.report, ms: performance.now() - t0 };
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, [buf]);
  } catch (err) {
    mod = null; // retry from scratch next time
    const msg: ExportResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
  }
};
