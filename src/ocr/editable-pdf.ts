/**
 * The PDF of "PDF sửa được chữ" (editable.ts cuts the words out of the
 * scan): each page is the scan without its words (one picture), with every
 * word drawn back as real text.
 *
 * A word's text is drawn in a Type 3 font of the page's own: one glyph per
 * word, whose drawing is the word's own shape (its ink colour, with the
 * ink's coverage as a soft mask), so the page looks as the scan did, letter
 * for letter. The font's ToUnicode gives each glyph its word, so the text
 * can be searched, copied and selected, and an editor sees one text object
 * per word: move it and its spot is empty (the picture under it holds no
 * ink), change it and the new text is set in another font. The fonts carry
 * /BaseFont /ezOCR-Words (engine/word-pictures.ts): ezPDF's edit tool then
 * sets a changed word again on its own, its neighbours kept.
 *
 * A word's text size is the type's size on the page (glyph space is scaled
 * to it) and its fill colour the colour it reads in: an editor that sets
 * new text where a word was gives it that size and colour. All the words
 * of a line stand on one baseline (each shape still drawn where it was), a
 * space follows each word but the last of its line, as wide as the gap to
 * the next word (word spacing), and the words come in the order the page
 * reads, so readers copy the text as the page shows it.
 *
 * The file is written page by page as the pages come (`addPage`), so only
 * what is written is kept; `finish` closes it.
 */
import { zlibSync } from 'fflate';
import { WORD_PICTURES_FONT } from '../engine/word-pictures';
import type { CutWord } from './editable';

export interface EditablePage {
  /** the page's size, points */
  widthPt: number;
  heightPt: number;
  /** pixels of the picture per inch: the words' boxes are in them */
  dpi: number;
  /** the scan without its words: a JPEG, or 8-bit samples already Flate-compressed */
  background: { kind: 'jpeg'; bytes: Uint8Array; w: number; h: number; gray: boolean } | { kind: 'flate'; bytes: Uint8Array; w: number; h: number; gray: boolean };
  words: CutWord[];
}

/**
 * The longest advance a word's glyph has, in glyph units (1.6 em): a long
 * word's shape is drawn whole but the pen moves less (the next word has its
 * own position anyway; the space after it makes up the rest). PDFium's
 * text extraction takes an object into the line before it when it lies
 * within half a glyph's width of it: a word glyph many ems wide would pull
 * the line below into its own, word by word.
 */
const ADVANCE = 1600;

/** codes a font gives its words: every byte but the space's */
const CODES = Array.from({ length: 256 }, (_, i) => i).filter((c) => c !== 32);

const enc = new TextEncoder();
const num = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
const hex2 = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
/** text as UTF-16BE hex (ToUnicode) */
function utf16hex(s: string) {
  let out = '';
  for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return out;
}

/** coverage in steps of 17 (editable.ts) packed two pixels to a byte, rows padded to a byte */
function pack4(alpha: Uint8Array, w: number, h: number): Uint8Array {
  const row = Math.ceil(w / 2);
  const out = new Uint8Array(row * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.min(15, Math.round(alpha[y * w + x] / 17));
      out[y * row + (x >> 1)] |= x & 1 ? v : v << 4;
    }
  return out;
}

/**
 * a word's glyph metrics, glyph units: `u` per picture pixel, its advance (at most ADVANCE, and
 * at most `room` points: see `rooms`), its shape against the baseline
 */
function metrics(word: CutWord, pt: number, room = Infinity) {
  const s = Math.max(1, word.size);
  const u = (pt * 1000) / s;
  const gw = word.box.x1 - word.box.x0;
  const gh = word.box.y1 - word.box.y0;
  return { s, u, gw, gh, advance: Math.min(gw * u, ADVANCE, (room * 1000) / s), dy: (word.base - word.box.y1) * u };
}

/**
 * How far each line's glyphs may advance, points: 1.2 times the distance to the nearest other
 * line beside or under it (big type close to the next line would otherwise draw it in, as with
 * ADVANCE).
 */
function rooms(words: CutWord[], pt: number): Map<number, number> {
  const lines = new Map<number, { base: number; x0: number; x1: number }>();
  for (const w of words) {
    const l = lines.get(w.line);
    if (l) {
      l.x0 = Math.min(l.x0, w.box.x0);
      l.x1 = Math.max(l.x1, w.box.x1);
    } else lines.set(w.line, { base: w.base, x0: w.box.x0, x1: w.box.x1 });
  }
  const out = new Map<number, number>();
  for (const [k, a] of lines) {
    let near = Infinity;
    for (const [j, b] of lines) if (j !== k && b.x0 < a.x1 && b.x1 > a.x0 && Math.abs(b.base - a.base) > 0.5) near = Math.min(near, Math.abs(b.base - a.base));
    out.set(k, near * pt * 1.2);
  }
  return out;
}

export class EditablePdf {
  private chunks: Uint8Array[] = [];
  private size = 0;
  private offsets: number[] = [];
  private count = 3;
  private kids: number[] = [];

  constructor() {
    this.add('%PDF-1.5\n%âãÏÓ\n');
  }

  private add(b: Uint8Array | string) {
    const u = typeof b === 'string' ? enc.encode(b) : b;
    this.chunks.push(u);
    this.size += u.byteLength;
  }

  private next() {
    return ++this.count;
  }

  /** an object; with `stream`, `dict` gets its /Length */
  private obj(n: number, dict: string, stream?: Uint8Array) {
    this.offsets[n] = this.size;
    if (stream) {
      this.add(`${n} 0 obj\n${dict.slice(0, -2)}/Length ${stream.byteLength}>>stream\n`);
      this.add(stream);
      this.add('\nendstream\nendobj\n');
    } else this.add(`${n} 0 obj\n${dict}\nendobj\n`);
  }

  get pages() {
    return this.kids.length;
  }

  addPage(p: EditablePage) {
    const page = this.next();
    const contents = this.next();
    const bg = this.next();
    const pt = 72 / p.dpi;
    // page y of a picture row (rows from the top)
    const Y = (y: number) => p.heightPt - y * pt;
    const fonts: string[] = [];
    const room = rooms(p.words, pt);
    let ops = `q ${num(p.widthPt)} 0 0 ${num(p.heightPt)} 0 0 cm /Bg Do Q\n`;
    for (let start = 0; start < p.words.length; start += CODES.length) {
      const group = p.words.slice(start, start + CODES.length);
      const name = `F${fonts.length + 1}`;
      fonts.push(`/${name} ${this.font(group, pt, room)} 0 R`);
      ops += 'BT\n';
      let colour = '';
      group.forEach((word, i) => {
        const g = metrics(word, pt, room.get(word.line));
        const tone = word.tone.map((c) => num(c / 255)).join(' ');
        if (tone !== colour) ops += `${tone} rg\n`;
        colour = tone;
        const next = p.words[start + i + 1];
        // the space: from the end of the pen's move (see ADVANCE) to the next word
        const gap = next && next.line === word.line ? Math.max(0, next.box.x0 - word.box.x1) * pt + (g.gw * g.u - g.advance) * (g.s / 1000) : -1;
        ops += `/${name} ${num(g.s)} Tf${gap >= 0 ? ` ${num(gap)} Tw` : ''} 1 0 0 1 ${num(word.box.x0 * pt)} ${num(Y(word.base))} Tm <${hex2(CODES[i])}${gap >= 0 ? '20' : ''}> Tj\n`;
      });
      ops += 'ET\n';
    }
    const b = p.background;
    const fontRes = fonts.length ? `/Font<<${fonts.join(' ')}>>` : '';
    this.obj(page, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${num(p.widthPt)} ${num(p.heightPt)}]/Resources<</XObject<</Bg ${bg} 0 R>>${fontRes}>>/Contents ${contents} 0 R>>`);
    this.obj(contents, '<</Filter/FlateDecode>>', zlibSync(enc.encode(ops), { level: 6 }));
    this.obj(bg, `<</Subtype/Image/Width ${b.w}/Height ${b.h}/ColorSpace/${b.gray ? 'DeviceGray' : 'DeviceRGB'}/BitsPerComponent 8/Filter/${b.kind === 'jpeg' ? 'DCTDecode' : 'FlateDecode'}>>`, b.bytes);
    this.kids.push(page);
  }

  /** a Type 3 font whose glyph k is word k's shape; `pt` points per picture pixel */
  private font(words: CutWord[], pt: number, room: Map<number, number>): number {
    const font = this.next();
    const toUnicode = this.next();
    const procs: string[] = [];
    const xobjects: string[] = [];
    const widths: number[] = [];
    let b = 0;
    let r = 0;
    let t = 0;
    words.forEach((word, k) => {
      const g = metrics(word, pt, room.get(word.line));
      widths.push(g.advance);
      r = Math.max(r, g.gw * g.u);
      b = Math.min(b, g.dy);
      t = Math.max(t, g.dy + g.gh * g.u);
      const proc = this.next();
      const image = this.next();
      const mask = this.next();
      const grey = word.ink[0] === word.ink[1] && word.ink[1] === word.ink[2];
      const colour = new Uint8Array(g.gw * g.gh * (grey ? 1 : 3));
      if (grey) colour.fill(word.ink[0]);
      else for (let i = 0; i < g.gw * g.gh; i++) colour.set(word.ink, i * 3);
      this.obj(image, `<</Subtype/Image/Width ${g.gw}/Height ${g.gh}/ColorSpace/${grey ? 'DeviceGray' : 'DeviceRGB'}/BitsPerComponent 8/SMask ${mask} 0 R/Filter/FlateDecode>>`, zlibSync(colour, { level: 9 }));
      this.obj(mask, `<</Subtype/Image/Width ${g.gw}/Height ${g.gh}/ColorSpace/DeviceGray/BitsPerComponent 4/Filter/FlateDecode>>`, zlibSync(pack4(word.alpha, g.gw, g.gh), { level: 9 }));
      // drawn a hundredth of a pixel inside its box: a reader that rounds a picture's box
      // outwards (PDFium) then puts it on exactly its pixels at the scan's own size, instead of
      // stretching it by one pixel for a rounding error
      const e = g.u / 100;
      this.obj(proc, '<<>>', enc.encode(`${num(g.advance)} 0 d0 q ${num(g.gw * g.u - 2 * e)} 0 0 ${num(g.gh * g.u - 2 * e)} ${num(e)} ${num(g.dy + e)} cm /I${k} Do Q`));
      procs.push(`/g${k} ${proc} 0 R`);
      xobjects.push(`/I${k} ${image} 0 R`);
    });
    // the space (code 32): no ink, no width of its own (word spacing sets it)
    const space = this.next();
    this.obj(space, '<<>>', enc.encode('0 0 d0'));
    procs.push(`/space ${space} 0 R`);
    const first = 0;
    const last = Math.max(32, CODES[words.length - 1]);
    const W: string[] = [];
    for (let c = first, k = 0; c <= last; c++) W.push(c === 32 || k >= widths.length ? '0' : num(widths[k++]));
    const diffs = ['32/space', ...words.map((_, k) => `${CODES[k]}/g${k}`)];
    this.obj(
      font,
      `<</Type/Font/Subtype/Type3/BaseFont/${WORD_PICTURES_FONT}/FontBBox[0 ${num(b)} ${num(r)} ${num(t)}]/FontMatrix[0.001 0 0 0.001 0 0]/CharProcs<<${procs.join(' ')}>>/Encoding<</Type/Encoding/Differences[${diffs.join(' ')}]>>/FirstChar ${first}/LastChar ${last}/Widths[${W.join(' ')}]/Resources<</XObject<<${xobjects.join(' ')}>>>>/ToUnicode ${toUnicode} 0 R>>`,
    );
    const bf = ['<20> <0020>', ...words.map((word, k) => `<${hex2(CODES[k])}> <${utf16hex(word.text)}>`)];
    let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n';
    for (let i = 0; i < bf.length; i += 100) {
      const part = bf.slice(i, i + 100);
      cmap += `${part.length} beginbfchar\n${part.join('\n')}\nendbfchar\n`;
    }
    cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
    this.obj(toUnicode, '<</Filter/FlateDecode>>', zlibSync(enc.encode(cmap), { level: 6 }));
    return font;
  }

  /** the whole file; the writer is spent */
  finish(title = ''): Uint8Array {
    this.obj(1, '<</Type/Catalog/Pages 2 0 R>>');
    this.obj(2, `<</Type/Pages/Count ${this.kids.length}/Kids[${this.kids.map((k) => `${k} 0 R`).join(' ')}]>>`);
    const safeTitle = title.replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, '\\$&');
    this.obj(3, `<</Producer(ezPDF)/Creator(ezPDF OCR)${safeTitle ? `/Title(${safeTitle})` : ''}>>`);
    const xref = this.size;
    const total = this.count + 1;
    let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for (let i = 1; i < total; i++) table += `${String(this.offsets[i]).padStart(10, '0')} 00000 n \n`;
    this.add(table);
    this.add(`trailer\n<</Size ${total}/Root 1 0 R/Info 3 0 R>>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    this.chunks = [];
    return out;
  }
}
