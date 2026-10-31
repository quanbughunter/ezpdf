/**
 * Pictures in a Word file, whatever their format: what each one really is
 * (by its bytes, not its name), and the ways to make it something a browser
 * shows.
 *
 *  - PNG, JPEG, GIF, BMP, WebP, SVG, ICO: shown as they are.
 *  - TIFF: decoded (tiff.ts, UTIF.js) and shown as PNG. Chrome, Edge and
 *    the Android WebView do not show TIFF; only Safari does.
 *  - WMF, EMF: drawn as SVG (metafile.ts); .wmz/.emz/.svgz unpacked first.
 *  - EPS: its preview (the TIFF or WMF Word itself shows, or the EPSI bitmap).
 *  - Mac PICT: the JPEG inside it, when there is one.
 *  - AVIF, HEIC, JPEG XR: shown when the browser on this device can; the
 *    reader asks it before opening (readDocx's `canShow`).
 *  - anything else: a labelled chip, never a broken picture.
 */
import { zlibSync } from 'fflate';

export type ImageKind =
  | 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'avif' | 'heic' | 'tiff' | 'svg' | 'ico'
  | 'wmf' | 'emf' | 'gzip' | 'eps' | 'pict' | 'jxr' | 'unknown';

/** what a browser is told the bytes are */
export const IMAGE_MIME: Partial<Record<ImageKind, string>> = {
  png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', avif: 'image/avif',
  heic: 'image/heic', svg: 'image/svg+xml', ico: 'image/x-icon', jxr: 'image/vnd.ms-photo',
};

/** shown as they are by every browser ezPDF runs in */
export const NATIVE = new Set<ImageKind>(['png', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico']);
/** shown only by some browsers: the reader asks this one first */
export const MAYBE = new Set<ImageKind>(['avif', 'heic', 'jxr']);

/** the name a chip shows for a picture ezPDF cannot show */
export const KIND_LABEL: Partial<Record<ImageKind, string>> = {
  tiff: 'TIFF', eps: 'EPS', pict: 'PICT', heic: 'HEIC', avif: 'AVIF', jxr: 'JPEG XR', wmf: 'WMF', emf: 'EMF', gzip: 'nén',
};

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** What a picture is, by its first bytes. */
export function sniffImage(b: Uint8Array): ImageKind {
  if (b.length < 4) return 'unknown';
  const u32 = (at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (b[0] === 0x42 && b[1] === 0x4d && b.length > 18 && [12, 40, 52, 56, 64, 108, 124].includes(u32(14))) return 'bmp';
  if (ascii(b, 0, 4) === 'RIFF' && b.length > 12 && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b.length > 12 && ascii(b, 4, 4) === 'ftyp') {
    const brands = ascii(b, 8, Math.min(32, Math.max(0, (b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]) - 8)));
    if (/avi[fs]/.test(brands)) return 'avif';
    if (/hei[cxms]|hev[cxms]|mif1|msf1/.test(brands)) return 'heic';
  }
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return 'tiff';
  if (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0xbc) return 'jxr';
  if (isIco(b)) return 'ico';
  if (u32(0) === 0x9ac6cdd7) return 'wmf';
  if ((b[0] === 1 || b[0] === 2) && b[1] === 0 && b[2] === 9 && b[3] === 0) return 'wmf';
  if (u32(0) === 1 && b.length > 44 && ascii(b, 40, 4) === ' EMF') return 'emf';
  if (b[0] === 0x1f && b[1] === 0x8b) return 'gzip';
  if (u32(0) === 0xc6d3d0c5 || ascii(b, 0, 4) === '%!PS') return 'eps';
  if (isPict(b)) return 'pict';
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 4096)).replace(/^\uFEFF/, '').trimStart();
  if (/^<(\?xml|svg|!--|!DOCTYPE)/i.test(head) && /<svg[\s>]/.test(head)) return 'svg';
  return 'unknown';
}

/** an icon file: 00 00 01|02 00, a count, and a first entry that points inside the file (a TGA can start the same way) */
function isIco(b: Uint8Array): boolean {
  if (b.length < 22 || b[0] !== 0 || b[1] !== 0 || (b[2] !== 1 && b[2] !== 2) || b[3] !== 0) return false;
  const count = b[4] | (b[5] << 8);
  const size = (b[14] | (b[15] << 8) | (b[16] << 16) | (b[17] << 24)) >>> 0;
  const at = (b[18] | (b[19] << 8) | (b[20] << 16) | (b[21] << 24)) >>> 0;
  return count > 0 && count <= 256 && b[9] === 0 && size > 0 && at >= 6 + 16 * count && at + size <= b.length;
}

/** a QuickDraw PICT (version 1 or 2), with or without the 512-byte file header */
function isPict(b: Uint8Array): boolean {
  for (const at of [10, 522]) {
    if (b.length < at + 4) continue;
    if (b[at] === 0x11 && b[at + 1] === 0x01) return true; // version 1
    if (b[at] === 0x00 && b[at + 1] === 0x11 && b[at + 2] === 0x02 && b[at + 3] === 0xff) return true; // version 2
  }
  return false;
}

/** A Mac PICT made by QuickTime holds a whole JPEG: those bytes, or null. */
export function pictJpeg(b: Uint8Array): Uint8Array | null {
  for (let i = 0; i + 3 < b.length; i++) {
    if (b[i] === 0xff && b[i + 1] === 0xd8 && b[i + 2] === 0xff && (b[i + 3] & 0xf0) === 0xe0) {
      // the browser stops at the JPEG's end marker; what follows is ignored
      return b.subarray(i);
    }
  }
  return null;
}

export type Bitmap = { rgba: Uint8Array; w: number; h: number };

/**
 * The preview of a DOS EPS (the picture Word shows): its TIFF or WMF part.
 * null when the file is not a DOS EPS or has neither.
 */
export function dosEpsPreview(b: Uint8Array): { kind: 'tiff' | 'wmf'; bytes: Uint8Array } | null {
  if (b.length < 30) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== 0xc6d3d0c5) return null;
  const part = (at: number) => {
    const start = dv.getUint32(at, true), len = dv.getUint32(at + 4, true);
    return len > 0 && start >= 30 && start + len <= b.length ? b.subarray(start, start + len) : null;
  };
  const tiff = part(20);
  if (tiff) return { kind: 'tiff', bytes: tiff };
  const wmf = part(12);
  return wmf ? { kind: 'wmf', bytes: wmf } : null;
}

/** hex digit → value, 255 for anything else */
const HEX = (() => {
  const t = new Uint8Array(256).fill(255);
  for (let i = 0; i < 10; i++) t[48 + i] = i;
  for (let i = 0; i < 6; i++) t[65 + i] = t[97 + i] = 10 + i;
  return t;
})();

/**
 * The EPSI bitmap in an EPS file's comments (%%BeginPreview: width height
 * depth lines, then the rows in hex), 4 million pixels at most; null when
 * there is none.
 */
export function epsiBitmap(b: Uint8Array): Bitmap | null {
  const scan = b.subarray(0, Math.min(b.length, 8 * 1024 * 1024));
  const text = new TextDecoder('latin1').decode(scan.subarray(0, Math.min(scan.length, 64 * 1024)));
  const m = /%%BeginPreview:\s*(\d+)\s+(\d+)\s+(\d+)\s+\d+/.exec(text);
  if (!m) return null;
  const w = Number(m[1]), h = Number(m[2]), depth = Number(m[3]);
  if (!(w > 0 && h > 0 && w * h <= 4e6 && [1, 2, 4, 8].includes(depth))) return null;
  const rowBytes = Math.ceil((w * depth) / 8);
  // the hex digits, straight into bytes, stopping at %%EndPreview or when the bitmap is full
  const raw = new Uint8Array(rowBytes * h);
  let n = 0, hi = -1;
  for (let i = m.index + m[0].length; i < scan.length && n < raw.length; i++) {
    const c = scan[i];
    if (c === 0x25 && scan[i + 1] === 0x25 && scan[i + 2] === 0x45) break; // %%E(ndPreview)
    const v = HEX[c];
    if (v === 255) continue;
    if (hi < 0) hi = v;
    else {
      raw[n++] = (hi << 4) | v;
      hi = -1;
    }
  }
  if (n < raw.length) return null;
  const rgba = new Uint8Array(w * h * 4);
  const max = (1 << depth) - 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bit = x * depth;
      const v = (raw[y * rowBytes + (bit >> 3)] >> (8 - depth - (bit & 7))) & max;
      // 0 is white, the largest value black
      const g = 255 - Math.round((v / max) * 255);
      const o = (y * w + x) * 4;
      rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
      rgba[o + 3] = 255;
    }
  }
  return { rgba, w, h };
}

/** a picture larger than this on its long side is shown scaled down (it is kept as it was in the file) */
export const MAX_SIDE = 2400;

/** A bitmap scaled down by averaging, to at most `maxSide` pixels on its long side. */
export function shrink(bm: Bitmap, maxSide = MAX_SIDE): Bitmap {
  const k = Math.max(bm.w, bm.h) / maxSide;
  if (k <= 1) return bm;
  const w = Math.max(1, Math.round(bm.w / k)), h = Math.max(1, Math.round(bm.h / k));
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * bm.h) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * bm.h) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * bm.w) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * bm.w) / w));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * bm.w + xx) * 4;
          r += bm.rgba[i];
          g += bm.rgba[i + 1];
          b += bm.rgba[i + 2];
          a += bm.rgba[i + 3];
          n++;
        }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { rgba: out, w, h };
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A bitmap as a PNG file (RGB when it has no transparency). */
export function encodePng(bm: Bitmap): Uint8Array {
  const { rgba, w, h } = bm;
  let opaque = true;
  for (let i = 3; i < rgba.length && opaque; i += 4) if (rgba[i] !== 255) opaque = false;
  const ch = opaque ? 3 : 4;
  const row = w * ch + 1;
  const raw = new Uint8Array(row * h);
  for (let y = 0; y < h; y++) {
    let o = y * row + 1; // filter byte 0: none
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[o++] = rgba[i];
      raw[o++] = rgba[i + 1];
      raw[o++] = rgba[i + 2];
      if (ch === 4) raw[o++] = rgba[i + 3];
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const head = new Uint8Array(8);
    new DataView(head.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
    const tail = new Uint8Array(4);
    new DataView(tail.buffer).setUint32(0, crc32([head.subarray(4), data]));
    return [head, data, tail];
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = opaque ? 2 : 6;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunk('IHDR', ihdr), ...chunk('IDAT', zlibSync(raw, { level: 4 })), ...chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
