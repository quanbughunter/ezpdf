/**
 * Putting a document together from pages: of the open document, of other
 * PDFs, and blank ones, in any order, each with its own rotation. One plan
 * describes the result page by page; two ways to build it:
 *
 *  - in place (rearranging the open document): the open document itself is
 *    edited. Pages it no longer has are deleted (FPDFPage_Delete), pages
 *    from elsewhere are imported (FPDF_ImportPagesByIndex), blank pages are
 *    created (FPDFPage_New), then everything is moved into the planned order
 *    (FPDF_MovePages). The document's own parts stay: form fields
 *    (AcroForm), bookmarks, metadata, and each page keeps its annotations.
 *  - as a new file (extracting, splitting): a new document with the planned
 *    pages imported into it, so the file holds only those pages. Form
 *    fields keep their look but are no longer fillable there.
 *
 * Rotation is written as each page's /Rotate (absolute quarter turns), the
 * same way the export writes it.
 */
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { Wasm } from './wasm';

/** One page of the result. */
export interface PlanPage {
  /** 0: the open document; 1, 2…: the other PDFs, in the order given; -1: a blank page */
  src: number;
  /** page index in that source (ignored for a blank page) */
  page: number;
  /** absolute quarter turns (0–3), written as /Rotate */
  rotation: number;
  /** a blank page's size in points */
  size?: { w: number; h: number };
}

export interface PageInfo {
  /** size in points without the page's rotation */
  w: number;
  h: number;
  /** the page's /Rotate, quarter turns */
  rotation: number;
}

export class PageOpsError extends Error {}

const quarter = (r: number) => ((Math.round(r) % 4) + 4) % 4;

interface Opened {
  doc: number;
  close(): void;
}

export function openPdf(m: WrappedPdfiumModule, bytes: Uint8Array, what = 'tài liệu'): Opened {
  const w = new Wasm(m);
  const ptr = w.copyIn(bytes);
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.byteLength, '');
  if (!doc) {
    w.free(ptr);
    const code = m.FPDF_GetLastError();
    throw new PageOpsError(code === 4 ? `Không mở được ${what}: tệp có mật khẩu.` : `Không mở được ${what} (PDFium mã lỗi ${code}).`);
  }
  return {
    doc,
    close: () => {
      m.FPDF_CloseDocument(doc);
      w.free(ptr);
    },
  };
}

export function savePdf(m: WrappedPdfiumModule, doc: number): Uint8Array {
  const w = new Wasm(m);
  const writer = m.PDFiumExt_OpenFileWriter();
  try {
    if (!m.PDFiumExt_SaveAsCopy(doc, writer)) throw new PageOpsError('Không ghi được tài liệu.');
    const size = m.PDFiumExt_GetFileWriterSize(writer);
    const ptr = w.malloc(size);
    try {
      m.PDFiumExt_GetFileWriterData(writer, ptr, size);
      return w.heap.slice(ptr, ptr + size);
    } finally {
      w.free(ptr);
    }
  } finally {
    m.PDFiumExt_CloseFileWriter(writer);
  }
}

/** Each page's size (unrotated) and /Rotate. */
export function pageInfos(m: WrappedPdfiumModule, doc: number): PageInfo[] {
  const out: PageInfo[] = [];
  const n = m.FPDF_GetPageCount(doc);
  for (let i = 0; i < n; i++) {
    const page = m.FPDF_LoadPage(doc, i);
    if (!page) {
      out.push({ w: 595.28, h: 841.89, rotation: 0 });
      continue;
    }
    try {
      const rotation = quarter(m.FPDFPage_GetRotation(page));
      // PDFium reports the size as shown, with /Rotate applied
      const sw = m.FPDF_GetPageWidthF(page), sh = m.FPDF_GetPageHeightF(page);
      out.push(rotation % 2 ? { w: sh, h: sw, rotation } : { w: sw, h: sh, rotation });
    } finally {
      m.FPDF_ClosePage(page);
    }
  }
  return out;
}

function importOne(m: WrappedPdfiumModule, dest: number, src: number, pageIndex: number, at: number) {
  const w = new Wasm(m);
  const ptr = w.malloc(4);
  try {
    m.pdfium.setValue(ptr, pageIndex, 'i32');
    if (!m.FPDF_ImportPagesByIndex(dest, src, ptr, 1, at)) throw new PageOpsError(`Không chép được trang ${pageIndex + 1}.`);
  } finally {
    w.free(ptr);
  }
}

function moveOne(m: WrappedPdfiumModule, doc: number, from: number, to: number) {
  const w = new Wasm(m);
  const ptr = w.malloc(4);
  try {
    m.pdfium.setValue(ptr, from, 'i32');
    if (!m.FPDF_MovePages(doc, ptr, 1, to)) throw new PageOpsError('Không đổi được thứ tự trang.');
  } finally {
    w.free(ptr);
  }
}

function addBlank(m: WrappedPdfiumModule, doc: number, at: number, size: { w: number; h: number }) {
  const page = m.FPDFPage_New(doc, at, size.w, size.h);
  if (!page) throw new PageOpsError('Không tạo được trang trắng.');
  m.FPDF_ClosePage(page);
}

function setRotations(m: WrappedPdfiumModule, doc: number, plan: PlanPage[]) {
  plan.forEach((p, i) => {
    const page = m.FPDF_LoadPage(doc, i);
    if (!page) throw new PageOpsError(`Không đọc được trang ${i + 1} sau khi sắp xếp.`);
    try {
      const want = quarter(p.rotation);
      if (quarter(m.FPDFPage_GetRotation(page)) !== want) m.FPDFPage_SetRotation(page, want);
    } finally {
      m.FPDF_ClosePage(page);
    }
  });
}

const A4 = { w: 595.28, h: 841.89 };

function checkPlan(plan: PlanPage[], counts: number[]) {
  if (!plan.length) throw new PageOpsError('Tài liệu phải còn ít nhất một trang.');
  for (const p of plan) {
    if (p.src === -1) continue;
    if (!(p.src >= 0 && p.src < counts.length)) throw new PageOpsError('Kế hoạch trang trỏ tới một tệp không có.');
    if (!(p.page >= 0 && p.page < counts[p.src])) throw new PageOpsError(`Trang ${p.page + 1} không có trong tệp.`);
  }
}

/**
 * The open document (`base`) rearranged by `plan`; `extras` are the other
 * PDFs (src 1, 2…). Returns the new bytes.
 */
export function assembleInPlace(m: WrappedPdfiumModule, base: Uint8Array, extras: Uint8Array[], plan: PlanPage[]): Uint8Array {
  const dest = openPdf(m, base);
  const others: Opened[] = [];
  let baseCopy: Opened | null = null;
  try {
    for (const [i, e] of extras.entries()) others.push(openPdf(m, e, `tệp thứ ${i + 1}`));
    const counts = [m.FPDF_GetPageCount(dest.doc), ...others.map((o) => m.FPDF_GetPageCount(o.doc))];
    checkPlan(plan, counts);
    // The first use of a page of the open document is that page itself; a
    // second use is a copy, imported from a second copy of the document.
    const used = new Set<number>();
    const label = plan.map((p, k) => {
      if (p.src === 0 && !used.has(p.page)) {
        used.add(p.page);
        return `o${p.page}`;
      }
      return `n${k}`;
    });
    // 1. pages the result no longer has
    for (let i = counts[0] - 1; i >= 0; i--) if (!used.has(i)) m.FPDFPage_Delete(dest.doc, i);
    const order: string[] = [];
    for (let i = 0; i < counts[0]; i++) if (used.has(i)) order.push(`o${i}`);
    // 2. pages from elsewhere, and blank ones, at the end for now
    plan.forEach((p, k) => {
      if (label[k] !== `n${k}`) return;
      const at = order.length;
      if (p.src === -1) addBlank(m, dest.doc, at, p.size ?? A4);
      else if (p.src === 0) {
        baseCopy ??= openPdf(m, base);
        importOne(m, dest.doc, baseCopy.doc, p.page, at);
      } else importOne(m, dest.doc, others[p.src - 1].doc, p.page, at);
      order.push(label[k]);
    });
    if (m.FPDF_GetPageCount(dest.doc) !== plan.length) throw new PageOpsError('Số trang sau khi ghép không khớp.');
    // 3. into the planned order, left to right
    for (let t = 0; t < plan.length; t++) {
      const j = order.indexOf(label[t]);
      if (j === t) continue;
      moveOne(m, dest.doc, j, t);
      order.splice(t, 0, ...order.splice(j, 1));
    }
    setRotations(m, dest.doc, plan);
    return savePdf(m, dest.doc);
  } finally {
    (baseCopy as Opened | null)?.close();
    for (const o of others) o.close();
    dest.close();
  }
}

/** A new document holding only the planned pages (extract, split). */
export function assembleNew(m: WrappedPdfiumModule, base: Uint8Array, extras: Uint8Array[], plan: PlanPage[]): Uint8Array {
  const sources = [openPdf(m, base)];
  const doc = m.FPDF_CreateNewDocument();
  if (!doc) {
    sources[0].close();
    throw new PageOpsError('Không tạo được tệp mới.');
  }
  try {
    for (const [i, e] of extras.entries()) sources.push(openPdf(m, e, `tệp thứ ${i + 1}`));
    checkPlan(
      plan,
      sources.map((s) => m.FPDF_GetPageCount(s.doc)),
    );
    plan.forEach((p, k) => {
      if (p.src === -1) addBlank(m, doc, k, p.size ?? A4);
      else importOne(m, doc, sources[p.src].doc, p.page, k);
    });
    m.FPDF_CopyViewerPreferences(doc, sources[0].doc);
    setRotations(m, doc, plan);
    return savePdf(m, doc);
  } finally {
    m.FPDF_CloseDocument(doc);
    for (const s of sources) s.close();
  }
}
