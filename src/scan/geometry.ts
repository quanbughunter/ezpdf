/**
 * Geometry for scanning a sheet of paper from a photo: corner order, the
 * perspective transform (homography) between the photo and the flat page,
 * and the sheet's real proportions.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Four corners: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

/** Corners of any four points, ordered TL, TR, BR, BL (y down). */
export function orderQuad(pts: Pt[]): Quad {
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  const byAngle = [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  // clockwise from the point nearest the top-left
  let start = 0;
  byAngle.forEach((p, i) => {
    if (p.x + p.y < byAngle[start].x + byAngle[start].y) start = i;
  });
  const q = [0, 1, 2, 3].map((k) => byAngle[(start + k) % 4]);
  return q as Quad;
}

export function quadArea(q: Pt[]): number {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    const n = q[(i + 1) % q.length];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** True when the four corners make a convex shape (dragged handles can fold it). */
export function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) return false;
    const s = Math.sign(z);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * 3×3 homography (row-major, h[8] = 1) mapping `from[i]` to `to[i]`.
 * Solved directly from the eight linear equations.
 */
export function homography(from: Quad, to: Quad): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return [...h, 1];
}

export function applyH(h: number[], x: number, y: number): Pt {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

/** Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('degenerate corners');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Width / height of the real sheet behind a photographed quadrilateral.
 *
 * Side lengths alone are skewed by perspective (the far edge looks short).
 * With a pinhole camera whose principal point is the image centre, the
 * rectangle's true aspect follows from the vanishing geometry (Zhang & He,
 * "Whiteboard scanning and image enhancement", 2007). When the photo is
 * nearly frontal the formula is ill-conditioned and the side lengths are
 * used instead.
 */
export function sheetAspect(q: Quad, imageW: number, imageH: number): number {
  const [tl, tr, br, bl] = q;
  const sides = (dist(tl, tr) + dist(bl, br)) / (dist(tl, bl) + dist(tr, br));
  const u0 = imageW / 2;
  const v0 = imageH / 2;
  // corners in the paper's order m1 (TL) m2 (TR) m3 (BL) m4 (BR), centred
  const m = [tl, tr, bl, br].map((p) => [p.x - u0, p.y - v0, 1]);
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k2 = dot(cross(m[0], m[3]), m[2]) / dot(cross(m[1], m[3]), m[2]);
  const k3 = dot(cross(m[0], m[3]), m[1]) / dot(cross(m[2], m[3]), m[1]);
  const n2 = m[1].map((v, i) => k2 * v - m[0][i]);
  const n3 = m[2].map((v, i) => k3 * v - m[0][i]);
  const f2 = -((n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]));
  if (!(f2 > 0) || !Number.isFinite(f2) || Math.abs(n2[2]) < 1e-6 || Math.abs(n3[2]) < 1e-6) return sides;
  const f = Math.sqrt(f2);
  // a plausible phone focal length: 0.5 to 3 image widths
  const big = Math.max(imageW, imageH);
  if (f < 0.5 * big || f > 3 * big) return sides;
  const num = n2[0] * n2[0] + n2[1] * n2[1] + (n2[2] * n2[2] * f2);
  const den = n3[0] * n3[0] + n3[1] * n3[1] + (n3[2] * n3[2] * f2);
  const r = Math.sqrt(num / den);
  return Number.isFinite(r) && r > 0.2 && r < 5 ? r : sides;
}

/** ISO A4 proportions (portrait height / width). */
export const A4_RATIO = Math.SQRT2;

/**
 * Output size in pixels for a sheet of the given aspect: the larger side is
 * `maxSide`, but never more than 1.25 × what the photo holds (no blow-up).
 * A sheet within 3 % of A4 becomes exactly A4.
 */
export function outputSize(q: Quad, aspect: number, maxSide: number): { width: number; height: number; a4: boolean } {
  const [tl, tr, br, bl] = q;
  const photoLong = Math.max(dist(tl, tr), dist(bl, br), dist(tl, bl), dist(tr, br));
  let a = aspect;
  const portrait = a < 1;
  const ratio = portrait ? 1 / a : a;
  const a4 = Math.abs(ratio - A4_RATIO) / A4_RATIO < 0.03;
  if (a4) a = portrait ? 1 / A4_RATIO : A4_RATIO;
  const long = Math.round(Math.min(maxSide, photoLong * 1.25));
  return a >= 1 ? { width: long, height: Math.round(long / a), a4 } : { width: Math.round(long * a), height: long, a4 };
}
