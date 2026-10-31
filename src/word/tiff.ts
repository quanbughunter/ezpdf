/**
 * TIFF → bitmap, with UTIF.js (MIT, Photopea): uncompressed, PackBits, LZW,
 * Deflate, CCITT G3/G4 (scanned black-and-white pages), JPEG; strips and
 * tiles; bilevel, grey, palette, RGB, CMYK. The first page of a multi-page
 * TIFF, as Word shows it.
 *
 * UTIF trusts the file. Before it sees one, a copy is checked and made safe
 * here, so a crafted file cannot make it loop for ever or fill the memory:
 *  - the chain of pages is followed with every step checked, and cut where
 *    it would loop or leave the file, and after 8 pages;
 *  - the tags UTIF would follow into other directories or another TIFF
 *    (sub-pages, EXIF, maker notes, DNG data) are renamed, so it does not;
 *  - every tag's values must lie inside the file; a big tag decoding does
 *    not need (Photoshop layers, XMP…) is emptied;
 *  - the picture itself: size, bits, strips and tiles must agree and fit
 *    the limits below; each JPEG piece must be no larger than its strip;
 *  - LZW and Deflate are decoded here, never past the strip's own size
 *    (UTIF's LZW runs on past the end of a damaged strip for ever).
 * On top of that the app decodes in a worker it stops after a few seconds
 * (app/word/raster-client.ts).
 */
import UTIF from 'utif';
import { Unzlib } from 'fflate';
import type { Bitmap } from './images';

/** the most pixels a TIFF may have to be decoded (a 600 dpi A4 scan is 35 million) */
const MAX_PIXELS = 36e6;
/** the most bytes its decoded samples may take */
const MAX_RAW = 160 * 1024 * 1024;
const MAX_PAGES = 8;
/** compressions decoded: none, CCITT G3, G4, LZW, old JPEG, JPEG, Deflate, PackBits */
const COMPRESSIONS = new Set([1, 3, 4, 5, 6, 7, 8, 32773]);
/** tags UTIF follows into other directories (sub-pages, EXIF, maker note, DNG private data) */
const NESTED = new Set([330, 34665, 37500, 50740]);
/** tags decoding uses; another tag larger than 64 KB is emptied */
const NEEDED = new Set([254, 256, 257, 258, 259, 262, 266, 273, 277, 278, 279, 284, 317, 320, 322, 323, 324, 325, 338, 339, 347, 513, 514, 530, 532]);
/** bytes per value of each TIFF type (0: unknown, read as nothing) */
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4, 0, 0, 8, 8, 8];

/*
 * JPEG inside a TIFF whose pixels are stored as RGB (PhotometricInterpretation
 * 2, as many scanners write it): UTIF's JPEG decoder takes three-component
 * data for YCbCr and converts it again, which gives wrong colours. Its
 * "colour transform" switch (the minified field `B` of UTIF 3.1.0, which
 * package.json pins) is turned off for those pictures only.
 */
let rgbJpeg = false;
const BaseJpeg = UTIF.JpegDecoder;
UTIF.JpegDecoder = function JpegDecoder() {
  const d = new BaseJpeg();
  if (rgbJpeg) d.B = 0;
  // a JPEG whose height comes from a DNL marker is parsed a second time with that height: never (the frame size was checked, that height was not)
  const parse = d.parse;
  d.parse = function (data: Uint8Array, again?: unknown) {
    if (again !== undefined) throw new Error('JPEG with a DNL height');
    return parse.call(this, data);
  };
  return d;
} as unknown as typeof UTIF.JpegDecoder;

type Page = Record<string, number[]> & { t322?: number[]; isLE?: boolean };

/*
 * Each strip or tile: LZW and Deflate decoded here, into exactly the room it
 * has; the other compressions by UTIF. Byte order and the predictor are then
 * applied here, with the strip's or tile's own width and height (UTIF uses
 * the picture's, which is wrong for tiles and makes them very slow).
 */
const baseDecompress = UTIF.decode._decompress;
UTIF.decode._decompress = function (img: never, ifds: unknown, data: Uint8Array, off: number, len: number, cmpr: number, tgt: Uint8Array, toff: number, fo: number) {
  const page = img as Page;
  const w = page.t256[0];
  const bps = page.t258?.[0] ?? 1;
  const spp = page.t277?.[0] ?? 1;
  const pieceW = page.t322 ? page.t322[0] : w;
  const bpl = Math.ceil((bps * spp * pieceW) / 8);
  const room = Math.max(0, Math.min(tgt.length - toff, page.t322 ? tgt.length : stripBytes(page)));
  // UTIF's own byte swap and predictor off for this call
  const pred = page.t317, le = page.isLE;
  page.t317 = undefined as unknown as number[];
  page.isLE = true;
  try {
    if (cmpr === 5 || cmpr === 8) {
      const src = data.subarray(off, Math.min(data.length, off + len));
      const out = cmpr === 5 ? lzw(src, room) : inflate(src, room);
      baseDecompress.call(this, img, ifds, out, 0, out.length, 1, tgt, toff, fo);
    } else baseDecompress.call(this, img, ifds, data, off, len, cmpr, tgt, toff, fo);
  } finally {
    page.t317 = pred;
    page.isLE = le;
  }
  const rows = Math.floor(room / bpl);
  if (bps === 16 && !le) {
    for (let i = toff, end = toff + rows * bpl - 1; i < end; i += 2) {
      const t = tgt[i];
      tgt[i] = tgt[i + 1];
      tgt[i + 1] = t;
    }
  }
  if (pred?.[0] === 2) {
    const step = (bps * spp) >> 3; // bytes per pixel (8 or 16 bits a sample: see fits)
    for (let y = 0; y < rows; y++) {
      const r = toff + y * bpl;
      if (bps === 16) {
        for (let j = r + step; j + 1 < r + bpl; j += 2) {
          const v = ((tgt[j + 1] << 8) | tgt[j]) + ((tgt[j - step + 1] << 8) | tgt[j - step]);
          tgt[j] = v & 255;
          tgt[j + 1] = (v >>> 8) & 255;
        }
      } else for (let j = r + step; j < r + bpl; j++) tgt[j] = (tgt[j] + tgt[j - step]) & 255;
    }
  }
};

/*
 * CCITT G3/G4: UTIF builds each line as a list of pixels; a damaged strip
 * can make a line grow without end. A line longer than the page is refused.
 */
let lineCap = 0;
const baseAddN = UTIF.decode._addNtimes;
UTIF.decode._addNtimes = function (arr: unknown[], n: number, val: number) {
  if (lineCap && arr.length + n > lineCap) throw new Error('CCITT line longer than the page');
  return baseAddN.call(this, arr, n, val);
};

function bitsPerPixel(p: Page): number {
  return p.t258 ? Math.min(32, p.t258[0]) * p.t258.length : (p.t277?.[0] ?? 1);
}
function stripBytes(p: Page): number {
  const w = p.t256[0], h = p.t257[0];
  const rps = Math.min(p.t278?.[0] ?? h, h);
  return rps * Math.ceil((w * bitsPerPixel(p)) / 8);
}

/** TIFF LZW (most significant bit first, code width grows one code early), stopping at the end code, the end of the data or `room` bytes */
function lzw(src: Uint8Array, room: number): Uint8Array {
  const out = new Uint8Array(room);
  const prev = new Int16Array(4096), last = new Uint8Array(4096), first = new Uint8Array(4096), size = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) {
    prev[i] = -1;
    last[i] = first[i] = i;
    size[i] = 1;
  }
  let o = 0, pos = 0, bits = 9, next = 258, old = -1;
  const total = src.length * 8;
  const emit = (code: number) => {
    let c = code;
    for (let k = size[code] - 1; k >= 0; k--) {
      if (o + k < room) out[o + k] = last[c];
      c = prev[c];
    }
    o += size[code];
  };
  while (pos + bits <= total && o < room) {
    const b = pos >>> 3;
    const v = (src[b] << 16) | ((src[b + 1] ?? 0) << 8) | (src[b + 2] ?? 0);
    const code = (v >>> (24 - (pos & 7) - bits)) & ((1 << bits) - 1);
    pos += bits;
    if (code === 257) break;
    if (code === 256) {
      bits = 9;
      next = 258;
      old = -1;
      continue;
    }
    if (old < 0) {
      if (code > 255) break;
      emit(code);
      old = code;
      continue;
    }
    if (code < next) {
      if (next < 4096) {
        prev[next] = old;
        last[next] = first[code];
        first[next] = first[old];
        size[next] = size[old] + 1;
        next++;
      }
      emit(code);
    } else if (code === next && next < 4096) {
      prev[next] = old;
      last[next] = first[old];
      first[next] = first[old];
      size[next] = size[old] + 1;
      next++;
      emit(code);
    } else break; // a code that cannot be there: the strip is damaged
    old = code;
    if (next === (1 << bits) - 1 && bits < 12) bits++;
  }
  return o >= room ? out : out.subarray(0, o);
}

const FULL = new Error('full');
/** zlib data, inflated in small steps and stopped once `room` bytes are out (a few KB cannot become gigabytes) */
function inflate(src: Uint8Array, room: number): Uint8Array {
  const out = new Uint8Array(room);
  let o = 0;
  const z = new Unzlib((chunk) => {
    const n = Math.min(chunk.length, room - o);
    out.set(chunk.subarray(0, n), o);
    o += n;
    if (o >= room) throw FULL;
  });
  try {
    for (let i = 0; i < src.length; i += 4096) z.push(src.subarray(i, i + 4096), i + 4096 >= src.length);
  } catch {
    // full, or damaged: what came out is kept
  }
  return o >= room ? out : out.subarray(0, o);
}

/** the size in a JPEG's frame header, or null when there is none before the image data */
function jpegFrame(b: Uint8Array, off: number, len: number): { w: number; h: number } | null {
  const end = Math.min(b.length, off + len);
  if (b[off] !== 0xff || b[off + 1] !== 0xd8) return null;
  let p = off + 2;
  while (p + 9 <= end) {
    if (b[p] !== 0xff) return null;
    const m = b[p + 1];
    if (m === 0xff) {
      p++;
      continue;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) {
      p += 2;
      continue;
    }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[p + 5] << 8) | b[p + 6], w: (b[p + 7] << 8) | b[p + 8] };
    if (m === 0xda || m === 0xd9) return null;
    p += 2 + ((b[p + 2] << 8) | b[p + 3]);
  }
  return null;
}

/**
 * A copy of the file UTIF can read safely (see the top of this file), or
 * null when the file cannot be one.
 */
export function safeCopy(bytes: Uint8Array): Uint8Array | null {
  const len = bytes.length;
  if (len < 8) return null;
  const b = bytes.slice();
  const le = b[0] === 0x49;
  if (!(le ? b[1] === 0x49 && b[2] === 42 && b[3] === 0 : b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42)) return null;
  const dv = new DataView(b.buffer);
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  const seen = new Set<number>();
  let link = 4; // where the offset of the next page is written
  let at = u32(4);
  while (at) {
    if (seen.has(at) || at + 2 > len) return seen.size ? (dv.setUint32(link, 0, le), b) : null;
    const n = u16(at);
    const next = at + 2 + n * 12;
    if (n === 0 || n > 4096 || next + 4 > len) return seen.size ? (dv.setUint32(link, 0, le), b) : null;
    seen.add(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const bytesNeeded = count * (TYPE_SIZE[type] ?? 0);
      if (NESTED.has(tag)) dv.setUint16(e, 65000 + (tag % 500), le);
      const inside = bytesNeeded <= 4 || u32(e + 8) + bytesNeeded <= len;
      if (NEEDED.has(tag)) {
        if (!inside || count > 1 << 20) return null;
      } else if (!inside || bytesNeeded > 65536 || (type === 2 && count > 4096)) {
        dv.setUint32(e + 4, 0, le); // emptied
      }
    }
    if (seen.size >= MAX_PAGES) {
      dv.setUint32(next, 0, le);
      break;
    }
    link = next;
    at = u32(next);
  }
  return seen.size ? b : null;
}

/**
 * Can this page be decoded within the limits, into colours ezPDF converts
 * (toRgba)? Fills in a missing PhotometricInterpretation and a
 * BitsPerSample given once for several samples.
 */
function fits(p: Page, len: number, b: Uint8Array): boolean {
  const w = p.t256?.[0], h = p.t257?.[0];
  if (!(w > 0 && h > 0) || w * h > MAX_PIXELS) return false;
  const cmpr = p.t259?.[0] ?? 1;
  if (!COMPRESSIONS.has(cmpr)) return false;
  const spp = p.t277?.[0] ?? 1;
  if (!(spp >= 1 && spp <= 8)) return false;
  if (!p.t258) p.t258 = [1];
  if (p.t258.length === 1 && spp > 1) p.t258 = new Array(spp).fill(p.t258[0]);
  const bps = p.t258[0];
  if (p.t258.length !== spp || p.t258.some((v) => v !== bps)) return false;
  if (!p.t262) p.t262 = [spp >= 3 ? (cmpr === 7 ? 6 : 2) : 1];
  // the layouts toRgba converts; samples one after another for each pixel (not in separate planes)
  const pi = p.t262[0];
  const ok =
    ((pi === 0 || pi === 1) && [1, 2, 4, 8, 16].includes(bps)) ||
    (pi === 2 && spp >= 3 && (bps === 8 || bps === 16)) ||
    (pi === 3 && [1, 2, 4, 8].includes(bps) && spp === 1 && (p.t320?.length ?? 0) >= 3 << bps) ||
    (pi === 5 && spp >= 4 && (bps === 8 || bps === 16)) ||
    (pi === 6 && cmpr === 7 && spp >= 3 && bps === 8);
  if (!ok || (p.t284?.[0] ?? 1) !== 1) return false;
  const pred = p.t317?.[0] ?? 1;
  if (pred !== 1 && !(pred === 2 && (bps === 8 || bps === 16))) return false;
  if (cmpr === 7 && bps !== 8) return false;
  const bpl = Math.ceil((w * bitsPerPixel(p)) / 8);
  if (h * bpl > MAX_RAW) return false;
  const offs = p.t273 ?? p.t324;
  const counts = p.t279 ?? p.t325;
  if (!offs?.length || (!counts && !(cmpr === 1 && offs.length === 1)) || (counts && counts.length < offs.length)) return false;
  let sum = 0;
  for (let i = 0; i < offs.length; i++) {
    const c = counts ? counts[i] : 0;
    if (counts && offs[i] + c > len) return false;
    sum += c;
  }
  if (sum > 4 * len) return false;
  let pieceW = w, pieceH: number;
  if (p.t322) {
    const tw = p.t322[0], th = p.t323?.[0];
    if (!(tw >= 1 && tw <= 8192 && th >= 1 && th <= 8192)) return false;
    const tiles = Math.ceil(w / tw) * Math.ceil(h / th);
    if (tiles > offs.length || tiles > 1e6 || (tw * th * bitsPerPixel(p)) / 8 > 64 * 1024 * 1024) return false;
    pieceW = tw;
    pieceH = th;
  } else {
    const rps = Math.min(p.t278?.[0] ?? h, h);
    if (!(rps >= 1) || offs.length > Math.ceil(h / rps) + 1) return false;
    pieceH = rps;
  }
  // a JPEG piece no larger than its strip or tile (UTIF's decoder sizes its buffers by the JPEG)
  const small = (f: { w: number; h: number } | null) => !!f && f.w > 0 && f.h > 0 && f.w <= pieceW + 16 && f.h <= pieceH + 16;
  if (cmpr === 7) {
    for (let i = 0; i < offs.length; i++) if (!small(jpegFrame(b, offs[i], counts![i]))) return false;
  }
  if (cmpr === 6) {
    // old-style JPEG: only the kind that holds one whole JPEG
    const at = p.t513?.[0], n = p.t514?.[0];
    if (!(at >= 0 && n > 0 && at + n <= len)) return false;
    const f = jpegFrame(b, at, n);
    if (!(f && f.w <= w + 16 && f.h <= h + 16)) return false;
  }
  return true;
}

/** The first page of a TIFF as RGBA, or null when it cannot be decoded. */
export function decodeTiff(bytes: Uint8Array): Bitmap | null {
  try {
    const safe = safeCopy(bytes);
    if (!safe) return null;
    const buf = safe.buffer as ArrayBuffer;
    const pages = UTIF.decode(buf) as Page[];
    // the first page that is a picture, not a reduced-size copy of one (NewSubfileType bit 0)
    const pics = pages.filter((p) => p.t256 && p.t257);
    const page = pics.find((p) => !((p.t254?.[0] ?? 0) & 1)) ?? pics[0];
    if (!page || !fits(page, safe.length, safe)) return null;
    const w = page.t256[0], h = page.t257[0];
    rgbJpeg = page.t259?.[0] === 7 && page.t262[0] === 2;
    lineCap = w + 64;
    try {
      UTIF.decodeImage(buf, page, pages);
    } finally {
      rgbJpeg = false;
      lineCap = 0;
    }
    const data = (page as unknown as { data?: Uint8Array }).data;
    if (!data) return null;
    return { rgba: toRgba(page, data, w, h), w, h };
  } catch {
    return null;
  }
}

/**
 * Decoded samples → RGBA, for the layouts `fits` lets through (UTIF's own
 * conversion knows fewer: 4-bit grey, palettes under 8 bits, 16-bit CMYK…).
 * 16-bit samples are little-endian here; their high byte is used.
 */
function toRgba(p: Page, data: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const pi = p.t262[0];
  const bps = p.t258[0];
  const spp = p.t277?.[0] ?? 1;
  const bpl = Math.ceil((w * bps * spp) / 8);
  const extra = p.t338?.[0] ?? 0; // 1: alpha multiplied in, 2: plain alpha
  const hi = bps === 16 ? 1 : 0;
  const bpsB = bps >> 3; // bytes per sample (8 and 16 bits)
  /** sample `s` of pixel `x` in row `y`, 0–255 */
  const sample = (y: number, x: number, s: number): number => {
    if (bps >= 8) return data[y * bpl + (x * spp + s) * bpsB + hi] ?? 0;
    const bit = (x * spp + s) * bps;
    const v = ((data[y * bpl + (bit >> 3)] ?? 0) >> (8 - bps - (bit & 7))) & ((1 << bps) - 1);
    return Math.round((v * 255) / ((1 << bps) - 1));
  };
  const map = p.t320;
  const ncol = 1 << bps;
  const stride = map ? Math.floor(map.length / 3) : 0; // 2^bits per channel; some writers give 256 for fewer bits
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r: number, g: number, bl: number, a = 255;
      if (pi === 0 || pi === 1) {
        const v = sample(y, x, 0);
        r = g = bl = pi === 0 ? 255 - v : v;
        if (spp >= 2 && extra) a = sample(y, x, 1);
      } else if (pi === 3) {
        const bit = x * bps;
        const i = bps === 8 ? data[y * bpl + x] ?? 0 : ((data[y * bpl + (bit >> 3)] ?? 0) >> (8 - bps - (bit & 7))) & (ncol - 1);
        r = map[i] >> 8;
        g = map[stride + i] >> 8;
        bl = map[2 * stride + i] >> 8;
      } else if (pi === 5) {
        const k = 255 - sample(y, x, 3);
        r = Math.round(((255 - sample(y, x, 0)) * k) / 255);
        g = Math.round(((255 - sample(y, x, 1)) * k) / 255);
        bl = Math.round(((255 - sample(y, x, 2)) * k) / 255);
        if (spp >= 5 && extra) a = sample(y, x, 4);
      } else {
        // RGB (and YCbCr JPEG, which the JPEG decoder has already turned into RGB)
        r = sample(y, x, 0);
        g = sample(y, x, 1);
        bl = sample(y, x, 2);
        if (spp >= 4 && extra) a = sample(y, x, 3);
      }
      if (extra === 1 && a > 0 && a < 255) {
        r = Math.min(255, Math.round((r * 255) / a));
        g = Math.min(255, Math.round((g * 255) / a));
        bl = Math.min(255, Math.round((bl * 255) / a));
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = bl;
      out[o + 3] = a;
    }
  }
  return out;
}
