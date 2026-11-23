/**
 * From the photo to a flat page.
 *
 *  - warp: the four corners become the page's corners (inverse homography,
 *    bilinear sampling)
 *  - rotate: quarter turns
 * The filters (Làm sáng, Màu sạch, …) are in filters.ts.
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
