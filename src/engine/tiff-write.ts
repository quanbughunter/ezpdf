/**
 * TIFF files of page pictures (Xuất thành ảnh): baseline TIFF 6.0, 8-bit RGB
 * or grey, LZW with the horizontal predictor (lossless; what libtiff,
 * Photoshop and Windows write and read), strips of about 64 KB, the
 * resolution in dots per inch. Several pages make one multi-page file
 * (chained IFDs, PageNumber on each).
 *
 * Split in two so the heavy part runs where the pixels are (the PDFium
 * worker): tiffPage() compresses one page, tiffFile() only puts compressed
 * pages together. Nothing here reads a TIFF.
 */

export interface TiffPage {
  width: number;
  height: number;
  /** one sample per pixel (grey, black is zero) instead of three */
  gray: boolean;
  /** dots per inch, written as XResolution / YResolution */
  dpi: number;
  rowsPerStrip: number;
  /** LZW-compressed strips, top to bottom */
  strips: Uint8Array[];
}

/** ≈ 64 KB of pixels per strip */
const STRIP_BYTES = 64 * 1024;

/**
 * TIFF's LZW (TIFF 6.0 section 13), written as libtiff writes it: codes 9 to
 * 12 bits wide, most significant bit first; 256 clears the table, 257 ends
 * the strip. The code grows a bit once the next free entry needs it (512,
 * 1024, 2048: a reader, one entry behind, widens at 511, the "early
 * change"); the table is cleared when entry 4093 has been added. The end
 * code is written at the width the reader will have after the last code.
 */
export class LzwEncoder {
  /** child code for (code, next byte), 0 when there is none: codes 258… never collide with 0 */
  private next = new Uint16Array(4096 * 256);
  /** entries set since the last clear, to empty only those */
  private used = new Int32Array(4096);
  private nUsed = 0;

  encode(data: Uint8Array): Uint8Array {
    let out = new Uint8Array(Math.max(64, (data.length >> 1) + 16));
    let pos = 0;
    let acc = 0;
    let bits = 0;
    let width = 9;
    let free = 258;
    const put = (code: number) => {
      acc = (acc << width) | code;
      bits += width;
      while (bits >= 8) {
        bits -= 8;
        if (pos >= out.length) {
          const grown = new Uint8Array(out.length * 2);
          grown.set(out);
          out = grown;
        }
        out[pos++] = (acc >>> bits) & 0xff;
      }
      acc &= (1 << bits) - 1;
    };
    const clear = () => {
      for (let i = 0; i < this.nUsed; i++) this.next[this.used[i]] = 0;
      this.nUsed = 0;
      free = 258;
    };
    clear();
    put(256);
    if (!data.length) {
      put(257);
    } else {
      let prefix = data[0];
      for (let i = 1; i < data.length; i++) {
        const c = data[i];
        const key = (prefix << 8) | c;
        const child = this.next[key];
        if (child) {
          prefix = child;
          continue;
        }
        put(prefix);
        this.next[key] = free;
        this.used[this.nUsed++] = key;
        free++;
        if (free === 4094) {
          put(256);
          clear();
          width = 9;
        } else if (free > (1 << width) - 1) width++;
        prefix = c;
      }
      put(prefix);
      // the reader adds one more entry on reading `prefix`, and may widen before the end code
      if (free + 1 === 4094) {
        put(256);
        width = 9;
      } else if (free + 1 > (1 << width) - 1) width++;
      put(257);
    }
    if (bits > 0) {
      if (pos >= out.length) {
        const grown = new Uint8Array(out.length + 1);
        grown.set(out);
        out = grown;
      }
      out[pos++] = (acc << (8 - bits)) & 0xff;
    }
    return out.slice(0, pos);
  }
}

/** Rec. 601 luma, as most image programs turn colour into grey */
export const lumaOf = (r: number, g: number, b: number) => (r * 299 + g * 587 + b * 114 + 500) / 1000;

/**
 * One page from RGBA pixels (alpha ignored: pages are drawn on white).
 * The horizontal predictor turns each sample into its difference from the
 * one to its left, which LZW then packs far better for photographs.
 */
export function tiffPage(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, opts: { gray?: boolean; dpi: number }): TiffPage {
  if (!(width > 0 && height > 0) || rgba.length < width * height * 4) throw new Error('Ảnh trang không hợp lệ.');
  const gray = !!opts.gray;
  const spp = gray ? 1 : 3;
  const rowBytes = width * spp;
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(STRIP_BYTES / rowBytes)));
  const lzw = new LzwEncoder();
  const strips: Uint8Array[] = [];
  const buf = new Uint8Array(rowBytes * rowsPerStrip);
  for (let y0 = 0; y0 < height; y0 += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, height - y0);
    for (let r = 0; r < rows; r++) {
      const src = (y0 + r) * width * 4;
      const dst = r * rowBytes;
      if (gray) {
        let prev = 0;
        for (let x = 0; x < width; x++) {
          const s = src + x * 4;
          const v = lumaOf(rgba[s], rgba[s + 1], rgba[s + 2]) | 0;
          buf[dst + x] = (v - prev) & 0xff;
          prev = v;
        }
      } else {
        let pr = 0, pg = 0, pb = 0;
        for (let x = 0; x < width; x++) {
          const s = src + x * 4;
          const d = dst + x * 3;
          const r0 = rgba[s], g0 = rgba[s + 1], b0 = rgba[s + 2];
          buf[d] = (r0 - pr) & 0xff;
          buf[d + 1] = (g0 - pg) & 0xff;
          buf[d + 2] = (b0 - pb) & 0xff;
          pr = r0;
          pg = g0;
          pb = b0;
        }
      }
    }
    strips.push(lzw.encode(buf.subarray(0, rows * rowBytes)));
  }
  return { width, height, gray, dpi: opts.dpi, rowsPerStrip, strips };
}

const TYPE = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5 } as const;
const SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };

interface Entry {
  tag: number;
  type: number;
  values: number[];
}

/** Pages put together as one file: one IFD per page, each followed by its strips. */
export function tiffFile(pages: TiffPage[], software = 'ezPDF'): Uint8Array {
  if (!pages.length) throw new Error('Không có trang nào để ghi.');
  const soft = [...new TextEncoder().encode(software.slice(0, 60)), 0];
  // layout: header, then per page: IFD, its out-of-line values, its strips
  const plans = pages.map((p, i) => {
    const spp = p.gray ? 1 : 3;
    const dpi = Math.max(1, Math.round(p.dpi));
    const entries: Entry[] = [
      { tag: 254, type: TYPE.LONG, values: [0] },
      { tag: 256, type: TYPE.LONG, values: [p.width] },
      { tag: 257, type: TYPE.LONG, values: [p.height] },
      { tag: 258, type: TYPE.SHORT, values: Array(spp).fill(8) },
      { tag: 259, type: TYPE.SHORT, values: [5] },
      { tag: 262, type: TYPE.SHORT, values: [p.gray ? 1 : 2] },
      { tag: 273, type: TYPE.LONG, values: p.strips.map(() => 0) },
      { tag: 277, type: TYPE.SHORT, values: [spp] },
      { tag: 278, type: TYPE.LONG, values: [p.rowsPerStrip] },
      { tag: 279, type: TYPE.LONG, values: p.strips.map((s) => s.length) },
      { tag: 282, type: TYPE.RATIONAL, values: [dpi, 1] },
      { tag: 283, type: TYPE.RATIONAL, values: [dpi, 1] },
      { tag: 284, type: TYPE.SHORT, values: [1] },
      { tag: 296, type: TYPE.SHORT, values: [2] },
      ...(pages.length > 1 ? [{ tag: 297, type: TYPE.SHORT, values: [i, pages.length] }] : []),
      { tag: 305, type: TYPE.ASCII, values: soft },
      { tag: 317, type: TYPE.SHORT, values: [2] },
    ];
    const count = (e: Entry) => (e.type === TYPE.RATIONAL ? e.values.length / 2 : e.values.length);
    const bytesOf = (e: Entry) => count(e) * SIZE[e.type];
    const ifdSize = 2 + entries.length * 12 + 4;
    const extra = entries.reduce((n, e) => n + (bytesOf(e) > 4 ? (bytesOf(e) + 1) & ~1 : 0), 0);
    const data = p.strips.reduce((n, s) => n + s.length, 0);
    return { p, entries, count, bytesOf, ifdSize, extra, data };
  });
  const total = 8 + plans.reduce((n, pl) => n + pl.ifdSize + pl.extra + pl.data + 1, 0);
  if (total > 0xffffffff) throw new Error('Tệp TIFF quá lớn (trên 4 GB): hãy chọn ít trang hơn hoặc độ phân giải thấp hơn.');
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x49, 0x49, 42, 0]);
  let at = 8;
  dv.setUint32(4, at, true);
  plans.forEach((pl, i) => {
    const ifd = at;
    let extraAt = ifd + pl.ifdSize;
    let dataAt = extraAt + pl.extra;
    // strip offsets known now
    const offs: number[] = [];
    for (const s of pl.p.strips) {
      offs.push(dataAt);
      out.set(s, dataAt);
      dataAt += s.length;
    }
    pl.entries.find((e) => e.tag === 273)!.values = offs;
    dv.setUint16(ifd, pl.entries.length, true);
    pl.entries.forEach((e, k) => {
      const p0 = ifd + 2 + k * 12;
      dv.setUint16(p0, e.tag, true);
      dv.setUint16(p0 + 2, e.type, true);
      dv.setUint32(p0 + 4, pl.count(e), true);
      const n = pl.bytesOf(e);
      const where = n > 4 ? extraAt : p0 + 8;
      if (n > 4) {
        dv.setUint32(p0 + 8, extraAt, true);
        extraAt += (n + 1) & ~1;
      }
      e.values.forEach((v, j) => {
        if (e.type === TYPE.BYTE || e.type === TYPE.ASCII) out[where + j] = v;
        else if (e.type === TYPE.SHORT) dv.setUint16(where + j * 2, v, true);
        else dv.setUint32(where + j * 4, v, true); // LONG, and RATIONAL as two LONGs
      });
    });
    // word-aligned next IFD (TIFF wants IFDs on even offsets)
    let end = dataAt;
    if (end & 1) end++;
    const nextIfd = i + 1 < plans.length ? end : 0;
    dv.setUint32(ifd + 2 + pl.entries.length * 12, nextIfd, true);
    at = end;
  });
  return out.slice(0, at);
}
