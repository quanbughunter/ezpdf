/**
 * From the photo to a flat, evenly lit page.
 *
 *  - warp: the four corners become the page's corners (inverse homography,
 *    bilinear sampling)
 *  - brighten ("Làm sáng", on by default): the light falling on the sheet is
 *    estimated from the paper itself (a max filter wipes out the writing,
 *    a blur smooths it) and divided out, per colour channel. The paper turns
 *    evenly white, shadows and the lamp's colour cast go, and the ink keeps
 *    its own colour. A mild curve deepens the ink a little. Nothing is
 *    thresholded, so photos and stamps on the page stay natural.
 */
import { applyH, homography, type Quad } from './geometry';

export interface Img {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>; // RGBA
}

export function warp(src: Img, quad: Quad, width: number, height: number): Img {
  const out = new Uint8ClampedArray(width * height * 4);
  const dst: Quad = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const h = homography(dst, quad); // page pixel → photo pixel
  const sw = src.width, sh = src.height, s = src.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = applyH(h, x + 0.5, y + 0.5);
      let fx = p.x - 0.5, fy = p.y - 0.5;
      fx = fx < 0 ? 0 : fx > sw - 1 ? sw - 1 : fx;
      fy = fy < 0 ? 0 : fy > sh - 1 ? sh - 1 : fy;
      const x0 = fx | 0, y0 = fy | 0;
      const x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0;
      const ax = fx - x0, ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * ax;
        const bot = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * ax;
        out[o + c] = top + (bot - top) * ay;
      }
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

/** Area-average downscale of one channel to w × h (floats). */
function shrink(img: Img, c: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy += 2) {
        for (let xx = x0; xx < x1; xx += 2) {
          sum += img.data[(yy * img.width + xx) * 4 + c];
          n++;
        }
      }
      out[y * w + x] = sum / n;
    }
  }
  return out;
}

function maxFilter(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = Math.max(m, a[y * w + k]);
      t[y * w + x] = m;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = Math.max(m, t[k * w + x]);
      o[y * w + x] = m;
    }
  return o;
}

function boxBlur(a: Float32Array, w: number, h: number, r: number): Float32Array {
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
  return o;
}

/** Paper level, white point of the result (0–1): a little below pure white looks natural. */
const PAPER = 0.975;
/** > 1 deepens the ink, leaves the paper where it is */
const INK_CURVE = 1.25;
const SATURATION = 1.08;

export function brighten(img: Img): Img {
  const { width, height } = img;
  const long = 160;
  const w = width >= height ? long : Math.max(8, Math.round((long * width) / height));
  const h = height > width ? long : Math.max(8, Math.round((long * height) / width));
  const r = Math.max(2, Math.round(long * 0.05));
  // the light on the paper, per channel
  const bg = [0, 1, 2].map((c) => boxBlur(boxBlur(maxFilter(shrink(img, c, w, h), w, h, r), w, h, r), w, h, r));
  // big dark areas (a photo, a black box) are content, not shadow: limit the gain
  const levels = [0, 1, 2].map((c) => {
    const v = Array.from(bg[c]).sort((a, b) => a - b);
    return v[Math.floor(v.length * 0.9)];
  });
  const floor = levels.map((l) => Math.max(24, l * 0.5));
  const out = new Uint8ClampedArray(img.data.length);
  const lut = new Float32Array(1025);
  for (let i = 0; i <= 1024; i++) lut[i] = Math.pow(Math.min(1, (i / 1024) * PAPER), INK_CURVE) * 255;
  const fx = (w - 1) / Math.max(1, width - 1), fy = (h - 1) / Math.max(1, height - 1);
  const px = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    const gy = y * fy, y0 = gy | 0, y1 = Math.min(h - 1, y0 + 1), ay = gy - y0;
    for (let x = 0; x < width; x++) {
      const gx = x * fx, x0 = gx | 0, x1 = Math.min(w - 1, x0 + 1), ax = gx - x0;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const b = bg[c];
        const top = b[y0 * w + x0] + (b[y0 * w + x1] - b[y0 * w + x0]) * ax;
        const bot = b[y1 * w + x0] + (b[y1 * w + x1] - b[y1 * w + x0]) * ax;
        const light = Math.max(floor[c], top + (bot - top) * ay);
        const v = img.data[o + c] / light; // 1 = paper
        px[c] = lut[Math.min(1024, Math.round(v * 1024))];
      }
      const l = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
      out[o] = l + (px[0] - l) * SATURATION;
      out[o + 1] = l + (px[1] - l) * SATURATION;
      out[o + 2] = l + (px[2] - l) * SATURATION;
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

/** Quarter turns clockwise. */
export function rotate(img: Img, quarter: number): Img {
  const q = ((quarter % 4) + 4) % 4;
  if (!q) return img;
  const { width: w, height: h, data } = img;
  const W = q % 2 ? h : w, H = q % 2 ? w : h;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [X, Y] = q === 1 ? [h - 1 - y, x] : q === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x];
      const i = (y * w + x) * 4, o = (Y * W + X) * 4;
      out[o] = data[i];
      out[o + 1] = data[i + 1];
      out[o + 2] = data[i + 2];
      out[o + 3] = 255;
    }
  return { width: W, height: H, data: out };
}
