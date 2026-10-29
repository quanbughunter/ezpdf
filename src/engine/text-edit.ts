/**
 * Editing text that is already in a PDF, in the page's content stream.
 *
 * What it does (one line at a time):
 *  1. Group the page's top-level text objects into lines (same baseline,
 *     close together, upright).
 *  2. Compare the old and the new line object by object: objects at the
 *     start and at the end whose text did not change stay as they are (a
 *     bold label before the value keeps its own font); only the objects in
 *     between are replaced (`planEdit`).
 *  3. Remove those objects from the page and insert new text objects at the
 *     same place in the drawing order, with the position, size, colour and
 *     render mode of the part they replace. Objects after them on the line
 *     move by the change in width.
 *  4. Regenerate the page content (FPDFPage_GenerateContent) and check the
 *     result by reading the new objects back.
 *
 * The old text is gone from the file: nothing is covered or painted over.
 *
 * Font: the line keeps its own font only when that font can draw every
 * character of the new text, i.e. each character is already drawn with this
 * font somewhere on the page (an embedded subset holds only the glyphs that
 * were used) and PDFium finds a glyph for it. Otherwise the changed part is
 * set in ezSansVN Regular or Bold (embedded; Latin, Vietnamese, Greek,
 * Cyrillic), slanted for an italic line. When the original font has no space character (TeX places
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
  /** the line's objects in reading order, where they sit in `text`, and their fonts */
  parts: LinePart[];
  fonts: LineFont[];
  editable: boolean;
  /** why not, in the user's words */
  reason?: string;
}

export interface LinePart {
  /** [start, end) in the line's text */
  start: number;
  end: number;
  /** index into TextLine.fonts */
  font: number;
}

export interface LineFont {
  name: string;
  bold: boolean;
  italic: boolean;
  embedded: boolean;
  /** characters this font can draw (already drawn with it on this page) */
  keepChars: string;
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
  /** objects of the line left as they were (unchanged start and end) */
  keptObjects: number;
  /** the old text of the part that was replaced, and its new text */
  replaced: string;
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

  /**
   * Replace the text of the line `key` (from `lines`) with `text`. Only the
   * part that changed is rewritten (see `planEdit`).
   */
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

      const layout = lineLayout(line);
      let plan = planEdit(layout.text, layout.spans, wanted);
      if (!plan) {
        const info = this.fontInfo(mainObject(line).font);
        return { fontKept: true, fontName: info.name, removedObjects: 0, addedObjects: 0, keptObjects: line.length, replaced: '', readback: wanted };
      }
      {
        // a part that must change font takes its whole run in that font
        const m0 = mainObject(line.slice(plan.from, plan.to));
        if (plan.middle && this.cannotKeep(m0.font, plan.middle, fontChars.get(m0.font) ?? new Set())) {
          plan = widenToRun(plan, line.map((o) => o.font), m0.font, layout.text, layout.spans, wanted);
        }
      }
      const changed = line.slice(plan.from, plan.to);
      const after = line.slice(plan.to);
      const kept = line.length - changed.length;
      const replaced = layout.text.slice(layout.spans[plan.from].start, layout.spans[plan.to - 1].end);
      const middle = plan.middle;
      // The space between a kept part and the replaced one often belongs to the
      // replaced object (" Иванов…" after a bold "Автор:"): keep it, or the
      // new text would run into its neighbour.
      const lead = plan.from > 0 && /^[\s\u00a0]/.test(line[plan.from].text) ? ' ' : '';
      const trail = plan.to < line.length && /[\s\u00a0]$/.test(line[plan.to - 1].text) ? ' ' : '';
      const drawn = middle ? lead + middle + trail : '';

      const main = mainObject(changed);
      const first = changed[0];
      // the new text starts where the replaced part started, in its main style
      const like: Obj = { ...main, m: [main.m[0], main.m[1], main.m[2], main.m[3], first.m[4], first.m[5]] };
      const insertAt = Math.min(...changed.map((o) => o.index));
      const style = {
        fill: this.color(main.handle, 'fill'),
        stroke: this.color(main.handle, 'stroke'),
        renderMode: main.renderMode,
      };
      const info = this.fontInfo(main.font);
      const why = middle ? this.cannotKeep(main.font, middle, fontChars.get(main.font) ?? new Set()) : null;
      const variant = info.bold ? 'bold' : 'regular';
      const metrics = this.metrics(variant);
      const notInFallback = [...new Set([...middle].filter((ch) => ch !== ' ' && !metrics.has(ch.codePointAt(0)!)))];
      if (why && notInFallback.length) {
        throw new TextEditError(`Phông gốc và phông thay thế đều chưa có ký tự: ${notInFallback.join(' ')}. Dòng chưa được sửa.`);
      }

      // Take the replaced objects off the page; they go back if anything fails.
      for (const o of changed) {
        if (!this.m.FPDFPage_RemoveObject(page, o.handle)) throw new Error('FPDFPage_RemoveObject failed');
      }
      const drop = (objs: number[]) => {
        for (const h of objs) {
          this.m.FPDFPage_RemoveObject(page, h);
          this.m.FPDFPageObj_Destroy(h);
        }
      };
      const restore = () => {
        for (const o of [...changed].sort((p, q) => p.index - q.index)) this.m.FPDFPage_InsertObjectAtIndex(page, o.handle, o.index);
      };
      const oldRight = Math.max(...changed.map((o) => o.box.right));
      const finish = (placed: number[], report: Pick<EditReport, 'fontKept' | 'fontName' | 'fallbackReason' | 'readback'>): EditReport => {
        // what follows on the line moves by the change in width
        if (after.length) {
          const newRight = placed.length ? Math.max(...placed.map((h) => this.bounds(h).right)) : null;
          const delta = newRight === null ? first.box.left - after[0].box.left : newRight - oldRight;
          if (Math.abs(delta) > 0.01) {
            const len = Math.hypot(like.m[0], like.m[1]) || 1;
            for (const o of after) this.m.FPDFPageObj_Transform(o.handle, 1, 0, 0, 1, (delta * like.m[0]) / len, (delta * like.m[1]) / len);
          }
        }
        this.generate(page);
        for (const o of changed) this.m.FPDFPageObj_Destroy(o.handle);
        return { ...report, removedObjects: changed.length, addedObjects: placed.length, keptObjects: kept, replaced };
      };

      try {
        // the part was only deleted
        if (!middle) return finish([], { fontKept: true, fontName: info.name, readback: '' });
        // 1st choice: the part's own font, when it can draw every character.
        if (!why) {
          const placed = this.place(page, insertAt, like, main.font, drawn, style, false, this.hasSpace(main.font, fontChars));
          if (this.readBack(page, placed) === middle) return finish(placed, { fontKept: true, fontName: info.name, readback: middle });
          drop(placed);
        }
        if (notInFallback.length) {
          throw new TextEditError(`Phông thay thế chưa có ký tự: ${notInFallback.join(' ')}. Dòng chưa được sửa.`);
        }
        // Otherwise ezSansVN, embedded once per editing session.
        const font = this.fallbackFont(variant);
        const placed = this.place(page, insertAt, like, font, drawn, style, info.italic, true);
        const back = this.readBack(page, placed);
        if (back !== middle) {
          drop(placed);
          throw new Error(`đọc lại không khớp: “${back}”`);
        }
        return finish(placed, {
          fontKept: false,
          fontName: this.fontInfo(font).name,
          fallbackReason: why ?? 'phông gốc không mã hóa được phần mới',
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
    const box = this.bounds(h);
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

  private bounds(h: number): Box {
    const { w, m } = this;
    return w.withScratch(16, (p) => {
      m.FPDFPageObj_GetBounds(h, p, p + 4, p + 8, p + 12);
      return { left: w.f32(p), bottom: w.f32(p + 4), right: w.f32(p + 8), top: w.f32(p + 12) };
    });
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
    const keepOf = (font: number) =>
      [...(chars?.get(font) ?? [])]
        .map((cp) => String.fromCodePoint(cp))
        .filter((ch) => ch === ' ' || this.hasGlyph(font, ch))
        .join('');
    const keep = keepOf(main.font);
    const info = this.fontInfo(main.font);
    const fontIds: number[] = [];
    const fonts: LineFont[] = [];
    const layout = lineLayout(objs);
    const parts: LinePart[] = objs.map((o, i) => {
      let k = fontIds.indexOf(o.font);
      if (k < 0) {
        k = fontIds.push(o.font) - 1;
        const fi = this.fontInfo(o.font);
        fonts.push({ name: fi.name, bold: fi.bold, italic: fi.italic, embedded: !!this.m.FPDFFont_GetIsEmbedded(o.font), keepChars: o.font === main.font ? keep : keepOf(o.font) });
      }
      return { start: layout.spans[i].start, end: layout.spans[i].end, font: k };
    });
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
      text: layout.text,
      box,
      baseline: main.m[5],
      fontSize: main.size,
      fontName: info.name,
      bold: info.bold,
      italic: info.italic,
      color: [fill[0], fill[1], fill[2]],
      keepChars: keep,
      fontEmbedded: !!this.m.FPDFFont_GetIsEmbedded(main.font),
      parts,
      fonts,
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

/** Characters of `text` a font of the line cannot draw, as the bar shows them. */
export function missingForFont(font: Pick<LineFont, 'keepChars' | 'embedded'>, text: string): string[] {
  return [...new Set([...text].filter((ch) => ch.trim() && !(font.embedded ? font.keepChars.includes(ch) : inWinAnsi(ch))))];
}

export interface EditPlan {
  /** objects [from, to) of the line are replaced */
  from: number;
  to: number;
  /** their new text ('' = the part is deleted) */
  middle: string;
}

/**
 * Which objects of a line an edit has to replace. Objects entirely inside
 * the common start or the common end of the old and new text stay; the
 * rest is replaced by the new text between them. Returns null when nothing
 * changed. `spans` are the objects' places in `old` (from the line layout).
 */
export function planEdit(old: string, spans: { start: number; end: number }[], next: string): EditPlan | null {
  if (old === next || !spans.length) return null;
  let p = 0;
  while (p < old.length && p < next.length && old[p] === next[p]) p++;
  let s = 0;
  while (s < old.length - p && s < next.length - p && old[old.length - 1 - s] === next[next.length - 1 - s]) s++;
  const tail = old.length - s;
  let from = 0;
  while (from < spans.length && spans[from].end <= p) from++;
  let to = spans.length;
  while (to > from && spans[to - 1].start >= tail) to--;
  if (to === from) {
    // only the space between two objects changed: take the object after it
    if (from < spans.length) to = from + 1;
    else from = to - 1;
  }
  return { from, to, middle: middleFor(old, spans, next, from, to) };
}

/** The new text for objects [from, to) once the others stay as they are. */
function middleFor(old: string, spans: { start: number; end: number }[], next: string, from: number, to: number): string {
  const a = from > 0 ? spans[from - 1].end : 0;
  const bOld = to < spans.length ? spans[to].start : old.length;
  const b = next.length - (old.length - bOld);
  return next.slice(a, Math.max(a, b)).trim();
}

/**
 * When the part has to change font (the original lacks a character), the
 * new font takes the whole run of objects in that font, so no word ends up
 * half in one font and half in the other. Objects in other fonts (a bold
 * label) still stay.
 */
export function widenToRun(plan: EditPlan, fontOf: unknown[], main: unknown, old: string, spans: { start: number; end: number }[], next: string): EditPlan {
  let { from, to } = plan;
  while (from > 0 && fontOf[from - 1] === main) from--;
  while (to < fontOf.length && fontOf[to] === main) to++;
  if (from === plan.from && to === plan.to) return plan;
  return { from, to, middle: middleFor(old, spans, next, from, to) };
}

/** What the bar should say before saving: the part rewritten, its font, what that font lacks. */
export function describeEdit(line: Pick<TextLine, 'text' | 'parts' | 'fonts'>, next: string) {
  const wanted = normalizeLineText(next);
  let plan = planEdit(line.text, line.parts, wanted);
  if (!plan) return null;
  const mainOf = (p: EditPlan) => {
    const parts = line.parts.slice(p.from, p.to);
    return parts.reduce((best, q) => (q.end - q.start > best.end - best.start ? q : best), parts[0]);
  };
  const main = mainOf(plan);
  const font = line.fonts[main.font];
  const missing = plan.middle ? missingForFont(font, plan.middle) : [];
  if (missing.length) plan = widenToRun(plan, line.parts.map((q) => q.font), main.font, line.text, line.parts, wanted);
  return {
    plan,
    font,
    /** old text of the part rewritten */
    replaced: line.text.slice(line.parts[plan.from].start, line.parts[plan.to - 1].end),
    whole: plan.from === 0 && plan.to === line.parts.length,
    missing,
  };
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

/**
 * The line as a reader sees it (a space where objects are clearly apart,
 * white space collapsed), and where each object's text sits in it.
 */
function lineLayout(objs: Pick<Obj, 'text' | 'box' | 'size'>[]): { text: string; spans: { start: number; end: number }[] } {
  let raw = '';
  const rawSpans: [number, number][] = [];
  objs.forEach((o, i) => {
    if (i > 0) {
      const gap = o.box.left - objs[i - 1].box.right;
      if (gap > Math.min(o.size, objs[i - 1].size) * 0.15 && !/\s$/.test(raw) && !/^\s/.test(o.text)) raw += ' ';
    }
    rawSpans.push([raw.length, raw.length + o.text.length]);
    raw += o.text;
  });
  // collapse white space, keeping a map from raw to collapsed positions
  const map = new Array<number>(raw.length + 1);
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    map[i] = out.length;
    if (/[\s\u00a0]/.test(raw[i])) {
      if (out.length && !out.endsWith(' ')) out += ' ';
    } else out += raw[i];
  }
  map[raw.length] = out.length;
  const text = out.endsWith(' ') ? out.slice(0, -1) : out;
  const spans = rawSpans.map(([a, b]) => {
    let start = Math.min(map[a], text.length);
    let end = Math.min(map[b], text.length);
    while (start < end && text[start] === ' ') start++;
    while (end > start && text[end - 1] === ' ') end--;
    return { start, end };
  });
  return { text, spans };
}
