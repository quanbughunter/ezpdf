/**
 * The resolution of a page picture written into the file, so that Word,
 * an image editor or a printer shows it at the page's real size: a PNG gets
 * a pHYs chunk (pixels per metre), a JPEG gets JFIF density in dots per
 * inch. The browser's own encoders (canvas) write neither. Everything else
 * in the file is left as the encoder wrote it.
 */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** `png` with a pHYs chunk for `dpi` right after IHDR (one already there is replaced). */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (png.length < 33 || PNG_SIG.some((b, i) => png[i] !== b)) return png;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (dv.getUint32(12) !== 0x49484452) return png; // IHDR first
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // pHYs
  cv.setUint32(8, ppm);
  cv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  cv.setUint32(17, crc32(chunk, 4, 17));
  // drop a pHYs the encoder wrote, keep every other chunk as it is
  const parts: Uint8Array[] = [png.subarray(0, 33), chunk];
  let at = 33;
  while (at + 12 <= png.length) {
    const len = dv.getUint32(at);
    const type = dv.getUint32(at + 4);
    const end = at + 12 + len;
    if (end > png.length) break;
    if (type !== 0x70485973) parts.push(png.subarray(at, end));
    at = end;
  }
  if (at < png.length) parts.push(png.subarray(at));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** `jpeg` whose JFIF header says `dpi` (a JFIF segment is added when the encoder wrote none). */
export function jpegWithDpi(jpeg: Uint8Array, dpi: number): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  const isJfif = (at: number) =>
    jpeg[at] === 0xff && jpeg[at + 1] === 0xe0 && jpeg[at + 4] === 0x4a && jpeg[at + 5] === 0x46 && jpeg[at + 6] === 0x49 && jpeg[at + 7] === 0x46 && jpeg[at + 8] === 0;
  if (jpeg.length > 18 && isJfif(2)) {
    const out = jpeg.slice();
    out[13] = 1; // units: dots per inch
    out[14] = d >> 8;
    out[15] = d & 0xff;
    out[16] = d >> 8;
    out[17] = d & 0xff;
    return out;
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 0xff, d >> 8, d & 0xff, 0, 0]);
  const out = new Uint8Array(jpeg.length + app0.length);
  out.set(jpeg.subarray(0, 2));
  out.set(app0, 2);
  out.set(jpeg.subarray(2), 2 + app0.length);
  return out;
}
