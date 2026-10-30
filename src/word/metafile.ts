/**
 * Windows metafiles (WMF and EMF) → SVG, for display. Word keeps them as
 * the picture of an equation from MathType or the old Equation Editor 3.0
 * (an OLE object), and as pictures pasted from older programs.
 *
 * Plays the GDI records those files use: the coordinate mapping (window,
 * viewport, map modes, world transform), pens, brushes, fonts, lines,
 * polygons, rectangles, ellipses, arcs, paths, bitmaps, and text with its
 * alignment, per-character spacing, italic and bold. Text in the Symbol font
 * (Greek letters, operators, the pieces of big brackets) is turned into the
 * Unicode characters it shows, so it reads right on phones that have no
 * Symbol font. EMF+ records are skipped: Office writes the GDI version
 * beside them. Clipping is not applied.
 *
 * Pure: bytes in, SVG markup out. Every number is a number and all text is
 * escaped. A malformed file gives null, never a partial or unsafe drawing.
 */
import { escapeHtml } from './xml';

export interface MetaSvg {
  /** SVG content (markup) drawn in a w × h px box */
  inner: string;
  w: number;
  h: number;
}

// ---- output -----------------------------------------------------------------

const r2 = (x: number) => Math.round((Number.isFinite(x) ? x : 0) * 100) / 100;
const num = (x: number) => String(r2(x));

interface Pen {
  style: number;
  /** logical units (0: one device pixel) */
  width: number;
  color: string;
}
interface Brush {
  style: number;
  color: string;
}
interface Font {
  height: number;
  escapement: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  charset: number;
  family: number;
  face: string;
}
type Obj = { pen: Pen } | { brush: Brush } | { font: Font } | { other: true };

interface DC {
  pen: Pen;
  brush: Brush;
  font: Font;
  textColor: string;
  textAlign: number;
  fillMode: number;
  mapMode: number;
  winOrg: [number, number];
  winExt: [number, number];
  vpOrg: [number, number];
  vpExt: [number, number];
  /** world transform (EMF): a b c d e f */
  world: number[];
  cur: [number, number];
}

const BLACK_PEN: Pen = { style: 0, width: 0, color: '#000000' };
const WHITE_BRUSH: Brush = { style: 0, color: '#ffffff' };
const DEFAULT_FONT: Font = { height: -16, escapement: 0, weight: 400, italic: false, underline: false, strike: false, charset: 0, family: 0, face: 'Arial' };

const colorRef = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** the Symbol font's characters → Unicode (0x20–0xFE) */
const SYMBOL: Record<number, number> = {
  0x22: 0x2200, 0x24: 0x2203, 0x27: 0x220b, 0x2a: 0x2217, 0x2d: 0x2212, 0x40: 0x2245, 0x41: 0x391, 0x42: 0x392, 0x43: 0x3a7,
  0x44: 0x394, 0x45: 0x395, 0x46: 0x3a6, 0x47: 0x393, 0x48: 0x397, 0x49: 0x399, 0x4a: 0x3d1, 0x4b: 0x39a, 0x4c: 0x39b,
  0x4d: 0x39c, 0x4e: 0x39d, 0x4f: 0x39f, 0x50: 0x3a0, 0x51: 0x398, 0x52: 0x3a1, 0x53: 0x3a3, 0x54: 0x3a4, 0x55: 0x3a5,
  0x56: 0x3c2, 0x57: 0x3a9, 0x58: 0x39e, 0x59: 0x3a8, 0x5a: 0x396, 0x5c: 0x2234, 0x5e: 0x22a5, 0x60: 0x203e, 0x61: 0x3b1,
  0x62: 0x3b2, 0x63: 0x3c7, 0x64: 0x3b4, 0x65: 0x3b5, 0x66: 0x3c6, 0x67: 0x3b3, 0x68: 0x3b7, 0x69: 0x3b9, 0x6a: 0x3d5,
  0x6b: 0x3ba, 0x6c: 0x3bb, 0x6d: 0x3bc, 0x6e: 0x3bd, 0x6f: 0x3bf, 0x70: 0x3c0, 0x71: 0x3b8, 0x72: 0x3c1, 0x73: 0x3c3,
  0x74: 0x3c4, 0x75: 0x3c5, 0x76: 0x3d6, 0x77: 0x3c9, 0x78: 0x3be, 0x79: 0x3c8, 0x7a: 0x3b6, 0x7e: 0x223c, 0xa0: 0x20ac,
  0xa1: 0x3d2, 0xa2: 0x2032, 0xa3: 0x2264, 0xa4: 0x2044, 0xa5: 0x221e, 0xa6: 0x192, 0xa7: 0x2663, 0xa8: 0x2666, 0xa9: 0x2665,
  0xaa: 0x2660, 0xab: 0x2194, 0xac: 0x2190, 0xad: 0x2191, 0xae: 0x2192, 0xaf: 0x2193, 0xb0: 0xb0, 0xb1: 0xb1, 0xb2: 0x2033,
  0xb3: 0x2265, 0xb4: 0xd7, 0xb5: 0x221d, 0xb6: 0x2202, 0xb7: 0x2022, 0xb8: 0xf7, 0xb9: 0x2260, 0xba: 0x2261, 0xbb: 0x2248,
  0xbc: 0x2026, 0xbd: 0x23d0, 0xbe: 0x23af, 0xbf: 0x21b5, 0xc0: 0x2135, 0xc1: 0x2111, 0xc2: 0x211c, 0xc3: 0x2118, 0xc4: 0x2297,
  0xc5: 0x2295, 0xc6: 0x2205, 0xc7: 0x2229, 0xc8: 0x222a, 0xc9: 0x2283, 0xca: 0x2287, 0xcb: 0x2284, 0xcc: 0x2282, 0xcd: 0x2286,
  0xce: 0x2208, 0xcf: 0x2209, 0xd0: 0x2220, 0xd1: 0x2207, 0xd2: 0xae, 0xd3: 0xa9, 0xd4: 0x2122, 0xd5: 0x220f, 0xd6: 0x221a,
  0xd7: 0x22c5, 0xd8: 0xac, 0xd9: 0x2227, 0xda: 0x2228, 0xdb: 0x21d4, 0xdc: 0x21d0, 0xdd: 0x21d1, 0xde: 0x21d2, 0xdf: 0x21d3,
  0xe0: 0x25ca, 0xe1: 0x27e8, 0xe2: 0xae, 0xe3: 0xa9, 0xe4: 0x2122, 0xe5: 0x2211, 0xe6: 0x239b, 0xe7: 0x239c, 0xe8: 0x239d,
  0xe9: 0x23a1, 0xea: 0x23a2, 0xeb: 0x23a3, 0xec: 0x23a7, 0xed: 0x23a8, 0xee: 0x23a9, 0xef: 0x23aa, 0xf1: 0x27e9, 0xf2: 0x222b,
  0xf3: 0x2320, 0xf4: 0x23ae, 0xf5: 0x2321, 0xf6: 0x239e, 0xf7: 0x239f, 0xf8: 0x23a0, 0xf9: 0x23a4, 0xfa: 0x23a5, 0xfb: 0x23a6,
  0xfc: 0x23ab, 0xfd: 0x23ac, 0xfe: 0x23ad,
};

const isSymbolFont = (f: Font) => f.charset === 2 && /^symbol$/i.test(f.face.trim());

/** character codes → a string, a slice at a time (one call with ~65k arguments fails in Safari's engine) */
function fromCodes(codes: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < codes.length; i += 4096) s += String.fromCharCode(...Array.from(codes).slice(i, i + 4096));
  return s;
}

/** Symbol-font text (bytes, or U+F020–U+F0FF from an EMF) → Unicode (every result is in the BMP) */
function symbolText(codes: number[]): string {
  return fromCodes(
    codes.map((c) => {
      const k = c >= 0xf020 && c <= 0xf0ff ? c - 0xf000 : c;
      return SYMBOL[k] ?? (k >= 0x20 && k < 0x7f ? k : 0xfffd);
    }),
  );
}

const CHARSET_ENCODING: Record<number, string> = {
  0: 'windows-1252', 161: 'windows-1253', 162: 'windows-1254', 163: 'windows-1258', 177: 'windows-1255', 178: 'windows-1256',
  186: 'windows-1257', 204: 'windows-1251', 222: 'windows-874', 238: 'windows-1250', 128: 'shift_jis', 129: 'euc-kr',
  134: 'gbk', 136: 'big5',
};

function decode8(bytes: Uint8Array, charset: number): string {
  const enc = CHARSET_ENCODING[charset] ?? 'windows-1252';
  try {
    return new TextDecoder(enc).decode(bytes);
  } catch {
    return fromCodes(bytes);
  }
}

/** a font name fit for markup, and the generic family behind it */
function fontStack(f: Font, symbol: boolean): string {
  if (symbol) return `'Cambria Math', 'STIX Two Math', 'Times New Roman', serif`;
  const face = f.face.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 40);
  const fam = f.family & 0xf0;
  const generic = fam === 0x20 ? 'sans-serif' : fam === 0x30 ? 'monospace' : fam === 0x40 ? 'cursive' : 'serif';
  const extra = /^mt extra$/i.test(face) ? `, 'Cambria Math', 'STIX Two Math'` : '';
  const serif = generic === 'serif' && !/^times new roman$/i.test(face) ? `, 'Times New Roman'` : '';
  return `${face ? `'${face}'` : `'Times New Roman'`}${serif}${extra}, ${generic}`;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    s += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? '=' : B64[c & 63]);
  }
  return s;
}

/** a device-independent bitmap (header + bits) → a data: URL a browser shows */
function dibUrl(bmi: Uint8Array, bits: Uint8Array): string | null {
  if (bmi.length < 12) return null;
  const dv = new DataView(bmi.buffer, bmi.byteOffset, bmi.byteLength);
  const headerSize = dv.getUint32(0, true);
  if (headerSize >= 40) {
    const compression = dv.getUint32(16, true);
    if (compression === 4) return `data:image/jpeg;base64,${base64(bits)}`;
    if (compression === 5) return `data:image/png;base64,${base64(bits)}`;
  }
  const file = new Uint8Array(14 + bmi.length + bits.length);
  const fv = new DataView(file.buffer);
  file[0] = 0x42;
  file[1] = 0x4d;
  fv.setUint32(2, file.length, true);
  fv.setUint32(10, 14 + bmi.length, true);
  file.set(bmi, 14);
  file.set(bits, 14 + bmi.length);
  return `data:image/bmp;base64,${base64(file)}`;
}

const LIMIT_RECORDS = 300000;
const LIMIT_OUTPUT = 8 * 1024 * 1024;

/** The player both formats share: the device context, its stack, the objects, the SVG drawn. */
class Player {
  dc: DC;
  stack: DC[] = [];
  objects: (Obj | null)[] = [];
  out: string[] = [];
  size = 0;
  /** a path being recorded (BeginPath … EndPath), and the one ready to fill or stroke */
  recording: string[] | null = null;
  path: string[] | null = null;
  constructor(
    /** device coordinates → output px */
    public toOut: (x: number, y: number) => [number, number],
    /** output px per device unit */
    public devScale: number,
    /** the page mapping (logical → device) for the fixed map modes, device units per mm */
    public devPerMm: [number, number],
  ) {
    this.dc = {
      pen: BLACK_PEN,
      brush: WHITE_BRUSH,
      font: DEFAULT_FONT,
      textColor: '#000000',
      textAlign: 0,
      fillMode: 1,
      mapMode: 1,
      winOrg: [0, 0],
      winExt: [1, 1],
      vpOrg: [0, 0],
      vpExt: [1, 1],
      world: [1, 0, 0, 1, 0, 0],
      cur: [0, 0],
    };
  }

  emit(s: string) {
    this.size += s.length;
    if (this.size > LIMIT_OUTPUT) throw new Error('metafile: too large');
    this.out.push(s);
  }

  /** a piece of the path being recorded: counted against the same limit as what is drawn */
  rec(d: string) {
    if (!this.recording) return;
    this.size += d.length;
    if (this.size > LIMIT_OUTPUT) throw new Error('metafile: too large');
    this.recording.push(d);
  }

  save() {
    this.stack.push({ ...this.dc, winOrg: [...this.dc.winOrg], winExt: [...this.dc.winExt], vpOrg: [...this.dc.vpOrg], vpExt: [...this.dc.vpExt], world: [...this.dc.world], cur: [...this.dc.cur] });
    if (this.stack.length > 1000) this.stack.shift();
  }
  restore(n: number) {
    // negative: relative to the current state; positive: an absolute saved state
    const target = n < 0 ? this.stack.length + n : n - 1;
    if (target < 0 || target >= this.stack.length) return;
    this.dc = this.stack[target];
    this.stack.length = target;
  }

  /** logical → device */
  toDevice(x: number, y: number): [number, number] {
    const d = this.dc;
    const [a, b, c, dd, e, f] = d.world;
    const px = a * x + c * y + e;
    const py = b * x + dd * y + f;
    const units: Record<number, number> = { 2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 25.4 / 1440 };
    switch (d.mapMode) {
      case 7:
      case 8:
        return [(px - d.winOrg[0]) * (d.vpExt[0] / (d.winExt[0] || 1)) + d.vpOrg[0], (py - d.winOrg[1]) * (d.vpExt[1] / (d.winExt[1] || 1)) + d.vpOrg[1]];
      case 2:
      case 3:
      case 4:
      case 5:
      case 6: {
        const mm = units[d.mapMode];
        return [(px - d.winOrg[0]) * mm * this.devPerMm[0] + d.vpOrg[0], -(py - d.winOrg[1]) * mm * this.devPerMm[1] + d.vpOrg[1]];
      }
      default:
        return [px - d.winOrg[0] + d.vpOrg[0], py - d.winOrg[1] + d.vpOrg[1]];
    }
  }

  /** logical → output px */
  pt(x: number, y: number): [number, number] {
    const [dx, dy] = this.toDevice(x, y);
    return this.toOut(dx, dy);
  }

  /** output px for a logical length along x / y */
  lenX(v: number) {
    const a = this.pt(0, 0), b = this.pt(v, 0);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  lenY(v: number) {
    const a = this.pt(0, 0), b = this.pt(0, v);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }

  select(o: Obj | null) {
    if (!o) return;
    if ('pen' in o) this.dc.pen = o.pen;
    else if ('brush' in o) this.dc.brush = o.brush;
    else if ('font' in o) this.dc.font = o.font;
  }

  // ---- drawing ----

  strokeAttrs(): string {
    const pen = this.dc.pen;
    const style = pen.style & 0xf;
    if (style === 5) return ' stroke="none"';
    const w = pen.width ? Math.max(0.3, this.lenX(pen.width)) : Math.max(0.3, this.devScale);
    const dashes: Record<number, number[]> = { 1: [4, 2], 2: [1, 1.5], 3: [4, 1.5, 1, 1.5], 4: [4, 1.5, 1, 1.5, 1, 1.5] };
    const dash = dashes[style] ? ` stroke-dasharray="${dashes[style].map((k) => num(k * Math.max(w, 1))).join(' ')}"` : '';
    const cap = (pen.style & 0xf00) === 0x100 ? 'square' : (pen.style & 0xf00) === 0x200 ? 'butt' : 'round';
    const join = (pen.style & 0xf000) === 0x1000 ? 'bevel' : (pen.style & 0xf000) === 0x2000 ? 'miter' : 'round';
    return ` stroke="${pen.color}" stroke-width="${num(w)}"${dash} stroke-linecap="${cap}" stroke-linejoin="${join}"`;
  }

  fillAttrs(): string {
    const b = this.dc.brush;
    if (b.style === 1) return ' fill="none"';
    // hatched or pattern brushes: their colour, lighter
    const opacity = b.style === 2 ? ' fill-opacity="0.35"' : '';
    const color = b.style === 3 || b.style === 5 ? '#c0c0c0' : b.color;
    return ` fill="${color}"${opacity} fill-rule="${this.dc.fillMode === 2 ? 'nonzero' : 'evenodd'}"`;
  }

  /** a figure: recorded into a path when one is open, else drawn */
  draw(d: string, fill: boolean, stroke: boolean) {
    if (!d) return;
    if (this.recording) {
      this.rec(d);
      return;
    }
    this.emit(`<path d="${d}"${fill ? this.fillAttrs() : ' fill="none"'}${stroke ? this.strokeAttrs() : ' stroke="none"'}/>`);
  }

  poly(points: [number, number][], close: boolean, fill: boolean, stroke: boolean) {
    if (points.length < 2) return;
    const d = points.map(([x, y], i) => {
      const [px, py] = this.pt(x, y);
      return `${i ? 'L' : 'M'}${num(px)},${num(py)}`;
    });
    this.draw(d.join(' ') + (close ? ' Z' : ''), fill, stroke);
  }

  polyPoly(polys: [number, number][][], close: boolean, fill: boolean, stroke: boolean) {
    const d = polys
      .filter((p) => p.length >= 2)
      .map((p) => p.map(([x, y], i) => {
        const [px, py] = this.pt(x, y);
        return `${i ? 'L' : 'M'}${num(px)},${num(py)}`;
      }).join(' ') + (close ? ' Z' : ''))
      .join(' ');
    this.draw(d, fill, stroke);
  }

  rect(l: number, t: number, r: number, b: number, rx = 0, ry = 0) {
    if (rx || ry) {
      // a rounded rectangle, as a path through the four corners
      const [x0, y0] = this.pt(l, t), [x1, y1] = this.pt(r, b);
      const X = Math.min(x0, x1), Y = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);
      const kx = Math.min(W / 2, this.lenX(rx) / 2), ky = Math.min(H / 2, this.lenY(ry) / 2);
      this.draw(
        `M${num(X + kx)},${num(Y)} H${num(X + W - kx)} A${num(kx)},${num(ky)} 0 0 1 ${num(X + W)},${num(Y + ky)} V${num(Y + H - ky)} A${num(kx)},${num(ky)} 0 0 1 ${num(X + W - kx)},${num(Y + H)} H${num(X + kx)} A${num(kx)},${num(ky)} 0 0 1 ${num(X)},${num(Y + H - ky)} V${num(Y + ky)} A${num(kx)},${num(ky)} 0 0 1 ${num(X + kx)},${num(Y)} Z`,
        true,
        true,
      );
      return;
    }
    this.poly([[l, t], [r, t], [r, b], [l, b]], true, true, true);
  }

  ellipse(l: number, t: number, r: number, b: number) {
    const [x0, y0] = this.pt(l, t), [x1, y1] = this.pt(r, b);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
    this.draw(`M${num(cx - rx)},${num(cy)} A${num(rx)},${num(ry)} 0 1 0 ${num(cx + rx)},${num(cy)} A${num(rx)},${num(ry)} 0 1 0 ${num(cx - rx)},${num(cy)} Z`, true, true);
  }

  /** Arc, Chord, Pie: counter-clockwise from the start radial to the end radial */
  arc(l: number, t: number, r: number, b: number, xs: number, ys: number, xe: number, ye: number, kind: 'arc' | 'chord' | 'pie') {
    const [x0, y0] = this.pt(l, t), [x1, y1] = this.pt(r, b);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
    if (!(rx > 0 && ry > 0)) return;
    const [sx, sy] = this.pt(xs, ys), [ex, ey] = this.pt(xe, ye);
    const a0 = Math.atan2((sy - cy) / ry, (sx - cx) / rx);
    let a1 = Math.atan2((ey - cy) / ry, (ex - cx) / rx);
    // GDI draws counter-clockwise on screen (y down): decreasing angle
    while (a1 >= a0) a1 -= Math.PI * 2;
    const p0 = [cx + rx * Math.cos(a0), cy + ry * Math.sin(a0)], p1 = [cx + rx * Math.cos(a1), cy + ry * Math.sin(a1)];
    const large = a0 - a1 > Math.PI ? 1 : 0;
    let d = `M${num(p0[0])},${num(p0[1])} A${num(rx)},${num(ry)} 0 ${large} 0 ${num(p1[0])},${num(p1[1])}`;
    if (kind === 'chord') d += ' Z';
    if (kind === 'pie') d += ` L${num(cx)},${num(cy)} Z`;
    this.draw(d, kind !== 'arc', true);
  }

  /** text at a logical point; `dx`: the advance of each character (logical units), when given */
  text(x: number, y: number, codes: number[], raw8: Uint8Array | null, dx: number[] | null) {
    const f = this.dc.font;
    const symbol = isSymbolFont(f);
    let str = symbol ? symbolText(codes) : raw8 ? decode8(raw8, f.charset) : fromCodes(codes);
    if (!str) return;
    // the chars the advances refer to (a decoded 8-bit string can be shorter: double-byte charsets)
    const chars = [...str];
    if (dx && dx.length < chars.length) dx = null;
    const align = this.dc.textAlign;
    if (align & 1) [x, y] = this.dc.cur;
    const em = f.height ? (f.height < 0 ? this.lenY(-f.height) : this.lenY(f.height) * (symbol ? 0.82 : 0.9)) : 16 * this.devScale;
    if (!(em > 0.2)) return;
    const [px, py] = this.pt(x, y);
    const vert = align & 0x18;
    const ascent = symbol || /symbol/i.test(f.face) ? 1.0 : 0.89;
    const baseY = vert === 0x18 ? py : vert === 8 ? py - 0.22 * em : py + ascent * em;
    const horiz = align & 6;
    const flipX = this.pt(1, 0)[0] < this.pt(0, 0)[0] ? -1 : 1;
    let xs: number[] | null = null;
    if (dx) {
      const adv = dx.slice(0, chars.length).map((v) => this.lenX(v) * flipX);
      const total = adv.reduce((a, b) => a + b, 0);
      let start = horiz === 2 ? px - total : horiz === 6 ? px - total / 2 : px;
      xs = chars.map((_, i) => {
        const at = start;
        start += adv[i];
        return at;
      });
      if (align & 1) this.dc.cur = [x + dx.reduce((a, b) => a + b, 0), y];
    }
    const anchor = xs ? 'start' : horiz === 2 ? 'end' : horiz === 6 ? 'middle' : 'start';
    const attrs = [
      `x="${xs ? xs.map(num).join(' ') : num(px)}"`,
      `y="${num(baseY)}"`,
      `font-family="${escapeHtml(fontStack(f, symbol))}"`,
      `font-size="${num(em)}"`,
      `fill="${this.dc.textColor}"`,
    ];
    if (f.italic) attrs.push('font-style="italic"');
    if (f.weight >= 600) attrs.push('font-weight="bold"');
    if (f.underline || f.strike) attrs.push(`text-decoration="${f.underline ? 'underline' : 'line-through'}"`);
    if (anchor !== 'start') attrs.push(`text-anchor="${anchor}"`);
    if (f.escapement) attrs.push(`transform="rotate(${num(-f.escapement / 10)} ${num(px)} ${num(py)})"`);
    str = chars.join('');
    this.emit(`<text ${attrs.join(' ')} style="white-space:pre">${escapeHtml(str)}</text>`);
  }

  image(l: number, t: number, w: number, h: number, url: string | null) {
    if (!url) return;
    const [x0, y0] = this.pt(l, t), [x1, y1] = this.pt(l + w, t + h);
    this.emit(`<image x="${num(Math.min(x0, x1))}" y="${num(Math.min(y0, y1))}" width="${num(Math.abs(x1 - x0))}" height="${num(Math.abs(y1 - y0))}" preserveAspectRatio="none" href="${url}"/>`);
  }

  // ---- paths (EMF BeginPath … FillPath) ----

  beginPath() {
    this.recording = [];
  }
  endPath() {
    this.path = this.recording;
    this.recording = null;
  }
  usePath(fill: boolean, stroke: boolean) {
    const p = this.path;
    this.path = null;
    if (p?.length) this.draw(p.join(' '), fill, stroke);
  }
  /** a figure of moves and lines inside a path (LineTo, PolyBezierTo…): continues the current one */
  pathCont(d: string) {
    if (this.recording) this.rec(d);
    else this.emit(`<path d="${d}" fill="none"${this.strokeAttrs()}/>`);
  }
}

// ---- WMF ------------------------------------------------------------------------

function wmfToSvg(bytes: Uint8Array, size?: { w: number; h: number }): MetaSvg | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  let bbox: [number, number, number, number] | null = null;
  let inch = 1440;
  if (dv.getUint32(0, true) === 0x9ac6cdd7) {
    bbox = [dv.getInt16(6, true), dv.getInt16(8, true), dv.getInt16(10, true), dv.getInt16(12, true)];
    inch = dv.getUint16(14, true) || 1440;
    pos = 22;
  }
  const type = dv.getUint16(pos, true);
  const headerWords = dv.getUint16(pos + 2, true);
  if ((type !== 1 && type !== 2) || headerWords !== 9) return null;
  pos += 18;

  // the picture's size: the placeable box, or the size Word shows it at
  let W: number, H: number;
  if (bbox && bbox[2] !== bbox[0] && bbox[3] !== bbox[1]) {
    W = (Math.abs(bbox[2] - bbox[0]) * 96) / inch;
    H = (Math.abs(bbox[3] - bbox[1]) * 96) / inch;
  } else if (size) {
    W = size.w;
    H = size.h;
  } else return null;
  if (!(W > 0 && H > 0) || W > 20000 || H > 20000) return null;

  // WMF: the window (logical units) maps onto the picture; the "device" is the output itself
  const p = new Player((x, y) => [x, y], 1, [96 / 25.4, 96 / 25.4]);
  p.dc.mapMode = 8;
  const setWindow = () => {
    p.dc.vpOrg = [0, 0];
    p.dc.vpExt = [W, H];
  };
  if (bbox) {
    p.dc.winOrg = [Math.min(bbox[0], bbox[2]), Math.min(bbox[1], bbox[3])];
    p.dc.winExt = [Math.abs(bbox[2] - bbox[0]), Math.abs(bbox[3] - bbox[1])];
  } else {
    p.dc.winOrg = [0, 0];
    p.dc.winExt = [W, H];
  }
  setWindow();

  const i16 = (o: number) => dv.getInt16(o, true);
  const u16 = (o: number) => dv.getUint16(o, true);
  const color = (o: number) => colorRef(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2));
  // the object table: the lowest free slot, as GDI does; real files use a few dozen
  const addObject = (o: Obj) => {
    let i = p.objects.indexOf(null);
    if (i < 0) i = p.objects.length;
    if (i < 512) p.objects[i] = o;
  };
  /** the record being played ends here: nothing is read past it */
  let recEnd = 0;
  const points = (o: number, n: number) => {
    const pts: [number, number][] = [];
    const max = Math.max(0, Math.min(n, Math.floor((recEnd - o) / 4)));
    for (let k = 0; k < max; k++) pts.push([i16(o + k * 4), i16(o + k * 4 + 2)]);
    return pts;
  };

  let count = 0;
  while (pos + 6 <= bytes.length && count++ < LIMIT_RECORDS) {
    const words = dv.getUint32(pos, true);
    const fn = u16(pos + 4);
    const a = pos + 6; // parameters
    if (words < 3 || pos + words * 2 > bytes.length) break;
    recEnd = pos + words * 2;
    switch (fn) {
      case 0x0000: // EOF
        pos = bytes.length;
        continue;
      case 0x020b: // SetWindowOrg (y, x)
        p.dc.winOrg = [i16(a + 2), i16(a)];
        break;
      case 0x020c: // SetWindowExt (y, x)
        p.dc.winExt = [i16(a + 2), i16(a)];
        setWindow();
        break;
      case 0x0211: // OffsetWindowOrg
        p.dc.winOrg = [p.dc.winOrg[0] + i16(a + 2), p.dc.winOrg[1] + i16(a)];
        break;
      case 0x0410: { // ScaleWindowExt (yDenom, yNum, xDenom, xNum)
        const yd = i16(a) || 1, yn = i16(a + 2), xd = i16(a + 4) || 1, xn = i16(a + 6);
        p.dc.winExt = [(p.dc.winExt[0] * xn) / xd, (p.dc.winExt[1] * yn) / yd];
        break;
      }
      case 0x0209: // SetTextColor
        p.dc.textColor = color(a);
        break;
      case 0x012e: // SetTextAlign
        p.dc.textAlign = u16(a);
        break;
      case 0x0106: // SetPolyFillMode
        p.dc.fillMode = u16(a);
        break;
      case 0x001e: // SaveDC
        p.save();
        break;
      case 0x0127: // RestoreDC
        p.restore(i16(a));
        break;
      case 0x02fa: // CreatePenIndirect
        addObject({ pen: { style: u16(a), width: Math.abs(i16(a + 2)), color: color(a + 6) } });
        break;
      case 0x02fc: // CreateBrushIndirect
        addObject({ brush: { style: u16(a), color: color(a + 2) } });
        break;
      case 0x02fb: { // CreateFontIndirect
        const faceBytes: number[] = [];
        for (let k = 0; k < 32 && a + 18 + k < pos + words * 2; k++) {
          const c = dv.getUint8(a + 18 + k);
          if (!c) break;
          faceBytes.push(c);
        }
        addObject({
          font: {
            height: i16(a),
            escapement: i16(a + 4),
            weight: i16(a + 8),
            italic: !!dv.getUint8(a + 10),
            underline: !!dv.getUint8(a + 11),
            strike: !!dv.getUint8(a + 12),
            charset: dv.getUint8(a + 13),
            family: dv.getUint8(a + 17),
            face: decode8(new Uint8Array(faceBytes), 0),
          },
        });
        break;
      }
      case 0x00f7: // CreatePalette
      case 0x01f9: // CreatePatternBrush
      case 0x06ff: // CreateRegion
        addObject({ other: true });
        break;
      case 0x0142: // DibCreatePatternBrush
        addObject({ brush: { style: 5, color: '#c0c0c0' } });
        break;
      case 0x012d: // SelectObject
        p.select(p.objects[u16(a)] ?? null);
        break;
      case 0x01f0: // DeleteObject
        if (u16(a) < p.objects.length) p.objects[u16(a)] = null;
        break;
      case 0x0214: // MoveTo (y, x)
        p.dc.cur = [i16(a + 2), i16(a)];
        break;
      case 0x0213: { // LineTo (y, x)
        const to: [number, number] = [i16(a + 2), i16(a)];
        p.poly([p.dc.cur, to], false, false, true);
        p.dc.cur = to;
        break;
      }
      case 0x0325: // Polyline
        p.poly(points(a + 2, i16(a)), false, false, true);
        break;
      case 0x0324: // Polygon
        p.poly(points(a + 2, i16(a)), true, true, true);
        break;
      case 0x0538: { // PolyPolygon
        const n = Math.min(u16(a), Math.floor((recEnd - a - 2) / 2));
        const counts = Array.from({ length: Math.max(0, n) }, (_, k) => u16(a + 2 + k * 2));
        let o = a + 2 + n * 2;
        const polys = counts.map((c) => {
          const pts = points(o, c);
          o += c * 4;
          return pts;
        });
        p.polyPoly(polys, true, true, true);
        break;
      }
      case 0x041b: // Rectangle (bottom, right, top, left)
        p.rect(i16(a + 6), i16(a + 4), i16(a + 2), i16(a));
        break;
      case 0x061c: // RoundRect (height, width, bottom, right, top, left)
        p.rect(i16(a + 10), i16(a + 8), i16(a + 6), i16(a + 4), i16(a + 2), i16(a));
        break;
      case 0x0418: // Ellipse
        p.ellipse(i16(a + 6), i16(a + 4), i16(a + 2), i16(a));
        break;
      case 0x0817: // Arc
      case 0x0830: // Chord
      case 0x081a: // Pie  (yEnd, xEnd, yStart, xStart, bottom, right, top, left)
        p.arc(i16(a + 14), i16(a + 12), i16(a + 10), i16(a + 8), i16(a + 6), i16(a + 4), i16(a + 2), i16(a), fn === 0x0817 ? 'arc' : fn === 0x0830 ? 'chord' : 'pie');
        break;
      case 0x0521: { // TextOut
        const n = i16(a);
        if (n > 0) {
          const s = bytes.subarray(a + 2, a + 2 + n);
          const o = a + 2 + n + (n % 2);
          p.text(i16(o + 2), i16(o), [...s], s, null);
        }
        break;
      }
      case 0x0a32: { // ExtTextOut (y, x, count, options, [rect], string, [dx])
        const y = i16(a), x = i16(a + 2), n = i16(a + 4), opts = u16(a + 6);
        let o = a + 8;
        const end = pos + words * 2;
        if (opts & 0x0006) o += 8;
        if (n > 0 && o + n <= end) {
          const s = bytes.subarray(o, o + n);
          o += n + (n % 2);
          let dx: number[] | null = null;
          if (o + n * 2 <= end) dx = Array.from({ length: n }, (_, k) => i16(o + k * 2));
          p.text(x, y, [...s], s, dx);
        }
        break;
      }
      case 0x061d: { // PatBlt (rop 4, height, width, y, x): a rectangle filled with the brush
        const rop = dv.getUint32(a, true);
        const h = i16(a + 4), w = i16(a + 6), y = i16(a + 8), x = i16(a + 10);
        const save = { pen: p.dc.pen, brush: p.dc.brush };
        p.dc.pen = { style: 5, width: 0, color: '#000000' };
        if (rop === 0x00000042) p.dc.brush = { style: 0, color: '#000000' }; // BLACKNESS
        else if (rop === 0x00ff0062) p.dc.brush = { style: 0, color: '#ffffff' }; // WHITENESS
        else if (rop === 0x00550009) break; // DSTINVERT: nothing to show here
        p.rect(x, y, x + w, y + h);
        p.dc.pen = save.pen;
        p.dc.brush = save.brush;
        break;
      }
      case 0x0f43: { // StretchDIB (rop 4, usage 2, srcH, srcW, ySrc, xSrc, destH, destW, yDest, xDest, DIB)
        const dh = i16(a + 14), dw = i16(a + 16), yd = i16(a + 18), xd = i16(a + 20);
        const dib = bytes.subarray(a + 22, pos + words * 2);
        p.image(xd, yd, dw, dh, dibFromPacked(dib));
        break;
      }
      case 0x0b41: { // DibStretchBlt (rop 4, srcH, srcW, ySrc, xSrc, destH, destW, yDest, xDest, DIB)
        if (words * 2 > 6 + 22) {
          const dh = i16(a + 12), dw = i16(a + 14), yd = i16(a + 16), xd = i16(a + 18);
          p.image(xd, yd, dw, dh, dibFromPacked(bytes.subarray(a + 20, pos + words * 2)));
        }
        break;
      }
      case 0x0940: { // DibBitBlt (rop 4, ySrc, xSrc, height, width, yDest, xDest, DIB)
        if (words * 2 > 6 + 18) {
          const h = i16(a + 8), w = i16(a + 10), yd = i16(a + 12), xd = i16(a + 14);
          p.image(xd, yd, w, h, dibFromPacked(bytes.subarray(a + 16, pos + words * 2)));
        }
        break;
      }
      default:
        // SetMapMode, SetBkMode, SetBkColor, SetROP2, clipping, Escape…: no effect on the drawing here
        break;
    }
    pos += words * 2;
  }
  if (!p.out.length) return null;
  return { inner: p.out.join(''), w: W, h: H };
}

/** a packed DIB (BITMAPINFO followed by the bits) → data: URL */
function dibFromPacked(dib: Uint8Array): string | null {
  if (dib.length < 40) return null;
  const dv = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const headerSize = dv.getUint32(0, true);
  if (headerSize < 12 || headerSize > dib.length) return null;
  let colors = 0;
  if (headerSize >= 40) {
    const bpp = dv.getUint16(14, true);
    const used = dv.getUint32(32, true);
    const compression = dv.getUint32(16, true);
    colors = used || (bpp <= 8 ? 1 << bpp : 0);
    if (compression === 3 && headerSize === 40) colors = 3; // bit-field masks
  }
  const bmiLen = headerSize + colors * 4;
  if (bmiLen > dib.length) return null;
  return dibUrl(dib.subarray(0, bmiLen), dib.subarray(bmiLen));
}

// ---- EMF --------------------------------------------------------------------------

function emfToSvg(bytes: Uint8Array): MetaSvg | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 1 || dv.getUint32(40, true) !== 0x464d4520) return null;
  const i32 = (o: number) => dv.getInt32(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);
  const f32 = (o: number) => dv.getFloat32(o, true);
  const bounds = [i32(8), i32(12), i32(16), i32(20)];
  const frame = [i32(24), i32(28), i32(32), i32(36)];
  const devPx = [i32(72), i32(76)];
  const devMm = [i32(80), i32(84)];
  const perMm: [number, number] = [devMm[0] > 0 && devPx[0] > 0 ? devPx[0] / devMm[0] : 96 / 25.4, devMm[1] > 0 && devPx[1] > 0 ? devPx[1] / devMm[1] : 96 / 25.4];
  // the picture: its frame (0.01 mm) in device units
  let fl = (frame[0] / 100) * perMm[0], ft = (frame[1] / 100) * perMm[1];
  let fw = ((frame[2] - frame[0]) / 100) * perMm[0], fh = ((frame[3] - frame[1]) / 100) * perMm[1];
  if (!(fw > 0 && fh > 0)) {
    [fl, ft, fw, fh] = [bounds[0], bounds[1], bounds[2] - bounds[0] + 1, bounds[3] - bounds[1] + 1];
  }
  const k = 96 / 25.4 / perMm[0];
  const W = fw * k, H = fh * (96 / 25.4 / perMm[1]);
  if (!(W > 0 && H > 0) || W > 20000 || H > 20000) return null;
  const p = new Player((x, y) => [(x - fl) * k, (y - ft) * (96 / 25.4 / perMm[1])], k, perMm);
  const point = (o: number): [number, number] => [i32(o), i32(o + 4)];
  const point16 = (o: number): [number, number] => [dv.getInt16(o, true), dv.getInt16(o + 2, true)];
  /** the record being played ends here: nothing is read past it */
  let end = 0;
  const pts = (o: number, n: number, small: boolean) =>
    Array.from({ length: Math.max(0, Math.min(n, Math.floor((end - o) / (small ? 4 : 8)))) }, (_, i) => (small ? point16(o + i * 4) : point(o + i * 8)));
  const color = (o: number) => colorRef(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2));
  const STOCK: Record<number, Obj> = {
    0: { brush: { style: 0, color: '#ffffff' } }, 1: { brush: { style: 0, color: '#c0c0c0' } }, 2: { brush: { style: 0, color: '#808080' } },
    3: { brush: { style: 0, color: '#404040' } }, 4: { brush: { style: 0, color: '#000000' } }, 5: { brush: { style: 1, color: '#000000' } },
    6: { pen: { style: 0, width: 0, color: '#ffffff' } }, 7: { pen: { style: 0, width: 0, color: '#000000' } }, 8: { pen: { style: 5, width: 0, color: '#000000' } },
    13: { font: DEFAULT_FONT }, 17: { font: { ...DEFAULT_FONT, face: 'Segoe UI', height: -12 } },
  };
  const toMatrix = (o: number) => [f32(o), f32(o + 4), f32(o + 8), f32(o + 12), f32(o + 16), f32(o + 20)];
  const mul = (m: number[], n: number[]) => [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ];

  let pos = 0;
  let count = 0;
  while (pos + 8 <= bytes.length && count++ < LIMIT_RECORDS) {
    const type = u32(pos);
    const size = u32(pos + 4);
    if (size < 8 || size % 4 || pos + size > bytes.length) break;
    const a = pos + 8;
    end = pos + size;
    switch (type) {
      case 14: // EOF
        pos = bytes.length;
        continue;
      case 9: // SetWindowExtEx
        p.dc.winExt = [i32(a), i32(a + 4)];
        break;
      case 10: // SetWindowOrgEx
        p.dc.winOrg = [i32(a), i32(a + 4)];
        break;
      case 11: // SetViewportExtEx
        p.dc.vpExt = [i32(a), i32(a + 4)];
        break;
      case 12: // SetViewportOrgEx
        p.dc.vpOrg = [i32(a), i32(a + 4)];
        break;
      case 17: // SetMapMode
        p.dc.mapMode = u32(a);
        break;
      case 19: // SetPolyFillMode
        p.dc.fillMode = u32(a);
        break;
      case 22: // SetTextAlign
        p.dc.textAlign = u32(a);
        break;
      case 24: // SetTextColor
        p.dc.textColor = color(a);
        break;
      case 33: // SaveDC
        p.save();
        break;
      case 34: // RestoreDC
        p.restore(i32(a));
        break;
      case 35: // SetWorldTransform
        p.dc.world = toMatrix(a);
        break;
      case 36: { // ModifyWorldTransform
        const m = toMatrix(a);
        const mode = u32(a + 24);
        p.dc.world = mode === 1 ? [1, 0, 0, 1, 0, 0] : mode === 2 ? mul(m, p.dc.world) : mode === 3 ? mul(p.dc.world, m) : mode === 4 ? m : p.dc.world;
        break;
      }
      case 37: { // SelectObject
        const ih = u32(a);
        p.select(ih & 0x80000000 ? (STOCK[ih & 0x7fffffff] ?? null) : (p.objects[ih] ?? null));
        break;
      }
      case 40: // DeleteObject
        if (u32(a) < p.objects.length) p.objects[u32(a)] = null;
        break;
      case 38: // CreatePen (ih, style, width.x, width.y, color)
        if (u32(a) < 65536) p.objects[u32(a)] = { pen: { style: u32(a + 4), width: Math.abs(i32(a + 8)), color: color(a + 16) } };
        break;
      case 95: { // ExtCreatePen (ih, offBmi, cbBmi, offBits, cbBits, style, width, brushStyle, color…)
        const style = u32(a + 20);
        const cosmetic = (style & 0xf0000) === 0;
        if (u32(a) < 65536) p.objects[u32(a)] = { pen: { style: u32(a + 28) === 1 ? 5 : style, width: cosmetic ? 0 : u32(a + 24), color: color(a + 32) } };
        break;
      }
      case 39: // CreateBrushIndirect (ih, style, color, hatch)
        if (u32(a) < 65536) p.objects[u32(a)] = { brush: { style: u32(a + 4), color: color(a + 8) } };
        break;
      case 93: // CreateMonoBrush
      case 94: // CreateDibPatternBrushPt
        if (u32(a) < 65536) p.objects[u32(a)] = { brush: { style: 5, color: '#c0c0c0' } };
        break;
      case 82: { // ExtCreateFontIndirectW (ih, LOGFONTW…)
        let face = '';
        for (let i = 0; i < 32; i++) {
          const c = dv.getUint16(a + 32 + i * 2, true);
          if (!c) break;
          face += String.fromCharCode(c);
        }
        if (u32(a) < 65536)
          p.objects[u32(a)] = {
            font: {
              height: i32(a + 4),
              escapement: i32(a + 12),
              weight: i32(a + 20),
              italic: !!dv.getUint8(a + 24),
              underline: !!dv.getUint8(a + 25),
              strike: !!dv.getUint8(a + 26),
              charset: dv.getUint8(a + 27),
              family: dv.getUint8(a + 31),
              face,
            },
          };
        break;
      }
      case 27: // MoveToEx
        p.dc.cur = point(a);
        if (p.recording) p.rec(`M${p.pt(...p.dc.cur).map(num).join(',')}`);
        break;
      case 54: { // LineTo
        const to = point(a);
        const [x0, y0] = p.pt(...p.dc.cur), [x1, y1] = p.pt(...to);
        if (p.recording) p.rec(`${p.recording.length ? '' : `M${num(x0)},${num(y0)} `}L${num(x1)},${num(y1)}`);
        else p.pathCont(`M${num(x0)},${num(y0)} L${num(x1)},${num(y1)}`);
        p.dc.cur = to;
        break;
      }
      case 43: // Rectangle
        p.rect(i32(a), i32(a + 4), i32(a + 8), i32(a + 12));
        break;
      case 44: // RoundRect
        p.rect(i32(a), i32(a + 4), i32(a + 8), i32(a + 12), i32(a + 16), i32(a + 20));
        break;
      case 42: // Ellipse
        p.ellipse(i32(a), i32(a + 4), i32(a + 8), i32(a + 12));
        break;
      case 45: // Arc
      case 46: // Chord
      case 47: // Pie
        p.arc(i32(a), i32(a + 4), i32(a + 8), i32(a + 12), i32(a + 16), i32(a + 20), i32(a + 24), i32(a + 28), type === 45 ? 'arc' : type === 46 ? 'chord' : 'pie');
        break;
      case 3: // Polygon
      case 86: // Polygon16
        p.poly(pts(a + 20, u32(a + 16), type === 86), true, true, true);
        break;
      case 4: // Polyline
      case 87: // Polyline16
        p.poly(pts(a + 20, u32(a + 16), type === 87), false, false, true);
        break;
      case 6: // PolylineTo
      case 89: { // PolylineTo16
        const list = pts(a + 20, u32(a + 16), type === 89);
        const d = [p.dc.cur, ...list].map((q, i) => `${i ? 'L' : 'M'}${p.pt(...q).map(num).join(',')}`).join(' ');
        p.pathCont(p.recording?.length ? d.replace(/^M[^L]*/, '') : d);
        if (list.length) p.dc.cur = list[list.length - 1];
        break;
      }
      case 2: // PolyBezier
      case 85: { // PolyBezier16
        const list = pts(a + 20, u32(a + 16), type === 85);
        if (list.length >= 4) {
          let d = `M${p.pt(...list[0]).map(num).join(',')}`;
          for (let i = 1; i + 2 < list.length; i += 3) d += ` C${[list[i], list[i + 1], list[i + 2]].map((q) => p.pt(...q).map(num).join(',')).join(' ')}`;
          p.draw(d, false, true);
        }
        break;
      }
      case 5: // PolyBezierTo
      case 88: { // PolyBezierTo16
        const list = pts(a + 20, u32(a + 16), type === 88);
        let d = p.recording?.length ? '' : `M${p.pt(...p.dc.cur).map(num).join(',')}`;
        for (let i = 0; i + 2 < list.length; i += 3) d += ` C${[list[i], list[i + 1], list[i + 2]].map((q) => p.pt(...q).map(num).join(',')).join(' ')}`;
        p.pathCont(d.trim());
        if (list.length) p.dc.cur = list[list.length - 1];
        break;
      }
      case 7: // PolyPolyline
      case 90: // PolyPolyline16
      case 8: // PolyPolygon
      case 91: { // PolyPolygon16
        const small = type === 90 || type === 91;
        const n = Math.max(0, Math.min(u32(a + 16), Math.floor((end - a - 24) / 4)));
        const counts = Array.from({ length: n }, (_, i) => u32(a + 24 + i * 4));
        let o = a + 24 + n * 4;
        const polys = counts.map((c) => {
          const list = pts(o, c, small);
          o += c * (small ? 4 : 8);
          return list;
        });
        const closed = type === 8 || type === 91;
        p.polyPoly(polys, closed, closed, true);
        break;
      }
      case 59: // BeginPath
        p.beginPath();
        break;
      case 60: // EndPath
        p.endPath();
        break;
      case 61: // CloseFigure
        if (p.recording) p.rec('Z');
        break;
      case 62: // FillPath
        p.usePath(true, false);
        break;
      case 63: // StrokeAndFillPath
        p.usePath(true, true);
        break;
      case 64: // StrokePath
        p.usePath(false, true);
        break;
      case 67: // SelectClipPath
      case 68: // AbortPath
        p.path = null;
        p.recording = null;
        break;
      case 83: // ExtTextOutA
      case 84: { // ExtTextOutW (bounds, graphicsMode, exScale, eyScale, EMRTEXT)
        const t = a + 28;
        const ref = point(t);
        const n = Math.min(u32(t + 8), 100000);
        const offString = u32(t + 12);
        const options = u32(t + 16);
        const offDx = u32(t + 36);
        if (n > 0 && pos + offString + n * (type === 84 ? 2 : 1) <= end) {
          const codes: number[] = [];
          let raw: Uint8Array | null = null;
          if (type === 84) for (let i = 0; i < n; i++) codes.push(dv.getUint16(pos + offString + i * 2, true));
          else {
            raw = bytes.subarray(pos + offString, pos + offString + n);
            codes.push(...raw);
          }
          let dx: number[] | null = null;
          const step = options & 0x2000 ? 2 : 1;
          if (offDx && pos + offDx + n * 4 * step <= end) dx = Array.from({ length: n }, (_, i) => i32(pos + offDx + i * 4 * step));
          p.text(ref[0], ref[1], codes, raw, dx);
        }
        break;
      }
      case 81: { // StretchDIBits
        const xd = i32(a + 16), yd = i32(a + 20);
        const offBmi = u32(a + 40), cbBmi = u32(a + 44), offBits = u32(a + 48), cbBits = u32(a + 52);
        const cw = i32(a + 64), ch = i32(a + 68);
        if (offBmi && cbBmi && offBits && pos + offBmi + cbBmi <= end && pos + offBits + cbBits <= end)
          p.image(xd, yd, cw, ch, dibUrl(bytes.subarray(pos + offBmi, pos + offBmi + cbBmi), bytes.subarray(pos + offBits, pos + offBits + cbBits)));
        break;
      }
      case 76: // BitBlt
      case 77: { // StretchBlt
        const xd = i32(a + 16), yd = i32(a + 20), wd = i32(a + 24), hd = i32(a + 28);
        const offBmi = u32(a + 76), cbBmi = u32(a + 80), offBits = u32(a + 84), cbBits = u32(a + 88);
        if (offBmi && cbBmi && pos + offBmi + cbBmi <= end && pos + offBits + cbBits <= end)
          p.image(xd, yd, wd, hd, dibUrl(bytes.subarray(pos + offBmi, pos + offBmi + cbBmi), bytes.subarray(pos + offBits, pos + offBits + cbBits)));
        else if (!offBmi) {
          // a fill with the brush (PatBlt-like)
          const save = p.dc.pen;
          p.dc.pen = { style: 5, width: 0, color: '#000000' };
          p.rect(xd, yd, xd + wd, yd + hd);
          p.dc.pen = save;
        }
        break;
      }
      default:
        // EMF+ comments, clipping, palettes, background mode…: no effect here
        break;
    }
    pos += size;
  }
  if (!p.out.length) return null;
  return { inner: p.out.join(''), w: W, h: H };
}

/**
 * A WMF or EMF picture as SVG. `size`: the size Word shows it at (px), for a
 * WMF without a placeable header. null when the file is not one, or holds
 * nothing this player draws.
 */
export function metafileToSvg(bytes: Uint8Array, size?: { w: number; h: number }): MetaSvg | null {
  try {
    if (bytes.length < 40) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0, true) === 1 && dv.getUint32(40, true) === 0x464d4520) return emfToSvg(bytes);
    return wmfToSvg(bytes, size);
  } catch {
    return null;
  }
}
