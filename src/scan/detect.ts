/**
 * Finding the sheet of paper in a photo: its four corners.
 *
 * Works on a small copy of the photo (about 400 px). Paper is bright and
 * nearly colourless next to most tables, hands and backgrounds, so:
 *  1. score each pixel by brightness minus colourfulness, threshold the
 *     score (Otsu), close the holes the writing leaves;
 *  2. keep the largest connected region, favouring the one at the centre;
 *  3. take its convex hull and, among the hull's main points, the four that
 *     enclose the largest area;
 *  4. refine each side by fitting a straight line through the region's edge
 *     next to it, and intersect neighbouring lines, so a bent or covered
 *     corner still lands where the paper's edges meet.
 * When nothing convincing is found the whole photo is proposed: the user
 * drags the corners anyway.
 */
import { orderQuad, quadArea, type Pt, type Quad } from './geometry';

export interface Gray {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Detection {
  /** corners in the small image's pixels */
  quad: Quad;
  /** false: the whole photo, nothing convincing found */
  found: boolean;
  /** share of the photo the sheet covers */
  coverage: number;
}

/** Paper score: bright and colourless high, dark or colourful low. */
export function paperScore(rgba: Uint8ClampedArray, width: number, height: number): Gray {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    out[j] = l - 0.7 * (max - min);
  }
  return { width, height, data: out };
}

export function otsu(g: Gray): number {
  const hist = new Array(256).fill(0);
  for (const v of g.data) hist[v]++;
  const total = g.data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      t = i;
    }
  }
  return t;
}

/** Square max/min filter (radius r), separable. */
function morph(mask: Uint8Array, w: number, h: number, r: number, dilate: boolean): Uint8Array {
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  const want = dilate ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r && v !== want; k++) {
        const xx = x + k;
        if (xx < 0 || xx >= w) continue;
        if (mask[y * w + xx] === want) v = want;
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r && v !== want; k++) {
        const yy = y + k;
        if (yy < 0 || yy >= h) continue;
        if (tmp[yy * w + x] === want) v = want;
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Fill what is not reachable from the border (the writing inside the sheet). */
function fillHoles(mask: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!seen[i] && !mask[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < (h - 1) * w) push(i + w);
  }
  for (let i = 0; i < mask.length; i++) if (!seen[i]) mask[i] = 1;
}

/** Largest region, weighted towards the centre of the photo. */
function mainRegion(mask: Uint8Array, w: number, h: number): { pixels: number[]; area: number } | null {
  const label = new Int32Array(mask.length).fill(-1);
  let best: { pixels: number[]; score: number } | null = null;
  const cx = w / 2, cy = h / 2;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s] !== -1) continue;
    const pixels: number[] = [];
    const stack = [s];
    label[s] = s;
    let containsCentre = false;
    while (stack.length) {
      const i = stack.pop()!;
      pixels.push(i);
      const x = i % w, y = (i / w) | 0;
      if (Math.abs(x - cx) < w * 0.1 && Math.abs(y - cy) < h * 0.1) containsCentre = true;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j >= 0 && mask[j] && label[j] === -1) {
          label[j] = s;
          stack.push(j);
        }
      }
    }
    const score = pixels.length * (containsCentre ? 2 : 1);
    if (!best || score > best.score) best = { pixels, score };
  }
  return best ? { pixels: best.pixels, area: best.pixels.length } : null;
}

/** Monotone chain convex hull. */
export function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Douglas–Peucker on a closed polygon. */
function simplify(poly: Pt[], eps: number): Pt[] {
  if (poly.length <= 4) return poly;
  // split at the two farthest points
  let a = 0, b = 0, far = -1;
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 1; j < poly.length; j++) {
      const d = (poly[i].x - poly[j].x) ** 2 + (poly[i].y - poly[j].y) ** 2;
      if (d > far) [far, a, b] = [d, i, j];
    }
  }
  const run = (from: number, to: number): Pt[] => {
    const seg: Pt[] = [];
    for (let i = from; i !== to; i = (i + 1) % poly.length) seg.push(poly[i]);
    seg.push(poly[to]);
    return dp(seg, eps);
  };
  const first = run(a, b);
  const second = run(b, a);
  return first.slice(0, -1).concat(second.slice(0, -1));
}

function dp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let idx = -1, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b.y - a.y) * pts[i].x - (b.x - a.x) * pts[i].y + b.x * a.y - b.y * a.x) / len;
    if (d > max) [max, idx] = [d, i];
  }
  if (max <= eps) return [a, b];
  return dp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(dp(pts.slice(idx), eps));
}

/** The four hull points that enclose the largest area. */
function largestQuad(poly: Pt[]): Pt[] {
  const n = poly.length;
  if (n <= 4) return poly;
  let best: Pt[] = poly.slice(0, 4);
  let bestA = -1;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++)
        for (let l = k + 1; l < n; l++) {
          const q = [poly[i], poly[j], poly[k], poly[l]];
          const a = quadArea(q);
          if (a > bestA) [bestA, best] = [a, q];
        }
  return best;
}

/** Least-squares line (point + direction) through points. */
function fitLine(pts: Pt[]): { p: Pt; d: Pt } | null {
  if (pts.length < 5) return null;
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

function intersect(a: { p: Pt; d: Pt }, b: { p: Pt; d: Pt }): Pt | null {
  const den = a.d.x * b.d.y - a.d.y * b.d.x;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((b.p.x - a.p.x) * b.d.y - (b.p.y - a.p.y) * b.d.x) / den;
  return { x: a.p.x + t * a.d.x, y: a.p.y + t * a.d.y };
}

/** Each side: a line through the region's edge pixels close to it, away from the corners. */
function refine(q: Quad, edge: Pt[], w: number, h: number): Quad {
  const diag = Math.hypot(w, h);
  const lines = [0, 1, 2, 3].map((i) => {
    const a = q[i], b = q[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const near = edge.filter((p) => {
      const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len);
      if (t < 0.15 || t > 0.85) return false;
      const d = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / len;
      return d < diag * 0.015;
    });
    return fitLine(near);
  });
  const out = q.map((c, i) => {
    const prev = lines[(i + 3) % 4];
    const next = lines[i];
    const p = prev && next ? intersect(prev, next) : null;
    // keep the hull corner if the lines meet somewhere implausible
    return p && Math.hypot(p.x - c.x, p.y - c.y) < diag * 0.06 ? p : c;
  });
  return out.map((p) => ({ x: Math.min(w, Math.max(0, p.x)), y: Math.min(h, Math.max(0, p.y)) })) as Quad;
}

/** Box blur of a grey image (two passes ≈ Gaussian). */
function smooth(g: Gray, r: number): Float32Array {
  const { width: w, height: h } = g;
  let a = Float32Array.from(g.data);
  for (let pass = 0; pass < 2; pass++) {
    const t = new Float32Array(a.length), o = new Float32Array(a.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) (s += a[y * w + k]), n++;
        t[y * w + x] = s / n;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) (s += t[k * w + x]), n++;
        o[y * w + x] = s / n;
      }
    a = o;
  }
  return a;
}

/** Sheet by global threshold: works when the sheet is evenly lit. */
function maskByThreshold(score: Gray): Uint8Array {
  const t = otsu(score);
  const mask = new Uint8Array(score.data.length);
  for (let i = 0; i < mask.length; i++) mask[i] = score.data[i] > t ? 1 : 0;
  return mask;
}

/**
 * Sheet by growing from the centre across gentle changes only: a shadow is
 * a slow gradient, the paper's edge a sharp step. Writing stops the growth
 * locally; the holes it leaves are filled afterwards.
 */
export function maskByGrowth(score: Gray): Uint8Array {
  const { width: w, height: h } = score;
  const s = smooth(score, 1);
  const mask = new Uint8Array(w * h);
  // seeds: the brightest part of the centre
  const cx0 = Math.round(w * 0.4), cx1 = Math.round(w * 0.6), cy0 = Math.round(h * 0.4), cy1 = Math.round(h * 0.6);
  const centre: number[] = [];
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) centre.push(s[y * w + x]);
  centre.sort((a, b) => a - b);
  const seedLevel = centre[Math.floor(centre.length * 0.7)];
  const floor = seedLevel * 0.35;
  // Walls: pixels where the score changes fast in any direction, relative to
  // the light there. A shadow dims everything slowly and in proportion; the
  // sheet's edge (and the writing) is a jump, whatever way it is crossed.
  const rel = 0.03 * (400 / Math.max(w, h));
  const wall = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (s[i + 1] - s[i - 1]) / 2, gy = (s[i + w] - s[i - w]) / 2;
      if (Math.hypot(gx, gy) > Math.max(1.5, rel * s[i])) wall[i] = 1;
    }
  const stack: number[] = [];
  for (let y = cy0; y < cy1; y++)
    for (let x = cx0; x < cx1; x++) {
      const i = y * w + x;
      if (s[i] >= seedLevel && !wall[i]) {
        mask[i] = 1;
        stack.push(i);
      }
    }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < (h - 1) * w ? i + w : -1];
    for (const j of nb) {
      if (j < 0 || mask[j]) continue;
      if (!wall[j] && s[j] > floor) {
        mask[j] = 1;
        stack.push(j);
      }
    }
  }
  return mask;
}

/**
 * How clearly the quad's sides are edges: on each side, the score just
 * inside against just outside. The weakest side counts. A side lying on the
 * photo's border (the sheet runs past the frame) does not count against it.
 */
function edgeStrength(s: Float32Array, w: number, h: number, q: Quad): number {
  const c = { x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 };
  const at = (x: number, y: number) => s[Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))];
  const off = Math.max(2, Math.round(Math.max(w, h) / 130));
  let weakest = Infinity;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const onBorder = (p: Pt) => p.x < 3 || p.y < 3 || p.x > w - 3 || p.y > h - 3;
    if (onBorder(a) && onBorder(b)) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if ((mx + nx - c.x) ** 2 + (my + ny - c.y) ** 2 < (mx - c.x) ** 2 + (my - c.y) ** 2) (nx = -nx), (ny = -ny); // outward
    const d: number[] = [];
    for (let k = 1; k < 30; k++) {
      const t = 0.1 + (0.8 * k) / 30;
      const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      d.push(at(px - nx * off, py - ny * off) - at(px + nx * off, py + ny * off));
    }
    d.sort((x, y) => x - y);
    weakest = Math.min(weakest, d[Math.floor(d.length / 2)]);
  }
  return weakest === Infinity ? 0 : weakest;
}

function quadFromMask(mask0: Uint8Array, width: number, height: number, grownShort = 0): { quad: Quad; area: number } | null {
  let mask = mask0;
  const r = Math.max(1, Math.round(Math.max(width, height) / 200));
  mask = morph(morph(mask, width, height, r, false), width, height, r, true); // open: specks off
  mask = morph(morph(mask, width, height, r * 2, true), width, height, r * 2, false); // close: gaps shut
  fillHoles(mask, width, height);
  // growth stops at the wall pixels just inside the edge: give that back
  if (grownShort) mask = morph(mask, width, height, grownShort, true);
  const region = mainRegion(mask, width, height);
  const total = width * height;
  if (!region || region.area < total * 0.08) return null;
  const inRegion = new Uint8Array(total);
  for (const i of region.pixels) inRegion[i] = 1;
  const edge: Pt[] = [];
  for (const i of region.pixels) {
    const x = i % width, y = (i / width) | 0;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || !inRegion[i - 1] || !inRegion[i + 1] || !inRegion[i - width] || !inRegion[i + width]) {
      edge.push({ x: x + 0.5, y: y + 0.5 });
    }
  }
  const hull = convexHull(edge);
  let poly = hull;
  for (let eps = Math.max(width, height) * 0.005; poly.length > 12; eps *= 1.5) poly = simplify(hull, eps);
  const quad = refine(orderQuad(largestQuad(poly)), edge, width, height);
  return { quad, area: region.area };
}

/** For tests: what each method proposes. */
export function detectCandidates(rgba: Uint8ClampedArray, width: number, height: number) {
  const score = paperScore(rgba, width, height);
  const sm = smooth(score, 1);
  const wallWidth = Math.max(1, Math.round(Math.max(width, height) / 160));
  return [maskByThreshold(score), maskByGrowth(score)].map((mask, i) => {
    const filled = mask.reduce((a, b) => a + b, 0);
    const c = quadFromMask(mask, width, height, i ? wallWidth : 0);
    if (!c) return { method: i ? 'growth' : 'threshold', filled, quad: null };
    return { method: i ? 'growth' : 'threshold', filled, quad: c.quad, fill: c.area / quadArea(c.quad), coverage: quadArea(c.quad) / (width * height), strength: edgeStrength(sm, width, height, c.quad) };
  });
}

export function detectSheet(rgba: Uint8ClampedArray, width: number, height: number): Detection {
  const whole: Quad = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const score = paperScore(rgba, width, height);
  const sm = smooth(score, 1);
  const total = width * height;
  let best: { quad: Quad; strength: number } | null = null;
  const wallWidth = Math.max(1, Math.round(Math.max(width, height) / 160));
  for (const [mask, short] of [
    [maskByThreshold(score), 0],
    [maskByGrowth(score), wallWidth],
  ] as const) {
    const c = quadFromMask(mask, width, height, short);
    if (!c) continue;
    const coverage = quadArea(c.quad) / total;
    if (coverage > 0.97 || coverage < 0.08) continue;
    // the region should fill its quad: a leak or a stray blob does not
    if (c.area / quadArea(c.quad) < 0.85) continue;
    const strength = edgeStrength(sm, width, height, c.quad);
    if (!best || strength > best.strength) best = { quad: c.quad, strength };
  }
  // no side with a clear edge: nothing to go by
  if (!best || best.strength < 8) return { quad: whole, found: false, coverage: 1 };
  return { quad: best.quad, found: true, coverage: quadArea(best.quad) / total };
}
