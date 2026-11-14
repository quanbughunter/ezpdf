/**
 * Colour marks behind text: the band a word processor paints behind
 * highlighted words, and highlight annotations.
 *
 * Google Docs, Chrome, Word and LibreOffice do not save a highlight as a
 * highlight: they paint a filled rectangle in the page content, one per line,
 * just before the words. Taking the highlight off is taking those rectangles
 * out of the content (text-edit.ts), so this file only decides which filled
 * rectangles are such marks and which belong together.
 *
 * A filled rectangle is a mark under a line when
 *  - it is coloured (not white) and lies under the words of that line only
 *    (a band reaching into another line is a cell or box background);
 *  - its height is that of the text (more than half the type size, at most
 *    2.6 times it) and it does not reach more than 0.6 em past the words;
 *  - it is drawn before the words, or over them but see-through (a flattened
 *    highlight); an opaque box drawn over words hides them and is never
 *    offered (taking it away could uncover a redaction);
 *  - the words on it are dark: light words on a dark band need the band;
 *  - its left and right sides do not sit on the table's vertical rules
 *    (that is a cell background).
 *
 * Marks of the same colour that touch line after line, with no rule between
 * them, make a passage; the bar takes a passage off in one go.
 *
 * Pure geometry, PDF user space (y up). Tested in tests/marks.test.ts.
 */
import type { Box } from './text-edit';

/** A straight rule (table border, line) along one axis. */
export interface Rule {
  vertical: boolean;
  /** x of a vertical rule, y of a horizontal one */
  at: number;
  /** extent along the rule */
  from: number;
  to: number;
}

/** A filled path made only of rectangles. */
export interface Fill {
  /** place in the page's object list (drawing order) */
  index: number;
  pieces: Box[];
  /** 0–255, alpha includes the fill opacity */
  color: [number, number, number, number];
}

/** A text object, with the line it belongs to. */
export interface MarkText {
  index: number;
  box: Box;
  /** type size on the page */
  size: number;
  line: number;
  /** dark enough to read on white */
  dark: boolean;
}

/** A highlight annotation: its quads. */
export interface AnnotMark {
  index: number;
  pieces: Box[];
  color: [number, number, number];
}

const height = (b: Box) => b.top - b.bottom;
const width = (b: Box) => b.right - b.left;
const hOverlap = (a: Box, b: Box) => Math.min(a.right, b.right) - Math.max(a.left, b.left);
const vOverlap = (a: Box, b: Box) => Math.min(a.top, b.top) - Math.max(a.bottom, b.bottom);

/** Text objects a piece lies under: a real part of their width, at least half their height. */
function under(p: Box, texts: MarkText[]) {
  return texts.filter((t) => hOverlap(p, t.box) > Math.min(0.3 * t.size, 0.5 * width(t.box)) && vOverlap(p, t.box) >= 0.5 * height(t.box));
}

/** Both side edges on vertical rules that run along it: a table cell's background. */
function cellBackground(p: Box, rules: Rule[]) {
  const tol = 1.5;
  const on = (x: number) =>
    rules.some((r) => r.vertical && Math.abs(r.at - x) <= tol && Math.min(r.to, p.top) - Math.max(r.from, p.bottom) >= 0.8 * height(p));
  return on(p.left) && on(p.right);
}

/** The line a piece marks, or null when it is not a mark. */
function pieceLine(p: Box, fill: Fill, texts: MarkText[], rules: Rule[]): number | null {
  const over = under(p, texts);
  if (!over.length) return null;
  const line = over[0].line;
  if (over.some((t) => t.line !== line)) return null;
  const s = Math.max(...over.map((t) => t.size));
  const h = height(p);
  if (h < 0.55 * s || h > 2.6 * s) return null;
  // reaching into another line: a box or cell background
  if (texts.some((t) => t.line !== line && hOverlap(p, t.box) > 0 && vOverlap(p, t.box) > 0.3 * height(t.box))) return null;
  // over the words and opaque: it hides them, it is not a highlight
  if (fill.index > Math.min(...over.map((t) => t.index)) && fill.color[3] > 200) return null;
  if (over.some((t) => !t.dark)) return null;
  const left = Math.min(...over.map((t) => t.box.left));
  const right = Math.max(...over.map((t) => t.box.right));
  if (p.left < left - 0.6 * s || p.right > right + 0.6 * s) return null;
  if (cellBackground(p, rules)) return null;
  return line;
}

/**
 * The fills that are marks, each with the lines it lies under. A fill is a
 * mark only when every one of its rectangles is.
 */
export function findMarks(fills: Fill[], texts: MarkText[], rules: Rule[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  fills.forEach((fill, k) => {
    const [r, g, b, a] = fill.color;
    if (a < 20 || Math.min(r, g, b) >= 245 || !fill.pieces.length) return;
    const lines = new Set<number>();
    for (const p of fill.pieces) {
      const line = pieceLine(p, fill, texts, rules);
      if (line === null) return;
      lines.add(line);
    }
    out.set(k, [...lines]);
  });
  return out;
}

/** Lines a highlight annotation lies over. */
export function annotLines(a: AnnotMark, texts: MarkText[]): number[] {
  const lines = new Set<number>();
  for (const p of a.pieces) for (const t of texts) if (hOverlap(p, t.box) > 0 && vOverlap(p, t.box) >= 0.5 * height(t.box)) lines.add(t.line);
  return [...lines];
}

const sameColor = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) <= 10 && Math.abs(a[1] - b[1]) <= 10 && Math.abs(a[2] - b[2]) <= 10;

/** A rule between two pieces, across the gap that separates them. */
function ruleBetween(p: Box, q: Box, rules: Rule[]) {
  const [hi, lo] = p.bottom >= q.top ? [p, q] : q.bottom >= p.top ? [q, p] : [null, null];
  if (hi && lo) {
    const from = Math.max(p.left, q.left), to = Math.min(p.right, q.right);
    if (rules.some((r) => !r.vertical && r.at <= hi.bottom + 0.5 && r.at >= lo.top - 0.5 && Math.min(r.to, to) - Math.max(r.from, from) > 0)) return true;
  }
  const [rt, lf] = p.left >= q.right ? [p, q] : q.left >= p.right ? [q, p] : [null, null];
  if (rt && lf) {
    const from = Math.max(p.bottom, q.bottom), to = Math.min(p.top, q.top);
    if (rules.some((r) => r.vertical && r.at <= rt.left + 0.5 && r.at >= lf.right - 0.5 && Math.min(r.to, to) - Math.max(r.from, from) > 0)) return true;
  }
  return false;
}

/** Two pieces of one passage: the next line (or the next run on the line), nothing ruled between. */
function touches(p: Box, q: Box, rules: Rule[]) {
  const h = Math.min(height(p), height(q));
  const vGap = Math.max(p.bottom, q.bottom) - Math.min(p.top, q.top);
  const hGap = Math.max(p.left, q.left) - Math.min(p.right, q.right);
  return vGap <= 0.8 * h && hGap <= 0.5 * h && !ruleBetween(p, q, rules);
}

/**
 * The passage of marks a line belongs to: the fills under it, and the fills
 * of the same colour that touch them line after line. Returns fill numbers
 * (keys of `marks`).
 */
export function passage(line: number, marks: Map<number, number[]>, fills: Fill[], rules: Rule[]): number[] {
  const seen = new Set<number>();
  const queue: number[] = [];
  for (const [k, lines] of marks) if (lines.includes(line)) (seen.add(k), queue.push(k));
  while (queue.length) {
    const a = queue.pop()!;
    for (const b of marks.keys()) {
      if (seen.has(b) || !sameColor(fills[a].color, fills[b].color)) continue;
      if (fills[a].pieces.some((p) => fills[b].pieces.some((q) => touches(p, q, rules)))) {
        seen.add(b);
        queue.push(b);
      }
    }
  }
  return [...seen].sort((x, y) => x - y);
}

/** A vertical rule between two text boxes on one line (two table cells). */
export function ruleSplits(a: Box, b: Box, rules: Rule[]): boolean {
  const lo = Math.min(a.bottom, b.bottom), hi = Math.max(a.top, b.top);
  const band = hi - lo;
  return rules.some((r) => r.vertical && r.at > a.right - 1 && r.at < b.left + 1 && Math.min(r.to, hi) - Math.max(r.from, lo) >= 0.5 * band);
}

/**
 * Rules and fills from the rectangles and segments of one path object
 * (page space). `rects` and `segments` come from the path's subpaths;
 * `other` is true when some subpath is neither (a curve, a polygon).
 */
export function classifyPath(
  shape: { rects: Box[]; segments: { x0: number; y0: number; x1: number; y1: number }[]; other: boolean },
  filled: boolean,
  stroked: boolean,
): { rules: Rule[]; fillPieces: Box[] | null } {
  const rules: Rule[] = [];
  const thin = (b: Box) => Math.min(width(b), height(b)) <= 2 && Math.max(width(b), height(b)) >= 3;
  for (const s of shape.segments) {
    if (!stroked) continue;
    if (Math.abs(s.x0 - s.x1) <= 0.2) rules.push({ vertical: true, at: (s.x0 + s.x1) / 2, from: Math.min(s.y0, s.y1), to: Math.max(s.y0, s.y1) });
    else if (Math.abs(s.y0 - s.y1) <= 0.2) rules.push({ vertical: false, at: (s.y0 + s.y1) / 2, from: Math.min(s.x0, s.x1), to: Math.max(s.x0, s.x1) });
  }
  for (const b of shape.rects) {
    if (filled && thin(b)) {
      if (width(b) <= height(b)) rules.push({ vertical: true, at: (b.left + b.right) / 2, from: b.bottom, to: b.top });
      else rules.push({ vertical: false, at: (b.bottom + b.top) / 2, from: b.left, to: b.right });
    } else if (stroked) {
      rules.push(
        { vertical: true, at: b.left, from: b.bottom, to: b.top },
        { vertical: true, at: b.right, from: b.bottom, to: b.top },
        { vertical: false, at: b.bottom, from: b.left, to: b.right },
        { vertical: false, at: b.top, from: b.left, to: b.right },
      );
    }
  }
  // a fill that could be a mark: only rectangles, none of them a rule, not stroked
  const fillPieces = filled && !stroked && !shape.other && !shape.segments.length && shape.rects.length && !shape.rects.some(thin) ? shape.rects : null;
  return { rules, fillPieces };
}

/**
 * The subpaths of a path as rectangles, straight segments, or other shapes.
 * `points`: per subpath, its points in page space, `curved` when it has a
 * Bézier segment.
 */
export function shapeOf(subpaths: { points: [number, number][]; curved: boolean }[]) {
  const rects: Box[] = [];
  const segments: { x0: number; y0: number; x1: number; y1: number }[] = [];
  let other = false;
  const eps = 0.05;
  for (const sp of subpaths) {
    if (sp.curved) {
      other = true;
      continue;
    }
    const pts: [number, number][] = [];
    for (const p of sp.points) {
      const last = pts[pts.length - 1];
      if (!last || Math.abs(last[0] - p[0]) > eps || Math.abs(last[1] - p[1]) > eps) pts.push(p);
    }
    if (pts.length > 2 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) <= eps && Math.abs(pts[0][1] - pts[pts.length - 1][1]) <= eps) pts.pop();
    if (pts.length < 2) continue;
    if (pts.length === 2) {
      segments.push({ x0: pts[0][0], y0: pts[0][1], x1: pts[1][0], y1: pts[1][1] });
      continue;
    }
    if (pts.length === 4) {
      const axis = (a: [number, number], b: [number, number]) => (Math.abs(a[0] - b[0]) <= eps ? 'v' : Math.abs(a[1] - b[1]) <= eps ? 'h' : null);
      const sides = [0, 1, 2, 3].map((i) => axis(pts[i], pts[(i + 1) % 4]));
      if (sides.every(Boolean) && sides[0] !== sides[1] && sides[0] === sides[2] && sides[1] === sides[3]) {
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        rects.push({ left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) });
        continue;
      }
    }
    other = true;
  }
  return { rects, segments, other };
}
