/// <reference lib="webworker" />
/**
 * ezPDF's own PDFium worker: a second, private PDFium instance next to
 * EmbedPDF's.
 *  - export: post-processes the bytes EmbedPDF saved (FreeText appearances
 *    with an embedded VN font, page rotations)
 *  - text editing: holds one copy of the document open while the "edit
 *    text" tool is on, lists a page's lines and replaces one line at a time
 *    (text-edit.ts), returning the new bytes
 * Runs off the UI thread; the document never leaves the device.
 */
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { finalizeExport, type FinalizeReport } from './vn-freetext-export';
import { TextEditor, TextEditError, type EditReport, type TextLine } from './text-edit';
import { Wasm } from './wasm';

export interface ExportRequest {
  id: number;
  kind?: 'export';
  bytes: ArrayBuffer;
  wasmUrl: string;
  fontUrl: string;
  /** absolute page rotations (quarter turns) to write as /Rotate */
  pageRotations?: Record<number, number>;
}

export type EditRequest =
  | { id: number; kind: 'edit-open'; bytes: ArrayBuffer; wasmUrl: string; fontUrl: string; boldFontUrl: string }
  | { id: number; kind: 'edit-lines'; session: number; pageIndex: number }
  | { id: number; kind: 'edit-replace'; session: number; pageIndex: number; key: string; text: string }
  | { id: number; kind: 'edit-close'; session: number };

export type WorkerRequest = ExportRequest | EditRequest;

export type ExportResponse =
  | { id: number; ok: true; bytes: ArrayBuffer; report: FinalizeReport; ms: number }
  | { id: number; ok: false; error: string; userError?: boolean };

export type EditResponse =
  | { id: number; ok: true; session: number }
  | { id: number; ok: true; lines: TextLine[] }
  | { id: number; ok: true; bytes: ArrayBuffer; report: EditReport; ms: number }
  | { id: number; ok: true }
  | { id: number; ok: false; error: string; userError?: boolean };

let mod: Promise<WrappedPdfiumModule> | null = null;
const fontCache = new Map<string, Promise<Uint8Array>>();

async function load(wasmUrl: string) {
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error(`PDFium WASM: HTTP ${res.status}`);
  const m = await init({ wasmBinary: await res.arrayBuffer() });
  m.PDFiumExt_Init();
  return m;
}

function fontBytes(url: string) {
  let f = fontCache.get(url);
  if (!f) {
    f = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`font: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    });
    f.catch(() => fontCache.delete(url));
    fontCache.set(url, f);
  }
  return f;
}

interface Session {
  m: WrappedPdfiumModule;
  doc: number;
  srcPtr: number;
  editor: TextEditor;
}
const sessions = new Map<number, Session>();
let nextSession = 1;

function save(m: WrappedPdfiumModule, doc: number): ArrayBuffer {
  const w = new Wasm(m);
  const writer = m.PDFiumExt_OpenFileWriter();
  try {
    if (!m.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error('PDFiumExt_SaveAsCopy failed');
    const size = m.PDFiumExt_GetFileWriterSize(writer);
    const ptr = w.malloc(size);
    try {
      m.PDFiumExt_GetFileWriterData(writer, ptr, size);
      const out = new ArrayBuffer(size);
      new Uint8Array(out).set(w.heap.subarray(ptr, ptr + size));
      return out;
    } finally {
      w.free(ptr);
    }
  } finally {
    m.PDFiumExt_CloseFileWriter(writer);
  }
}

function closeSession(id: number) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  s.editor.dispose();
  s.m.FPDF_CloseDocument(s.doc);
  new Wasm(s.m).free(s.srcPtr);
}

const post = (msg: ExportResponse | EditResponse, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

async function handleEdit(req: EditRequest) {
  if (req.kind === 'edit-open') {
    mod ??= load(req.wasmUrl);
    const [m, regular, bold] = await Promise.all([mod, fontBytes(req.fontUrl), fontBytes(req.boldFontUrl)]);
    const w = new Wasm(m);
    const bytes = new Uint8Array(req.bytes);
    const srcPtr = w.copyIn(bytes);
    const doc = m.FPDF_LoadMemDocument(srcPtr, bytes.byteLength, '');
    if (!doc) {
      w.free(srcPtr);
      throw new Error(`PDFium không mở được tài liệu (mã lỗi ${m.FPDF_GetLastError()})`);
    }
    const session = nextSession++;
    sessions.set(session, { m, doc, srcPtr, editor: new TextEditor(m, doc, { regular, bold }) });
    return post({ id: req.id, ok: true, session });
  }
  if (req.kind === 'edit-close') {
    closeSession(req.session);
    return post({ id: req.id, ok: true });
  }
  const s = sessions.get(req.session);
  if (!s) throw new TextEditError('Phiên sửa chữ đã đóng, hãy chọn lại dòng.');
  if (req.kind === 'edit-lines') return post({ id: req.id, ok: true, lines: s.editor.lines(req.pageIndex) });
  const t0 = performance.now();
  const report = s.editor.replaceLine(req.pageIndex, req.key, req.text);
  const bytes = save(s.m, s.doc);
  post({ id: req.id, ok: true, bytes, report, ms: performance.now() - t0 }, [bytes]);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.kind !== undefined && req.kind !== 'export') {
    try {
      await handleEdit(req as EditRequest);
    } catch (err) {
      post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err), userError: err instanceof TextEditError });
    }
    return;
  }
  const { id, bytes, wasmUrl, fontUrl, pageRotations } = req as ExportRequest;
  try {
    mod ??= load(wasmUrl);
    const [m, f] = await Promise.all([mod, fontBytes(fontUrl)]);
    const t0 = performance.now();
    const out = await finalizeExport(m, new Uint8Array(bytes), { font: f, pageRotations });
    const buf = out.bytes.buffer.slice(out.bytes.byteOffset, out.bytes.byteOffset + out.bytes.byteLength) as ArrayBuffer;
    post({ id, ok: true, bytes: buf, report: out.report, ms: performance.now() - t0 }, [buf]);
  } catch (err) {
    if (!sessions.size) mod = null; // retry from scratch next time
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
