/**
 * Scan filters: what the flat page looks like in the PDF.
 *
 *  - original ("Gốc"): the photo as it is, only cut and straightened
 *  - brighten ("Làm sáng"): the same light as "clean" divided out, gently:
 *    the paper turns evenly near-white with its own grain, nothing is
 *    thresholded, a mild curve deepens the ink
 *  - clean ("Màu sạch"): white paper and nothing else. The light falling on
 *    the sheet (shadows, streaks, a lamp's colour, a dark corner) is found
 *    on the paper and divided out; then everything that is only slightly
 *    darker than paper (dirt, smears, the paper's grain, faint marks of
 *    the light) becomes pure white, and the ink is deepened with its own
 *    hue kept: a red stamp stays red, blue ink stays blue, a highlighter
 *    stays yellow.
 *  - gray ("Xám"): "clean", in shades of grey
 *  - bw ("Đen trắng"): "clean", then black or white
 *
 * How "clean" tells the light from what is printed (see paperLight):
 *  1. on a small copy of the page (long side 480), a closing (max then
 *     min filter, a few pixels) wipes out the writing: thin dark strokes
 *     go, broad areas and the edges of shadows stay where they are;
 *  2. a median over 4 % of the page then removes every broad thing that
 *     is narrower than that (lines of text, table rows, a highlighter
 *     stroke, a signature), and keeps a shadow's edge sharp;
 *  3. what is left is the light, unless it does not look like paper in
 *     another light: compared with the page's overall paper colour it
 *     must be darker by much the same in red, green and blue (a shadow,
 *     even a bluish one) and not nearly black. A coloured fill, a
 *     picture, a black box fail and are filled in from the paper around
 *     them, so they keep their colours.
 * A very light grey fill (about 10 % grey) passes as a shade of light and
 * turns white; so do faint smudges, by design.
 *
 * Everything runs in the scan worker, on this device.
 */
import type { Img } from './process';

export type ScanFilter = 'original' | 'brighten' | 'clean' | 'gray' | 'bw';
export const SCAN_FILTERS: readonly ScanFilter[] = ['original', 'brighten', 'clean', 'gray', 'bw'];
export const DEFAULT_FILTER: ScanFilter = 'clean';
export const isScanFilter = (v: unknown): v is ScanFilter => typeof v === 'string' && (SCAN_FILTERS as readonly string[]).includes(v);
/** the scan worker's answer to a request without the photo when it no longer keeps that cut page */
export const MISS = 'MISS';

// ---- planes on a small grid ---------------------------------------------------------

type Plane = Float32Array<ArrayBuffer>;

/** Area average of the three channels down to w × h. */
function shrink(img: Img, w: number, h: number): [Plane, Plane, Plane] {
  const out: [Plane, Plane, Plane] = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  const W = img.width, H = img.height, d = img.data;
  for (let y = 0; y < h; y++) {
    const ya = Math.floor((y * H) / h), yb = Math.max(ya + 1, Math.floor(((y + 1) * H) / h));
    for (let x = 0; x < w; x++) {
      const xa = Math.floor((x * W) / w), xb = Math.max(xa + 1, Math.floor(((x + 1) * W) / w));
      let r = 0, g = 0, b = 0;
      for (let yy = ya; yy < yb; yy++) {
        let i = (yy * W + xa) * 4;
        for (let xx = xa; xx < xb; xx++, i += 4) {
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
        }
      }
      const k = 1 / ((yb - ya) * (xb - xa));
      out[0][y * w + x] = r * k;
      out[1][y * w + x] = g * k;
      out[2][y * w + x] = b * k;
    }
  }
  return out;
}

/**
 * Max (or min) over a (2r+1)² window, the window cut at the borders: van
 * Herk / Gil-Werman, a few comparisons per cell whatever the radius.
 */
function rank(a: Plane, w: number, h: number, r: number, max: boolean): Plane {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  const n = Math.max(w, h) + 2 * r;
  const p = new Float32Array(n), g = new Float32Array(n), hh = new Float32Array(n);
  const run = (src: Plane, dst: Plane, off: number, stride: number, len: number) => {
    const k = 2 * r + 1, N = len + 2 * r, pad = max ? -Infinity : Infinity;
    for (let i = 0; i < N; i++) p[i] = i >= r && i < len + r ? src[off + (i - r) * stride] : pad;
    for (let i = 0; i < N; i++) {
      const v = p[i];
      if (i % k === 0) g[i] = v;
      else {
        const u = g[i - 1];
        g[i] = max ? (u > v ? u : v) : u < v ? u : v;
      }
    }
    for (let i = N - 1; i >= 0; i--) {
      const v = p[i];
      if (i === N - 1 || i % k === k - 1) hh[i] = v;
      else {
        const u = hh[i + 1];
        hh[i] = max ? (u > v ? u : v) : u < v ? u : v;
      }
    }
    for (let x = 0; x < len; x++) {
      const u = hh[x], v = g[x + 2 * r];
      dst[off + x * stride] = max ? (u > v ? u : v) : u < v ? u : v;
    }
  };
  for (let y = 0; y < h; y++) run(a, t, y * w, 1, w);
  for (let x = 0; x < w; x++) run(t, o, x, w, h);
  return o;
}

/** Halves a plane (2 × 2 average; an odd last row or column is kept on its own). */
function halve(a: Plane, w: number, h: number) {
  const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
  const o = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < hw; x++) {
      const x0 = 2 * x, y0 = 2 * y, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      o[y * hw + x] = (a[y0 * w + x0] + a[y0 * w + x1] + a[y1 * w + x0] + a[y1 * w + x1]) / 4;
    }
  return { a: o, w: hw, h: hh };
}

/** Back to w × h from a halved plane, bilinear. */
function double(a: Plane, hw: number, hh: number, w: number, h: number): Plane {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(hh - 1, Math.max(0, (y + 0.5) / 2 - 0.5)), y0 = gy | 0, y1 = Math.min(hh - 1, y0 + 1), ay = gy - y0;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(hw - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), x0 = gx | 0, x1 = Math.min(hw - 1, x0 + 1), ax = gx - x0;
      const top = a[y0 * hw + x0] + (a[y0 * hw + x1] - a[y0 * hw + x0]) * ax;
      const bot = a[y1 * hw + x0] + (a[y1 * hw + x1] - a[y1 * hw + x0]) * ax;
      o[y * w + x] = top + (bot - top) * ay;
    }
  }
  return o;
}

/** Box blur with running sums (window shrinks at the borders). */
function boxBlur(a: Plane, w: number, h: number, r: number): Plane {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let x = 0; x <= Math.min(w - 1, r); x++) s += a[row + x];
    for (let x = 0; x < w; x++) {
      const x0 = x - r, x1 = x + r;
      t[row + x] = s / (Math.min(w - 1, x1) - Math.max(0, x0) + 1);
      if (x1 + 1 < w) s += a[row + x1 + 1];
      if (x0 >= 0) s -= a[row + x0];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y <= Math.min(h - 1, r); y++) s += t[y * w + x];
    for (let y = 0; y < h; y++) {
      const y0 = y - r, y1 = y + r;
      o[y * w + x] = s / (Math.min(h - 1, y1) - Math.max(0, y0) + 1);
      if (y1 + 1 < h) s += t[(y1 + 1) * w + x];
      if (y0 >= 0) s -= t[y0 * w + x];
    }
  }
  return o;
}

const blur3 = (a: Plane, w: number, h: number, r: number) => boxBlur(boxBlur(boxBlur(a, w, h, r), w, h, r), w, h, r);

/** Median over a (2r+1)² window (smaller at the borders); values 0–255, Huang's running histogram. */
export function median(a: Plane, w: number, h: number, r: number): Plane {
  const q = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) q[i] = a[i] <= 0 ? 0 : a[i] >= 255 ? 255 : Math.round(a[i]);
  const out = new Float32Array(a.length);
  const hist = new Int32Array(256);
  for (let y = 0; y < h; y++) {
    hist.fill(0);
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    let n = 0;
    const col = (x: number, d: number) => {
      for (let yy = y0; yy <= y1; yy++) hist[q[yy * w + x]] += d;
      n += d * (y1 - y0 + 1);
    };
    for (let x = 0; x <= Math.min(w - 1, r); x++) col(x, 1);
    let m = 0, below = 0; // below: how many values are < m
    for (let x = 0; x < w; x++) {
      if (x > 0) {
        const add = x + r, drop = x - r - 1;
        if (add < w) {
          for (let yy = y0; yy <= y1; yy++) if (q[yy * w + add] < m) below++;
          col(add, 1);
        }
        if (drop >= 0) {
          for (let yy = y0; yy <= y1; yy++) if (q[yy * w + drop] < m) below--;
          col(drop, -1);
        }
      }
      const half = (n - 1) >> 1;
      while (below > half) below -= hist[--m];
      while (below + hist[m] <= half) below += hist[m++];
      out[y * w + x] = m;
    }
  }
  return out;
}

// ---- the light on the paper -------------------------------------------------------------

/**
 * Broad areas that are printed, not shade: on the closed grid, an area
 * darker (below 90 %) than the paper around it, with a sharp edge,
 * inside the page: a picture, a photo, a black box, huge letters. "The
 * paper around" is a median over a quarter of the page, so it follows a
 * big shadow and a photo lying in one still stands out. A shadow comes in
 * over the page's edge or fades out softly; so do smears and streaks of
 * light. Light areas shut in by a printed one (the bright parts of a photo)
 * count as printed too. 1 = printed, on the grid.
 */
export function printedAreas(closed: Plane[], w: number, h: number): Uint8Array {
  const n = w * h;
  const lumC = new Float32Array(n);
  for (let i = 0; i < n; i++) lumC[i] = 0.299 * closed[0][i] + 0.587 * closed[1][i] + 0.114 * closed[2][i];
  // the paper around: a wide median, worked out on a half-size grid
  const hw = Math.max(4, w >> 1), hh = Math.max(4, h >> 1);
  const half = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++)
    for (let x = 0; x < hw; x++) {
      const sx = Math.min(w - 1, Math.round(((x + 0.5) * w) / hw - 0.5)), sy = Math.min(h - 1, Math.round(((y + 0.5) * h) / hh - 0.5));
      half[y * hw + x] = lumC[sy * w + sx];
    }
  const around = median(half, hw, hh, Math.max(3, Math.round(Math.max(hw, hh) * 0.10)));
  const dev = new Float32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gx = Math.min(hw - 1, Math.max(0, ((x + 0.5) * hw) / w - 0.5)), gy = Math.min(hh - 1, Math.max(0, ((y + 0.5) * hh) / h - 0.5));
      const x0 = gx | 0, y0 = gy | 0, x1 = Math.min(hw - 1, x0 + 1), y1 = Math.min(hh - 1, y0 + 1), ax = gx - x0, ay = gy - y0;
      const top = around[y0 * hw + x0] + (around[y0 * hw + x1] - around[y0 * hw + x0]) * ax;
      const bot = around[y1 * hw + x0] + (around[y1 * hw + x1] - around[y1 * hw + x0]) * ax;
      dev[y * w + x] = lumC[y * w + x] / Math.max(1, top + (bot - top) * ay);
    }
  const at = (x: number, y: number) => dev[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const dark = new Uint8Array(n);
  const comp = new Int32Array(n);
  const queue = new Int32Array(n);
  const printed = new Float32Array(n);
  const flood = (start: number, id: number, members: number[]) => {
    let head = 0, tail = 0, border = false;
    queue[tail++] = start;
    comp[start] = id;
    const want = dark[start];
    while (head < tail) {
      const p = queue[head++];
      members.push(p);
      const x = p % w, y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      for (const [dx, dy] of DIRS) {
        const qx = x + dx, qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const q = qy * w + qx;
        if (comp[q] < 0 && dark[q] === want) {
          comp[q] = id;
          queue[tail++] = q;
        }
      }
    }
    return border;
  };
  let id = 0;
  const members: number[] = [];
  /** the dark areas below `cut`: dark, broad, sharp all round, inside the page → printed */
  const findAt = (cut: number) => {
    for (let i = 0; i < n; i++) dark[i] = dev[i] < cut ? 1 : 0;
    comp.fill(-1);
    // cells with dark all around them (two cells): a printed area is broad, a sliver along a shadow's edge is not
    const core = rank(Float32Array.from(dark), w, h, 2, false);
    for (let s = 0; s < n; s++) {
      if (!dark[s] || comp[s] >= 0) continue;
      members.length = 0;
      if (flood(s, id++, members)) continue;
      // sharp all round: the change across the edge, two cells out against two cells in.
      // (Next to a shadow's hard edge the wide median makes a band of shade look dark too;
      // only its side along the edge is sharp.)
      let sharp = 0, count = 0;
      for (const p of members) {
        const x = p % w, y = (p - x) / w;
        for (const [dx, dy] of DIRS) {
          const qx = x + dx, qy = y + dy;
          if (qx < 0 || qy < 0 || qx >= w || qy >= h || dark[qy * w + qx]) continue;
          const o = at(x + 2 * dx, y + 2 * dy), i = at(x - 2 * dx, y - 2 * dy);
          if ((o - i) / Math.max(o, 1e-3) >= 0.12) sharp++;
          count++;
        }
      }
      let broad = 0;
      for (const p of members) broad += core[p];
      if (count && sharp >= count * 0.75 && broad >= members.length * 0.25) for (const p of members) printed[p] = 1;
    }
  };
  // twice: what is a little darker than the paper, then only what is much darker. A
  // photo lying next to a soft shadow joins up with it at 90 % and touches the page's
  // edge through it; its dark parts (hair, a suit) stand alone at 70 %.
  findAt(0.7);
  findAt(0.9);
  // light holes in printed areas (not too big: a framed page is not a picture)
  for (let s = 0; s < n; s++) {
    if (dark[s] || comp[s] >= 0) continue;
    members.length = 0;
    if (flood(s, id++, members) || members.length > n * 0.02) continue;
    let shut = true;
    for (const p of members) {
      const x = p % w, y = (p - x) / w;
      for (const [dx, dy] of DIRS) {
        const qx = x + dx, qy = y + dy;
        if (qx >= 0 && qy >= 0 && qx < w && qy < h && dark[qy * w + qx] && !printed[qy * w + qx]) shut = false;
      }
    }
    if (shut) for (const p of members) printed[p] = 1;
  }
  const grown = rank(printed, w, h, 1, true);
  const mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) mask[p] = grown[p] > 0 ? 1 : 0;
  return mask;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

export interface PaperLight {
  /** grid size */
  w: number;
  h: number;
  /** the light on the paper, per channel (0–255) */
  light: [Plane, Plane, Plane];
  /** 1 where the light was read off the paper, 0 where it was filled in */
  paper: Plane;
  /** 1 where a broad printed area (picture, photo, box) was found */
  printed: Uint8Array;
  /**
   * 0–1: a picture (a photo on an ID page, a coloured picture): the printed
   * areas and the coloured or dark areas they touch (a face next to the hair).
   * "Màu sạch" shows these as "Làm sáng" does, without whitening light parts.
   */
  picture: Plane;
}

/** Long side of the grid the light is worked out on. */
const GRID = 480;

export function paperLight(img: Img): PaperLight {
  const { width, height } = img;
  const long = Math.max(width, height);
  const s = Math.min(1, GRID / long);
  const w = Math.max(8, Math.round(width * s)), h = Math.max(8, Math.round(height * s));
  const g = Math.max(w, h);
  const close = Math.max(2, Math.round(g * 0.007)); // wipes strokes up to ~1.4 % of the page wide
  const med = Math.max(4, Math.round(g * 0.04));
  const env = Math.max(4, Math.round(g * 0.05));
  const fill = Math.max(4, Math.round(g * 0.06));
  const planes = shrink(img, w, h);
  const closed = planes.map((p) => rank(rank(p, w, h, close, true), w, h, close, false));
  // the median on a half-size grid (it only has to be right in broad areas), then back
  const mid = closed.map((p) => {
    const half = halve(p, w, h);
    return double(median(half.a, half.w, half.h, Math.max(2, Math.round(med / 2))), half.w, half.h, w, h);
  });
  // the paper's colour over the whole page: an upper envelope, smoothed
  const overall = closed.map((p) => blur3(rank(p, w, h, env, true), w, h, env));
  /** 1 when `x` looks like paper under some light (see the header), 0 when not */
  const paperLike = (x: Plane[], i: number, tint: number) => {
    const r0 = x[0][i] / Math.max(1, overall[0][i]);
    const r1 = x[1][i] / Math.max(1, overall[1][i]);
    const r2 = x[2][i] / Math.max(1, overall[2][i]);
    const mean = (r0 + r1 + r2) / 3;
    const spread = (Math.max(r0, r1, r2) - Math.min(r0, r1, r2)) / Math.max(1e-3, mean);
    const allowed = tint + 0.25 * Math.max(0, 1 - mean);
    const hue = Math.min(1, Math.max(0, (allowed + 0.03 - spread) / 0.06));
    // not nearly black: under 25 % of the paper's light is print (hair, a suit, a black
    // box), not shade; from 40 % on it may be shade
    const dark = Math.min(1, Math.max(0, (mean - 0.25) / 0.15));
    return hue * dark;
  };
  const lum = (x: Plane[], i: number) => 0.299 * x[0][i] + 0.587 * x[1][i] + 0.114 * x[2][i];
  const printed = printedAreas(closed, w, h);
  const wMid = new Float32Array(w * h);
  const wClosed = new Float32Array(w * h);
  for (let i = 0; i < wMid.length; i++) {
    if (printed[i]) continue;
    wMid[i] = paperLike(mid, i, 0.06);
    // the fine light (closed): a shadow's edge, a smear, a fold, at the grid's own sharpness
    wClosed[i] = paperLike(closed, i, 0.03);
  }
  void lum;
  const picture = pictureAreas(printed, closed, paperLike, w, h);
  const paper = boxBlur(rank(wMid, w, h, 1, false), w, h, 1);
  const fine = boxBlur(rank(wClosed, w, h, 1, false), w, h, 1);
  // where it is not paper: the light of the paper around it (normalised convolution)
  const den = blur3(paper, w, h, fill);
  const light = mid.map((m, c) => {
    const num = new Float32Array(w * h);
    for (let i = 0; i < num.length; i++) num[i] = m[i] * paper[i];
    const around = blur3(num, w, h, fill);
    const out = new Float32Array(w * h);
    const cl = closed[c];
    for (let i = 0; i < out.length; i++) {
      const filled = den[i] > 0.02 ? around[i] / den[i] : overall[c][i];
      const broad = paper[i] * m[i] + (1 - paper[i]) * filled;
      // never more than 3 times brighter than the page's paper: a very deep shade stays a
      // little grey rather than anything being burnt out
      out[i] = Math.max(8, overall[c][i] * 0.33, fine[i] * cl[i] + (1 - fine[i]) * broad);
    }
    return out;
  }) as [Plane, Plane, Plane];
  return { w, h, light, paper, printed, picture };
}

/**
 * Pictures: the printed areas, grown into the cells next to them that are not
 * paper either (coloured, or dark), at most 6 % of the page away. A face is
 * not dark, but it lies next to the hair; a stamp touches no printed area.
 */
function pictureAreas(printed: Uint8Array, closed: Plane[], paperLike: (x: Plane[], i: number, tint: number) => number, w: number, h: number): Plane {
  const n = w * h;
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (printed[i]) (dist[i] = 0), (queue[tail++] = i);
  const reach = Math.max(3, Math.round(Math.max(w, h) * 0.06));
  while (head < tail) {
    const p = queue[head++];
    if (dist[p] >= reach) continue;
    const x = p % w, y = (p - x) / w;
    for (const [dx, dy] of DIRS) {
      const qx = x + dx, qy = y + dy;
      if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
      const q = qy * w + qx;
      if (dist[q] >= 0 || paperLike(closed, q, 0.06) >= 0.5) continue;
      dist[q] = dist[p] + 1;
      queue[tail++] = q;
    }
  }
  const pic = new Float32Array(n);
  for (let i = 0; i < n; i++) pic[i] = dist[i] >= 0 ? 1 : 0;
  return boxBlur(rank(pic, w, h, 1, true), w, h, 1);
}

// ---- "Màu sạch" ---------------------------------------------------------------------------

export interface CleanStats {
  /** below this much ink (0–1, the strongest of the three channels) a pixel becomes paper */
  threshold: number;
  /** ink this strong becomes full strength */
  inkLevel: number;
  /** isolated specks removed */
  specks: number;
}

/** < 1 deepens the ink between the threshold and full strength */
const GAMMA = 0.85;

/** The light (and the picture weight) on the grid, bilinear at full size, one row at a time. */
function lightRows(L: PaperLight, width: number, height: number) {
  const { w, h } = L;
  const planes = [...L.light, L.picture];
  const fx = (w - 1) / Math.max(1, width - 1), fy = (h - 1) / Math.max(1, height - 1);
  const x0 = new Int32Array(width), x1 = new Int32Array(width), ax = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const gx = x * fx;
    x0[x] = gx | 0;
    x1[x] = Math.min(w - 1, x0[x] + 1);
    ax[x] = gx - x0[x];
  }
  const rowGrid = planes.map(() => new Float32Array(w));
  const row = planes.map(() => new Float32Array(width));
  return (y: number) => {
    const gy = y * fy, y0 = gy | 0, y1 = Math.min(h - 1, y0 + 1), ay = gy - y0;
    for (let c = 0; c < planes.length; c++) {
      const b = planes[c], g = rowGrid[c], r = row[c];
      for (let x = 0; x < w; x++) g[x] = b[y0 * w + x] + (b[y1 * w + x] - b[y0 * w + x]) * ay;
      for (let x = 0; x < width; x++) r[x] = g[x0[x]] + (g[x1[x]] - g[x0[x]]) * ax[x];
    }
    return row;
  };
}

export function clean(img: Img, stats?: (s: CleanStats) => void): Img {
  const { width, height, data } = img;
  const L = paperLight(img);
  const n = width * height;
  const rows = lightRows(L, width, height);
  // how much ink each pixel holds: 1 − value / light, the strongest channel
  const strong = new Float32Array(n);
  const BINS = 2048; // histogram of the strength, -1 … 1
  const hist = new Uint32Array(BINS);
  for (let y = 0; y < height; y++) {
    const [lr, lg, lb] = rows(y);
    for (let x = 0, p = y * width, o = p * 4; x < width; x++, p++, o += 4) {
      const a0 = 1 - data[o] / lr[x], a1 = 1 - data[o + 1] / lg[x], a2 = 1 - data[o + 2] / lb[x];
      const e = a0 > a1 ? (a0 > a2 ? a0 : a2) : a1 > a2 ? a1 : a2;
      strong[p] = e;
      hist[Math.min(BINS - 1, Math.max(0, Math.round(((e + 1) / 2) * (BINS - 1))))]++;
    }
  }
  const at = (q: number) => {
    const want = q * n;
    let acc = 0;
    for (let i = 0; i < BINS; i++) {
      acc += hist[i];
      if (acc >= want) return (i / (BINS - 1)) * 2 - 1;
    }
    return 1;
  };
  // the paper's spread → the threshold; the ink's strength → full strength
  const mid = at(0.5), spread = Math.max(0.005, mid - at(0.16));
  const threshold = Math.min(0.24, Math.max(0.12, mid + 5 * spread));
  const from = Math.round(((threshold + 0.15 + 1) / 2) * (BINS - 1));
  let inked = 0;
  for (let i = from; i < BINS; i++) inked += hist[i];
  let inkLevel = 0.85;
  if (inked > n * 0.0005) {
    let acc = 0;
    for (let i = from; i < BINS; i++) {
      acc += hist[i];
      if (acc >= inked * 0.85) {
        inkLevel = Math.min(0.95, Math.max(0.5, (i / (BINS - 1)) * 2 - 1));
        break;
      }
    }
  }
  const pow = new Float32Array(1025);
  for (let i = 0; i <= 1024; i++) pow[i] = Math.pow(i / 1024, GAMMA);
  const natural = naturalLut();
  // ink → output strength, the hue kept: every channel scaled by the same factor
  const out = new Uint8ClampedArray(data.length);
  const keep = new Uint8Array(n); // output strength 0–255, for the specks
  for (let y = 0; y < height; y++) {
    const [lr, lg, lb, pic] = rows(y);
    for (let x = 0, p = y * width, o = p * 4; x < width; x++, p++, o += 4) {
      out[o + 3] = 255;
      let r = 255, g = 255, b = 255;
      const e = strong[p];
      if (e > 0.04) {
        let a0 = 1 - data[o] / lr[x], a1 = 1 - data[o + 1] / lg[x], a2 = 1 - data[o + 2] / lb[x];
        if (a0 < 0) a0 = 0;
        if (a1 < 0) a1 = 0;
        if (a2 < 0) a2 = 0;
        // coloured marks (a pale fill, a light highlighter) count as ink much sooner than grey
        // ones (dirt, smears): colourful for their strength, and clearly so
        const chroma = e - Math.min(a0, a1, a2);
        const colourful = Math.min(1, Math.max(0, (chroma / e - 0.3) / 0.3)) * Math.min(1, Math.max(0, (chroma - 0.04) / 0.04));
        const t = threshold * (1 - 0.8 * colourful);
        if (e > t) {
          const s = Math.min(1, (e - t) / Math.max(0.05, inkLevel - t));
          const soft = Math.min(1, (e - t) / 0.08);
          const strength = pow[Math.round(s * 1024)] * soft * soft * (3 - 2 * soft);
          const k = strength / e;
          keep[p] = Math.round(strength * 255);
          r = 255 * (1 - Math.min(1, a0 * k));
          g = 255 * (1 - Math.min(1, a1 * k));
          b = 255 * (1 - Math.min(1, a2 * k));
        }
      }
      // in a picture: as "Làm sáng" shows it (a face's light parts must not turn white)
      const w = pic[x];
      if (w > 0.01) {
        const [nr, ng, nb] = natural(data[o] / lr[x], data[o + 1] / lg[x], data[o + 2] / lb[x]);
        r += (nr - r) * w;
        g += (ng - g) * w;
        b += (nb - b) * w;
        if (w > 0.5) keep[p] = 255;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  const specks = removeSpecks(out, keep, width, height);
  stats?.({ threshold, inkLevel, specks });
  return { width, height, data: out };
}

/**
 * Dust: a tiny mark (8-connected) with no other ink anywhere near becomes
 * paper. A diacritic or a full stop always has its letters close by.
 */
function removeSpecks(out: Uint8ClampedArray, keep: Uint8Array, width: number, height: number) {
  const n = width * height;
  const long = Math.max(width, height);
  const maxArea = Math.max(2, Math.round(9 * (long / 2400) ** 2));
  const near = Math.max(4, Math.round(12 * (long / 2400)));
  const ON = 51; // a fifth of full strength
  // integral image of the ink, for "is anything else near?"
  const W1 = width + 1;
  const sum = new Uint32Array(W1 * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += keep[y * width + x] >= ON ? 1 : 0;
      sum[(y + 1) * W1 + x + 1] = sum[y * W1 + x + 1] + row;
    }
  }
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(width - 1, x1); y1 = Math.min(height - 1, y1);
    return sum[(y1 + 1) * W1 + x1 + 1] - sum[y0 * W1 + x1 + 1] - sum[(y1 + 1) * W1 + x0] + sum[y0 * W1 + x0];
  };
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const pix = new Int32Array(maxArea + 1);
  let removed = 0;
  for (let p0 = 0; p0 < n; p0++) {
    if (keep[p0] < ON || seen[p0]) continue;
    let top = 0, area = 0, x0 = width, y0 = height, x1 = 0, y1 = 0;
    stack[top++] = p0;
    seen[p0] = 1;
    while (top) {
      const p = stack[--top];
      if (area <= maxArea) pix[area] = p;
      area++;
      const x = p % width, y = (p - x) / width;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (keep[q] >= ON && !seen[q]) {
            seen[q] = 1;
            stack[top++] = q;
          }
        }
      }
    }
    if (area > maxArea || box(x0 - near, y0 - near, x1 + near, y1 + near) !== area) continue;
    for (let i = 0; i < area; i++) out[pix[i] * 4] = out[pix[i] * 4 + 1] = out[pix[i] * 4 + 2] = 255;
    removed++;
  }
  return removed;
}

// ---- "Làm sáng" ---------------------------------------------------------------------------

/** Paper level of "Làm sáng" (0–1): a little below pure white looks natural. */
const PAPER = 0.975;
/** > 1 deepens the ink, leaves the paper where it is */
const INK_CURVE = 1.25;
const SATURATION = 1.08;

/** "Làm sáng" for one pixel: value / light per channel (1 = paper) → output 0–255. */
function naturalLut() {
  const lut = new Float32Array(1025);
  for (let i = 0; i <= 1024; i++) lut[i] = Math.pow(Math.min(1, (i / 1024) * PAPER), INK_CURVE) * 255;
  const px: [number, number, number] = [0, 0, 0];
  return (vr: number, vg: number, vb: number) => {
    const r = lut[Math.min(1024, Math.round(vr * 1024))];
    const g = lut[Math.min(1024, Math.round(vg * 1024))];
    const b = lut[Math.min(1024, Math.round(vb * 1024))];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    px[0] = l + (r - l) * SATURATION;
    px[1] = l + (g - l) * SATURATION;
    px[2] = l + (b - l) * SATURATION;
    return px;
  };
}

export function brighten(img: Img): Img {
  const { width, height, data } = img;
  const rows = lightRows(paperLight(img), width, height);
  const natural = naturalLut();
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    const light = rows(y);
    for (let x = 0, o = y * width * 4; x < width; x++, o += 4) {
      const [r, g, b] = natural(data[o] / light[0][x], data[o + 1] / light[1][x], data[o + 2] / light[2][x]);
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

// ---- grey, black and white ----------------------------------------------------------------

export function gray(img: Img): Img {
  const c = clean(img);
  const d = c.data;
  for (let o = 0; o < d.length; o += 4) {
    const l = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
    d[o] = d[o + 1] = d[o + 2] = l;
  }
  return c;
}

/** Below this grey (0–255) a pixel of the clean page is black. */
const BW_CUT = 150;

export function blackWhite(img: Img): Img {
  const c = clean(img);
  const d = c.data;
  for (let o = 0; o < d.length; o += 4) {
    const l = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
    d[o] = d[o + 1] = d[o + 2] = l < BW_CUT ? 0 : 255;
  }
  return c;
}
