/// <reference lib="webworker" />
/**
 * ezPDF's own PDFium worker: a second, private PDFium instance next to
 * EmbedPDF's.
 *  - export: post-processes the bytes EmbedPDF saved (FreeText appearances
 *    with an embedded VN font, page rotations)
 *  - text editing: holds one copy of the document open while the "edit
 *    text" tool is on, lists a page's lines and replaces one line at a time
 *    (text-edit.ts), returning the new bytes
 *  - printing (browser, desktop): renders the finished PDF page by page to
 *    JPEG at print resolution, for the print-only page the app builds; the
 *    same rendering makes the page organizer's thumbnails
 *  - pages: puts a document together from pages of the open one, other PDFs
 *    and blank pages (page-ops.ts): rearranging, extracting, splitting
 * Runs off the UI thread; the document never leaves the device.
 */
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { finalizeExport, type FinalizeReport } from './vn-freetext-export';
import { TextEditor, TextEditError, type EditReport, type TextLine } from './text-edit';
import { assembleInPlace, assembleNew, pageInfos, PageOpsError, type PageInfo, type PlanPage } from './page-ops';
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

export type RenderRequest =
  | { id: number; kind: 'render-open'; bytes: ArrayBuffer; wasmUrl: string }
  /** unrotated: drawn without the page's /Rotate (the caller turns it as it likes) */
  | { id: number; kind: 'render-page'; session: number; pageIndex: number; dpi: number; unrotated?: boolean }
  | { id: number; kind: 'render-close'; session: number };

/** Put a document together from pages (page-ops.ts). */
export interface PagesRequest {
  id: number;
  kind: 'pages-build';
  bytes: ArrayBuffer;
  extras: ArrayBuffer[];
  plan: PlanPage[];
  mode: 'in-place' | 'new';
  wasmUrl: string;
  fontUrl: string;
}

export type WorkerRequest = ExportRequest | EditRequest | RenderRequest | PagesRequest;

export type PagesResponse = { id: number; ok: true; bytes: ArrayBuffer; ms: number } | { id: number; ok: false; error: string; userError?: boolean };

export type ExportResponse =
  | { id: number; ok: true; bytes: ArrayBuffer; report: FinalizeReport; ms: number }
  | { id: number; ok: false; error: string; userError?: boolean };

export type EditResponse =
  | { id: number; ok: true; session: number }
  | { id: number; ok: true; lines: TextLine[] }
  | { id: number; ok: true; bytes: ArrayBuffer; report: EditReport; ms: number }
  | { id: number; ok: true }
  | { id: number; ok: false; error: string; userError?: boolean };

export type RenderResponse =
  | { id: number; ok: true; session: number; pages: { w: number; h: number }[]; infos: PageInfo[] }
  | { id: number; ok: true; image: Blob; width: number; height: number }
  | { id: number; ok: true }
  | { id: number; ok: false; error: string; userError?: boolean };

let mod: Promise<WrappedPdfiumModule> | null = null;
const fontCache = new Map<string, Promise<Uint8Array>>();

/** The PDFium module, loaded once; a failed load is forgotten so the next request tries again. */
function module(wasmUrl: string) {
  mod ??= load(wasmUrl).catch((e) => {
    mod = null;
    throw e;
  });
  return mod;
}

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

const post = (msg: ExportResponse | EditResponse | RenderResponse | PagesResponse, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

async function handleEdit(req: EditRequest) {
  if (req.kind === 'edit-open') {
    const [m, regular, bold] = await Promise.all([module(req.wasmUrl), fontBytes(req.fontUrl), fontBytes(req.boldFontUrl)]);
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

// ---- printing ---------------------------------------------------------------

interface RenderDoc {
  m: WrappedPdfiumModule;
  doc: number;
  srcPtr: number;
}
const renderDocs = new Map<number, RenderDoc>();

/** PDFium render flags: draw annotations; write RGBA (not BGRA) for ImageData. */
const FPDF_ANNOT = 0x01;
const FPDF_REVERSE_BYTE_ORDER = 0x10;

/**
 * One page at `dpi`, as the reader sees it: annotations drawn from their
 * appearance, the page's /Rotate applied (FPDF_GetPageWidthF and the render
 * both follow it), white paper.
 */
async function renderPage(m: WrappedPdfiumModule, doc: number, pageIndex: number, dpi: number, unrotated = false) {
  const page = m.FPDF_LoadPage(doc, pageIndex);
  if (!page) throw new Error(`Không đọc được trang ${pageIndex + 1}.`);
  let img: ImageData;
  try {
    // unrotated: turned back by the page's own /Rotate (render rotation adds to it)
    const back = unrotated ? (4 - (((m.FPDFPage_GetRotation(page) % 4) + 4) % 4)) % 4 : 0;
    const sw = m.FPDF_GetPageWidthF(page), sh = m.FPDF_GetPageHeightF(page);
    const [pw, ph] = back % 2 ? [sh, sw] : [sw, sh];
    const width = Math.max(1, Math.round((pw * dpi) / 72));
    const height = Math.max(1, Math.round((ph * dpi) / 72));
    const bmp = m.FPDFBitmap_Create(width, height, 1);
    if (!bmp) throw new Error(`Không đủ bộ nhớ để dựng trang ${pageIndex + 1}.`);
    try {
      m.FPDFBitmap_FillRect(bmp, 0, 0, width, height, 0xffffffff);
      m.FPDF_RenderPageBitmap(bmp, page, 0, 0, width, height, back, FPDF_ANNOT | FPDF_REVERSE_BYTE_ORDER);
      const w = new Wasm(m);
      const ptr = m.FPDFBitmap_GetBuffer(bmp);
      const stride = m.FPDFBitmap_GetStride(bmp);
      img = new ImageData(width, height);
      const heap = w.heap;
      for (let y = 0; y < height; y++) img.data.set(heap.subarray(ptr + y * stride, ptr + y * stride + width * 4), y * width * 4);
    } finally {
      m.FPDFBitmap_Destroy(bmp);
    }
  } finally {
    m.FPDF_ClosePage(page);
  }
  // Encoding waits; the page and the bitmap are gone by then, so a
  // render-close handled meanwhile cannot free anything still in use.
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  const image = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return { image, width: img.width, height: img.height };
}

function closeRender(id: number) {
  const r = renderDocs.get(id);
  if (!r) return;
  renderDocs.delete(id);
  r.m.FPDF_CloseDocument(r.doc);
  new Wasm(r.m).free(r.srcPtr);
}

async function handleRender(req: RenderRequest) {
  if (req.kind === 'render-open') {
    const m = await module(req.wasmUrl);
    const w = new Wasm(m);
    const bytes = new Uint8Array(req.bytes);
    const srcPtr = w.copyIn(bytes);
    const doc = m.FPDF_LoadMemDocument(srcPtr, bytes.byteLength, '');
    if (!doc) {
      w.free(srcPtr);
      throw new Error(`PDFium không mở được tài liệu (mã lỗi ${m.FPDF_GetLastError()})`);
    }
    const pages: { w: number; h: number }[] = [];
    const n = m.FPDF_GetPageCount(doc);
    for (let i = 0; i < n; i++) {
      const page = m.FPDF_LoadPage(doc, i);
      pages.push(page ? { w: m.FPDF_GetPageWidthF(page), h: m.FPDF_GetPageHeightF(page) } : { w: 595.28, h: 841.89 });
      if (page) m.FPDF_ClosePage(page);
    }
    const session = nextSession++;
    renderDocs.set(session, { m, doc, srcPtr });
    return post({ id: req.id, ok: true, session, pages, infos: pageInfos(m, doc) });
  }
  if (req.kind === 'render-close') {
    closeRender(req.session);
    return post({ id: req.id, ok: true });
  }
  const r = renderDocs.get(req.session);
  if (!r) throw new Error('Bản in đã bị hủy.');
  const out = await renderPage(r.m, r.doc, req.pageIndex, req.dpi, req.unrotated);
  post({ id: req.id, ok: true, ...out });
}

async function handlePages(req: PagesRequest) {
  const m = await module(req.wasmUrl);
  const t0 = performance.now();
  let out: Uint8Array;
  if (req.mode === 'new') {
    // a file that leaves the app: finished like an export (ezPDF's text boxes
    // drawn with the embedded Vietnamese font, so every viewer shows them)
    const raw = assembleNew(m, new Uint8Array(req.bytes), req.extras.map((e) => new Uint8Array(e)), req.plan);
    out = (await finalizeExport(m, raw, { font: await fontBytes(req.fontUrl) })).bytes;
  } else out = assembleInPlace(m, new Uint8Array(req.bytes), req.extras.map((e) => new Uint8Array(e)), req.plan);
  const bytes = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  post({ id: req.id, ok: true, bytes, ms: performance.now() - t0 }, [bytes]);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.kind === 'pages-build') {
    try {
      await handlePages(req);
    } catch (err) {
      post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err), userError: err instanceof PageOpsError });
    }
    return;
  }
  if (req.kind === 'render-open' || req.kind === 'render-page' || req.kind === 'render-close') {
    try {
      await handleRender(req);
    } catch (err) {
      post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
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
    const [m, f] = await Promise.all([module(wasmUrl), fontBytes(fontUrl)]);
    const t0 = performance.now();
    const out = await finalizeExport(m, new Uint8Array(bytes), { font: f, pageRotations });
    const buf = out.bytes.buffer.slice(out.bytes.byteOffset, out.bytes.byteOffset + out.bytes.byteLength) as ArrayBuffer;
    post({ id, ok: true, bytes: buf, report: out.report, ms: performance.now() - t0 }, [buf]);
  } catch (err) {
    if (!sessions.size && !renderDocs.size) mod = null; // retry from scratch next time
    post({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
