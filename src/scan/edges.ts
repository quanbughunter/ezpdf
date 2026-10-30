/**
 * Second way to find the sheet: from its four straight sides.
 *
 * The first way (detect.ts) takes the outline of the bright, colourless
 * region. That outline is not the sheet when the paper region is more than
 * one sheet: a page lying on another, the one under it showing along two
 * sides. The page on top is still bounded by four straight lines: towards
 * the table they are steps (paper inside, darker outside); towards the sheet
 * under it they are the faint step of the shadow it casts on that sheet.
 *
 *  1. Straight lines (Hough transform) through the edges around the paper
 *     region and, inside it, the steps between two papers (not the writing,
 *     not printed lines); the outline's long straight runs (a curled side's
 *     chord) and the photo's own borders (a sheet running past the frame)
 *     join them.
 *  2. Every four lines that pair up as two nearly parallel pairs make a
 *     quad. It counts when each side follows an edge for most of its length
 *     and paper fills it. It scores by its area, by how close its sides lie
 *     to the edges, and less when a corner is out on the table or a strip of
 *     another sheet runs along a side.
 *  3. The best quad wins, then each side is fitted to the edge points found
 *     along it.
 */
import { isConvex, orderQuad, quadArea, type Pt, type Quad } from './geometry';

/** x·cos θ + y·sin θ = rho */
interface Line {
  cos: number;
  sin: number;
  rho: number;
  deg: number;
  votes: number;
  border?: boolean;
}

export interface EdgeQuad {
  quad: Quad;
  /** weakest side: share of its length that follows an edge */
  support: number;
  /** share of the quad that is paper */
  fill: number;
  /** 0–1: how near the sides lie to the edges, less for a corner on the table or a strip of another sheet */
  confidence: number;
}

/**
 * `s`: the paper score, smoothed. `paper`: paper pixels with the writing's
 * holes filled. `level`: the score from which a pixel looks like paper.
 */
export function quadByEdges(
  s: Float32Array,
  w: number,
  h: number,
  paper: Uint8Array,
  level: number,
  /** more candidate lines: the paper outline's straight runs (a curled side's chord) */
  extra: { p: Pt; d: Pt }[] = [],
  /** a quad found another way, to check for a strip of another sheet inside it */
  check: Quad | null = null,
): { quad: EdgeQuad | null; outlineHasStrip: boolean } {
  const size = Math.max(w, h);
  // the paper's own white (median over the paper); a shadow between two
  // sheets stays near it, small writing blurs well below it
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < s.length; i++)
    if (paper[i]) {
      hist[Math.min(255, Math.max(0, Math.round(s[i])))]++;
      count++;
    }
  let white = 255;
  for (let v = 0, run = 0; v < 256; v++) {
    run += hist[v];
    if (run >= count / 2) {
      white = v;
      break;
    }
  }
  const shade = Math.max(level, white - 22);
  const band = Math.max(2, Math.round(size * 0.02));
  // around the paper region's outline (paper against the table)
  const outline = dilate(paper, w, h, band);
  const inner = erode(paper, w, h, band);
  for (let i = 0; i < outline.length; i++) if (inner[i]) outline[i] = 0;
  const lines = houghLines(s, w, h, { paper, outline, shade }, size);
  let added = 0;
  for (const e of extra) {
    if (added >= 16) break;
    let t = Math.atan2(e.d.y, e.d.x) + Math.PI / 2;
    t = ((t % Math.PI) + Math.PI) % Math.PI;
    const l = { cos: Math.cos(t), sin: Math.sin(t), rho: e.p.x * Math.cos(t) + e.p.y * Math.sin(t), deg: (t * 180) / Math.PI, votes: 0 };
    if (lines.some((q) => sameLine(l, q, w, h, Math.max(2, size * 0.005)))) continue;
    lines.unshift(l);
    added++;
  }
  lines.push(
    { cos: 1, sin: 0, rho: 0, deg: 0, votes: 0, border: true },
    { cos: 1, sin: 0, rho: w, deg: 0, votes: 0, border: true },
    { cos: 0, sin: 1, rho: 0, deg: 90, votes: 0, border: true },
    { cos: 0, sin: 1, rho: h, deg: 90, votes: 0, border: true },
  );
  const cx = w / 2, cy = h / 2;
  const minGap = Math.min(w, h) * 0.15;
  const pairs: { a: Line; b: Line; ia: number; ib: number; deg: number }[] = [];
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], b = lines[j];
      if (angleBetween(a.deg, b.deg) > 25) continue;
      if (Math.abs(lineDist(a, cx, cy) - lineDist(b, cx, cy)) < minGap) continue;
      pairs.push({ a, b, ia: i, ib: j, deg: meanDeg(a.deg, b.deg) });
    }
  const total = w * h;
  const at = sampler(s, w, h);
  const isPaper = (p: Pt) => {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    return x >= 0 && y >= 0 && x < w && y < h && paper[y * w + x] === 1;
  };
  const geo = { w, h, size, level, shade, at, smooth: bilinear(s, w, h), isPaper, lines };
  // each line's edge evidence once, on both sides of it; a quad's side is then a sum over a stretch
  const ev = lines.map((l) => lineEvidence(l, geo));
  let best: { quad: Quad; score: number; support: number; fill: number } | null = null;
  for (let i = 0; i < pairs.length; i++)
    for (let j = i + 1; j < pairs.length; j++) {
      const P = pairs[i], Q = pairs[j];
      if (angleBetween(P.deg, Q.deg) < 45) continue;
      if (P.a.border && P.b.border && Q.a.border && Q.b.border) continue;
      const c = [cross(P.a, Q.a), cross(Q.a, P.b), cross(P.b, Q.b), cross(Q.b, P.a)];
      if (c.some((p) => !p || p.x < -w * 0.03 || p.y < -h * 0.03 || p.x > w * 1.03 || p.y > h * 1.03)) continue;
      const cq = c as Quad;
      if (!isConvex(cq)) continue;
      const area = quadArea(cq);
      if (area < total * 0.08 || area > total * 0.97) continue;
      // cheap bound first: a smaller quad than the best cannot win
      if (best && area <= best.score) continue;
      const centre = { x: (cq[0].x + cq[1].x + cq[2].x + cq[3].x) / 4, y: (cq[0].y + cq[1].y + cq[2].y + cq[3].y) / 4 };
      // side k runs from corner k to k+1, on these lines
      const on = [Q.ia, P.ib, Q.ib, P.ia];
      let support = 1, close = 1;
      for (let k = 0; k < 4 && support >= MIN_SUPPORT; k++) {
        const r = stretch(ev[on[k]], cq[k], cq[(k + 1) % 4], centre);
        support = Math.min(support, r.share);
        close *= r.close;
      }
      // how near the edges the sides lie: a curled side strays a little along
      // part of it, a side on the wrong line a lot all along
      if (support < MIN_SUPPORT || (best && area * close <= best.score)) continue;
      const quad = orderQuad(cq);
      const scored = scoreRest(quad, geo);
      if (!scored) continue;
      const score = area * close * scored.factor;
      if (!best || score > best.score) best = { quad, score, support, fill: scored.fill };
    }
  const outlineHasStrip = !!check && [0, 1, 2, 3].some((i) => stripInside(check, i, geo));
  if (!best) return { quad: null, outlineHasStrip };
  return { quad: { quad: refit(best.quad, geo), support: best.support, fill: best.fill, confidence: best.score / quadArea(best.quad) }, outlineHasStrip };
}

interface Geo {
  w: number;
  h: number;
  size: number;
  level: number;
  /** darkest a paper in shadow gets: the paper's own white minus a margin */
  shade: number;
  lines: Line[];
  at: (x: number, y: number) => number;
  /** the same, read between pixels (bilinear) */
  smooth: (x: number, y: number) => number;
  isPaper: (p: Pt) => boolean;
}

const SAMPLES = 48;
const MIN_SUPPORT = 0.6;
const MIN_FILL = 0.85;

/** Paper fills it, its corners are on paper, no strip of another sheet along a side. */
function scoreRest(q: Quad, g: Geo): { fill: number; factor: number } | null {
  const fill = paperShare(q, g);
  if (fill < MIN_FILL) return null;
  let factor = 1;
  // A corner out on the table (the notch where two sheets' outlines meet,
  // a side carried on past the paper): the quad is not one sheet. A finger
  // on a corner looks the same, so it is a penalty, not a veto.
  for (let i = 0; i < 4; i++) {
    const c = q[i], prev = q[(i + 3) % 4], next = q[(i + 1) % 4];
    let on = 0;
    for (const a of [0.03, 0.06])
      for (const b of [0.03, 0.06])
        if (g.isPaper({ x: c.x + (prev.x - c.x) * a + (next.x - c.x) * b, y: c.y + (prev.y - c.y) * a + (next.y - c.y) * b })) on++;
    if (on < 3) factor *= 0.6;
  }
  // A sheet's edge just inside a side, all along it: this quad holds a
  // strip of the sheet underneath, and the quad that stops at that edge is
  // the top sheet.
  for (let i = 0; i < 4; i++) if (stripInside(q, i, g)) factor *= 0.7;
  return { fill, factor };
}

interface LineEvidence {
  p0: Pt;
  dir: Pt;
  u0: number;
  step: number;
  n: number;
  /** prefix sums of hits and of their closeness: [side the normal points to, the other side] */
  hits: [Float32Array, Float32Array];
  close: [Float32Array, Float32Array];
  normal: Pt;
  rho: number;
}

/** Edge evidence along a line, sampled every step or so, looking out to either side. */
function lineEvidence(l: Line, g: Geo): LineEvidence {
  const dir = { x: -l.sin, y: l.cos };
  const p0 = { x: l.cos * l.rho, y: l.sin * l.rho };
  // the stretch inside the photo, plus the 3 % a corner may lie outside it
  let u0 = -Infinity, u1 = Infinity;
  const clip = (p: number, d: number, lo: number, hi: number) => {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) [u0, u1] = [1, 0];
      return;
    }
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) [a, b] = [b, a];
    u0 = Math.max(u0, a);
    u1 = Math.min(u1, b);
  };
  clip(p0.x, dir.x, -g.w * 0.03, g.w * 1.03);
  clip(p0.y, dir.y, -g.h * 0.03, g.h * 1.03);
  const step = Math.max(1, g.size / 300);
  const n = u1 > u0 ? Math.floor((u1 - u0) / step) + 1 : 0;
  const reach = reachOf(g);
  const normal = { x: l.cos, y: l.sin };
  const hits: [Float32Array, Float32Array] = [new Float32Array(n + 1), new Float32Array(n + 1)];
  const close: [Float32Array, Float32Array] = [new Float32Array(n + 1), new Float32Array(n + 1)];
  for (let side = 0; side < 2; side++) {
    const nn = side ? { x: -normal.x, y: -normal.y } : normal;
    for (let k = 0; k < n; k++) {
      const u = u0 + k * step;
      const r = edgeAt(p0.x + dir.x * u, p0.y + dir.y * u, nn, g, reach);
      const hit = r ? 1 : 0;
      const c = !r ? 0 : r === true ? 1 : 1 - Math.abs(r.off) / (reach + 1);
      hits[side][k + 1] = hits[side][k] + hit;
      close[side][k + 1] = close[side][k] + c;
    }
  }
  return { p0, dir, u0, step, n, hits, close, normal, rho: l.rho };
}

/** Evidence for the side from a to b on this line, looking away from `centre`; its ends (6 % each) left out. */
function stretch(e: LineEvidence, a: Pt, b: Pt, centre: Pt): { share: number; close: number } {
  let ua = (a.x - e.p0.x) * e.dir.x + (a.y - e.p0.y) * e.dir.y;
  let ub = (b.x - e.p0.x) * e.dir.x + (b.y - e.p0.y) * e.dir.y;
  if (ua > ub) [ua, ub] = [ub, ua];
  const trim = (ub - ua) * 0.06;
  const ka = Math.max(0, Math.ceil((ua + trim - e.u0) / e.step));
  const kb = Math.min(e.n - 1, Math.floor((ub - trim - e.u0) / e.step));
  if (kb < ka) return { share: 0, close: 0 };
  // outward: the side of the line away from the quad's centre
  const side = centre.x * e.normal.x + centre.y * e.normal.y - e.rho < 0 ? 0 : 1;
  const m = kb - ka + 1;
  return { share: (e.hits[side][kb + 1] - e.hits[side][ka]) / m, close: (e.close[side][kb + 1] - e.close[side][ka]) / m };
}

/** Is there a line just inside side i, nearly parallel, that is an edge between two papers along most of it? */
function stripInside(q: Quad, i: number, g: Geo): boolean {
  const a = q[i], b = q[(i + 1) % 4];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = outward(q, i, len);
  const sideDeg = ((((Math.atan2(n.y, n.x) * 180) / Math.PI) % 180) + 180) % 180;
  const before = { p: q[(i + 3) % 4], d: unit(q[(i + 3) % 4], a) };
  const after = { p: b, d: unit(b, q[(i + 2) % 4]) };
  const reach = reachOf(g);
  for (const l of g.lines) {
    if (l.border || angleBetween(l.deg, sideDeg) > 6) continue;
    const ln = { p: { x: l.cos * l.rho, y: l.sin * l.rho }, d: { x: -l.sin, y: l.cos } };
    const A = meet(ln, before), B = meet(ln, after);
    if (!A || !B) continue;
    // both ends inside the quad's neighbouring sides, a little in from this side
    const da = Math.hypot(A.x - a.x, A.y - a.y), db = Math.hypot(B.x - b.x, B.y - b.y);
    const la = Math.hypot(a.x - before.p.x, a.y - before.p.y), lb = Math.hypot(q[(i + 2) % 4].x - b.x, q[(i + 2) % 4].y - b.y);
    if ((A.x - a.x) * before.d.x + (A.y - a.y) * before.d.y > 0 || (B.x - b.x) * after.d.x + (B.y - b.y) * after.d.y < 0) continue;
    // a wedge is fine: the sheet underneath may show more at one end
    if (Math.max(da, db) < reach || da > la * 0.12 || db > lb * 0.12) continue;
    let hits = 0;
    const N = 24;
    for (let k = 0; k < N; k++) {
      const t = 0.06 + (0.88 * k) / (N - 1);
      const r = edgeAt(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t, n, g, Math.max(2, Math.round(reach / 3)), true);
      if (r && r !== true) hits++;
    }
    if (hits / N >= 0.7) return true;
  }
  return false;
}

const unit = (from: Pt, to: Pt): Pt => {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / len, y: (to.y - from.y) / len };
};

/**
 * How much of side i, between `from` and `to` (0–1 along it), follows the
 * paper's edge (`close`: weighted by how near), and where (points for the fit).
 */
function sideEvidence(q: Quad, i: number, g: Geo, from = 0.06, to = 0.94, samples = SAMPLES, reach = reachOf(g)): { share: number; close: number; pts: Pt[] } {
  const a = q[i], b = q[(i + 1) % 4];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = outward(q, i, len);
  let hits = 0, close = 0;
  const pts: Pt[] = [];
  for (let k = 0; k < samples; k++) {
    const t = from + ((to - from) * k) / (samples - 1);
    const r = edgeAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, n, g, reach);
    if (!r) continue;
    hits++;
    if (r === true) close++;
    else {
      pts.push(r.at);
      close += 1 - Math.abs(r.off) / (reach + 1);
    }
  }
  return { share: hits / samples, close: close / samples, pts };
}

/** Paper curls: a side may stray this far from a straight line. */
const reachOf = (g: Geo) => Math.max(3, Math.round(g.size * 0.02));

/**
 * Is there a paper edge across `n` near this point? The point on it when
 * found; true at the photo's border when the paper runs out of the frame.
 */
function edgeAt(px: number, py: number, n: Pt, g: Geo, reach: number, papersOnly = false): { at: Pt; off: number } | boolean {
  const d = Math.max(2, Math.round(g.size / 200));
  // against the table a clear step; between two papers the top sheet's
  // shadow on the one under it, fainter, and only where both sides are
  // paper (not ink)
  const stepMin = 12;
  const paperStepMin = 5;
  // On the photo's border (or past it, near a corner): fine if the paper
  // runs out of the frame here. Further in, a real edge is needed.
  if (px < 1.5 || py < 1.5 || px > g.w - 2.5 || py > g.h - 2.5) {
    const ix = Math.min(g.w - 1, Math.max(0, px)) - n.x * 2 * d, iy = Math.min(g.h - 1, Math.max(0, py)) - n.y * 2 * d;
    return g.isPaper({ x: ix, y: iy });
  }
  // the edge nearest the line, not the strongest: a sheet under this one
  // has a stronger edge against the table a little further out
  const tx = -n.y * d, ty = n.x * d;
  const even = (x: number, y: number) => {
    const a = g.at(x - tx, y - ty), b = g.at(x, y), c = g.at(x + tx, y + ty);
    return Math.max(a, b, c) - Math.min(a, b, c) <= 6;
  };
  const stepAt = (o: number) => {
    const x = px + n.x * o, y = py + n.y * o;
    const inside = g.at(x - n.x * d, y - n.y * d);
    if (inside < g.level) return 0;
    const ox = x + n.x * d, oy = y + n.y * d;
    const outside = g.at(ox, oy);
    // (pale squares in a cloth are above the paper level too: the paper's
    // own side of an edge against the table is near its white)
    if (!g.isPaper({ x: ox, y: oy })) return papersOnly || inside < (g.level + g.shade) / 2 ? 0 : (inside - outside) / stepMin;
    if (outside < g.shade || inside < g.shade) return 0;
    // The shadow is darkest at the edge and fades out slowly: still there
    // twice as far out, and no darker. Coming up to a printed line it gets
    // darker further on; past it, it is white again.
    const fx = x + n.x * 2 * d, fy = y + n.y * 2 * d;
    const further = g.at(fx, fy);
    if (further < outside - 2 || inside - further < paperStepMin / 2) return 0;
    // and it is even along the edge, where writing is letters and gaps
    if (!even(x - n.x * d, y - n.y * d) || !even(ox, oy) || !even(fx, fy)) return 0;
    return (inside - outside) / paperStepMin;
  };
  for (let k = 0; k <= 2 * reach; k++) {
    const o = k % 2 ? (k + 1) / 2 : -k / 2;
    if (stepAt(o) < 1) continue;
    // the step is found from d before the edge to d past it: its middle,
    // where it is steepest, is where the edge is
    let best = o, bestV = stepAt(o);
    for (let e = o - d; e <= o + d; e++) {
      if (e === o || Math.abs(e) > reach) continue;
      const v = stepAt(e);
      if (v > bestV) [best, bestV] = [e, v];
    }
    return { at: { x: px + n.x * best, y: py + n.y * best }, off: best };
  }
  return false;
}

/** Share of the quad (filled paper mask) that is paper, on a grid. */
function paperShare(q: Quad, g: Geo): number {
  let on = 0, all = 0;
  const N = 24;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const u = (i + 0.5) / N, v = (j + 0.5) / N;
      const top = { x: q[0].x + (q[1].x - q[0].x) * u, y: q[0].y + (q[1].y - q[0].y) * u };
      const bot = { x: q[3].x + (q[2].x - q[3].x) * u, y: q[3].y + (q[2].y - q[3].y) * u };
      const p = { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
      if (p.x < 0 || p.y < 0 || p.x >= g.w || p.y >= g.h) continue;
      all++;
      if (g.isPaper(p)) on++;
    }
  return all ? on / all : 0;
}

/**
 * Each side fitted to the edge points found along it, each point first
 * moved to where the paper's edge is steepest (to a fraction of a pixel); a
 * side on the photo's border stays.
 */
function refit(q: Quad, g: Geo): Quad {
  const d = Math.max(2, Math.round(g.size / 200));
  const lines = [0, 1, 2, 3].map((i) => {
    const { pts } = sideEvidence(q, i, g);
    if (pts.length < 8) return null;
    const n = outward(q, i, Math.hypot(q[(i + 1) % 4].x - q[i].x, q[(i + 1) % 4].y - q[i].y) || 1);
    return fitLine(pts.map((p) => steepest(p, n, d, g.smooth)));
  });
  const out = q.map((c, i) => {
    const prev = lines[(i + 3) % 4];
    const next = lines[i];
    const sides = [prev ?? lineThrough(q[(i + 3) % 4], c), next ?? lineThrough(c, q[(i + 1) % 4])];
    const p = meet(sides[0], sides[1]);
    return p && Math.hypot(p.x - c.x, p.y - c.y) < g.size * 0.03 ? p : c;
  });
  return out.map((p) => ({ x: Math.min(g.w, Math.max(0, p.x)), y: Math.min(g.h, Math.max(0, p.y)) })) as Quad;
}

/** Along n within ±d of p: where the score drops fastest, outwards (parabola through the steepest step). */
function steepest(p: Pt, n: Pt, d: number, at: (x: number, y: number) => number): Pt {
  const drop = (t: number) => at(p.x + n.x * (t - 0.5), p.y + n.y * (t - 0.5)) - at(p.x + n.x * (t + 0.5), p.y + n.y * (t + 0.5));
  let bt = 0, bv = -Infinity;
  for (let t = -d; t <= d; t += 0.5) {
    const v = drop(t);
    if (v > bv) [bt, bv] = [t, v];
  }
  const a = drop(bt - 0.5), c = drop(bt + 0.5);
  const den = a - 2 * bv + c;
  const shift = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) * 0.5 : 0;
  return { x: p.x + n.x * (bt + shift), y: p.y + n.y * (bt + shift) };
}

/* ---- lines ------------------------------------------------------------------------ */

/**
 * Hough transform over edge pixels near the paper. Each pixel votes only for
 * lines close to across its gradient, so a grey ramp or a dotted texture
 * does not pile up votes.
 */
function houghLines(s: Float32Array, w: number, h: number, where: { paper: Uint8Array; outline: Uint8Array; shade: number }, size: number): Line[] {
  const diag = Math.ceil(Math.hypot(w, h));
  const R = diag * 2 + 1;
  const acc = new Float32Array(180 * R);
  const cosT = new Float32Array(180), sinT = new Float32Array(180);
  for (let t = 0; t < 180; t++) {
    cosT[t] = Math.cos((t * Math.PI) / 180);
    sinT[t] = Math.sin((t * Math.PI) / 180);
  }
  const n = w * h;
  const mag = new Float32Array(n), gxs = new Float32Array(n), gys = new Float32Array(n);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (s[i - w + 1] + 2 * s[i + 1] + s[i + w + 1] - s[i - w - 1] - 2 * s[i - 1] - s[i + w - 1]) / 8;
      const gy = (s[i + w - 1] + 2 * s[i + w] + s[i + w + 1] - s[i - w - 1] - 2 * s[i - w] - s[i - w + 1]) / 8;
      mag[i] = Math.hypot(gx, gy);
      gxs[i] = gx;
      gys[i] = gy;
    }
  // The edge's direction from the gradients around it (structure tensor):
  // one pixel's gradient on a faint edge swings by ten degrees or more.
  const jxx = new Float32Array(n), jxy = new Float32Array(n), jyy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    jxx[i] = gxs[i] * gxs[i];
    jxy[i] = gxs[i] * gys[i];
    jyy[i] = gys[i] * gys[i];
  }
  const tr = Math.max(1, Math.round(size / 300));
  for (const a of [jxx, jxy, jyy]) boxSum(a, w, h, tr);
  const dir = new Float32Array(n);
  // coherence: 1 where the gradients around agree (an edge), low in writing
  // (strokes every way)
  const coh = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tr2 = jxx[i] + jyy[i];
    coh[i] = tr2 > 0 ? Math.hypot(jxx[i] - jyy[i], 2 * jxy[i]) / tr2 : 0;
    let phi = 0.5 * Math.atan2(2 * jxy[i], jxx[i] - jyy[i]);
    // from dark to bright, as this pixel's own gradient points
    if (Math.cos(phi) * gxs[i] + Math.sin(phi) * gys[i] < 0) phi += Math.PI;
    dir[i] = phi;
  }
  const minMag = 2;
  const reach = Math.max(2, Math.round(size / 250));
  const shade = where.shade;
  const at = sampler(s, w, h);
  const ex: number[] = [], ey: number[] = [], ed: number[] = [];
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < minMag) continue;
      const inOutline = where.outline[i] === 1;
      if (!inOutline && !where.paper[i]) continue;
      if (coh[i] < 0.6) continue;
      // thin edges: a maximum across the edge
      const c = Math.cos(dir[i]), sn = Math.sin(dir[i]);
      const ox = Math.round(c), oy = Math.round(sn);
      if (m < mag[i + oy * w + ox] || m < mag[i - oy * w - ox]) continue;
      // Inside the paper only steps between two papers (the top sheet
      // against the shadow it casts on the one under it). Not the writing:
      // its dark side is ink; not a printed line: paper on both sides is
      // equally white.
      if (!inOutline) {
        const dark = at(x + 0.5 - c * reach * 2, y + 0.5 - sn * reach * 2);
        const bright = at(x + 0.5 + c * reach * 2, y + 0.5 + sn * reach * 2);
        if (dark < shade || bright - dark < 4) continue;
      }
      let deg = Math.round((dir[i] * 180) / Math.PI);
      deg = ((deg % 180) + 180) % 180;
      // the pixel's centre
      const cx = x + 0.5, cy = y + 0.5;
      ex.push(cx);
      ey.push(cy);
      ed.push(deg);
      for (let dt = -4; dt <= 4; dt++) {
        const t = (deg + dt + 180) % 180;
        const r = Math.round(cx * cosT[t] + cy * sinT[t]) + diag;
        acc[t * R + r] += 1;
      }
    }
  const minVotes = Math.min(w, h) * 0.06;
  const peaks: Line[] = [];
  for (let t = 0; t < 180; t++)
    for (let r = 0; r < R; r++) {
      const v = acc[t * R + r];
      if (v < minVotes) continue;
      let top = true;
      for (let dt = -2; dt <= 2 && top; dt++) {
        const tt = t + dt;
        if (tt < 0 || tt >= 180) continue;
        for (let dr = -3; dr <= 3; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= R || (dt === 0 && dr === 0)) continue;
          const u = acc[tt * R + rr];
          if (u > v || (u === v && (dt < 0 || (dt === 0 && dr < 0)))) {
            top = false;
            break;
          }
        }
      }
      if (top) peaks.push({ cos: cosT[t], sin: sinT[t], rho: r - diag, deg: t, votes: v });
    }
  peaks.sort((a, b) => b.votes - a.votes);
  const out: Line[] = [];
  const sep = Math.max(4, size * 0.01);
  for (const peak of peaks) {
    if (out.length >= 48) break;
    // Lines of writing run all one way: sixteen lines at most each way, so
    // the sheet's own sides the other way keep their place.
    if (out.filter((q) => angleBetween(q.deg, peak.deg) <= 5).length >= 16) continue;
    // The bins are a degree and a pixel wide: the line fitted to its own
    // edge pixels too. A curled side splits into peaks; the fit is its chord.
    const fit = fitToEdges(peak, ex, ey, ed, sep * 2);
    for (const p of fit ? [fit, peak] : [peak]) {
      if (out.some((q) => sameLine(p, q, w, h, sep))) continue;
      out.push(p);
    }
  }
  return out;
}

/** The line through the edge pixels near it that run its way (two rounds, the band narrowing). */
function fitToEdges(l: Line, ex: number[], ey: number[], ed: number[], band: number): Line | null {
  let line = l;
  for (const b of [band, band / 2]) {
    let n = 0, mx = 0, my = 0;
    const idx: number[] = [];
    for (let k = 0; k < ex.length; k++) {
      if (angleBetween(ed[k], line.deg) > 10) continue;
      if (Math.abs(ex[k] * line.cos + ey[k] * line.sin - line.rho) > b) continue;
      idx.push(k);
      mx += ex[k];
      my += ey[k];
      n++;
    }
    if (n < 20) return null;
    mx /= n;
    my /= n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const k of idx) {
      sxx += (ex[k] - mx) ** 2;
      sxy += (ex[k] - mx) * (ey[k] - my);
      syy += (ey[k] - my) ** 2;
    }
    // direction of the points' spread; the normal is across it
    const along = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let t = along + Math.PI / 2;
    t = ((t % Math.PI) + Math.PI) % Math.PI;
    const c = Math.cos(t), sn = Math.sin(t);
    line = { cos: c, sin: sn, rho: mx * c + my * sn, deg: (t * 180) / Math.PI, votes: l.votes };
  }
  return line;
}

/* ---- small geometry ------------------------------------------------------------- */

function angleBetween(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

function meanDeg(a: number, b: number): number {
  let d = b - a;
  if (d > 90) d -= 180;
  if (d < -90) d += 180;
  return (((a + d / 2) % 180) + 180) % 180;
}

/** Within `tol` of each other across the whole photo (checked where line a enters and leaves it). */
function sameLine(a: Line, b: Line, w: number, h: number, tol: number): boolean {
  if (angleBetween(a.deg, b.deg) > 3) return false;
  const ends = clipToFrame(a, w, h);
  if (!ends) return Math.abs(lineDist(b, w / 2, h / 2) - lineDist(a, w / 2, h / 2)) < tol;
  return ends.every((p) => Math.abs(lineDist(b, p.x, p.y)) < tol);
}

/** Where the line crosses the photo's frame (two points), if it does. */
function clipToFrame(l: Line, w: number, h: number): Pt[] | null {
  const pts: Pt[] = [];
  if (Math.abs(l.sin) > 1e-6)
    for (const x of [0, w]) {
      const y = (l.rho - x * l.cos) / l.sin;
      if (y >= 0 && y <= h) pts.push({ x, y });
    }
  if (Math.abs(l.cos) > 1e-6)
    for (const y of [0, h]) {
      const x = (l.rho - y * l.sin) / l.cos;
      if (x >= 0 && x <= w) pts.push({ x, y });
    }
  return pts.length >= 2 ? pts.slice(0, 2) : null;
}

/** Signed distance of a point from the line. */
function lineDist(l: Line, x: number, y: number): number {
  return x * l.cos + y * l.sin - l.rho;
}

function cross(a: Line, b: Line): Pt | null {
  const den = a.cos * b.sin - a.sin * b.cos;
  if (Math.abs(den) < 1e-6) return null;
  return { x: (a.rho * b.sin - b.rho * a.sin) / den, y: (a.cos * b.rho - b.cos * a.rho) / den };
}

function outward(q: Quad, i: number, len: number): Pt {
  const a = q[i], b = q[(i + 1) % 4];
  const c = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
  let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  if ((mx + nx - c.x) ** 2 + (my + ny - c.y) ** 2 < (mx - c.x) ** 2 + (my - c.y) ** 2) (nx = -nx), (ny = -ny);
  return { x: nx, y: ny };
}

/** Pixel i covers [i, i + 1): its value is read anywhere in it. */
function sampler(s: Float32Array, w: number, h: number) {
  return (x: number, y: number) => {
    const xi = Math.min(w - 1, Math.max(0, Math.floor(x)));
    const yi = Math.min(h - 1, Math.max(0, Math.floor(y)));
    return s[yi * w + xi];
  };
}

/** Between pixel centres (i + 0.5), linearly. */
function bilinear(s: Float32Array, w: number, h: number) {
  return (x: number, y: number) => {
    const cx = Math.min(w - 1.001, Math.max(0, x - 0.5)), cy = Math.min(h - 1.001, Math.max(0, y - 0.5));
    const x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0;
    const i = y0 * w + x0;
    return (s[i] * (1 - fx) + s[i + 1] * fx) * (1 - fy) + (s[i + w] * (1 - fx) + s[i + w + 1] * fx) * fy;
  };
}

function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(mask.length), out = new Uint8Array(mask.length);
  // two sweeps per row, then per column: within r of a set pixel
  for (let y = 0; y < h; y++) {
    let prev = -Infinity;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) prev = x;
      if (x - prev <= r) tmp[y * w + x] = 1;
    }
    let next = Infinity;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[y * w + x]) next = x;
      if (next - x <= r) tmp[y * w + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let prev = -Infinity;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) prev = y;
      if (y - prev <= r) out[y * w + x] = 1;
    }
    let next = Infinity;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) next = y;
      if (next - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}

/** In place: each value becomes the sum over the (2r+1)² box around it. */
function boxSum(a: Float32Array, w: number, h: number, r: number) {
  const t = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x < w + r; x++) {
      if (x + r < w) sum += a[y * w + x + r];
      if (x - r - 1 >= 0) sum -= a[y * w + x - r - 1];
      if (x >= 0 && x < w) t[y * w + x] = sum;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y < h + r; y++) {
      if (y + r < h) sum += t[(y + r) * w + x];
      if (y - r - 1 >= 0) sum -= t[(y - r - 1) * w + x];
      if (y >= 0 && y < h) a[y * w + x] = sum;
    }
  }
}

function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const grown = dilate(inv, w, h, r);
  for (let i = 0; i < grown.length; i++) grown[i] = grown[i] ? 0 : 1;
  return grown;
}

function fitLine(pts: Pt[]): { p: Pt; d: Pt } {
  const mx = pts.reduce((s, q) => s + q.x, 0) / pts.length;
  const my = pts.reduce((s, q) => s + q.y, 0) / pts.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const q of pts) {
    sxx += (q.x - mx) ** 2;
    sxy += (q.x - mx) * (q.y - my);
    syy += (q.y - my) ** 2;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: { x: mx, y: my }, d: { x: Math.cos(angle), y: Math.sin(angle) } };
}

function lineThrough(a: Pt, b: Pt): { p: Pt; d: Pt } {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { p: a, d: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
}

function meet(a: { p: Pt; d: Pt }, b: { p: Pt; d: Pt }): Pt | null {
  const den = a.d.x * b.d.y - a.d.y * b.d.x;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / den;
  return { x: a.p.x + t * a.d.x, y: a.p.y + t * a.d.y };
}
