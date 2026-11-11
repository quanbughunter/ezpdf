/**
 * From pixels and the words Tesseract read to the page's structure (pure,
 * runs in a worker and in Node tests):
 *
 *  1. prepare(): the page straightened, its ruled lines found (tables, the
 *     page frame, loose lines) and painted out of the copy Tesseract reads,
 *     so cell borders are never read as letters and text is not cut by them
 *  2. layoutPage(): every word goes to the table cell it sits in, or to the
 *     page; the page's lines become paragraphs (indents, alignment, size,
 *     bold and italic measured from the strokes), lines side by side become
 *     a borderless table (the two-column headings of official papers,
 *     signature blocks) or one line with tab stops, text above a rule at the
 *     top is the running header and below one at the bottom the footer, and
 *     ink that is neither text nor lines is a picture, cut from the page in
 *     colour
 */
import type { Block, Cell, Line, PageLayout, Para, Picture, RuleBlock, TableBlock, Word } from './model';
import { binarize, inkIn, rotate, skewAngle, unrotatePoint, union, type Box, type Gray } from './raster';
import { eraseRules, findRules, findTables, lineInk, type Rule, type Ruling, type Table } from './lines';
import { encodePng } from '../word/images';
import { timesWidth, type Style } from './times';

export interface Prepared {
  w: number;
  h: number;
  dpi: number;
  /** degrees the page was turned to straighten it */
  angle: number;
  /** ink of the straightened page without its ruled lines */
  ink: Uint8Array;
  ruling: Ruling;
}

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/** Straightens the page, finds its lines; returns what to hand Tesseract (lines painted out). */
export function prepare(page: Gray, dpi: number): { prep: Prepared; forOcr: Gray } {
  let g = page;
  let ink = binarize(g, dpi);
  let angle = skewAngle(ink, g.w, g.h);
  if (Math.abs(angle) >= 0.15) {
    g = rotate(g, angle);
    ink = binarize(g, dpi);
  } else angle = 0;
  const rules = findRules(lineInk(g.data, g.w, g.h, dpi), ink, g.w, g.h, dpi);
  const ruling = findTables(rules, g.w, g.h, dpi);
  const drawn: Rule[] = [...ruling.tables.flatMap((t) => t.rules), ...(ruling.frame?.rules ?? []), ...ruling.loose];
  const forOcr = { w: g.w, h: g.h, data: g.data === page.data ? g.data.slice() : g.data };
  eraseRules(forOcr.data, g.w, g.h, drawn, 1, 255);
  eraseRules(ink, g.w, g.h, drawn, 1, 0);
  return { prep: { w: g.w, h: g.h, dpi, angle, ink, ruling }, forOcr };
}

// ---- letter height -------------------------------------------------------------

/** of the letters and digits in a text, the share that stand as tall as capitals */
function tallShare(text: string): number {
  let tall = 0;
  let all = 0;
  for (const c of text) {
    if (/\p{N}/u.test(c)) {
      tall++;
      all++;
    } else if (/\p{L}/u.test(c)) {
      all++;
      if (c !== c.toLowerCase()) tall++;
    }
  }
  return all ? tall / all : 0;
}

/**
 * The height of a line's small letters, measured on its ink: going up from
 * the baseline, rows stay dense through the small letters and thin out
 * above them (only ascenders and accents). Tesseract's own figure for this
 * swings widely from line to line. A line of capitals or digits gives their
 * height, scaled to the x-height of the same type (Times: 0.448 against
 * 0.662).
 */
function measureXh(l: Line, ink: Uint8Array, w: number): number {
  const x0 = Math.max(0, Math.round(l.box.x0));
  const x1 = Math.min(w, Math.round(l.box.x1));
  const base = Math.round((l.base.y0 + l.base.y1) / 2);
  const up = Math.round(base - l.box.y0);
  if (up < 4 || x1 - x0 < 4) return l.xh;
  const d: number[] = [0];
  for (let k = 1; k <= up; k++) {
    const y = base - k;
    if (y < 0) break;
    let n = 0;
    for (let x = x0; x < x1; x++) n += ink[y * w + x];
    d.push(n);
  }
  const peak = Math.max(...d.slice(1, Math.max(2, Math.round(up * 0.7))));
  if (peak <= 0) return l.xh;
  let top = d.length - 1;
  for (let k = 2; k < d.length - 1; k++) {
    if (d[k] < peak * 0.4 && d[k + 1] < peak * 0.4) {
      top = k;
      break;
    }
  }
  const tall = tallShare(textOf(l)) >= 0.6;
  return tall ? (top * 0.448) / 0.662 : top;
}

/**
 * The type size that makes Times New Roman as wide as the line's words on
 * the page (the words' own widths, so stretched spaces in justified text do
 * not count). Matching widths is what keeps Word's lines breaking where the
 * paper's did. Only for lines with enough letters to tell.
 */
function sizeFromWidth(l: Line, dpi: number): number | undefined {
  let ink = 0;
  let em = 0;
  let n = 0;
  for (const w of l.words) {
    const style: Style = w.bold ? (w.italic ? 'bi' : 'b') : w.italic ? 'i' : 'r';
    const adv = timesWidth(w.text, style);
    // the ink of a word is a little narrower than its advance (the side bearings)
    em += Math.max(adv * 0.6, adv - BEARINGS);
    ink += w.box.x1 - w.box.x0;
    n += [...w.text].length;
  }
  if (n < 6 || em <= 0) return undefined;
  return (ink / em / dpi) * 72;
}

/** side bearings of a word's first and last letters together, em */
const BEARINGS = 0.04;

/** paragraphs whose size could only be guessed from the height of a few letters */
const guessed = new WeakSet<Para>();

/**
 * The size most of a group's text (the page's body, one table) is set in;
 * sizes within half a point of it are taken as it (the measure wavers a
 * little), and paragraphs too short to measure get it.
 */
function evenSizes(paras: Para[]) {
  const weight = new Map<number, number>();
  for (const p of paras) {
    if (guessed.has(p)) continue;
    const n = p.lines.reduce((a, l) => a + textOf(l).length, 0);
    weight.set(p.size, (weight.get(p.size) ?? 0) + n);
  }
  const sizes = [...weight.entries()];
  if (!sizes.length) return;
  let main = sizes[0][0];
  let best = -1;
  for (const [s] of sizes) {
    const near = sizes.filter(([t]) => Math.abs(t - s) <= 0.5).reduce((a, [, n]) => a + n, 0);
    if (near > best || (near === best && s < main)) {
      best = near;
      main = s;
    }
  }
  for (const p of paras) if (guessed.has(p) || Math.abs(p.size - main) <= 0.5) p.size = main;
}

function allParas(blocks: Block[]): Para[] {
  const out: Para[] = [];
  for (const b of blocks) {
    if (b.kind === 'para') out.push(b);
    else if (b.kind === 'table') for (const c of b.cells) out.push(...c.paras);
  }
  return out;
}

// ---- words: bold, italic ------------------------------------------------------

/** typical width of the upright strokes in a word, over its x-height (bold letters have wider ones) */
function strokeRatio(ink: Uint8Array, w: number, box: Box, base: number, xh: number): number {
  const runs: number[] = [];
  const y0 = Math.max(box.y0, Math.round(base - xh * 0.85));
  const y1 = Math.min(box.y1, Math.round(base - xh * 0.15));
  const max = xh * 0.8;
  for (let y = y0; y < y1; y++) {
    let run = 0;
    for (let x = box.x0; x <= box.x1; x++) {
      if (x < box.x1 && ink[y * w + x]) run++;
      else if (run) {
        if (run <= max) runs.push(run);
        run = 0;
      }
    }
  }
  // the mean, not the median: runs are whole pixels, and bold is only a pixel or two wider
  return runs.length >= 6 ? runs.reduce((a, b) => a + b, 0) / runs.length / xh : 0;
}

/**
 * How much a word leans: the shear (dx per dy) that stands its strokes
 * upright, found as the one giving the sharpest column profile. Italic type
 * leans about 0.2.
 */
function lean(ink: Uint8Array, w: number, box: Box, base: number): number {
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  if (bw < 4 || bh < 6) return 0;
  const score = (s: number) => {
    const pad = Math.ceil(Math.abs(s) * bh) + 1;
    const cols = new Float64Array(bw + 2 * pad);
    for (let y = box.y0; y < box.y1; y++) {
      const shift = s * (base - y);
      for (let x = box.x0; x < box.x1; x++) if (ink[y * w + x]) cols[Math.round(x - box.x0 - shift) + pad]++;
    }
    let v = 0;
    for (const c of cols) v += c * c;
    return v;
  };
  const upright = score(0);
  let best = 0;
  let bestScore = upright;
  for (const s of [0.08, 0.14, 0.2, 0.26, 0.32]) {
    const v = score(s);
    if (v > bestScore) {
      bestScore = v;
      best = s;
    }
  }
  return upright > 0 && bestScore > upright * 1.03 ? best : 0;
}

const LETTERS = /[\p{L}\p{N}]/u;

function markStyle(lines: Line[], prep: Prepared) {
  const ratios: { word: Word; r: number; n: number }[] = [];
  for (const l of lines) {
    for (const word of l.words) {
      const midX = (word.box.x0 + word.box.x1) / 2;
      const base = l.base.y0 + ((l.base.y1 - l.base.y0) * (midX - l.base.x0)) / Math.max(1, l.base.x1 - l.base.x0);
      const n = [...word.text].filter((c) => LETTERS.test(c)).length;
      ratios.push({ word, r: strokeRatio(prep.ink, prep.w, word.box, base, l.xh), n });
    }
  }
  const page = median(ratios.filter((x) => x.n >= 3 && x.r > 0).map((x) => x.r));
  for (const x of ratios) x.word.bold = page > 0 && x.r > page * 1.2;
  // a word's measure wavers: each word takes the style of most of its neighbourhood
  for (const l of lines) {
    if (l.words.length < 5) continue;
    const v = l.words.map((w) => !!w.bold);
    l.words.forEach((w, i) => {
      const near = v.slice(Math.max(0, i - 2), i + 3);
      w.bold = near.filter(Boolean).length * 2 > near.length;
    });
  }
  // a line is set in one style more often than not: short words follow their line
  for (const l of lines) {
    const long = l.words.filter((w) => [...w.text].filter((c) => LETTERS.test(c)).length >= 3);
    if (long.length < 2) continue;
    const bold = long.filter((w) => w.bold).length / long.length;
    for (const w of l.words) {
      if (bold >= 0.75) w.bold = true;
      else if (bold <= 0.25) w.bold = false;
    }
  }
  // italic: measured on each line as a whole (a word alone has too few strokes to tell)
  for (const l of lines) {
    const box = l.words.map((w) => w.box).reduce(union);
    const base = (l.base.y0 + l.base.y1) / 2;
    const italic = lean(prep.ink, prep.w, { ...box, y0: Math.max(box.y0, Math.round(base - l.xh * 1.6)), y1: Math.round(base) }, base) >= 0.14;
    for (const w of l.words) w.italic = italic;
  }
}

// ---- pieces of lines -------------------------------------------------------------

type Where = { table: number; cell: number } | null;

function whereIs(x: number, y: number, tables: Table[]): Where {
  for (let t = 0; t < tables.length; t++) {
    const b = tables[t].box;
    if (x < b.x0 || x >= b.x1 || y < b.y0 || y >= b.y1) continue;
    const cells = tables[t].cells;
    for (let c = 0; c < cells.length; c++) {
      const cb = cells[c].box;
      if (x >= cb.x0 && x < cb.x1 && y >= cb.y0 && y < cb.y1) return { table: t, cell: c };
    }
  }
  return null;
}

interface Seg extends Line {
  where: Where;
}

const baseAt = (l: Line, x: number) => l.base.y0 + ((l.base.y1 - l.base.y0) * (x - l.base.x0)) / Math.max(1, l.base.x1 - l.base.x0);
const baseY = (l: Line) => (l.base.y0 + l.base.y1) / 2;

function segment(line: Line, words: Word[], where: Where): Seg {
  const box = words.map((w) => w.box).reduce(union);
  return { words, where, xh: line.xh, box, base: { x0: box.x0, y0: baseAt(line, box.x0), x1: box.x1, y1: baseAt(line, box.x1) } };
}

/** splits Tesseract's lines where they cross into another cell, or jump a wide gap */
function segments(lines: Line[], tables: Table[], dpi: number): Seg[] {
  const out: Seg[] = [];
  for (const line of lines) {
    const words = [...line.words].sort((a, b) => a.box.x0 - b.box.x0);
    const maxGap = Math.max(dpi * 0.5, line.xh * 6);
    let cur: Word[] = [];
    let curWhere: Where = null;
    const same = (a: Where, b: Where) => (a === null ? b === null : b !== null && a.table === b.table && a.cell === b.cell);
    for (const w of words) {
      const where = whereIs((w.box.x0 + w.box.x1) / 2, (w.box.y0 + w.box.y1) / 2, tables);
      const last = cur[cur.length - 1];
      if (cur.length && (!same(where, curWhere) || (where === null && w.box.x0 - last.box.x1 > maxGap))) {
        out.push(segment(line, cur, curWhere));
        cur = [];
      }
      if (!cur.length) curWhere = where;
      cur.push(w);
    }
    if (cur.length) out.push(segment(line, cur, curWhere));
  }
  return out;
}

// ---- paragraphs ------------------------------------------------------------------

const MARK = /^([-–—•+*]\s|[-–—•+]$|\(?\d+(\.\d+)*[.)]\s|\d+(\.\d+)+\s|[a-zđ][.)]\s|[IVX]+[.)]\s|(Điều|Chương|CHƯƠNG|Mục|MỤC|Phụ lục|PHỤ LỤC|Bảng|Hình|Phần|PHẦN)\s)/u;

export const textOf = (l: Line) => l.words.map((w) => w.text).join(' ');

/** points from the x-height in pixels (Times New Roman: x-height 0.448 em) */
export const sizeOf = (xh: number, dpi: number) => Math.max(6, Math.min(48, Math.round(((xh / dpi) * 72) / 0.46 * 2) / 2));

/**
 * The lines of one column of text (the page, a cell, one side of a
 * borderless table), top to bottom, as paragraphs. left and right: the edges
 * the text is set between.
 */
export function paragraphs(segs: Line[], left: number, right: number, dpi: number, opts: { centreOf?: number; pageMid?: number } = {}): Para[] {
  const { centreOf, pageMid } = opts;
  const lines = [...segs].sort((a, b) => baseY(a) - baseY(b));
  if (!lines.length) return [];
  const xhAll = median(lines.map((l) => l.xh)) || dpi / 20;
  const steps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const d = baseY(lines[i]) - baseY(lines[i - 1]);
    if (d > xhAll * 1.5 && d < xhAll * 4.5) steps.push(d);
  }
  const pitch = median(steps) || xhAll * 2.6;
  const width = right - left;
  const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
  // centred: about the middle of the column, or about the centre its lines share (one side of a two-column heading)
  const centred = (l: Line) => {
    const mid = (l.box.x0 + l.box.x1) / 2;
    if (centreOf !== undefined) return near(mid, centreOf, Math.max(l.xh * 2, width * 0.04));
    // room on both sides, about as much on each: of the column, or of the page (margins are seldom even)
    const even = (a: number, b: number) => Math.abs(a - b) < Math.max(l.xh * 1.5, Math.min(a, b) * 0.15);
    const before = l.box.x0 - left;
    const after = right - l.box.x1;
    if (before < l.xh * 1.5 || after < l.xh * 1.5) return false;
    return even(before, after) || (pageMid !== undefined && even(l.box.x0, pageMid * 2 - l.box.x1));
  };
  const full = (l: Line) => right - l.box.x1 <= l.xh * 2.2;
  const bold = (l: Line) => l.words.filter((w) => w.bold).length * 2 > l.words.length;

  const groups: Line[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const b = lines[i];
    const a = lines[i - 1];
    let start = !a;
    if (a) {
      const d = baseY(b) - baseY(a);
      const xh = Math.max(a.xh, b.xh);
      if (d > pitch * 1.45 || d > xh * 4.2) start = true;
      else if (MARK.test(textOf(b))) start = true;
      else if (Math.abs(a.xh - b.xh) > Math.min(a.xh, b.xh) * 0.25) start = true;
      else if (bold(a) !== bold(b)) start = true;
      else if (centred(a) && centred(b)) start = false;
      else if (!full(a)) start = true;
      else if (b.box.x0 - left > xh * 1.2 && b.box.x0 > a.box.x0 + xh * 1.2) start = true;
      else if (centred(a) !== centred(b)) start = true;
    }
    if (start) groups.push([b]);
    else groups[groups.length - 1].push(b);
  }

  return groups.map((g): Para => {
    const box = g.map((l) => l.box).reduce(union);
    const xh = median(g.map((l) => l.xh));
    const size = paraSize(g, dpi);
    let pitchHere = 0;
    if (g.length > 1) pitchHere = median(g.slice(1).map((l, i) => baseY(l) - baseY(g[i])));
    let align: Para['align'] = 'left';
    let breaks = false;
    if (g.every(centred)) {
      align = 'center';
      breaks = g.length > 1;
    } else if (g.length === 1) {
      const l = g[0];
      if (right - l.box.x1 <= l.xh * 1.2 && l.box.x0 - left > width * 0.3) align = 'right';
    } else if (g.slice(0, -1).every(full)) align = 'justify';
    else breaks = true;
    let indent = 0;
    let firstLine = 0;
    let indentRight = 0;
    if (align === 'center') {
      // Word centres between the indents: they put the middle where the lines' middle is
      const mid = g.reduce((a, l) => a + (l.box.x0 + l.box.x1) / 2, 0) / g.length;
      const off = mid - (left + right) / 2;
      if (off > xh * 0.5) indent = 2 * off;
      else if (off < -xh * 0.5) indentRight = -2 * off;
    }
    if (align !== 'center' && align !== 'right') {
      const rest = g.length > 1 ? Math.min(...g.slice(1).map((l) => l.box.x0)) : g[0].box.x0;
      indent = Math.max(0, rest - left);
      if (g.length === 1) {
        firstLine = 0;
      } else firstLine = g[0].box.x0 - left - indent;
      if (Math.abs(firstLine) < xh * 0.5) firstLine = 0;
      if (indent < xh * 0.5) indent = 0;
    }
    return sized({ kind: 'para', box, lines: g, align, breaks, indent, firstLine, indentRight, size, pitch: pitchHere || pitch, before: 0 });
  });
}

/** the size of a paragraph's type: from its lines' widths, else from the height of its letters */
function paraSize(lines: Line[], dpi: number): number {
  const measured = lines.filter((l) => l.size).map((l) => l.size!);
  return measured.length ? Math.max(6, Math.min(48, Math.round(median(measured) * 2) / 2)) : sizeOf(median(lines.map((l) => l.xh)), dpi);
}

const sized = (p: Para) => {
  if (!p.lines.some((l) => l.size)) guessed.add(p);
  return p;
};

/** text side by side in one row: one line, the later pieces at tab stops */
function tabbed(row: Line[], left: number, right: number, dpi: number): Para {
  const sorted = [...row].sort((a, b) => a.box.x0 - b.box.x0);
  const xh = median(sorted.map((l) => l.xh));
  const box = sorted.map((l) => l.box).reduce(union);
  return sized({
    kind: 'para',
    box,
    lines: sorted,
    align: 'left',
    breaks: false,
    indent: Math.max(0, sorted[0].box.x0 - left),
    firstLine: 0,
    indentRight: 0,
    size: paraSize(sorted, dpi),
    pitch: 0,
    before: 0,
    tabs: sorted.slice(1).map((l) => (right - l.box.x1 <= xh * 1.5 ? { at: l.box.x1 - left, kind: 'right' as const } : { at: l.box.x0 - left, kind: 'left' as const })),
  });
}

// ---- side by side ------------------------------------------------------------------

/** lines grouped by their baselines: lines in one row sit side by side */
function rowsOf(segs: Seg[]): Seg[][] {
  const sorted = [...segs].sort((a, b) => baseY(a) - baseY(b));
  const rows: { base: number; xh: number; items: Seg[] }[] = [];
  for (const s of sorted) {
    const row = rows.find((r) => Math.abs(baseY(s) - r.base) <= Math.max(r.xh, s.xh) * 0.7);
    if (row) {
      row.items.push(s);
      row.base = row.items.reduce((a, x) => a + baseY(x), 0) / row.items.length;
    } else rows.push({ base: baseY(s), xh: s.xh, items: [s] });
  }
  return rows.sort((a, b) => a.base - b.base).map((r) => r.items.sort((a, b) => a.box.x0 - b.box.x0));
}

type FlowItem = { y: number; block?: Block; seg?: Seg };

/**
 * The page's own lines (not in tables) into the flow: rows with text side
 * by side start a region; following rows join it while their text keeps to
 * its columns. A region of one row is one line with tab stops; a taller one
 * is a borderless table.
 */
function sideBySide(segs: Seg[], left: number, right: number, dpi: number, barriers: number[]): FlowItem[] {
  const rows = rowsOf(segs);
  const width = right - left;
  // text across most of the column is not one side of anything
  const wide = (s: Seg) => s.box.x1 - s.box.x0 > width * 0.6;
  const crossed = (y0: number, y1: number) => barriers.some((b) => b > y0 && b < y1);
  const items: FlowItem[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.length < 2 || row.some(wide)) {
      if (row.length >= 2) {
        // pieces of one line far apart, one of them long: one line with tab stops
        items.push({ y: row[0].box.y0, block: tabbed(row, left, right, dpi) });
        i++;
        continue;
      }
      items.push({ y: row[0].box.y0, seg: row[0] });
      i++;
      continue;
    }
    // column ranges from this row; following rows join while they fit them
    let cols = row.map((s) => ({ x0: s.box.x0, x1: s.box.x1 }));
    const region: Seg[][] = [row];
    let j = i + 1;
    const xh = median(row.map((s) => s.xh));
    while (j < rows.length) {
      const next = rows[j];
      const prevBottom = Math.max(...region[region.length - 1].map((s) => s.box.y1));
      const gap = next[0].box.y0 - prevBottom;
      if (gap > xh * 3.5) break;
      if (next.some(wide) || crossed(prevBottom, Math.min(...next.map((s) => s.box.y0)))) break;
      const fits = next.every((s) => {
        const hit = cols.filter((c) => s.box.x1 > c.x0 - xh && s.box.x0 < c.x1 + xh);
        return hit.length === 1;
      });
      if (!fits) break;
      for (const s of next) {
        const c = cols.find((c) => s.box.x1 > c.x0 - xh && s.box.x0 < c.x1 + xh)!;
        c.x0 = Math.min(c.x0, s.box.x0);
        c.x1 = Math.max(c.x1, s.box.x1);
      }
      region.push(next);
      j++;
    }
    cols = cols.sort((a, b) => a.x0 - b.x0);
    const all = region.flat();
    if (region.length === 1) {
      items.push({ y: row[0].box.y0, block: tabbed(row, left, right, dpi) });
    } else {
      // columns meet halfway between them
      const xs = [left];
      for (let k = 1; k < cols.length; k++) xs.push(Math.round((cols[k - 1].x1 + cols[k].x0) / 2));
      xs.push(right);
      const box = all.map((s) => s.box).reduce(union);
      const cells: Cell[] = cols.map((c, k) => {
        const mine = all.filter((s) => {
          const mid = (s.box.x0 + s.box.x1) / 2;
          return mid >= xs[k] && mid < xs[k + 1];
        });
        // the side's lines share a centre (they start at different places): it is centred about it
        const mids = mine.map((s) => (s.box.x0 + s.box.x1) / 2);
        const starts = mine.map((s) => s.box.x0);
        const tol = Math.max(xh * 1.2, dpi * 0.06);
        const shared = mine.length >= 2 && Math.max(...mids) - Math.min(...mids) < tol && Math.max(...starts) - Math.min(...starts) > tol;
        const centreOf = shared ? mids.reduce((a, b) => a + b, 0) / mids.length : undefined;
        return {
          r0: 0,
          r1: 1,
          c0: k,
          c1: k + 1,
          box: { x0: xs[k], y0: box.y0, x1: xs[k + 1], y1: box.y1 },
          top: false,
          bottom: false,
          left: false,
          right: false,
          valign: 'top',
          paras: spaced(paragraphs(mine, xs[k], xs[k + 1], dpi, { centreOf }), dpi),
        };
      });
      const t: TableBlock = { kind: 'table', box: { ...box, x0: left, x1: right }, xs, ys: [box.y0, box.y1], cells, borderless: true, before: 0 };
      items.push({ y: box.y0, block: t });
    }
    i = j;
  }
  return items;
}

// ---- pictures ------------------------------------------------------------------------

/** ink that is neither words nor lines, in clumps big enough to be a picture */
function findPictures(prep: Prepared, lines: Line[]): Box[] {
  const { w, h, dpi } = prep;
  const mask = prep.ink.slice();
  // words are text unless Tesseract was quite unsure of them and of their line (marks it
  // tried to read in a logo or a stamp)
  const words = lines.flatMap((l) => {
    const conf = l.words.reduce((a, x) => a + x.conf, 0) / l.words.length;
    return l.words.filter((x) => x.conf >= 30 || (conf >= 60 && l.words.length >= 2));
  });
  for (const word of words) {
    const x0 = Math.max(0, word.box.x0 - 2);
    const x1 = Math.min(w, word.box.x1 + 2);
    for (let y = Math.max(0, word.box.y0 - 2); y < Math.min(h, word.box.y1 + 2); y++) mask.fill(0, y * w + x0, y * w + x1);
  }
  const s = Math.max(4, Math.round(dpi / 30));
  const gw = Math.ceil(w / s);
  const gh = Math.ceil(h / s);
  const grid = new Uint8Array(gw * gh);
  const count = new Uint16Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const gy = (y / s) | 0;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) count[gy * gw + ((x / s) | 0)]++;
  }
  for (let i = 0; i < grid.length; i++) grid[i] = count[i] >= 3 ? 1 : 0;
  // join what is close (parts of one drawing)
  const r = 2;
  const grown = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      if (!grid[y * gw + x]) continue;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) grown[yy * gw + xx] = 1;
        }
    }
  const seen = new Uint8Array(gw * gh);
  const out: Box[] = [];
  const stack: number[] = [];
  for (let i = 0; i < grown.length; i++) {
    if (!grown[i] || seen[i]) continue;
    let x0 = gw;
    let y0 = gh;
    let x1 = 0;
    let y1 = 0;
    let inkCells = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % gw;
      const y = (k / gw) | 0;
      if (grid[k]) {
        inkCells += count[k];
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      for (const n of [k - 1, k + 1, k - gw, k + gw]) {
        if (n < 0 || n >= grown.length || seen[n] || !grown[n]) continue;
        if ((n === k - 1 && x === 0) || (n === k + 1 && x === gw - 1)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (x1 < x0) continue;
    const box = { x0: x0 * s, y0: y0 * s, x1: Math.min(w, (x1 + 1) * s), y1: Math.min(h, (y1 + 1) * s) };
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    if (bw < dpi * 0.3 || bh < dpi * 0.3) continue;
    if (inkCells < dpi * dpi * 0.012) continue;
    // a streak along the scan's edge (shadow, punch holes)
    const atEdge = box.x0 <= s || box.y0 <= s || box.x1 >= w - s || box.y1 >= h - s;
    if (atEdge && (bw < dpi * 0.25 || bh < dpi * 0.25 || Math.max(bw / bh, bh / bw) > 5)) continue;
    out.push(box);
  }
  return out;
}

/** that part of the page in colour, as PNG (the colour page is the one before straightening) */
function cutOut(rgba: { data: Uint8Array | Uint8ClampedArray; w: number; h: number }, box: Box, prep: Prepared): { png: Uint8Array; box: Box } {
  const pad = Math.round(prep.dpi / 50);
  const x0 = Math.max(0, box.x0 - pad);
  const y0 = Math.max(0, box.y0 - pad);
  const x1 = Math.min(prep.w, box.x1 + pad);
  const y1 = Math.min(prep.h, box.y1 + pad);
  const w = x1 - x0;
  const h = y1 - y0;
  const out = new Uint8Array(w * h * 4);
  // the colour page has the same size as the grey one it was read from
  const sx = rgba.w / prep.w;
  const sy = rgba.h / prep.h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = unrotatePoint(x0 + x, y0 + y, prep.angle, prep.w, prep.h);
      const ox = Math.min(rgba.w - 1, Math.max(0, Math.round(p.x * sx)));
      const oy = Math.min(rgba.h - 1, Math.max(0, Math.round(p.y * sy)));
      const i = (oy * rgba.w + ox) * 4;
      const o = (y * w + x) * 4;
      out[o] = rgba.data[i];
      out[o + 1] = rgba.data[i + 1];
      out[o + 2] = rgba.data[i + 2];
      out[o + 3] = 255;
    }
  return { png: encodePng({ rgba: out, w, h }), box: { x0, y0, x1, y1 } };
}

// ---- the page ------------------------------------------------------------------------

export interface PageInput {
  prep: Prepared;
  lines: Line[];
  /** the page in colour as rendered (before straightening), for pictures */
  rgba: { data: Uint8Array | Uint8ClampedArray; w: number; h: number } | null;
  widthPt: number;
  heightPt: number;
}

const NUMERIC = /^[\d.,%/+\-–=x×()]+$/;
/** what Tesseract makes of a lone "1" or "0" */
const LOOKS_1 = /^[lI|\]\[!í]$/;
const LOOKS_0 = /^[oO]$/;

/**
 * In a column of figures, a cell read as a lone l, I, | or ] is a 1 (and a
 * lone O a 0): Tesseract cannot tell them apart without words around them.
 */
function fixFigures(t: Table, segs: Seg[], index: number) {
  const C = t.xs.length - 1;
  for (let c = 0; c < C; c++) {
    const cells = t.cells.map((cell, k) => ({ cell, k })).filter(({ cell }) => cell.c0 === c && cell.c1 === c + 1);
    const texts = cells.map(({ k }) => segs.filter((s) => s.where?.table === index && s.where.cell === k));
    const filled = texts.filter((list) => list.length);
    const figures = filled.filter((list) => list.every((s) => NUMERIC.test(textOf(s).replace(/\s/g, ''))));
    if (filled.length < 3 || figures.length * 2 < filled.length) continue;
    for (const list of texts) {
      if (list.length !== 1 || list[0].words.length !== 1) continue;
      const w = list[0].words[0];
      if (LOOKS_1.test(w.text)) w.text = '1';
      else if (LOOKS_0.test(w.text)) w.text = '0';
    }
  }
  // what is left of such marks is a speck or the stub of a border
  for (const s of segs) if (s.where?.table === index) s.words = s.words.filter((w) => !/^[|\][!]$/.test(w.text));
}

function tableBlock(t: Table, segs: Seg[], index: number, dpi: number): TableBlock {
  fixFigures(t, segs, index);
  const cells: Cell[] = t.cells.map((c, k) => {
    const mine = segs.filter((s) => s.where && s.where.table === index && s.where.cell === k && s.words.length);
    const pad = dpi / 40;
    const paras = paragraphs(mine, c.box.x0 + pad, c.box.x1 - pad, dpi);
    spaceBlocks(paras, dpi);
    let valign: Cell['valign'] = 'top';
    if (mine.length) {
      const top = Math.min(...mine.map((s) => s.box.y0)) - c.box.y0;
      const bottom = c.box.y1 - Math.max(...mine.map((s) => s.box.y1));
      const hgt = c.box.y1 - c.box.y0;
      if (Math.abs(top - bottom) < hgt * 0.22 || Math.abs(top - bottom) < dpi * 0.05) valign = 'center';
      else valign = top < bottom ? 'top' : 'bottom';
    }
    return { ...c, valign, paras };
  });
  return { kind: 'table', box: t.box, xs: t.xs, ys: t.ys, cells, borderless: false, before: 0 };
}

export function layoutPage(input: PageInput): PageLayout {
  const { prep, rgba } = input;
  const { w, h, dpi } = prep;
  // a "word" far taller than the page's words is a drawing Tesseract tried to read
  const heights = input.lines.flatMap((l) => l.words.map((x) => x.box.y1 - x.box.y0));
  const tall = Math.max(dpi * 0.45, median(heights) * 4);
  for (const l of input.lines) l.words = l.words.filter((x) => x.box.y1 - x.box.y0 <= tall);
  const lines = input.lines.filter((l) => l.words.length);
  // a box drawn round a drawing (one or two "cells" with no word in them) is part of the picture
  // (Tesseract may read a mark or two in the drawing: they cover little of it)
  const boxed = prep.ruling.tables.filter((t) => {
    if (t.cells.length > 2) return false;
    const inside = lines.flatMap((l) => l.words).filter((x) => {
      const c = { x: (x.box.x0 + x.box.x1) / 2, y: (x.box.y0 + x.box.y1) / 2 };
      return c.x >= t.box.x0 && c.x < t.box.x1 && c.y >= t.box.y0 && c.y < t.box.y1;
    });
    const area = (t.box.x1 - t.box.x0) * (t.box.y1 - t.box.y0);
    const covered = inside.reduce((a, x) => a + (x.box.x1 - x.box.x0) * (x.box.y1 - x.box.y0), 0);
    const ink = inkIn(prep.ink, w, { x0: t.box.x0 + 6, y0: t.box.y0 + 6, x1: t.box.x1 - 6, y1: t.box.y1 - 6 });
    return inside.length <= 2 && covered < area * 0.08 && ink > dpi * dpi * 0.02;
  });
  const ruling: Ruling = { ...prep.ruling, tables: prep.ruling.tables.filter((t) => !boxed.includes(t)) };
  for (const l of lines) l.words = l.words.filter((x) => !boxed.some((t) => (x.box.x0 + x.box.x1) / 2 >= t.box.x0 && (x.box.x0 + x.box.x1) / 2 < t.box.x1 && (x.box.y0 + x.box.y1) / 2 >= t.box.y0 && (x.box.y0 + x.box.y1) / 2 < t.box.y1));
  // small-letter height: from the line's width where it is long enough
  // (steady), else measured on its ink; then bold and italic, then the size
  // again with them (bold type is wider)
  const xhOf = (size: number) => (size / 72) * dpi * 0.448;
  for (const l of lines) {
    const size = sizeFromWidth(l, dpi);
    if (size) l.xh = xhOf(size);
    else {
      const m = measureXh(l, prep.ink, prep.w);
      if (m > (l.box.y1 - l.box.y0) * 0.3) l.xh = m;
    }
  }
  markStyle(lines, prep);

  // pictures, and the words that are only marks inside them
  // (a clump inside a table cell is a leftover of its text or border, unless it is big)
  const picBoxes = [...boxed.map((t) => t.box), ...findPictures(prep, lines)].filter((b, i, all) => !all.some((o, j) => j < i && b.x0 >= o.x0 - 4 && b.x1 <= o.x1 + 4 && b.y0 >= o.y0 - 4 && b.y1 <= o.y1 + 4)).filter(
    (b) => !ruling.tables.some((t) => t.cells.some((c) => b.x0 >= c.box.x0 - 4 && b.x1 <= c.box.x1 + 4 && b.y0 >= c.box.y0 - 4 && b.y1 <= c.box.y1 + 4 && (b.x1 - b.x0 < dpi * 0.6 || b.y1 - b.y0 < dpi * 0.6))),
  );
  const inPic = (b: Box) => picBoxes.some((p) => b.x0 >= p.x0 - 2 && b.x1 <= p.x1 + 2 && b.y0 >= p.y0 - 2 && b.y1 <= p.y1 + 2);
  for (const l of lines) l.words = l.words.filter((w) => !(inPic(w.box) && (w.conf < 50 || ([...w.text].length <= 2 && w.conf < 80))));
  const kept = lines.filter((l) => l.words.length);

  // pieces Tesseract was unsure of throughout are specks and smudges, not text
  // (in a table cell, where text is expected, an unsure word of some length is kept)
  let segs = segments(kept, ruling.tables, dpi).filter((sg) => {
    const conf = sg.words.reduce((a, w) => a + w.conf, 0) / sg.words.length;
    const letters = [...textOf(sg)].filter((c) => LETTERS.test(c)).length;
    if (sg.where) return conf >= 45 || letters >= 3 || (sg.words.length === 1 && conf >= 20);
    if (conf < 45) return false;
    return !(sg.words.length === 1 && letters <= 2 && conf < 70);
  });
  for (const sg of segs) {
    sg.size = sizeFromWidth(sg, dpi);
    if (sg.size) sg.xh = xhOf(sg.size);
  }
  const free = () => segs.filter((s) => !s.where);

  // the running header and footer: text beyond a rule at the top or bottom, or beyond the frame
  const header: Block[] = [];
  const footer: Block[] = [];
  // (a rule inside the page's frame belongs to what the frame holds)
  const fr = ruling.frame;
  const topRules = ruling.loose.filter((r) => r.dir === 'h' && r.at < h * 0.16 && r.a1 - r.a0 > w * 0.3 && (!fr || r.at < fr.y0));
  const bottomRules = ruling.loose.filter((r) => r.dir === 'h' && r.at > h * 0.84 && r.a1 - r.a0 > w * 0.3 && (!fr || r.at > fr.y1));
  const usedRules = new Set<Rule>();
  let headLimit = ruling.frame ? ruling.frame.y0 : -1;
  let footLimit = ruling.frame ? ruling.frame.y1 : h + 1;
  if (topRules.length) {
    const lowest = Math.max(...topRules.map((r) => r.at));
    if (free().some((s) => s.box.y1 <= lowest + 2)) {
      headLimit = Math.max(headLimit, lowest);
      topRules.forEach((r) => usedRules.add(r));
    }
  }
  if (bottomRules.length) {
    const highest = Math.min(...bottomRules.map((r) => r.at));
    if (free().some((s) => s.box.y0 >= highest - 2)) {
      footLimit = Math.min(footLimit, highest);
      bottomRules.forEach((r) => usedRules.add(r));
    }
  }
  const headSegs = free().filter((s) => s.box.y1 <= headLimit + 2);
  const footSegs = free().filter((s) => s.box.y0 >= footLimit - 2);
  if (!footSegs.length && !bottomRules.length) {
    // a page number on its own at the foot
    const rest = free();
    const last = rest.sort((a, b) => b.box.y1 - a.box.y1)[0];
    const above = rest.filter((s) => s !== last);
    const lowestOther = Math.max(...above.map((s) => s.box.y1), ...ruling.tables.map((t) => t.box.y1));
    if (last && last.box.y0 > h * 0.88 && last.box.y0 - lowestOther > last.xh * 3 && textOf(last).length <= 14) footSegs.push(last);
  }
  segs = segs.filter((s) => !headSegs.includes(s) && !footSegs.includes(s));

  // the text column
  const bodyFree = free();
  // (one short piece far out from the rest is not where the text column starts)
  const edgeOf = (list: Seg[], side: 'x0' | 'x1') => {
    const sorted = [...list].sort((a, b) => (side === 'x0' ? a.box.x0 - b.box.x0 : b.box.x1 - a.box.x1));
    if (!sorted.length) return undefined;
    const [a, b] = sorted;
    if (b && Math.abs(a.box[side] - b.box[side]) > dpi * 0.3 && a.words.length <= 3) return b.box[side];
    return a.box[side];
  };
  let left = Math.min(edgeOf(bodyFree, 'x0') ?? w * 0.1, ...ruling.tables.map((t) => t.box.x0));
  let right = Math.max(edgeOf(bodyFree, 'x1') ?? w * 0.9, ...ruling.tables.map((t) => t.box.x1));
  if (!isFinite(left) || !isFinite(right) || right - left < w * 0.2) {
    left = w * 0.1;
    right = w * 0.9;
  }
  // a few marks out in the margin (a note, a stamp's edge) are not part of the text
  segs = segs.filter((sg) => sg.where || !((sg.box.x0 >= right - 2 || sg.box.x1 <= left + 2) && sg.words.length <= 3));

  const items: FlowItem[] = [];
  ruling.tables.forEach((t, k) => items.push({ y: t.box.y0, block: tableBlock(t, segs, k, dpi) }));
  for (const r of ruling.loose) {
    if (usedRules.has(r) || r.dir !== 'h' || r.a1 - r.a0 < (right - left) * 0.3) continue;
    if (r.at <= headLimit + 2 || r.at >= footLimit - 2) continue;
    const rule: RuleBlock = { kind: 'rule', box: { x0: r.a0, y0: r.at - r.thick / 2, x1: r.a1, y1: r.at + r.thick / 2 }, thick: r.thick, before: 0 };
    items.push({ y: r.at, block: rule });
  }
  const textBoxes = kept.flatMap((l) => l.words.map((w) => w.box));
  const pictures: Picture[] = [];
  for (const b of picBoxes) {
    if (!rgba) break;
    const overText = textBoxes.some((t) => t.x0 < b.x1 && t.x1 > b.x0 && t.y0 < b.y1 && t.y1 > b.y0);
    const inTable = ruling.tables.some((t) => b.x0 < t.box.x1 && b.x1 > t.box.x0 && b.y0 < t.box.y1 && b.y1 > t.box.y0);
    const cut = cutOut(rgba, b, prep);
    const p: Picture = { kind: 'picture', box: cut.box, png: cut.png, behind: overText || inTable || b.y1 <= headLimit || b.y0 >= footLimit, before: 0 };
    pictures.push(p);
    if (!p.behind) items.push({ y: b.y0, block: p });
  }
  // a region of text side by side never reaches across a table, a rule or a picture
  const barriers = items.map((it) => it.y);
  items.push(...sideBySide(free(), left, right, dpi, barriers));
  items.sort((a, b) => a.y - b.y);

  // the flow: runs of lines become paragraphs
  const blocks: Block[] = [];
  let run: Seg[] = [];
  const flush = () => {
    if (run.length) blocks.push(...paragraphs(run, left, right, dpi, { pageMid: w / 2 }));
    run = [];
  };
  for (const it of items) {
    if (it.seg) run.push(it.seg);
    else {
      flush();
      blocks.push(it.block!);
    }
  }
  flush();
  spaceBlocks(blocks, dpi);

  const edgeBlocks = (list: Seg[], rules: Rule[], under: boolean): Block[] => {
    const out: Block[] = paragraphs(list, left, right, dpi);
    if (rules.length) {
      const ys = rules.map((r) => r.at);
      const box = { x0: Math.min(...rules.map((r) => r.a0)), x1: Math.max(...rules.map((r) => r.a1)), y0: Math.min(...ys), y1: Math.max(...ys) };
      const rule: RuleBlock = { kind: 'rule', box, thick: Math.max(...rules.map((r) => r.thick)), double: rules.length > 1, before: 0 };
      if (under) out.push(rule);
      else out.unshift(rule);
    }
    spaceBlocks(out, dpi);
    return out;
  };
  header.push(...edgeBlocks(headSegs, topRules.filter((r) => usedRules.has(r)), true));
  footer.push(...edgeBlocks(footSegs, bottomRules.filter((r) => usedRules.has(r)), false));

  // sizes evened out where text is alike: the body, each table, header and footer
  const bodyParas = allParas(blocks.filter((b) => b.kind !== 'table' || b.borderless));
  evenSizes(bodyParas);
  for (const b of blocks) if (b.kind === 'table' && !b.borderless) evenSizes(allParas([b]));
  evenSizes(allParas(header));
  evenSizes(allParas(footer));

  // floating pictures go with the page (the writer anchors them to its first paragraph)
  for (const p of pictures) if (p.behind) blocks.push(p);

  const bodyBlocks = blocks.filter((b) => !(b.kind === 'picture' && b.behind));
  const top = bodyBlocks.length ? Math.min(...bodyBlocks.map((b) => b.box.y0)) : h * 0.1;
  const bottom = bodyBlocks.length ? Math.max(...bodyBlocks.map((b) => b.box.y1)) : h * 0.9;
  const frame = ruling.frame
    ? { x0: ruling.frame.x0, y0: ruling.frame.y0, x1: ruling.frame.x1, y1: ruling.frame.y1, thick: Math.max(1, median(ruling.frame.rules.map((r) => r.thick))), double: ruling.frame.rules.some((a) => ruling.frame!.rules.some((b) => a !== b && a.dir === b.dir && Math.abs(a.at - b.at) > 2 && Math.abs(a.at - b.at) < dpi / 20)) }
    : null;

  return { w, h, dpi, widthPt: input.widthPt, heightPt: input.heightPt, body: { x0: left, x1: right, y0: top, y1: bottom }, blocks, header, footer, frame, angle: prep.angle };
}

const spaced = (paras: Para[], dpi: number) => {
  spaceBlocks(paras, dpi);
  return paras;
};

/** the space above each block, from the gaps on the page */
function spaceBlocks(blocks: Block[], dpi: number) {
  for (let i = 1; i < blocks.length; i++) {
    const a = blocks[i - 1];
    const b = blocks[i];
    if (b.kind === 'picture' && b.behind) continue;
    let gap: number;
    if (a.kind === 'para' && b.kind === 'para') {
      const lastA = a.lines[a.lines.length - 1];
      const firstB = b.lines[0];
      const lineH = b.pitch || (b.size / 72) * dpi * 1.15;
      gap = baseY(firstB) - baseY(lastA) - lineH;
    } else if (b.kind === 'para') {
      gap = b.box.y0 - a.box.y1 - b.lines[0].xh * 0.8;
    } else gap = b.box.y0 - a.box.y1;
    b.before = Math.max(0, Math.round(gap));
  }
}
