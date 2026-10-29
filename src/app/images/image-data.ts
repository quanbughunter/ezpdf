/**
 * Image preparation, all on this device: decode, fix orientation, rotate,
 * re-encode, remove a paper background, trim.
 *
 * PDFium embeds JPEG bytes as they are (DCT pass-through) and PNG via its
 * own decoder (alpha becomes an SMask). What the PDF shows must be what the
 * user saw in the app, so:
 *  - a JPEG keeps its original bytes unless it carries an EXIF rotation
 *    (browsers apply it, PDF viewers don't) or is very large;
 *  - every other format is normalised to an 8-bit RGBA PNG through a canvas.
 */

export type ImageMime = 'image/png' | 'image/jpeg';

export interface PreparedImage {
  bytes: ArrayBuffer;
  mime: ImageMime;
  /** pixel size, upright as the user sees it */
  width: number;
  height: number;
}

const MAX_SIDE = 3200;
const JPEG_QUALITY = 0.92;

export class ImageReadError extends Error {}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export async function encode(c: HTMLCanvasElement, mime: ImageMime): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, mime, mime === 'image/jpeg' ? JPEG_QUALITY : undefined));
  if (!blob) throw new ImageReadError('Không mã hóa được ảnh.');
  return blob.arrayBuffer();
}

/** EXIF orientation (1–8) of a JPEG, 1 when absent. */
export function jpegOrientation(bytes: ArrayBuffer): number {
  const v = new DataView(bytes);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return 1;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off);
    const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966 /* Exif */) {
      const tiff = off + 10;
      if (tiff + 8 > v.byteLength) return 1;
      const le = v.getUint16(tiff) === 0x4949;
      const ifd = tiff + v.getUint32(tiff + 4, le);
      if (ifd + 2 > v.byteLength) return 1;
      const n = v.getUint16(ifd, le);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > v.byteLength) break;
        if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le) || 1;
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    off += 2 + len;
  }
  return 1;
}

const isJpeg = (b: ArrayBuffer) => b.byteLength > 3 && new DataView(b).getUint16(0) === 0xffd8;

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    // 'from-image' applies EXIF orientation, i.e. what the user sees elsewhere
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageReadError('Trình duyệt không đọc được ảnh này. Hãy dùng ảnh PNG hoặc JPG.');
  }
}

function fit(w: number, h: number, max = MAX_SIDE) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** Read a picked file into bytes PDFium will embed exactly as shown. */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const bytes = await file.arrayBuffer();
  const bmp = await decode(new Blob([bytes]));
  try {
    const big = Math.max(bmp.width, bmp.height) > MAX_SIDE;
    if (isJpeg(bytes) && jpegOrientation(bytes) === 1 && !big) {
      return { bytes, mime: 'image/jpeg', width: bmp.width, height: bmp.height };
    }
    const mime: ImageMime = isJpeg(bytes) ? 'image/jpeg' : 'image/png';
    const { w, h } = fit(bmp.width, bmp.height);
    const c = canvas(w, h);
    const g = c.getContext('2d')!;
    if (mime === 'image/jpeg') {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
    }
    g.drawImage(bmp, 0, 0, w, h);
    return { bytes: await encode(c, mime), mime, width: w, height: h };
  } finally {
    bmp.close();
  }
}

/**
 * The same picture turned clockwise by `quarters` × 90°, for a page that is
 * displayed rotated: the page turns it back upright.
 */
export async function rotateImage(img: PreparedImage, quarters: number): Promise<PreparedImage> {
  const q = ((quarters % 4) + 4) % 4;
  if (q === 0) return img;
  const bmp = await decode(new Blob([img.bytes], { type: img.mime }));
  try {
    const swap = q % 2 === 1;
    const c = canvas(swap ? bmp.height : bmp.width, swap ? bmp.width : bmp.height);
    const g = c.getContext('2d')!;
    if (img.mime === 'image/jpeg') {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
    }
    g.translate(c.width / 2, c.height / 2);
    g.rotate((q * Math.PI) / 2);
    g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    return { bytes: await encode(c, img.mime), mime: img.mime, width: c.width, height: c.height };
  } finally {
    bmp.close();
  }
}

/** Bounding box of pixels with alpha above `min` (0–255), or null when empty. */
export function opaqueBounds(d: ImageData, min = 8) {
  let x0 = d.width, y0 = d.height, x1 = -1, y1 = -1;
  const a = d.data;
  for (let y = 0; y < d.height; y++) {
    const row = y * d.width * 4;
    for (let x = 0; x < d.width; x++) {
      if (a[row + x * 4 + 3] > min) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Crop a canvas to its visible pixels plus a margin; null when nothing is drawn. */
export function trimCanvas(src: HTMLCanvasElement, margin = 8): HTMLCanvasElement | null {
  const d = src.getContext('2d')!.getImageData(0, 0, src.width, src.height);
  const b = opaqueBounds(d);
  if (!b) return null;
  const x = Math.max(0, b.x - margin), y = Math.max(0, b.y - margin);
  const w = Math.min(src.width - x, b.w + 2 * margin), h = Math.min(src.height - y, b.h + 2 * margin);
  const out = canvas(w, h);
  out.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, w, h);
  return out;
}

/**
 * A photo or scan of a signature → ink on transparent background.
 * The paper colour is the median of the image border; each pixel's alpha
 * comes from how much darker it is than the paper, with a soft edge, and the
 * paper tint is taken out of the edge pixels so no light halo remains.
 * `strength` 0..1: higher removes more (lighter strokes may go too).
 */
export function removePaper(src: ImageData, strength: number): ImageData {
  const { width: w, height: h, data } = src;
  const border: number[][] = [];
  const step = Math.max(1, Math.floor((w + h) / 400));
  const edge = Math.max(1, Math.round(Math.min(w, h) * 0.03));
  for (let x = 0; x < w; x += step)
    for (const y of [0, edge, h - 1 - edge, h - 1]) {
      const i = (Math.min(h - 1, Math.max(0, y)) * w + x) * 4;
      border.push([data[i], data[i + 1], data[i + 2]]);
    }
  for (let y = 0; y < h; y += step)
    for (const x of [0, edge, w - 1 - edge, w - 1]) {
      const i = (y * w + Math.min(w - 1, Math.max(0, x))) * 4;
      border.push([data[i], data[i + 1], data[i + 2]]);
    }
  const median = (k: number) => {
    const v = border.map((p) => p[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] ?? 255;
  };
  const paper = [median(0), median(1), median(2)];
  const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
  const lp = Math.max(1, lum(paper[0], paper[1], paper[2]));
  const s = Math.min(1, Math.max(0, strength));
  const lo = 0.06 + 0.3 * s;
  const hi = lo + 0.22;
  const out = new ImageData(w, h);
  const o = out.data;
  for (let i = 0; i < data.length; i += 4) {
    const dark = (lp - lum(data[i], data[i + 1], data[i + 2])) / lp;
    const a = Math.min(1, Math.max(0, (dark - lo) / (hi - lo)));
    if (a <= 0.004) continue;
    for (let k = 0; k < 3; k++) {
      // un-blend from the paper: c = a·ink + (1−a)·paper
      o[i + k] = Math.min(255, Math.max(0, Math.round((data[i + k] - (1 - a) * paper[k]) / a)));
    }
    o[i + 3] = Math.round(a * 255 * Math.min(1, data[i + 3] / 255));
  }
  return out;
}

/** Decode a picked signature photo into a (downscaled) ImageData. */
export async function readForSignature(file: Blob, maxSide = 1600): Promise<ImageData> {
  const bmp = await decode(file);
  try {
    const { w, h } = fit(bmp.width, bmp.height, maxSide);
    const c = canvas(w, h);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    return g.getImageData(0, 0, w, h);
  } finally {
    bmp.close();
  }
}

/** ImageData → trimmed transparent PNG. */
export async function imageDataToPng(d: ImageData, margin = 8): Promise<PreparedImage | null> {
  const c = canvas(d.width, d.height);
  c.getContext('2d')!.putImageData(d, 0, 0);
  const t = trimCanvas(c, margin);
  if (!t) return null;
  return { bytes: await encode(t, 'image/png'), mime: 'image/png', width: t.width, height: t.height };
}
