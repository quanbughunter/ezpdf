/**
 * The searchable PDF (PDFium, in ezPDF's own worker): the words OCR read are
 * laid as invisible text over each scanned page, word by word on its line's
 * baseline and stretched to the word's width on the page, so a reader's
 * search finds them where they stand and a selection covers the word in the
 * picture. Nothing of the page itself is touched: the scan's image stream is
 * kept as it is (the page's content stream only gains the text), and the
 * text is drawn in render mode 3 (invisible), the way scanners' own OCR
 * does it.
 */
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { Wasm, wideString } from './wasm';

/** one line of words, in the pixels of the page as OCR read it (straightened by `angle`) */
export interface OcrTextLine {
  /** baseline at the line's ends */
  base: { x0: number; y0: number; x1: number; y1: number };
  /** top of the line's letters */
  top: number;
  words: { text: string; x0: number; x1: number }[];
}

export interface OcrTextPage {
  index: number;
  /** size in pixels of the page as rendered for OCR, and at what resolution */
  w: number;
  h: number;
  dpi: number;
  /** degrees the page image was turned to straighten it */
  angle: number;
  lines: OcrTextLine[];
}

export interface PageScan {
  /** characters of text the page already has */
  chars: number;
  /** resolution of the biggest picture on the page (a scan), 0 if none */
  scanDpi: number;
}

const FPDF_PAGEOBJ_IMAGE = 3;
const FPDF_FONT_TRUETYPE = 2;
const FPDF_TEXTRENDERMODE_INVISIBLE = 3;

/** what a page holds: text already, and the resolution of its scan */
export function pageScan(m: WrappedPdfiumModule, doc: number, index: number): PageScan {
  const w = new Wasm(m);
  const page = m.FPDF_LoadPage(doc, index);
  if (!page) return { chars: 0, scanDpi: 0 };
  try {
    const tp = m.FPDFText_LoadPage(page);
    let chars = 0;
    if (tp) {
      // characters that are not spaces
      const n = m.FPDFText_CountChars(tp);
      for (let i = 0; i < n; i++) {
        const u = m.FPDFText_GetUnicode(tp, i);
        if (u > 32) chars++;
      }
      m.FPDFText_ClosePage(tp);
    }
    let scanDpi = 0;
    let biggest = 0;
    const count = m.FPDFPage_CountObjects(page);
    for (let i = 0; i < count; i++) {
      const obj = m.FPDFPage_GetObject(page, i);
      if (m.FPDFPageObj_GetType(obj) !== FPDF_PAGEOBJ_IMAGE) continue;
      w.withScratch(24, (p) => {
        if (!m.FPDFImageObj_GetImagePixelSize(obj, p, p + 4)) return;
        const pw = w.i32(p) >>> 0;
        const ph = w.i32(p + 4) >>> 0;
        if (!m.FPDFPageObj_GetBounds(obj, p + 8, p + 12, p + 16, p + 20)) return;
        const bw = w.f32(p + 16) - w.f32(p + 8);
        const bh = w.f32(p + 20) - w.f32(p + 12);
        const area = bw * bh;
        if (area <= biggest || bw <= 0 || bh <= 0) return;
        biggest = area;
        // the picture may be turned on the page: compare long side with long side
        scanDpi = Math.round((Math.max(pw, ph) / Math.max(bw, bh)) * 72);
      });
    }
    return { chars, scanDpi };
  } finally {
    m.FPDF_ClosePage(page);
  }
}

/** a point of the straightened page back on the page as rendered */
function unturn(x: number, y: number, deg: number, w: number, h: number) {
  if (!deg) return { x, y };
  const a = (deg * Math.PI) / 180;
  const dx = x - w / 2;
  const dy = y - h / 2;
  return { x: w / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: h / 2 + dx * Math.sin(a) + dy * Math.cos(a) };
}

/**
 * Pixels of the page as rendered (at `dpi`, the page's /Rotate applied, as
 * FPDF_RenderPageBitmap draws it) → the page's own coordinates, as PDFium
 * maps them (FPDF_DeviceToPage); asked at 8× the size, for precision.
 */
function deviceToPage(m: WrappedPdfiumModule, page: number, w: number, h: number) {
  const wasm = new Wasm(m);
  const S = 8;
  const at = (dx: number, dy: number) =>
    wasm.withScratch(16, (p) => {
      m.FPDF_DeviceToPage(page, 0, 0, w * S, h * S, 0, dx, dy, p, p + 8);
      return { x: wasm.p.getValue(p, 'double') as number, y: wasm.p.getValue(p + 8, 'double') as number };
    });
  const o = at(0, 0);
  const ex = at(w * S, 0);
  const ey = at(0, h * S);
  return (x: number, y: number) => ({ x: o.x + ((ex.x - o.x) * x) / w + ((ey.x - o.x) * y) / h, y: o.y + ((ex.y - o.y) * x) / w + ((ey.y - o.y) * y) / h });
}

export interface TextLayerReport {
  pages: number;
  words: number;
  /** the font's handle: close it (FPDFFont_Close) once the document is saved */
  font: number;
}

/**
 * Lays the words over their pages, in place in `doc` (save it, then close
 * the font handle in the report). The font is embedded once for the whole
 * document (ezSansVN: Latin and Vietnamese).
 */
export function addTextLayer(m: WrappedPdfiumModule, doc: number, pages: OcrTextPage[], font: Uint8Array): TextLayerReport {
  const w = new Wasm(m);
  const fptr = w.copyIn(font);
  let f: number;
  try {
    f = m.FPDFText_LoadFont(doc, fptr, font.byteLength, FPDF_FONT_TRUETYPE, true);
  } finally {
    w.free(fptr);
  }
  if (!f) throw new Error('Không nạp được phông chữ cho lớp chữ.');
  const advance = (text: string, size: number) => {
    let sum = 0;
    for (const ch of text) sum += w.withScratch(4, (p) => (m.FPDFFont_GetGlyphWidth(f, ch.codePointAt(0)!, size, p) ? w.f32(p) : size * 0.5));
    return sum;
  };
  let words = 0;
  try {
    for (const pg of pages) {
      const page = m.FPDF_LoadPage(doc, pg.index);
      if (!page) throw new Error(`Không đọc được trang ${pg.index + 1}.`);
      try {
        const toPage = deviceToPage(m, page, pg.w, pg.h);
        const map = (x: number, y: number) => {
          const p = unturn(x, y, pg.angle, pg.w, pg.h);
          return toPage(p.x, p.y);
        };
        const unit = 72 / pg.dpi;
        for (const line of pg.lines) {
          const b = line.base;
          const slope = (b.y1 - b.y0) / Math.max(1, b.x1 - b.x0);
          const baseAt = (x: number) => b.y0 + (x - b.x0) * slope;
          // type size: baseline up to the top of the letters (accents included)
          const sizePx = Math.max(4, (baseAt(line.words[0]?.x0 ?? b.x0) - line.top) * 1.05);
          const size = sizePx * unit;
          line.words.forEach((word, i) => {
            const text = word.text.normalize('NFC');
            if (!text) return;
            const last = i === line.words.length - 1;
            const endX = last ? word.x1 : Math.max(word.x1, line.words[i + 1].x0);
            const s = map(word.x0, baseAt(word.x0));
            const e = map(endX, baseAt(endX));
            const len = Math.hypot(e.x - s.x, e.y - s.y);
            const content = last ? text : `${text} `;
            const natural = advance(content, size);
            if (len <= 0 || natural <= 0) return;
            const cos = (e.x - s.x) / len;
            const sin = (e.y - s.y) / len;
            const hs = len / natural;
            const obj = m.FPDFPageObj_CreateTextObj(doc, f, size);
            if (!obj) throw new Error('FPDFPageObj_CreateTextObj failed');
            const ws = wideString(w, content);
            try {
              if (!m.FPDFText_SetText(obj, ws)) throw new Error('FPDFText_SetText failed');
            } finally {
              w.free(ws);
            }
            const mat = [hs * cos, hs * sin, -sin, cos, s.x, s.y];
            w.withScratch(24, (p) => {
              mat.forEach((v, k) => w.p.setValue(p + k * 4, v, 'float'));
              m.FPDFPageObj_SetMatrix(obj, p);
            });
            m.FPDFTextObj_SetTextRenderMode(obj, FPDF_TEXTRENDERMODE_INVISIBLE);
            m.FPDFPage_InsertObject(page, obj);
            words++;
          });
        }
        if (!m.FPDFPage_GenerateContent(page)) throw new Error('FPDFPage_GenerateContent failed');
      } finally {
        m.FPDF_ClosePage(page);
      }
    }
  } catch (e) {
    m.FPDFFont_Close(f);
    throw e;
  }
  return { pages: pages.length, words, font: f };
}
