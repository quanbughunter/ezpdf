/**
 * Ruled lines of a page and the tables they draw (pure, tested in Node).
 *
 * A ruled line is a long, thin run of ink: horizontal ones are found row by
 * row, vertical ones column by column, letting through the small breaks a
 * scanner leaves in a thin line. Runs that touch in neighbouring rows join
 * into one line (a slightly tilted line is a staircase of runs). Text gives
 * no such runs: its strokes are short, and big title letters are too thick.
 *
 * Lines that cross form a table. Its grid is every distinct position of its
 * lines; a cell is merged with its neighbour wherever the line between them
 * is missing (cells spanning columns or rows, as Word's gridSpan and vMerge
 * will write them). A box round most of the page is the page's frame, not a
 * table.
 */
import type { Box } from './raster';

export interface Rule {
  /** 'h' horizontal or 'v' vertical */
  dir: 'h' | 'v';
  /** along the line: x0..x1 for 'h', y0..y1 for 'v' */
  a0: number;
  a1: number;
  /** across: the line's centre (y for 'h', x for 'v') */
  at: number;
  /** stroke thickness, px */
  thick: number;
  /** the runs that make it: [row or column, from, to] each, to erase it exactly */
  runs: Int32Array;
}

export interface Cell {
  /** grid rows and columns the cell covers: r0 ≤ r < r1, c0 ≤ c < c1 */
  r0: number;
  r1: number;
  c0: number;
  c1: number;
  box: Box;
  /** which of its sides are drawn */
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
}

export interface Table {
  box: Box;
  /** grid line positions, px: xs.length-1 columns, ys.length-1 rows */
  xs: number[];
  ys: number[];
  cells: Cell[];
  /** the lines it is made of (to erase before reading the text) */
  rules: Rule[];
}

export interface Ruling {
  tables: Table[];
  /** a box round most of the page (Word: page border) */
  frame: (Box & { rules: Rule[] }) | null;
  /** long lines on their own, outside any table (under a running header, above a footer…) */
  loose: Rule[];
}

/** run lengths of ink, horizontal (along rows) or vertical (along columns) */
function findRuns(ink: Uint8Array, w: number, h: number, dir: 'h' | 'v', minLen: number, gap: number): number[] {
  const out: number[] = [];
  if (dir === 'h') {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let start = -1;
      let last = -1;
      for (let x = 0; x <= w; x++) {
        // a thin line can sit between two rows: either of them counts
        const on = x < w && (ink[row + x] === 1 || (y + 1 < h && ink[row + w + x] === 1));
        if (on) {
          if (start < 0) start = x;
          else if (x - last - 1 > gap) {
            if (last - start + 1 >= minLen) out.push(y, start, last);
            start = x;
          }
          last = x;
        }
      }
      if (start >= 0 && last - start + 1 >= minLen) out.push(y, start, last);
    }
  } else {
    const start = new Int32Array(w).fill(-1);
    const last = new Int32Array(w).fill(-1);
    for (let y = 0; y <= h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (y < h && (ink[row + x] === 1 || (x + 1 < w && ink[row + x + 1] === 1))) {
          if (start[x] < 0) start[x] = y;
          else if (y - last[x] - 1 > gap) {
            if (last[x] - start[x] + 1 >= minLen) out.push(x, start[x], last[x]);
            start[x] = y;
          }
          last[x] = y;
        } else if (y === h && start[x] >= 0) {
          if (last[x] - start[x] + 1 >= minLen) out.push(x, start[x], last[x]);
        }
      }
    }
  }
  return out;
}

/** joins runs that touch in neighbouring rows (or columns) into lines */
function joinRuns(unsorted: number[], dir: 'h' | 'v'): Rule[] {
  const n = unsorted.length / 3;
  // sorted by row (column), then start
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => unsorted[a * 3] - unsorted[b * 3] || unsorted[a * 3 + 1] - unsorted[b * 3 + 1]);
  const runs = new Int32Array(n * 3);
  order.forEach((o, i) => runs.set(unsorted.slice(o * 3, o * 3 + 3), i * 3));
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  // each run against the runs of the row just before it
  let prevFrom = 0; // runs of the previous row: prevFrom..prevTo
  let prevTo = 0;
  let rowFrom = 0;
  for (let i = 0; i < n; i++) {
    const at = runs[i * 3];
    if (i > 0 && at !== runs[(i - 1) * 3]) {
      const prevAt = runs[(i - 1) * 3];
      if (prevAt === at - 1) {
        prevFrom = rowFrom;
        prevTo = i;
      } else prevFrom = prevTo = i;
      rowFrom = i;
    }
    const a0 = runs[i * 3 + 1];
    const a1 = runs[i * 3 + 2];
    for (let j = prevFrom; j < prevTo; j++) {
      if (runs[j * 3 + 2] + 1 >= a0 && runs[j * 3 + 1] - 1 <= a1) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[ri] = rj;
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(i);
  }
  const rules: Rule[] = [];
  for (const g of groups.values()) {
    let a0 = Infinity;
    let a1 = -Infinity;
    let px = 0;
    let atSum = 0;
    const r = new Int32Array(g.length * 3);
    g.forEach((i, k) => {
      const at = runs[i * 3];
      const s = runs[i * 3 + 1];
      const e = runs[i * 3 + 2];
      a0 = Math.min(a0, s);
      a1 = Math.max(a1, e);
      px += e - s + 1;
      atSum += at * (e - s + 1);
      r[k * 3] = at;
      r[k * 3 + 1] = s;
      r[k * 3 + 2] = e;
    });
    const len = a1 - a0 + 1;
    rules.push({ dir, a0, a1: a1 + 1, at: atSum / px, thick: px / len, runs: r });
  }
  return rules;
}

/**
 * Ink for finding ruled lines: more of it than for text, because table rules
 * are often printed (or scanned) a light grey, and a thin line loses its
 * darkness where it falls between two rows of pixels.
 */
export function lineInk(gray: Uint8Array, w: number, h: number, dpi: number): Uint8Array {
  const r = Math.max(8, Math.round(dpi / 12));
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += gray[y * w + x];
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const mean = (sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
      const v = gray[y * w + x];
      out[y * w + x] = v < 210 && v < mean * 0.9 ? 1 : 0;
    }
  }
  return out;
}

/** pieces of one line broken by a gap (a scanner's dropout, a faint stretch) become one line */
function mergePieces(rules: Rule[], dpi: number): Rule[] {
  const tolAt = Math.max(2, dpi / 80);
  const maxGap = Math.max(6, dpi / 12);
  const out: Rule[] = [];
  for (const dir of ['h', 'v'] as const) {
    const list = rules.filter((r) => r.dir === dir).sort((a, b) => a.a0 - b.a0);
    const used = new Array(list.length).fill(false);
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      let cur = list[i];
      used[i] = true;
      for (let grew = true; grew; ) {
        grew = false;
        for (let j = 0; j < list.length; j++) {
          if (used[j]) continue;
          const o = list[j];
          if (Math.abs(o.at - cur.at) > tolAt) continue;
          if (o.a0 > cur.a1 + maxGap || o.a1 < cur.a0 - maxGap) continue;
          const la = cur.a1 - cur.a0;
          const lb = o.a1 - o.a0;
          const runs = new Int32Array(cur.runs.length + o.runs.length);
          runs.set(cur.runs);
          runs.set(o.runs, cur.runs.length);
          cur = { dir, a0: Math.min(cur.a0, o.a0), a1: Math.max(cur.a1, o.a1), at: (cur.at * la + o.at * lb) / (la + lb), thick: (cur.thick * la + o.thick * lb) / (la + lb), runs };
          used[j] = true;
          grew = true;
        }
      }
      out.push(cur);
    }
  }
  return out;
}

/**
 * How much ink runs alongside a line, just off both its sides (0..1): a
 * ruled line has paper there, a "line" found along the foot of a row of
 * letters (serifs touching) has letters right above it.
 */
function crowded(r: Rule, ink: Uint8Array, onRule: Uint8Array, w: number, h: number, dpi: number): number {
  const step = Math.max(2, Math.round(dpi / 90));
  const base = Math.ceil(r.thick / 2) + step;
  let worst = 0;
  // each side on its own, a little way off and a little further (letters sit on one side only)
  for (const side of [-1, 1])
    for (const off of [base, base + step]) {
      const c = Math.round(r.at + side * off);
      if (c < 0 || c >= (r.dir === 'h' ? h : w)) continue;
      let n = 0;
      let hits = 0;
      for (let a = Math.ceil(r.a0); a < r.a1; a += 2) {
        const i = r.dir === 'h' ? c * w + a : a * w + c;
        // ink of another line (the second stroke of a double rule) does not count
        hits += ink[i] & (onRule[i] ^ 1);
        n++;
      }
      // nearly solid: a second line beside this one (a double rule), not letters
      if (n && hits / n < 0.7) worst = Math.max(worst, hits / n);
    }
  return worst;
}

/**
 * All ruled lines of the page. lineInk: from lineInk(); ink: the page's ink
 * (binarize), to tell lines from rows of letters.
 */
export function findRules(lineMask: Uint8Array, ink: Uint8Array, w: number, h: number, dpi: number): Rule[] {
  const minRun = Math.round(dpi * 0.12);
  const gap = Math.max(1, Math.round(dpi / 100));
  const minLen = Math.round(dpi * 0.3);
  const thin = Math.max(3, dpi / 25);
  // a page frame is often a heavy (or double) line: allowed when long
  const heavy = Math.max(5, dpi / 14);
  // the scan's own edges are not lines of the page
  const edge = Math.max(4, dpi / 20);
  const pieces: Rule[] = [];
  for (const dir of ['h', 'v'] as const) {
    for (const r of joinRuns(findRuns(lineMask, w, h, dir, minRun, gap), dir)) {
      if (r.thick > heavy) continue;
      const across = dir === 'h' ? h : w;
      if (r.at < edge || r.at > across - edge) continue;
      pieces.push(r);
    }
  }
  const merged = mergePieces(pieces, dpi);
  // where the long lines are (for crowded)
  const onRule = new Uint8Array(w * h);
  for (const r of merged) {
    if (r.a1 - r.a0 < minLen) continue;
    for (let i = 0; i < r.runs.length; i += 3) {
      const at = r.runs[i];
      for (let a = r.runs[i + 1]; a <= r.runs[i + 2]; a++) onRule[r.dir === 'h' ? at * w + a : a * w + at] = 1;
    }
  }
  return merged.filter((r) => {
    const len = r.a1 - r.a0;
    if (len < minLen) return false;
    if (r.thick > thin && len < dpi * 0.8) return false;
    return crowded(r, ink, onRule, w, h, dpi) < 0.2;
  });
}

/** positions closer than tol become one (their median) */
function cluster(values: number[], tol: number): number[] {
  const v = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  let group: number[] = [];
  for (const x of v) {
    if (group.length && x - group[group.length - 1] > tol) {
      out.push(group[group.length >> 1]);
      group = [];
    }
    group.push(x);
  }
  if (group.length) out.push(group[group.length >> 1]);
  return out;
}

/** how much of [from, to] the lines at `at` (± tol) cover, 0..1 */
function covered(rules: Rule[], at: number, from: number, to: number, tol: number): number {
  const spans: [number, number][] = [];
  for (const r of rules) if (Math.abs(r.at - at) <= tol && r.a1 > from && r.a0 < to) spans.push([Math.max(from, r.a0), Math.min(to, r.a1)]);
  spans.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let end = from;
  for (const [s, e] of spans) {
    if (e <= end) continue;
    total += e - Math.max(s, end);
    end = e;
  }
  return to > from ? total / (to - from) : 0;
}

/** the table a group of crossing lines draws */
function gridOf(hs: Rule[], vs: Rule[], tol: number): Table | null {
  const xs = cluster(vs.map((r) => r.at), tol);
  const ys = cluster(hs.map((r) => r.at), tol);
  if (xs.length < 2 || ys.length < 2) return null;
  const R = ys.length - 1;
  const C = xs.length - 1;
  // which grid lines are drawn, piece by piece
  const vLine = (c: number, r: number) => covered(vs, xs[c], ys[r], ys[r + 1], tol) >= 0.6; // left of column c, row r
  const hLine = (r: number, c: number) => covered(hs, ys[r], xs[c], xs[c + 1], tol) >= 0.6; // above row r, column c
  const parent = Array.from({ length: R * C }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      if (c + 1 < C && !vLine(c + 1, r)) join(r * C + c, r * C + c + 1);
      if (r + 1 < R && !hLine(r + 1, c)) join(r * C + c, (r + 1) * C + c);
    }
  // a merged cell is a rectangle: a group that is not (lines missing in odd
  // places) takes in every cell of its bounding rectangle
  for (let changed = true; changed; ) {
    changed = false;
    const ext = new Map<number, { r0: number; r1: number; c0: number; c1: number }>();
    for (let r = 0; r < R; r++)
      for (let c = 0; c < C; c++) {
        const g = find(r * C + c);
        const e = ext.get(g);
        if (!e) ext.set(g, { r0: r, r1: r + 1, c0: c, c1: c + 1 });
        else {
          e.r0 = Math.min(e.r0, r);
          e.r1 = Math.max(e.r1, r + 1);
          e.c0 = Math.min(e.c0, c);
          e.c1 = Math.max(e.c1, c + 1);
        }
      }
    for (const [g, e] of ext)
      for (let r = e.r0; r < e.r1; r++)
        for (let c = e.c0; c < e.c1; c++)
          if (find(r * C + c) !== find(g)) {
            join(g, r * C + c);
            changed = true;
          }
  }
  const seen = new Set<number>();
  const cells: Cell[] = [];
  for (let r = 0; r < R; r++)
    for (let c = 0; c < C; c++) {
      const g = find(r * C + c);
      if (seen.has(g)) continue;
      seen.add(g);
      let r1 = r + 1;
      while (r1 < R && find(r1 * C + c) === g) r1++;
      let c1 = c + 1;
      while (c1 < C && find(r * C + c1) === g) c1++;
      const side = (fn: (i: number) => boolean, from: number, to: number) => {
        let n = 0;
        for (let i = from; i < to; i++) if (fn(i)) n++;
        return n * 2 >= to - from;
      };
      cells.push({
        r0: r,
        r1,
        c0: c,
        c1,
        box: { x0: xs[c], y0: ys[r], x1: xs[c1], y1: ys[r1] },
        top: side((i) => hLine(r, i), c, c1),
        bottom: side((i) => hLine(r1, i), c, c1),
        left: side((i) => vLine(c, i), r, r1),
        right: side((i) => vLine(c1, i), r, r1),
      });
    }
  return { box: { x0: xs[0], y0: ys[0], x1: xs[C], y1: ys[R] }, xs, ys, cells, rules: [...hs, ...vs] };
}

/**
 * The page's frame: long lines boxing most of the page (often a heavy or
 * double rule, sometimes faint in places and found in pieces). Tables drawn
 * inside may touch it; they are found once its lines are set aside.
 */
function findFrame(rules: Rule[], w: number, h: number, dpi: number): Ruling['frame'] {
  const tol = Math.max(4, dpi / 25);
  const H = rules.filter((r) => r.dir === 'h' && r.a1 - r.a0 >= w * 0.45);
  const V = rules.filter((r) => r.dir === 'v' && r.a1 - r.a0 >= h * 0.08);
  if (H.length < 2 || V.length < 2) return null;
  const top = Math.min(...H.map((r) => r.at));
  const bottom = Math.max(...H.map((r) => r.at));
  const left = Math.min(...V.map((r) => r.at));
  const right = Math.max(...V.map((r) => r.at));
  if ((bottom - top) * (right - left) < w * h * 0.35 || bottom - top < h * 0.5 || right - left < w * 0.5) return null;
  // every side mostly drawn (pieces of it count)
  const sides =
    covered(rules.filter((r) => r.dir === 'h'), top, left, right, tol) >= 0.75 &&
    covered(rules.filter((r) => r.dir === 'h'), bottom, left, right, tol) >= 0.75 &&
    covered(rules.filter((r) => r.dir === 'v'), left, top, bottom, tol) >= 0.5 &&
    covered(rules.filter((r) => r.dir === 'v'), right, top, bottom, tol) >= 0.5;
  if (!sides) return null;
  const on = rules.filter((r) =>
    r.dir === 'h'
      ? (Math.abs(r.at - top) <= tol || Math.abs(r.at - bottom) <= tol) && r.a1 - r.a0 >= (right - left) * 0.08
      : (Math.abs(r.at - left) <= tol || Math.abs(r.at - right) <= tol) && r.a1 - r.a0 >= (bottom - top) * 0.04,
  );
  return { x0: left, y0: top, x1: right, y1: bottom, rules: on };
}

/** lines that cross each other, in groups */
function crossingGroups(rules: Rule[], tol: number): Rule[][] {
  const n = rules.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const crosses = (a: Rule, b: Rule) => b.at >= a.a0 - tol && b.at <= a.a1 + tol && a.at >= b.a0 - tol && a.at <= b.a1 + tol;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (rules[i].dir === rules[j].dir) continue;
      if (crosses(rules[i], rules[j])) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[ri] = rj;
      }
    }
  const groups = new Map<number, Rule[]>();
  rules.forEach((r, i) => {
    const g = find(i);
    let list = groups.get(g);
    if (!list) groups.set(g, (list = []));
    list.push(r);
  });
  return [...groups.values()];
}

/** tables (crossing lines), the page frame and loose lines */
export function findTables(rules: Rule[], w: number, h: number, dpi: number): Ruling {
  const tol = Math.max(4, dpi / 25);
  const frame = findFrame(rules, w, h, dpi);
  const inside = frame ? rules.filter((r) => !frame.rules.includes(r)) : rules;
  const tables: Table[] = [];
  const loose: Rule[] = [];
  for (const g of crossingGroups(inside, tol)) {
    const hs = g.filter((r) => r.dir === 'h');
    const vs = g.filter((r) => r.dir === 'v');
    if (frame && hs.length >= 2 && vs.length >= 1) {
      // a table drawn against the frame uses the frame's sides as its own outer lines
      const ys = hs.map((r) => r.at);
      const span = (at: number): Rule => ({ dir: 'v', at, a0: Math.min(...ys), a1: Math.max(...ys), thick: 1, runs: new Int32Array(0) });
      if (hs.filter((r) => r.a0 <= frame.x0 + tol).length >= 2) vs.push(span(frame.x0));
      if (hs.filter((r) => r.a1 >= frame.x1 - tol).length >= 2) vs.push(span(frame.x1));
    }
    const t = hs.length >= 2 && vs.length >= 2 ? gridOf(hs, vs, tol) : null;
    if (!t || t.box.x1 - t.box.x0 < dpi * 0.4 || t.box.y1 - t.box.y0 < dpi * 0.12) {
      loose.push(...g.filter((r) => r.a1 - r.a0 >= dpi * 0.6));
      continue;
    }
    tables.push(t);
  }
  tables.sort((a, b) => a.box.y0 - b.box.y0);
  loose.sort((a, b) => a.at - b.at);
  return { tables, frame, loose };
}

/** sets the pixels of these lines (and `pad` round them) to `value`, in place: white in a grey page, 0 in ink */
export function eraseRules(gray: Uint8Array, w: number, h: number, rules: Rule[], pad = 1, value = 255) {
  for (const r of rules) {
    const runs = r.runs;
    for (let i = 0; i < runs.length; i += 3) {
      const at = runs[i];
      const s = Math.max(0, runs[i + 1] - pad);
      const e = runs[i + 2] + pad;
      for (let d = -pad; d <= pad; d++) {
        const k = at + d;
        if (r.dir === 'h') {
          if (k < 0 || k >= h) continue;
          gray.fill(value, k * w + s, k * w + Math.min(w - 1, e) + 1);
        } else {
          if (k < 0 || k >= w) continue;
          for (let y = s; y <= Math.min(h - 1, e); y++) gray[y * w + k] = value;
        }
      }
    }
  }
}
