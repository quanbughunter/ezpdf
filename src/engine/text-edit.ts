/**
 * Editing text that is already in a PDF, in the page's content stream.
 *
 * What it does (one line at a time):
 *  1. Group the page's top-level text objects into lines (same baseline,
 *     close together, upright).
 *  2. Remove the line's text objects from the page.
 *  3. Insert new text objects at the same place in the drawing order, with
 *     the same position, size, colour and render mode as the line's main
 *     object.
 *  4. Regenerate the page content (FPDFPage_GenerateContent) and check the
 *     result by reading the new objects back.
 *
 * The old text is gone from the file: nothing is covered or painted over.
 *
 * Font: the line keeps its own font only when that font can draw every
 * character of the new text, i.e. each character is already drawn with this
 * font somewhere on the page (an embedded subset holds only the glyphs that
 * were used) and PDFium finds a glyph for it. Otherwise the line is set in
 * ezSansVN Regular or Bold (embedded, covers Vietnamese), slanted for an
 * italic line. When the original font has no space character (TeX places
 * words by kerning) the words become separate objects so the font is kept.
 *
 * Limits (stated to the user): one line at a time, no reflow of the
 * paragraph, character and word spacing of the original are not kept,
 * text inside Form XObjects and rotated text are not editable, hidden text
 * (an OCR layer) is not offered because changing it would not change what
 * the page shows.
 *
 * Runs wherever a WrappedPdfiumModule exists: the edit worker in the app,
 * Node in tests.
 */
import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import { Wasm, wideString } from './wasm';
import { readFontMetrics, type FontMetrics } from './font-metrics';

const FPDF_PAGEOBJ_TEXT = 1;
const FPDF_PAGEOBJ_FORM = 5;
const FPDF_FONT_TRUETYPE = 2;
const RENDER_INVISIBLE = 3;
const ITALIC_SLANT = Math.tan((12 * Math.PI) / 180);

export interface Box {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface TextLine {
  /** indices of the line's objects in the page's object list, in reading order */
  key: string;
  text: string;
  /** PDF user space (unrotated, y up) */
  box: Box;
  baseline: number;
  /** size on the page in points */
  fontSize: number;
  fontName: string;
  bold: boolean;
  italic: boolean;
  color: [number, number, number];
  /** characters the line's own font can draw (already drawn with it on this page) */
  keepChars: string;
  /**
   * false: the font is not in the file (standard Helvetica, Times…); readers
   * use their own copy, which has every character of the Latin set
   * (WinAnsi), so `keepChars` is not the limit, `inWinAnsi` is.
   */
  fontEmbedded: boolean;
  editable: boolean;
  /** why not, in the user's words */
  reason?: string;
}

export interface FallbackFonts {
  regular: Uint8Array;
  bold: Uint8Array;
}

export interface EditReport {
  fontKept: boolean;
  /** font the new text is drawn with */
  fontName: string;
  /** why the original font was not kept */
  fallbackReason?: string;
  removedObjects: number;
  addedObjects: number;
  /** text read back from the new objects */
  readback: string;
}

export class TextEditError extends Error {}

type Matrix = [number, number, number, number, number, number];

interface Obj {
  index: number;
  handle: number;
  text: string;
  box: Box;
  m: Matrix;
  fontSize: number; // Tf
  size: number; // on the page
  font: number;
  renderMode: number;
}

/** Collapse runs of white space, as a reader sees the line. */
export const normalizeLineText = (s: string) => s.replace(/[\s ]+/g, ' ').trim();

export class TextEditor {
  private w: Wasm;
  private fallback = new Map<'regular' | 'bold', number>();

  constructor(
    private m: WrappedPdfiumModule,
    private doc: number,
    private fonts: FallbackFonts,
  ) {
    this.w = new Wasm(m);
  }

  /** Lines of one page, editable or not, top to bottom. */
  lines(pageIndex: number): TextLine[] {
    return this.withPage(pageIndex, (page) => {
      const tp = this.m.FPDFText_LoadPage(page);
      try {
        const objs = this.textObjects(page, tp);
        const chars = this.charsByFont(tp);
        const lines = groupLines(objs).map((g) => this.describe(g, chars));
        lines.push(...this.formLines(page, tp));
        return lines.sort((a, b) => b.baseline - a.baseline || a.box.left - b.box.left);
      } finally {
        this.m.FPDFText_ClosePage(tp);
      }
    });
  }

  /** Replace the text of the line `key` (from `lines`) with `text`. */
  replaceLine(pageIndex: number, key: string, text: string): EditReport {
    const wanted = normalizeLineText(text);
    if (!wanted) throw new TextEditError('Dòng mới không có chữ. Muốn bỏ cả dòng thì hãy dùng công cụ khác.');
    return this.withPage(pageIndex, (page) => {
      const tp = this.m.FPDFText_LoadPage(page);
      let line: Obj[];
      let fontChars: Map<number, Set<number>>;
      try {
        const objs = this.textObjects(page, tp);
        const idx = key.split(',').map(Number);
        line = idx.map((i) => objs.find((o) => o.index === i)).filter((o): o is Obj => !!o);
        if (line.length !== idx.length) throw new TextEditError('Trang đã thay đổi, hãy chọn lại dòng cần sửa.');
        const d = this.describe(line);
        if (!d.editable) throw new TextEditError(d.reason ?? 'Dòng này không sửa được.');
        fontChars = this.charsByFont(tp);
      } finally {
        this.m.FPDFText_ClosePage(tp);
      }

      const main = mainObject(line);
      const insertAt = Math.min(...line.map((o) => o.index));
      const style = {
        fill: this.color(main.handle, 'fill'),
        stroke: this.color(main.handle, 'stroke'),
        renderMode: main.renderMode,
      };
      const info = this.fontInfo(main.font);
      const why = this.cannotKeep(main.font, wanted, fontChars.get(main.font) ?? new Set());
      const variant = info.bold ? 'bold' : 'regular';
      const metrics = this.metrics(variant);
      const notInFallback = [...new Set([...wanted].filter((ch) => ch !== ' ' && !metrics.has(ch.codePointAt(0)!)))];
      if (why && notInFallback.length) {
        throw new TextEditError(`Phông gốc và phông thay thế đều chưa có ký tự: ${notInFallback.join(' ')}. Dòng chưa được sửa.`);
      }

      // Take the old objects off the page; they go back if anything fails.
      for (const o of line) {
        if (!this.m.FPDFPage_RemoveObject(page, o.handle)) throw new Error('FPDFPage_RemoveObject failed');
      }
      const drop = (objs: number[]) => {
        for (const h of objs) {
          this.m.FPDFPage_RemoveObject(page, h);
          this.m.FPDFPageObj_Destroy(h);
        }
      };
      const restore = () => {
        for (const o of [...line].sort((p, q) => p.index - q.index)) this.m.FPDFPage_InsertObjectAtIndex(page, o.handle, o.index);
      };
      const finish = (placed: number[], report: Omit<EditReport, 'removedObjects' | 'addedObjects'>): EditReport => {
        this.generate(page);
        for (const o of line) this.m.FPDFPageObj_Destroy(o.handle);
        return { ...report, removedObjects: line.length, addedObjects: placed.length };
      };

      try {
        // 1st choice: the line's own font, when it can draw every character.
        if (!why) {
          const placed = this.place(page, insertAt, main, main.font, wanted, style, false, this.hasSpace(main.font, fontChars));
          if (this.readBack(page, placed) === wanted) return finish(placed, { fontKept: true, fontName: info.name, readback: wanted });
          drop(placed);
        }
        if (notInFallback.length) {
          throw new TextEditError(`Phông thay thế chưa có ký tự: ${notInFallback.join(' ')}. Dòng chưa được sửa.`);
        }
        // Otherwise ezSansVN, embedded once per editing session.
        const font = this.fallbackFont(variant);
        const placed = this.place(page, insertAt, main, font, wanted, style, info.italic, true);
        const back = this.readBack(page, placed);
        if (back !== wanted) {
          drop(placed);
          throw new Error(`đọc lại không khớp: “${back}”`);
        }
        return finish(placed, {
          fontKept: false,
          fontName: this.fontInfo(font).name,
          fallbackReason: why ?? 'phông gốc không mã hóa được dòng mới',
          readback: back,
        });
      } catch (e) {
        restore();
        throw e;
      }
    });
  }

  /** Release the fonts this session embedded (call before closing the document). */
  dispose() {
    for (const f of this.fallback.values()) this.m.FPDFFont_Close(f);
    this.fallback.clear();
  }

  // ---- reading ------------------------------------------------------------

  private withPage<T>(pageIndex: number, fn: (page: number) => T): T {
    const page = this.m.FPDF_LoadPage(this.doc, pageIndex);
    if (!page) throw new Error(`cannot load page ${pageIndex + 1}`);
    try {
      return fn(page);
    } finally {
      this.m.FPDF_ClosePage(page);
    }
  }

  private textObjects(page: number, tp: number): Obj[] {
    const out: Obj[] = [];
    const n = this.m.FPDFPage_CountObjects(page);
    for (let i = 0; i < n; i++) {
      const h = this.m.FPDFPage_GetObject(page, i);
      if (!h || this.m.FPDFPageObj_GetType(h) !== FPDF_PAGEOBJ_TEXT) continue;
      out.push(this.readObject(h, i, tp));
    }
    return out;
  }

  private readObject(h: number, index: number, tp: number): Obj {
    const { w, m } = this;
    const box = w.withScratch(16, (p) => {
      m.FPDFPageObj_GetBounds(h, p, p + 4, p + 8, p + 12);
      return { left: w.f32(p), bottom: w.f32(p + 4), right: w.f32(p + 8), top: w.f32(p + 12) };
    });
    const mat = w.withScratch(24, (p) => {
      m.FPDFPageObj_GetMatrix(h, p);
      return [0, 1, 2, 3, 4, 5].map((k) => w.f32(p + k * 4)) as Matrix;
    });
    const fontSize = w.withScratch(4, (p) => (m.FPDFTextObj_GetFontSize(h, p) ? w.f32(p) : 0));
    return {
      index,
      handle: h,
      text: this.objectText(h, tp),
      box,
      m: mat,
      fontSize,
      size: fontSize * Math.hypot(mat[2], mat[3]),
      font: m.FPDFTextObj_GetFont(h),
      renderMode: m.FPDFTextObj_GetTextRenderMode(h),
    };
  }

  private objectText(h: number, tp: number): string {
    const len = this.m.FPDFTextObj_GetText(h, tp, 0, 0);
    if (len <= 2) return '';
    return this.w.withScratch(len, (p) => {
      this.m.FPDFTextObj_GetText(h, tp, p, len);
      return this.w.p.UTF16ToString(p);
    });
  }

  private describe(objs: Obj[], chars?: Map<number, Set<number>>): TextLine {
    const main = mainObject(objs);
    const keep = [...(chars?.get(main.font) ?? [])]
      .map((cp) => String.fromCodePoint(cp))
      .filter((ch) => ch === ' ' || this.hasGlyph(main.font, ch))
      .join('');
    const info = this.fontInfo(main.font);
    const box = objs.reduce(
      (b, o) => ({
        left: Math.min(b.left, o.box.left),
        bottom: Math.min(b.bottom, o.box.bottom),
        right: Math.max(b.right, o.box.right),
        top: Math.max(b.top, o.box.top),
      }),
      { ...objs[0].box },
    );
    let reason: string | undefined;
    if (!objs.every((o) => upright(o.m))) reason = 'Dòng chữ nghiêng hoặc xoay chưa sửa được.';
    else if (objs.every((o) => o.renderMode === RENDER_INVISIBLE))
      reason = 'Đây là chữ ẩn (lớp nhận dạng chữ của bản quét). Sửa nó không đổi được hình trên trang.';
    const fill = this.color(main.handle, 'fill');
    return {
      key: objs.map((o) => o.index).join(','),
      text: joinLine(objs),
      box,
      baseline: main.m[5],
      fontSize: main.size,
      fontName: info.name,
      bold: info.bold,
      italic: info.italic,
      color: [fill[0], fill[1], fill[2]],
      keepChars: keep,
      fontEmbedded: !!this.m.FPDFFont_GetIsEmbedded(main.font),
      editable: !reason,
      reason,
    };
  }

  /** Text inside Form XObjects, listed so a tap on it gets an explanation. */
  private formLines(page: number, tp: number): TextLine[] {
    const out: TextLine[] = [];
    const n = this.m.FPDFPage_CountObjects(page);
    for (let i = 0; i < n; i++) {
      const h = this.m.FPDFPage_GetObject(page, i);
      if (!h || this.m.FPDFPageObj_GetType(h) !== FPDF_PAGEOBJ_FORM) continue;
      const inner: Obj[] = [];
      const k = this.m.FPDFFormObj_CountObjects(h);
      for (let j = 0; j < k; j++) {
        const o = this.m.FPDFFormObj_GetObject(h, j);
        if (o && this.m.FPDFPageObj_GetType(o) === FPDF_PAGEOBJ_TEXT) inner.push(this.readObject(o, -1, tp));
      }
      for (const g of groupLines(inner)) {
        const d = this.describe(g);
        out.push({ ...d, key: `form:${i}`, editable: false, reason: 'Dòng này nằm trong một khối đồ họa gộp (Form XObject), bản này chưa sửa được.' });
      }
    }
    return out;
  }

  private fontInfo(font: number) {
    const { w, m } = this;
    const len = m.FPDFFont_GetBaseFontName(font, 0, 0);
    const raw = len > 1 ? w.withScratch(len, (p) => (m.FPDFFont_GetBaseFontName(font, p, len), w.p.UTF8ToString(p))) : '';
    const name = raw.replace(/^[A-Z]{6}\+/, '');
    const weight = m.FPDFFont_GetWeight(font);
    const flags = m.FPDFFont_GetFlags(font);
    const angle = w.withScratch(4, (p) => (m.FPDFFont_GetItalicAngle(font, p) ? w.i32(p) : 0));
    const bold = weight >= 600 || (flags & (1 << 18)) !== 0 || /bold|black|heavy|semibold|demi/i.test(name);
    const italic = angle !== 0 || (flags & (1 << 6)) !== 0 || /italic|oblique|^[a-z]*ti\d+$/i.test(name);
    return { name: name || 'không tên', bold, italic };
  }

  private color(h: number, which: 'fill' | 'stroke'): [number, number, number, number] {
    const { w, m } = this;
    return w.withScratch(16, (p) => {
      const ok = which === 'fill' ? m.FPDFPageObj_GetFillColor(h, p, p + 4, p + 8, p + 12) : m.FPDFPageObj_GetStrokeColor(h, p, p + 4, p + 8, p + 12);
      return ok ? [w.i32(p) & 0xff, w.i32(p + 4) & 0xff, w.i32(p + 8) & 0xff, w.i32(p + 12) & 0xff] : [0, 0, 0, 255];
    });
  }

  /** Characters really drawn with each font on the page (generated spaces excluded). */
  private charsByFont(tp: number): Map<number, Set<number>> {
    const map = new Map<number, Set<number>>();
    const n = this.m.FPDFText_CountChars(tp);
    for (let i = 0; i < n; i++) {
      if (this.m.FPDFText_IsGenerated(tp, i) === 1) continue;
      const obj = this.m.FPDFText_GetTextObject(tp, i);
      if (!obj) continue;
      const font = this.m.FPDFTextObj_GetFont(obj);
      let set = map.get(font);
      if (!set) map.set(font, (set = new Set()));
      set.add(this.m.FPDFText_GetUnicode(tp, i));
    }
    return map;
  }

  private hasGlyph(font: number, ch: string): boolean {
    const path = this.m.FPDFFont_GetGlyphPath(font, ch.codePointAt(0)!, 12);
    return !!path && this.m.FPDFGlyphPath_CountGlyphSegments(path) > 0;
  }

  private hasSpace(font: number, chars: Map<number, Set<number>>) {
    return chars.get(font)?.has(32) ?? false;
  }

  /** null when `font` can draw `text`, else the reason in the user's words. */
  private cannotKeep(font: number, text: string, used: Set<number>): string | null {
    const embedded = !!this.m.FPDFFont_GetIsEmbedded(font);
    const absent = [
      ...new Set(
        [...text].filter(
          (ch) => ch !== ' ' && (!(embedded ? used.has(ch.codePointAt(0)!) : inWinAnsi(ch)) || !this.hasGlyph(font, ch)),
        ),
      ),
    ];
    if (!absent.length) return null;
    return embedded
      ? `phông gốc chỉ nhúng những ký tự đã dùng, thiếu: ${absent.join(' ')}`
      : `phông gốc (không nhúng trong tệp) chỉ có bảng chữ Latin, thiếu: ${absent.join(' ')}`;
  }

  // ---- writing ------------------------------------------------------------

  private metricsCache = new Map<'regular' | 'bold', FontMetrics>();
  private metrics(variant: 'regular' | 'bold'): FontMetrics {
    let mt = this.metricsCache.get(variant);
    if (!mt) this.metricsCache.set(variant, (mt = readFontMetrics(variant === 'bold' ? this.fonts.bold : this.fonts.regular)));
    return mt;
  }

  private fallbackFont(variant: 'regular' | 'bold'): number {
    let f = this.fallback.get(variant);
    if (f) return f;
    const data = variant === 'bold' ? this.fonts.bold : this.fonts.regular;
    const ptr = this.w.copyIn(data);
    try {
      f = this.m.FPDFText_LoadFont(this.doc, ptr, data.byteLength, FPDF_FONT_TRUETYPE, true);
    } finally {
      this.w.free(ptr);
    }
    if (!f) throw new Error('FPDFText_LoadFont failed');
    this.fallback.set(variant, f);
    return f;
  }

  /**
   * New text objects for `text`, placed where `like` starts. One object, or
   * one per word when the font has no space character.
   */
  private place(
    page: number,
    at: number,
    like: Obj,
    font: number,
    text: string,
    style: { fill: number[]; stroke: number[]; renderMode: number },
    slant: boolean,
    oneObject: boolean,
  ): number[] {
    const [a, b, c0, d0, e, f] = like.m;
    const c = slant ? a * ITALIC_SLANT + c0 : c0;
    const d = slant ? b * ITALIC_SLANT + d0 : d0;
    const pieces: { text: string; dx: number }[] = [];
    if (oneObject) pieces.push({ text, dx: 0 });
    else {
      const space = this.width(font, ' ', like.fontSize) || like.fontSize * 0.3;
      let x = 0;
      for (const word of text.split(' ')) {
        if (word) pieces.push({ text: word, dx: x });
        x += this.width(font, word, like.fontSize) + space;
      }
    }
    const made: number[] = [];
    pieces.forEach((piece, i) => {
      const h = this.m.FPDFPageObj_CreateTextObj(this.doc, font, like.fontSize);
      if (!h) throw new Error('FPDFPageObj_CreateTextObj failed');
      const s = wideString(this.w, piece.text);
      try {
        if (!this.m.FPDFText_SetText(h, s)) throw new Error('FPDFText_SetText failed');
      } finally {
        this.w.free(s);
      }
      const mat: Matrix = [a, b, c, d, e + a * piece.dx, f + b * piece.dx];
      this.w.withScratch(24, (p) => {
        mat.forEach((v, k) => this.w.p.setValue(p + k * 4, v, 'float'));
        this.m.FPDFPageObj_SetMatrix(h, p);
      });
      this.m.FPDFPageObj_SetFillColor(h, style.fill[0], style.fill[1], style.fill[2], style.fill[3]);
      this.m.FPDFPageObj_SetStrokeColor(h, style.stroke[0], style.stroke[1], style.stroke[2], style.stroke[3]);
      this.m.FPDFTextObj_SetTextRenderMode(h, style.renderMode);
      if (!this.m.FPDFPage_InsertObjectAtIndex(page, h, at + i)) {
        this.m.FPDFPageObj_Destroy(h);
        throw new Error('FPDFPage_InsertObjectAtIndex failed');
      }
      made.push(h);
    });
    return made;
  }

  private width(font: number, s: string, size: number): number {
    let sum = 0;
    for (const ch of s) {
      sum += this.w.withScratch(4, (p) => (this.m.FPDFFont_GetGlyphWidth(font, ch.codePointAt(0)!, size, p) ? this.w.f32(p) : 0));
    }
    return sum;
  }

  /** What a reader gets from the new objects, words joined by single spaces. */
  private readBack(page: number, objs: number[]): string {
    const tp = this.m.FPDFText_LoadPage(page);
    try {
      return normalizeLineText(objs.map((h) => this.objectText(h, tp)).join(' '));
    } finally {
      this.m.FPDFText_ClosePage(tp);
    }
  }

  private generate(page: number) {
    if (!this.m.FPDFPage_GenerateContent(page)) throw new Error('FPDFPage_GenerateContent failed');
  }
}

// ---- pure helpers -------------------------------------------------------------

const WINANSI_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ']);

/** A character of WinAnsiEncoding, the Latin set every standard PDF font has. */
export function inWinAnsi(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WINANSI_EXTRA.has(ch);
}

/** Characters of `text` the line's own font cannot draw, as the bar shows them. */
export function missingForLine(line: Pick<TextLine, 'keepChars' | 'fontEmbedded'>, text: string): string[] {
  return [...new Set([...text].filter((ch) => ch.trim() && !(line.fontEmbedded ? line.keepChars.includes(ch) : inWinAnsi(ch))))];
}

// ---- grouping ---------------------------------------------------------------

const upright = (m: Matrix) => m[0] > 0 && m[3] > 0 && Math.abs(m[1]) < 1e-3 * m[0] && Math.abs(m[2]) < 1e-3 * m[3];

const mainObject = (objs: Obj[]) => objs.reduce((best, o) => (o.text.trim().length > best.text.trim().length ? o : best), objs[0]);

/**
 * Objects on one baseline, close enough to read as one line. A gap wider
 * than three times the text size starts a new line (two columns, a form's
 * label and value far apart).
 */
function groupLines(objs: Obj[]): Obj[][] {
  const items = objs.filter((o) => o.size > 0 && o.box.right > o.box.left);
  items.sort((p, q) => q.m[5] - p.m[5] || p.box.left - q.box.left);
  const lines: Obj[][] = [];
  for (const o of items) {
    const line = lines.find((l) => {
      const last = l[l.length - 1];
      const size = Math.min(last.size, o.size);
      return (
        upright(last.m) === upright(o.m) &&
        Math.abs(last.m[5] - o.m[5]) < size * 0.35 &&
        Math.max(last.size, o.size) < size * 1.6 &&
        o.box.left - last.box.right < size * 3 &&
        o.box.left > last.box.left - size * 0.5
      );
    });
    if (line) line.push(o);
    else lines.push([o]);
  }
  for (const l of lines) l.sort((p, q) => p.box.left - q.box.left);
  return lines.filter((l) => l.some((o) => o.text.trim()));
}

/** The line as a reader sees it: a space where objects are clearly apart. */
function joinLine(objs: Obj[]): string {
  let s = '';
  objs.forEach((o, i) => {
    if (i > 0) {
      const gap = o.box.left - objs[i - 1].box.right;
      if (gap > Math.min(o.size, objs[i - 1].size) * 0.15 && !/\s$/.test(s) && !/^\s/.test(o.text)) s += ' ';
    }
    s += o.text;
  });
  return normalizeLineText(s);
}
