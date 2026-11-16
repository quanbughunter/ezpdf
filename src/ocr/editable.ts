/**
 * "PDF sửa được chữ": the words OCR read are taken out of the scan and put
 * back as real text drawn with their own shapes, so the page looks as it
 * did and every word can be moved, edited or deleted.
 *
 * For each word read with enough confidence, in its box grown by a few
 * pixels:
 *  - the paper's colour P (the box's rim, without a neighbour's ink) and
 *    the ink's K (the darkest few in a hundred of the word's pixels);
 *  - each pixel's ink coverage α: where it lies between P and K. A pixel
 *    off that line (a red or blue stamp over the word, a coloured mark) is
 *    not the word's ink, nor is a straight line running on past the box (a
 *    table's rule, an underline), nor ink in the margin that does not join
 *    the word's own (a neighbouring line's accent): α = 0, they stay in the
 *    picture;
 *  - the picture without the word: each pixel of the word, and each faint
 *    grey pixel of its soft edge a few pixels round it, becomes a pixel of the paper round the
 *    word, picked at random, so the grain goes on and no trace of the
 *    word's shape is left;
 *  - the word's shape: colour K with coverage α.
 * Drawn back, shape over picture gives the scan again, (1 − α)·B + α·K ≈ I:
 * exactly where the ink covers the pixel, within the paper's grain at the
 * soft edge. The picture is changed only where the words were; nothing is
 * painted over it.
 * Words read with little confidence stay in the picture as they were.
 *
 * Pure pixels; runs in the OCR worker (and in Node for the tests).
 */
import { unrotatePoint, type Box } from './raster';
import type { Block, Line, PageLayout } from './model';

export interface SourceWord {
  text: string;
  /** 0–100 */
  conf: number;
  /** in the picture's pixels */
  box: Box;
  /** the baseline's y under the word, picture pixels */
  base: number;
  /** type size, points */
  size: number;
  /** the OCR line it is on (words of a line come one after another) */
  line: number;
}

export interface CutWord {
  text: string;
  /** where its shape is drawn: whole pixels of the picture, x1 and y1 past the end */
  box: Box;
  base: number;
  size: number;
  line: number;
  /** the ink's colour (its darkest), what the shape is drawn in */
  ink: [number, number, number];
  /** the colour the word reads in (its well covered pixels): for new text set in its place */
  tone: [number, number, number];
  /** ink coverage, a byte per pixel of `box`, rows from the top, in steps of 17 (0–15 × 17) */
  alpha: Uint8Array;
}

/**
 * The words of a page OCR read, in reading order, placed on the page as
 * drawn: OCR read a straightened copy at its own resolution, `scale` is the
 * picture's resolution over OCR's.
 */
export function sourceWords(layout: PageLayout, scale: number): SourceWord[] {
  const lines: { line: Line; size: number }[] = [];
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.kind === 'para') for (const l of b.lines) lines.push({ line: l, size: l.size ?? b.size });
      else if (b.kind === 'table')
        for (const c of [...b.cells].sort((x, y) => x.r0 - y.r0 || x.c0 - y.c0)) for (const p of c.paras) for (const l of p.lines) lines.push({ line: l, size: l.size ?? p.size });
    }
  };
  walk(layout.header);
  walk(layout.blocks);
  walk(layout.footer);
  const back = (x: number, y: number) => unrotatePoint(x, y, layout.angle, layout.w, layout.h);
  // each line's baseline, under its middle: one for all its words (each word's shape is still
  // drawn where it was; an editor then sees the words as one line)
  const placed = lines
    .filter(({ line }) => line.words.length)
    .map(({ line, size }) => {
      const { base } = line;
      const mid = (line.box.x0 + line.box.x1) / 2;
      const f = base.x1 === base.x0 ? 0 : (mid - base.x0) / (base.x1 - base.x0);
      const p = back(mid, base.y0 + f * (base.y1 - base.y0));
      return { line, size, base: p.y * scale, left: back(line.box.x0, base.y0).x * scale };
    });
  // in the order the page reads: top to bottom, and left to right along a row (cells of a
  // table row, pieces of a line), so a reader copies the text as the page shows it
  placed.sort((a, b) => a.base - b.base);
  const rows: (typeof placed)[] = [];
  for (const p of placed) {
    const row = rows[rows.length - 1];
    if (row && p.base - row[0].base < (p.size / 72) * layout.dpi * scale * 0.35) row.push(p);
    else rows.push([p]);
  }
  const out: SourceWord[] = [];
  let index = 0;
  for (const row of rows)
    for (const { line, size, base } of row.sort((a, b) => a.left - b.left)) {
      for (const wd of line.words) {
        const b = wd.box;
        const corners = [back(b.x0, b.y0), back(b.x1, b.y0), back(b.x0, b.y1), back(b.x1, b.y1)];
        out.push({
          text: wd.text,
          conf: wd.conf,
          box: {
            x0: Math.min(...corners.map((c) => c.x)) * scale,
            y0: Math.min(...corners.map((c) => c.y)) * scale,
            x1: Math.max(...corners.map((c) => c.x)) * scale,
            y1: Math.max(...corners.map((c) => c.y)) * scale,
          },
          base,
          size,
          line: index,
        });
      }
      index++;
    }
  return out;
}

/** a line drawn on the page, in the picture's pixels */
export interface RuleLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  thick: number;
}

/** the lines OCR found on the page (tables, frame, loose), placed on the picture like `sourceWords` */
export function sourceRules(layout: PageLayout, scale: number): RuleLine[] {
  const back = (x: number, y: number) => unrotatePoint(x, y, layout.angle, layout.w, layout.h);
  return (layout.rules ?? []).map((r) => {
    const p = r.dir === 'h' ? back(r.a0, r.at) : back(r.at, r.a0);
    const q = r.dir === 'h' ? back(r.a1, r.at) : back(r.at, r.a1);
    return { x0: p.x * scale, y0: p.y * scale, x1: q.x * scale, y1: q.y * scale, thick: r.thick * scale };
  });
}

/** below this confidence a word stays in the picture */
export const MIN_CONF = 55;

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * Takes the words out of `rgba` (changed in place) and returns their
 * shapes, in the order given. `dpi` sets the margin round each box.
 */
export function cutWords(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, dpi: number, words: SourceWord[], rules: RuleLine[] = []): { words: CutWord[]; left: number } {
  // pixels no word takes: those already taken, and the page's lines with a pixel round them (a
  // table's rule, an underline stay in the picture whole)
  const taken = new Uint8Array(w * h);
  for (const r of rules) markRule(taken, w, h, r);
  const out: CutWord[] = [];
  let left = 0;
  const halo = Math.max(2, Math.round(dpi / 50));
  const pad = halo + 1;
  for (const word of words) {
    const cut = word.conf >= MIN_CONF && word.text.trim() ? cutOne(rgba, w, h, pad, halo, taken, word) : null;
    if (cut) out.push(cut);
    else left++;
  }
  return { words: out, left };
}

function cutOne(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, pad: number, halo: number, taken: Uint8Array, word: SourceWord): CutWord | null {
  const x0 = Math.max(0, Math.floor(word.box.x0) - pad);
  const y0 = Math.max(0, Math.floor(word.box.y0) - pad);
  const x1 = Math.min(w, Math.ceil(word.box.x1) + pad);
  const y1 = Math.min(h, Math.ceil(word.box.y1) + pad);
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < 2 || bh < 2) return null;
  const px = (x: number, y: number) => (y * w + x) * 4;

  // paper: a ring two pixels outside the box (past the letters' soft edges), without what is
  // clearly darker than most of it (a neighbour's ink)
  const rim: number[] = [];
  const rx0 = Math.max(0, x0 - 2);
  const ry0 = Math.max(0, y0 - 2);
  const rx1 = Math.min(w, x1 + 2);
  const ry1 = Math.min(h, y1 + 2);
  for (let x = rx0; x < rx1; x++) rim.push(px(x, ry0), px(x, ry1 - 1));
  for (let y = ry0 + 1; y < ry1 - 1; y++) rim.push(px(rx0, y), px(rx1 - 1, y));
  const rimLum = rim.map((i) => lum(rgba[i], rgba[i + 1], rgba[i + 2]));
  const mid = median(rimLum);
  let paper = rim.filter((_, k) => rimLum[k] >= mid - 20);
  let P = [0, 1, 2].map((c) => median(paper.map((i) => rgba[i + c]))) as [number, number, number];
  let lp = lum(P[0], P[1], P[2]);

  // ink: the darkest few in a hundred of what is clearly darker than the paper (coverage is
  // measured against it: a darker pixel would come out lighter)
  const dark: number[] = [];
  for (let y = Math.max(y0, Math.floor(word.box.y0)); y < Math.min(y1, Math.ceil(word.box.y1)); y++)
    for (let x = Math.max(x0, Math.floor(word.box.x0)); x < Math.min(x1, Math.ceil(word.box.x1)); x++) {
      const i = px(x, y);
      if (!taken[y * w + x] && lum(rgba[i], rgba[i + 1], rgba[i + 2]) < lp - 40) dark.push(i);
    }
  if (dark.length < 4) return null;
  dark.sort((a, b) => lum(rgba[a], rgba[a + 1], rgba[a + 2]) - lum(rgba[b], rgba[b + 1], rgba[b + 2]));
  const darkest = dark.slice(0, Math.max(1, Math.ceil(dark.length * 0.03)));
  const K = [0, 1, 2].map((c) => Math.round(darkest.reduce((s, i) => s + rgba[i + c], 0) / darkest.length)) as [number, number, number];
  let d = [K[0] - P[0], K[1] - P[1], K[2] - P[2]];
  let dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  if (lp - lum(K[0], K[1], K[2]) < 40 || dd < 1600) return null;
  // the paper again, now that the ink is known: rim pixels with no ink in them by the measure
  // used for the word (a letter's soft edge reaching the rim is not paper)
  const clean = paper.filter((i) => ((rgba[i] - P[0]) * d[0] + (rgba[i + 1] - P[1]) * d[1] + (rgba[i + 2] - P[2]) * d[2]) / dd < 1 / 30);
  if (clean.length >= 8) {
    paper = clean;
    P = [0, 1, 2].map((c) => median(paper.map((i) => rgba[i + c]))) as [number, number, number];
    lp = lum(P[0], P[1], P[2]);
    d = [K[0] - P[0], K[1] - P[1], K[2] - P[2]];
    dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  }
  const off = Math.max(36, Math.sqrt(dd) * 0.22);

  // coverage
  const a = new Float32Array(bw * bh);
  // a faint grey pixel (the letters' soft edge, a scanner's ringing round them): paper for the
  // picture, if near the word
  const faint = new Uint8Array(bw * bh);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (taken[y * w + x]) continue;
      const i = px(x, y);
      const v = [rgba[i] - P[0], rgba[i + 1] - P[1], rgba[i + 2] - P[2]];
      const raw = Math.min(1, (v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / dd);
      // in fifteenths: the PDF keeps coverage in 4 bits
      const t = Math.round(raw * 15) / 15;
      // how far the pixel is from the paper-to-ink line: another colour
      const e0 = v[0] - raw * d[0];
      const e1 = v[1] - raw * d[1];
      const e2 = v[2] - raw * d[2];
      if (Math.sqrt(e0 * e0 + e1 * e1 + e2 * e2) > off) continue;
      if (raw < 0.2) faint[(y - y0) * bw + (x - x0)] = 1;
      if (t > 0) a[(y - y0) * bw + (x - x0)] = t;
    }

  // a rule through the box: a full row (column) of ink that goes on past it
  const inked = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const i = px(x, y);
    return lum(rgba[i], rgba[i + 1], rgba[i + 2]) < lp - 0.5 * (lp - lum(K[0], K[1], K[2]));
  };
  for (let yy = 0; yy < bh; yy++) {
    let n = 0;
    for (let xx = 0; xx < bw; xx++) if (a[yy * bw + xx] > 0.5) n++;
    if (n >= bw * 0.7 && inked(x0 - 1, y0 + yy) && inked(x0 - 2, y0 + yy) && inked(x1, y0 + yy) && inked(x1 + 1, y0 + yy)) for (let xx = 0; xx < bw; xx++) a[yy * bw + xx] = 0;
  }
  for (let xx = 0; xx < bw; xx++) {
    let n = 0;
    for (let yy = 0; yy < bh; yy++) if (a[yy * bw + xx] > 0.5) n++;
    if (n >= bh * 0.7 && inked(x0 + xx, y0 - 1) && inked(x0 + xx, y0 - 2) && inked(x0 + xx, y1) && inked(x0 + xx, y1 + 1)) for (let yy = 0; yy < bh; yy++) a[yy * bw + xx] = 0;
  }

  // only ink that joins the word's own (inside the box OCR gave): not a
  // neighbouring line's descender or accent reaching into the margin
  const keep = new Uint8Array(bw * bh);
  const stack: number[] = [];
  const cx0 = Math.floor(word.box.x0) - x0;
  const cy0 = Math.floor(word.box.y0) - y0;
  const cx1 = Math.ceil(word.box.x1) - x0;
  const cy1 = Math.ceil(word.box.y1) - y0;
  for (let yy = Math.max(0, cy0); yy < Math.min(bh, cy1); yy++)
    for (let xx = Math.max(0, cx0); xx < Math.min(bw, cx1); xx++) {
      const k = yy * bw + xx;
      if (a[k] > 0.3 && !keep[k]) {
        keep[k] = 1;
        stack.push(k);
      }
    }
  // strong ink (1) carries the fill on; the faint edge round it joins up to two pixels out (2, 3)
  while (stack.length) {
    const k = stack.pop()!;
    const xx = k % bw;
    const yy = (k - xx) / bw;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = xx + dx;
        const ny = yy + dy;
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const j = ny * bw + nx;
        if (keep[j] || a[j] <= 0) continue;
        if (a[j] > 0.3 && keep[k] === 1) keep[j] = 1;
        else if (keep[k] < 3) keep[j] = keep[k] + 1;
        else continue;
        if (keep[j] < 3) stack.push(j);
      }
  }
  for (let k = 0; k < a.length; k++) if (!keep[k]) a[k] = 0;

  // the shape's own box
  let gx0 = bw;
  let gy0 = bh;
  let gx1 = -1;
  let gy1 = -1;
  for (let yy = 0; yy < bh; yy++)
    for (let xx = 0; xx < bw; xx++)
      if (a[yy * bw + xx] > 0) {
        if (xx < gx0) gx0 = xx;
        if (xx > gx1) gx1 = xx;
        if (yy < gy0) gy0 = yy;
        if (yy > gy1) gy1 = yy;
      }
  if (gx1 < 0) return null;
  const gw = gx1 - gx0 + 1;
  const gh = gy1 - gy0 + 1;
  const alpha = new Uint8Array(gw * gh);

  // take the ink out of the picture: each pixel of the word, and of its soft edge two pixels
  // round it, becomes a pixel of the paper round the word (picked at random, so the grain goes
  // on where the word was and no trace of its shape is left)
  let seed = (x0 * 73856093) ^ (y0 * 19349663);
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  // the colour the word reads in (its well covered pixels, as scanned): new text set in its
  // place takes it
  const tone = [0, 0, 0];
  let toned = 0;
  for (let yy = gy0; yy <= gy1; yy++)
    for (let xx = gx0; xx <= gx1; xx++) {
      const t = a[yy * bw + xx];
      if (t <= 0) continue;
      const x = x0 + xx;
      const y = y0 + yy;
      const i = px(x, y);
      if (t >= 0.6) {
        for (let c = 0; c < 3; c++) tone[c] += rgba[i + c];
        toned++;
      }
      const j = paper[Math.floor(rand() * paper.length)];
      for (let c = 0; c < 3; c++) rgba[i + c] = rgba[j + c];
      taken[y * w + x] = 1;
      alpha[(yy - gy0) * gw + (xx - gx0)] = Math.round(t * 255);
    }
  // the soft edge round the word (faint grey, less ink than the shape keeps, up to `halo`
  // pixels out): paper too, so no halo of the word stays behind when it moves
  const near = new Uint8Array(bw * bh);
  for (let yy = gy0; yy <= gy1; yy++)
    for (let xx = gx0; xx <= gx1; xx++)
      if (a[yy * bw + xx] > 0)
        for (let ny = Math.max(0, yy - halo); ny <= Math.min(bh - 1, yy + halo); ny++) near.fill(1, ny * bw + Math.max(0, xx - halo), ny * bw + Math.min(bw, xx + halo + 1));
  for (let k = 0; k < near.length; k++) {
    if (!near[k] || a[k] > 0 || !faint[k]) continue;
    const xx = k % bw;
    const yy = (k - xx) / bw;
    const i = px(x0 + xx, y0 + yy);
    const j = paper[Math.floor(rand() * paper.length)];
    for (let c = 0; c < 3; c++) rgba[i + c] = rgba[j + c];
  }
  return {
    text: word.text,
    box: { x0: x0 + gx0, y0: y0 + gy0, x1: x0 + gx1 + 1, y1: y0 + gy1 + 1 },
    base: word.base,
    size: word.size,
    line: word.line,
    ink: K,
    tone: toned ? (tone.map((c) => Math.round(c / toned)) as [number, number, number]) : K,
    alpha,
  };
}

/** marks a line's pixels, and one round them, in a mask of the picture */
export function markRule(mask: Uint8Array, w: number, h: number, r: RuleLine) {
  const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
  const half = Math.ceil(r.thick / 2) + 1;
  for (let k = 0; k <= len * 2; k++) {
    const f = len ? k / (len * 2) : 0;
    const cx = Math.round(r.x0 + f * (r.x1 - r.x0));
    const cy = Math.round(r.y0 + f * (r.y1 - r.y0));
    for (let y = Math.max(0, cy - half); y <= Math.min(h - 1, cy + half); y++)
      for (let x = Math.max(0, cx - half); x <= Math.min(w - 1, cx + half); x++) mask[y * w + x] = 1;
  }
}

function quantile(v: number[], q: number) {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 255;
}

const median = (v: number[]) => quantile(v, 0.5);

/**
 * A page OCR read, cut for the editable PDF: its words taken out of `pic`
 * (the page drawn again at the scan's own resolution; changed in place).
 */
export function cutPage(layout: PageLayout, pic: { rgba: Uint8Array | Uint8ClampedArray; w: number; h: number; dpi: number }): { words: CutWord[]; left: number } {
  const scale = pic.dpi / layout.dpi;
  return cutWords(pic.rgba, pic.w, pic.h, pic.dpi, sourceWords(layout, scale), sourceRules(layout, scale));
}

/** the picture has no colour (every pixel grey, within a level or two) */
export function isGrey(rgba: Uint8Array | Uint8ClampedArray): boolean {
  for (let i = 0; i < rgba.length; i += 4) if (Math.abs(rgba[i] - rgba[i + 1]) > 2 || Math.abs(rgba[i + 1] - rgba[i + 2]) > 2) return false;
  return true;
}

/** the picture's samples (grey: one a pixel), Flate-compressed */
export function flateSamples(rgba: Uint8Array | Uint8ClampedArray, grey: boolean, compress: (b: Uint8Array) => Uint8Array): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n * (grey ? 1 : 3));
  if (grey) for (let i = 0; i < n; i++) out[i] = rgba[i * 4 + 1];
  else for (let i = 0; i < n; i++) out.set(rgba.subarray(i * 4, i * 4 + 3), i * 3);
  return compress(out);
}
