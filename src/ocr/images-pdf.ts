/**
 * Pictures to OCR (JPEG, PNG, TIFF with all its pages, BMP, GIF, WebP) as a
 * PDF, one page per picture, so they go through OCR like a scanned PDF and
 * come out as a searchable PDF that holds the pictures themselves:
 *  - a JPEG is embedded as it is (DCTDecode), not re-compressed
 *  - other pictures are stored losslessly (FlateDecode), in grey when they
 *    have no colour
 *  - the page has the picture's size at its resolution (JPEG JFIF, PNG
 *    pHYs, TIFF tags); a picture that does not say, or says 72 or 96 (a
 *    screen's default, not a scan's), is taken as a full A4 page
 *  - a phone photo's EXIF orientation becomes the page's /Rotate
 * Runs in the OCR worker; nothing leaves the device.
 */
import { zlibSync } from 'fflate';
import { decodeTiffPages } from '../word/tiff';

export interface PictureFile {
  name: string;
  bytes: Uint8Array;
}

interface PicturePage {
  width: number;
  height: number;
  /** points */
  pageWidth: number;
  pageHeight: number;
  rotate: number;
  image: { filter: 'DCTDecode'; data: Uint8Array; space: 'DeviceRGB' | 'DeviceGray' | 'DeviceCMYK'; invertCmyk: boolean } | { filter: 'FlateDecode'; data: Uint8Array; space: 'DeviceRGB' | 'DeviceGray' };
}

export class PictureError extends Error {}

export type PictureKind = 'jpeg' | 'png' | 'tiff' | 'bmp' | 'gif' | 'webp' | null;

export function pictureKind(b: Uint8Array): PictureKind {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42)) return 'tiff';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

const A4_LONG_IN = 11.69;

/** the page size for a picture: its own resolution, or a full A4 page (a turned photo's page turns with /Rotate) */
function pageSize(width: number, height: number, dpi: number) {
  let d = dpi;
  if (!(d >= 100 && d <= 2400) || d === 72 || d === 96) d = Math.max(100, Math.min(600, Math.max(width, height) / A4_LONG_IN));
  return { pageWidth: (width / d) * 72, pageHeight: (height / d) * 72 };
}

interface JpegInfo {
  width: number;
  height: number;
  components: number;
  dpi: number;
  rotate: number;
  adobe: boolean;
}

/** a JPEG's size, colour channels, resolution and EXIF orientation */
export function jpegInfo(b: Uint8Array): JpegInfo | null {
  let i = 2;
  let dpi = 0;
  let rotate = 0;
  let adobe = false;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    const seg = i + 4;
    if (marker === 0xe0 && b[seg] === 0x4a && b[seg + 1] === 0x46 && b[seg + 2] === 0x49 && b[seg + 3] === 0x46) {
      // JFIF: units 1 dots per inch, 2 per cm
      const units = b[seg + 7];
      const x = (b[seg + 8] << 8) | b[seg + 9];
      if (units === 1) dpi = x;
      else if (units === 2) dpi = x * 2.54;
    } else if (marker === 0xe1 && b[seg] === 0x45 && b[seg + 1] === 0x78 && b[seg + 2] === 0x69 && b[seg + 3] === 0x66) {
      rotate = exifRotation(b.subarray(seg + 6, seg + len - 2));
    } else if (marker === 0xee && b[seg] === 0x41 && b[seg + 1] === 0x64 && b[seg + 2] === 0x6f && b[seg + 3] === 0x62 && b[seg + 4] === 0x65) {
      adobe = true;
    } else if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (b[seg + 1] << 8) | b[seg + 2];
      const width = (b[seg + 3] << 8) | b[seg + 4];
      const components = b[seg + 5];
      if (!width || !height) return null;
      return { width, height, components, dpi: Math.round(dpi), rotate, adobe };
    }
    i += 2 + len;
  }
  return null;
}

/** EXIF orientation (tag 0x0112) as a page rotation: 6 → 90, 3 → 180, 8 → 270 */
function exifRotation(t: Uint8Array): number {
  if (t.length < 8) return 0;
  const le = t[0] === 0x49;
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0 : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0);
  const ifd = u32(4);
  if (ifd + 2 > t.length) return 0;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) break;
    if (u16(e) === 0x0112) return { 3: 180, 6: 90, 8: 270 }[u16(e + 8)] ?? 0;
  }
  return 0;
}

/** a PNG's resolution (pHYs, pixels per metre) */
function pngDpi(b: Uint8Array): number {
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (type === 'pHYs' && len >= 9) {
      const ppm = ((b[i + 8] << 24) | (b[i + 9] << 16) | (b[i + 10] << 8) | b[i + 11]) >>> 0;
      return b[i + 16] === 1 ? Math.round(ppm * 0.0254) : 0;
    }
    if (type === 'IDAT' || type === 'IEND') break;
    i += 12 + len;
  }
  return 0;
}

/** RGBA over white → grey or RGB samples, compressed */
function flate(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): PicturePage['image'] {
  const n = w * h;
  let grey = true;
  const over = (c: number, a: number) => (c * a + 255 * (255 - a)) / 255;
  for (let i = 0; i < n && grey; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    if (r !== g || g !== b) grey = false;
  }
  const out = new Uint8Array(n * (grey ? 1 : 3));
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    if (grey) out[i] = a === 255 ? rgba[i * 4] : over(rgba[i * 4], a);
    else {
      out[i * 3] = a === 255 ? rgba[i * 4] : over(rgba[i * 4], a);
      out[i * 3 + 1] = a === 255 ? rgba[i * 4 + 1] : over(rgba[i * 4 + 1], a);
      out[i * 3 + 2] = a === 255 ? rgba[i * 4 + 2] : over(rgba[i * 4 + 2], a);
    }
  }
  return { filter: 'FlateDecode', data: zlibSync(out, { level: 6 }), space: grey ? 'DeviceGray' : 'DeviceRGB' };
}

/** the browser's own decoder (PNG, BMP, GIF, WebP), in a worker */
async function decodeWithBrowser(bytes: Uint8Array): Promise<{ rgba: Uint8ClampedArray; w: number; h: number }> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart]));
  try {
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    return { rgba: ctx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
  } finally {
    bmp.close();
  }
}

/** the pages pictures make (a TIFF may hold several) */
export async function picturePages(files: PictureFile[]): Promise<PicturePage[]> {
  const pages: PicturePage[] = [];
  for (const f of files) {
    const kind = pictureKind(f.bytes);
    if (kind === 'jpeg') {
      const info = jpegInfo(f.bytes);
      if (!info || ![1, 3, 4].includes(info.components)) throw new PictureError(`${f.name}: ảnh JPEG này không đọc được.`);
      const space = info.components === 1 ? 'DeviceGray' : info.components === 4 ? 'DeviceCMYK' : 'DeviceRGB';
      pages.push({ width: info.width, height: info.height, rotate: info.rotate, ...pageSize(info.width, info.height, info.dpi), image: { filter: 'DCTDecode', data: f.bytes, space, invertCmyk: info.adobe } });
    } else if (kind === 'tiff') {
      const list = decodeTiffPages(f.bytes);
      if (!list.length) throw new PictureError(`${f.name}: ảnh TIFF này không đọc được.`);
      for (const { bitmap, dpi } of list) pages.push({ width: bitmap.w, height: bitmap.h, rotate: 0, ...pageSize(bitmap.w, bitmap.h, dpi), image: flate(bitmap.rgba, bitmap.w, bitmap.h) });
    } else if (kind) {
      let d: { rgba: Uint8ClampedArray; w: number; h: number };
      try {
        d = await decodeWithBrowser(f.bytes);
      } catch {
        throw new PictureError(`${f.name}: ảnh này không đọc được.`);
      }
      const dpi = kind === 'png' ? pngDpi(f.bytes) : 0;
      pages.push({ width: d.w, height: d.h, rotate: 0, ...pageSize(d.w, d.h, dpi), image: flate(d.rgba, d.w, d.h) });
    } else throw new PictureError(`${f.name}: không phải ảnh JPEG, PNG, TIFF, BMP, GIF hay WebP.`);
  }
  return pages;
}

const enc = new TextEncoder();
const num = (n: number) => (Math.round(n * 100) / 100).toString();

/** the PDF: one page per picture, drawn full page */
export function picturesToPdf(pages: PicturePage[], title = ''): Uint8Array {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const offsets: number[] = [];
  const add = (b: Uint8Array | string) => {
    const u = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(u);
    size += u.byteLength;
  };
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = size;
    add(`${n} 0 obj\n`);
    if (typeof body === 'string') add(body);
    else body();
    add('\nendobj\n');
  };
  const n = pages.length;
  const pageObj = (i: number) => 4 + i * 3;
  add('%PDF-1.5\n%âãÏÓ\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`);
  const safeTitle = title.replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, '\\$&');
  obj(3, `<< /Producer (ezPDF) /Creator (ezPDF OCR)${safeTitle ? ` /Title (${safeTitle})` : ''} >>`);
  pages.forEach((p, i) => {
    const page = pageObj(i);
    const contents = page + 1;
    const image = page + 2;
    obj(
      page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.pageWidth)} ${num(p.pageHeight)}]${p.rotate ? ` /Rotate ${p.rotate}` : ''} /Resources << /XObject << /Im0 ${image} 0 R >> /ProcSet [/PDF /ImageC /ImageB] >> /Contents ${contents} 0 R >>`,
    );
    const draw = `q ${num(p.pageWidth)} 0 0 ${num(p.pageHeight)} 0 0 cm /Im0 Do Q`;
    obj(contents, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    obj(image, () => {
      const im = p.image;
      const decode = im.filter === 'DCTDecode' && im.space === 'DeviceCMYK' && im.invertCmyk ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
      add(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /${im.space} /BitsPerComponent 8 /Filter /${im.filter}${decode} /Length ${im.data.byteLength} >>\nstream\n`);
      add(im.data);
      add('\nendstream');
    });
  });
  const xref = size;
  const total = 4 + n * 3;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  add(table);
  add(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}
