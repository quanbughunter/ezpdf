/**
 * Pixels of a page for OCR (pure: runs in a worker, in the browser and in
 * Node tests). A page arrives as 8-bit grey at a known resolution; here it
 * is straightened, split into ink and paper, and written as PGM for
 * Tesseract (Leptonica reads PNM directly).
 */

export interface Gray {
  w: number;
  h: number;
  /** one byte per pixel, 0 black … 255 white, rows top to bottom */
  data: Uint8Array;
}

/** a box in pixels of the page image: x0,y0 top left, x1,y1 bottom right (exclusive) */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const boxW = (b: Box) => b.x1 - b.x0;
export const boxH = (b: Box) => b.y1 - b.y0;
export const area = (b: Box) => Math.max(0, boxW(b)) * Math.max(0, boxH(b));
export const overlap = (a: Box, b: Box): Box => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });
export const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
export const centre = (b: Box) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 });
export const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.x0 && p.x < b.x1 && p.y >= b.y0 && p.y < b.y1;

/** RGBA (canvas order) → grey, by luma */
export function rgbaToGray(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Gray {
  const data = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114 + 500) / 1000;
  return { w, h, data };
}

/** PGM (P5) bytes: what Tesseract is handed */
export function toPgm(g: Gray): Uint8Array {
  const head = new TextEncoder().encode(`P5\n${g.w} ${g.h}\n255\n`);
  const out = new Uint8Array(head.length + g.data.length);
  out.set(head);
  out.set(g.data, head.length);
  return out;
}

/** PGM (P5) → grey (for the tests) */
export function fromPgm(b: Uint8Array): Gray {
  let pos = 0;
  const token = () => {
    while (pos < b.length && (b[pos] === 0x20 || b[pos] === 0x0a || b[pos] === 0x0d || b[pos] === 0x09 || b[pos] === 0x23)) {
      if (b[pos] === 0x23) while (pos < b.length && b[pos] !== 0x0a) pos++;
      else pos++;
    }
    let s = '';
    while (pos < b.length && b[pos] > 0x20) s += String.fromCharCode(b[pos++]);
    return s;
  };
  if (token() !== 'P5') throw new Error('not a PGM');
  const w = Number(token());
  const h = Number(token());
  const max = Number(token());
  pos++;
  if (max !== 255) throw new Error('PGM with maxval ' + max);
  return { w, h, data: b.slice(pos, pos + w * h) };
}

/**
 * Ink (1) and paper (0): a pixel is ink when clearly darker than the mean of
 * the square around it (so shading and yellowed paper stay paper) and dark
 * in itself. Window: about a sixth of an inch.
 */
export function binarize(g: Gray, dpi: number): Uint8Array {
  const { w, h, data } = g;
  const r = Math.max(8, Math.round(dpi / 12));
  // integral image of the grey values, (w+1)×(h+1)
  const W = w + 1;
  const sum = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
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
      const n = (x1 - x0) * (y1 - y0);
      const mean = (sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0]) / n;
      const v = data[y * w + x];
      out[y * w + x] = v < 170 && v < mean * 0.86 ? 1 : v < 90 ? 1 : 0;
    }
  }
  return out;
}

/**
 * The page's tilt in degrees (a scan placed slightly crooked), from how
 * sharply the rows of ink line up when the page is turned by each candidate
 * angle: text lines give the tallest peaks when level.
 */
export function skewAngle(ink: Uint8Array, w: number, h: number, maxDeg = 3): number {
  // a quarter-size sample is plenty
  const s = 4;
  const sw = Math.floor(w / s);
  const sh = Math.floor(h / s);
  const pts: number[] = [];
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      let any = 0;
      for (let dy = 0; dy < s && !any; dy++) for (let dx = 0; dx < s; dx++) if (ink[(y * s + dy) * w + x * s + dx]) { any = 1; break; }
      if (any) pts.push(x, y);
    }
  if (pts.length < 200) return 0;
  const score = (deg: number) => {
    const t = Math.tan((deg * Math.PI) / 180);
    const bins = new Float64Array(sh + sw + 2);
    const off = Math.ceil(Math.abs(t) * sw) + 1;
    for (let i = 0; i < pts.length; i += 2) {
      const yy = Math.round(pts[i + 1] - pts[i] * t) + off;
      if (yy >= 0 && yy < bins.length) bins[yy]++;
    }
    let v = 0;
    for (let i = 1; i < bins.length; i++) v += (bins[i] - bins[i - 1]) ** 2;
    return v;
  };
  let best = 0;
  let bestScore = score(0);
  for (let step = 0.5, lo = -maxDeg, hi = maxDeg; step >= 0.05; ) {
    for (let d = lo; d <= hi + 1e-9; d += step) {
      const v = score(d);
      if (v > bestScore) {
        bestScore = v;
        best = d;
      }
    }
    lo = best - step;
    hi = best + step;
    step /= 4;
  }
  return Math.round(best * 100) / 100;
}

/** the page turned by -deg about its centre (bilinear; what falls outside is paper) */
export function rotate(g: Gray, deg: number): Gray {
  if (!deg) return g;
  const { w, h, data } = g;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const cx = w / 2;
  const cy = h / 2;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // where this output pixel comes from in the tilted page
      const dx = x - cx;
      const dy = y - cy;
      const sx = cx + dx * c - dy * s;
      const sy = cy + dx * s + dy * c;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) {
        out[y * w + x] = 255;
        continue;
      }
      const fx = sx - x0;
      const fy = sy - y0;
      const i = y0 * w + x0;
      const top = data[i] + (data[i + 1] - data[i]) * fx;
      const bot = data[i + w] + (data[i + w + 1] - data[i + w]) * fx;
      out[y * w + x] = top + (bot - top) * fy;
    }
  return { w, h, data: out };
}

/** a point of the straightened page back on the page as scanned */
export function unrotatePoint(x: number, y: number, deg: number, w: number, h: number) {
  if (!deg) return { x, y };
  const a = (deg * Math.PI) / 180;
  const dx = x - w / 2;
  const dy = y - h / 2;
  return { x: w / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: h / 2 + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** a copy of the grey page with these boxes painted white (ruling lines, before Tesseract reads it) */
export function erase(g: Gray, boxes: Box[]): Gray {
  const out = g.data.slice();
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor(b.x0));
    const x1 = Math.min(g.w, Math.ceil(b.x1));
    const y0 = Math.max(0, Math.floor(b.y0));
    const y1 = Math.min(g.h, Math.ceil(b.y1));
    for (let y = y0; y < y1; y++) out.fill(255, y * g.w + x0, y * g.w + x1);
  }
  return { w: g.w, h: g.h, data: out };
}

/** a part of the grey page with a white margin round it (a table cell for Tesseract) */
export function crop(g: Gray, b: Box, margin: number): Gray {
  const x0 = Math.max(0, Math.floor(b.x0));
  const y0 = Math.max(0, Math.floor(b.y0));
  const x1 = Math.min(g.w, Math.ceil(b.x1));
  const y1 = Math.min(g.h, Math.ceil(b.y1));
  const w = Math.max(1, x1 - x0) + 2 * margin;
  const h = Math.max(1, y1 - y0) + 2 * margin;
  const data = new Uint8Array(w * h).fill(255);
  for (let y = y0; y < y1; y++) data.set(g.data.subarray(y * g.w + x0, y * g.w + x1), (y - y0 + margin) * w + margin);
  return { w, h, data };
}

/** ink pixels inside a box */
export function inkIn(ink: Uint8Array, w: number, b: Box): number {
  let n = 0;
  for (let y = Math.max(0, Math.floor(b.y0)); y < Math.ceil(b.y1); y++) for (let x = Math.max(0, Math.floor(b.x0)); x < Math.min(w, Math.ceil(b.x1)); x++) n += ink[y * w + x];
  return n;
}

/** the page scaled up by a whole factor (bilinear): small print reads better larger */
export function enlarge(g: Gray, f: number): Gray {
  if (f <= 1) return g;
  const w = g.w * f;
  const h = g.h * f;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(g.h - 1, Math.max(0, (y + 0.5) / f - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(g.h - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(g.w - 1, Math.max(0, (x + 0.5) / f - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(g.w - 1, x0 + 1);
      const fx = sx - x0;
      const top = g.data[y0 * g.w + x0] * (1 - fx) + g.data[y0 * g.w + x1] * fx;
      const bot = g.data[y1 * g.w + x0] * (1 - fx) + g.data[y1 * g.w + x1] * fx;
      data[y * w + x] = top * (1 - fy) + bot * fy;
    }
  }
  return { w, h, data };
}
