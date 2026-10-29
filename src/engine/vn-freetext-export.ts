/**
 * Export finalizer: rewrites the appearance stream (AP/N) of FreeText
 * annotations created or edited in ezPDF, using an embedded TrueType font
 * that covers Vietnamese.
 *
 * Why (G1): EmbedPDF 2.15.1 generates FreeText appearances with Helvetica /
 * WinAnsiEncoding only. Characters outside WinAnsi (ắ ặ ơ ư đ ế ệ …) are
 * silently dropped from the drawing, so other viewers show "Ti ng Vi t".
 * /Contents keeps the correct Unicode.
 *
 * How: for each marked FreeText, lay out the lines with the font's own
 * metrics, build a one-page PDF that draws them with the font embedded
 * (appearance-pdf.ts), and let PDFium clone that page into the annotation's
 * AP/N (EPDFAnnot_SetAppearanceFromPage). PDFium then saves the file, so
 * encrypted documents stay correctly encrypted. Only the PDFium C API and
 * EmbedPDF's EPDF* extensions are used — no private EmbedPDF TS internals.
 *
 * Runs wherever a WrappedPdfiumModule exists: a Web Worker in the app,
 * Node in tests.
 */
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { readFontMetrics, type FontMetrics } from './font-metrics';
import { layoutFreeText as layoutLines, normalizeFreeText } from './text-layout';
import { buildAppearancePdf, flate, type DrawSpec, type EmbeddableFont } from './appearance-pdf';
import { PdfLite, encodeLatin1, type PdfNode } from './pdf-incremental';

const FPDF_ANNOT_FREETEXT = 3;
const AP_NORMAL = 0;

/** Key in EmbedPDF's `custom` data marking annotations ezPDF owns. */
export const EZ_MARK = 'ez';

export interface FinalizeOptions {
  font: Uint8Array;
  /** PostScript name written into the PDF (no spaces). */
  fontName?: string;
  /** Rewrite every FreeText, not only those marked as ezPDF's. Default false. */
  allFreeText?: boolean;
  /**
   * Absolute page rotations to write as /Rotate, in clockwise quarter turns
   * (0–3), keyed by page index. Pages not listed keep their /Rotate.
   * G7: EmbedPDF 2.15.1 has no page-rotation API, so the app keeps page
   * rotation in its view state and this step persists it.
   */
  pageRotations?: Record<number, number>;
}

export interface FinalizeReport {
  freeTextSeen: number;
  rewritten: number;
  skippedForeign: number;
  acroFormFieldsAdded: boolean;
  encrypted: boolean;
  pagesRotated: number;
  missingGlyphs: string[];
  warnings: string[];
}

interface FreeTextProps {
  text: string;
  fontSize: number;
  color: [number, number, number];
  align: number; // 0 left, 1 center, 2 right
  valign: number; // 0 top, 1 middle, 2 bottom
  background: [number, number, number] | null;
  borderWidth: number;
  width: number;
  height: number;
  rotation: number; // raw /EPDFRotate: degrees counter-clockwise in PDF space
}

class Wasm {
  constructor(private m: WrappedPdfiumModule) {}
  get p() {
    return this.m.pdfium;
  }
  /** Re-read on every access: the view is replaced when WASM memory grows. */
  get heap(): Uint8Array {
    return (this.m.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
  }
  malloc(n: number): number {
    const ptr = this.p.wasmExports.malloc(n);
    if (!ptr) throw new Error('wasm malloc failed');
    return ptr;
  }
  free(ptr: number) {
    if (ptr) this.p.wasmExports.free(ptr);
  }
  copyIn(data: Uint8Array): number {
    const ptr = this.malloc(data.byteLength);
    this.heap.set(data, ptr);
    return ptr;
  }
  withScratch<T>(n: number, fn: (ptr: number) => T): T {
    const ptr = this.malloc(n);
    this.heap.fill(0, ptr, ptr + n);
    try {
      return fn(ptr);
    } finally {
      this.free(ptr);
    }
  }
  f32(ptr: number) {
    return this.p.getValue(ptr, 'float') as number;
  }
  i32(ptr: number) {
    return this.p.getValue(ptr, 'i32') as number;
  }
}

function readAnnotString(m: WrappedPdfiumModule, w: Wasm, annot: number, key: string): string {
  const len = m.FPDFAnnot_GetStringValue(annot, key, 0, 0);
  if (!len) return '';
  return w.withScratch(len + 2, (ptr) => {
    m.FPDFAnnot_GetStringValue(annot, key, ptr, len + 2);
    return w.p.UTF16ToString(ptr);
  });
}

function readRect(m: WrappedPdfiumModule, w: Wasm, fn: 'EPDFAnnot_GetRect' | 'EPDFAnnot_GetUnrotatedRect', annot: number) {
  return w.withScratch(16, (ptr) => {
    if (!m[fn](annot, ptr)) return null;
    const l = w.f32(ptr), t = w.f32(ptr + 4), r = w.f32(ptr + 8), b = w.f32(ptr + 12);
    return { left: Math.min(l, r), right: Math.max(l, r), bottom: Math.min(t, b), top: Math.max(t, b) };
  });
}

function readProps(m: WrappedPdfiumModule, w: Wasm, annot: number): FreeTextProps | null {
  const text = normalizeFreeText(readAnnotString(m, w, annot, 'Contents'));
  const da = w.withScratch(20, (p) => {
    const ok = m.EPDFAnnot_GetDefaultAppearance(annot, p, p + 4, p + 8, p + 12, p + 16);
    if (!ok) return null;
    return {
      size: w.f32(p + 4),
      color: [w.i32(p + 8) & 0xff, w.i32(p + 12) & 0xff, w.i32(p + 16) & 0xff] as [number, number, number],
    };
  });
  const bg = w.withScratch(12, (p) =>
    m.EPDFAnnot_GetColor(annot, 0, p, p + 4, p + 8)
      ? ([w.i32(p) & 0xff, w.i32(p + 4) & 0xff, w.i32(p + 8) & 0xff] as [number, number, number])
      : null,
  );
  const borderWidth = w.withScratch(4, (p) => {
    m.EPDFAnnot_GetBorderStyle(annot, p);
    return w.f32(p) || 0;
  });
  const rotation = w.withScratch(4, (p) => (m.EPDFAnnot_GetExtendedRotation(annot, p) ? w.f32(p) : 0));
  const box =
    (rotation ? readRect(m, w, 'EPDFAnnot_GetUnrotatedRect', annot) : null) ?? readRect(m, w, 'EPDFAnnot_GetRect', annot);
  if (!box) return null;
  return {
    text,
    fontSize: da?.size && da.size > 0 ? da.size : 12,
    color: da?.color ?? [0, 0, 0],
    align: m.EPDFAnnot_GetTextAlignment(annot),
    valign: m.EPDFAnnot_GetVerticalAlignment(annot),
    background: bg,
    borderWidth,
    width: box.right - box.left,
    height: box.top - box.bottom,
    rotation,
  };
}

/** Draw spec in the appearance's own space (PDF y-up, origin bottom-left of the box). */
export function layoutFreeText(metrics: FontMetrics, p: FreeTextProps): DrawSpec {
  const layout = layoutLines(metrics, p);
  return {
    width: p.width,
    height: p.height,
    fontSize: p.fontSize,
    color: p.color,
    background: p.background,
    borderWidth: p.borderWidth,
    lines: layout.lines.map((l) => ({ text: l.text, x: l.x, y: p.height - l.baselineFromTop })),
  };
}

/**
 * Sets AP/N /Matrix so the drawing turns by `deg`, the raw /EPDFRotate value.
 * EmbedPDF stores it counter-clockwise in PDF (y-up) space; its UI value is
 * (360 - deg) clockwise. Viewers fit the turned /BBox into /Rect (ISO 32000-1
 * §12.5.5), so no translation is needed.
 */
function applyRotationMatrix(m: WrappedPdfiumModule, w: Wasm, annot: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const mat = [c, s, -s, c, 0, 0];
  w.withScratch(24, (p) => {
    mat.forEach((v, i) => w.p.setValue(p + i * 4, v, 'float'));
    if (!m.EPDFAnnot_SetAPMatrix(annot, AP_NORMAL, p)) throw new Error('EPDFAnnot_SetAPMatrix failed');
  });
}

function saveDocument(m: WrappedPdfiumModule, w: Wasm, doc: number): Uint8Array {
  const writer = m.PDFiumExt_OpenFileWriter();
  try {
    if (!m.PDFiumExt_SaveAsCopy(doc, writer)) throw new Error('PDFiumExt_SaveAsCopy failed');
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

function isOurs(m: WrappedPdfiumModule, w: Wasm, annot: number): boolean {
  const raw = readAnnotString(m, w, annot, 'EPDFCustom');
  if (!raw) return false;
  try {
    const c = JSON.parse(raw);
    return !!c && typeof c === 'object' && !!c[EZ_MARK];
  } catch {
    return false;
  }
}

const nameToken = (k: string) =>
  '/' + k.replace(/[^!-~]|[#()<>[\]{}/%]/g, (c) => '#' + c.charCodeAt(0).toString(16).padStart(2, '0'));

/**
 * G3: PDFium's FreeText AP generator creates /AcroForm (for its /DR fonts) in
 * files that had no form, without the required /Fields array (ISO 32000-1
 * Table 218); Poppler reports "Can't get Fields array". Append an incremental
 * update that adds an empty one. Existing values are copied byte for byte with
 * the same object number, so this is also safe for encrypted files (the new
 * bytes, "/Fields []", contain no string or stream).
 */
function addMissingAcroFormFields(bytes: Uint8Array): Uint8Array | null {
  const pdf = new PdfLite(bytes);
  const rootRef = pdf.trailer.get('Root');
  if (!rootRef || rootRef.t !== 'ref') return null;
  const root = pdf.get(rootRef.num);
  if (!root || root.value.t !== 'dict') return null;
  const acroNode = root.value.v.get('AcroForm');
  if (!acroNode) return null;
  const serialize = (d: Map<string, PdfNode>, extra: string) =>
    `<< ${[...d].map(([k, v]) => `${nameToken(k)} ${pdf.raw(v)}`).join(' ')} ${extra} >>`;
  let update: { num: number; gen: number; data: Uint8Array } | null = null;
  if (acroNode.t === 'ref') {
    const acro = pdf.get(acroNode.num);
    if (!acro || acro.value.t !== 'dict' || acro.streamStart !== undefined || acro.value.v.has('Fields')) return null;
    update = {
      num: acro.num,
      gen: acro.gen,
      data: encodeLatin1(`${acro.num} ${acro.gen} obj\n${serialize(acro.value.v, '/Fields []')}\nendobj\n`),
    };
  } else if (acroNode.t === 'dict' && !acroNode.v.has('Fields')) {
    const entries = [...root.value.v]
      .map(([k, v]) => `${nameToken(k)} ${k === 'AcroForm' ? serialize(acroNode.v, '/Fields []') : pdf.raw(v)}`)
      .join(' ');
    update = { num: root.num, gen: root.gen, data: encodeLatin1(`${root.num} ${root.gen} obj\n<< ${entries} >>\nendobj\n`) };
  }
  return update ? pdf.appendUpdate([update]) : null;
}

export async function finalizeExport(
  m: WrappedPdfiumModule,
  input: Uint8Array,
  opts: FinalizeOptions,
): Promise<{ bytes: Uint8Array; report: FinalizeReport }> {
  const w = new Wasm(m);
  const metrics = readFontMetrics(opts.font);
  const font: EmbeddableFont = {
    postscriptName: opts.fontName ?? 'ezPDFSansVN-Regular',
    metrics,
    program: await flate(opts.font),
    programLength1: opts.font.byteLength,
    compressed: true,
  };
  const report: FinalizeReport = {
    freeTextSeen: 0,
    rewritten: 0,
    skippedForeign: 0,
    acroFormFieldsAdded: false,
    encrypted: false,
    pagesRotated: 0,
    missingGlyphs: [],
    warnings: [],
  };
  const missing = new Set<string>();

  const srcPtr = w.copyIn(input);
  const doc = m.FPDF_LoadMemDocument(srcPtr, input.byteLength, '');
  if (!doc) {
    w.free(srcPtr);
    throw new Error(`cannot reopen exported PDF (PDFium error ${m.FPDF_GetLastError()})`);
  }
  let saved: Uint8Array;
  try {
    report.encrypted = m.EPDF_IsEncrypted(doc) ? true : false;
    const pageCount = m.FPDF_GetPageCount(doc);
    for (let pi = 0; pi < pageCount; pi++) {
      const page = m.FPDF_LoadPage(doc, pi);
      if (!page) {
        report.warnings.push(`page ${pi + 1}: cannot load`);
        continue;
      }
      try {
        const want = opts.pageRotations?.[pi];
        if (want !== undefined) {
          const quarter = ((Math.round(want) % 4) + 4) % 4;
          if (m.FPDFPage_GetRotation(page) !== quarter) {
            m.FPDFPage_SetRotation(page, quarter);
            report.pagesRotated++;
          }
        }
        const count = m.FPDFPage_GetAnnotCount(page);
        for (let ai = 0; ai < count; ai++) {
          const annot = m.FPDFPage_GetAnnot(page, ai);
          if (!annot) continue;
          try {
            if (m.FPDFAnnot_GetSubtype(annot) !== FPDF_ANNOT_FREETEXT) continue;
            report.freeTextSeen++;
            if (!opts.allFreeText && !isOurs(m, w, annot)) {
              report.skippedForeign++;
              continue;
            }
            const props = readProps(m, w, annot);
            if (!props || props.width <= 0 || props.height <= 0) {
              report.warnings.push(`page ${pi + 1}: FreeText #${ai} has no usable rect`);
              continue;
            }
            for (const ch of props.text) {
              const cp = ch.codePointAt(0)!;
              if (cp > 0x20 && !metrics.has(cp)) missing.add(ch);
            }
            const apBytes = buildAppearancePdf(layoutFreeText(metrics, props), font);
            const apPtr = w.copyIn(apBytes);
            const apDoc = m.FPDF_LoadMemDocument(apPtr, apBytes.byteLength, '');
            try {
              if (!apDoc) throw new Error(`appearance PDF rejected (PDFium error ${m.FPDF_GetLastError()})`);
              if (!m.EPDFAnnot_SetAppearanceFromPage(annot, apDoc, 0)) {
                throw new Error('EPDFAnnot_SetAppearanceFromPage failed');
              }
              if (props.rotation) applyRotationMatrix(m, w, annot, props.rotation);
              report.rewritten++;
            } finally {
              if (apDoc) m.FPDF_CloseDocument(apDoc);
              w.free(apPtr);
            }
          } finally {
            m.FPDFPage_CloseAnnot(annot);
          }
        }
      } finally {
        m.FPDF_ClosePage(page);
      }
    }
    report.missingGlyphs = [...missing];
    saved = saveDocument(m, w, doc);
  } finally {
    m.FPDF_CloseDocument(doc);
    w.free(srcPtr);
  }
  try {
    const fixed = addMissingAcroFormFields(saved);
    if (fixed) {
      report.acroFormFieldsAdded = true;
      saved = fixed;
    }
  } catch (e) {
    report.warnings.push(`AcroForm /Fields check skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { bytes: saved, report };
}
