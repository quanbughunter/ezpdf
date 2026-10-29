/**
 * Minimal PDF reader + incremental-update writer for files saved by PDFium
 * (FPDF_SaveAsCopy always writes a classic xref table and no object streams;
 * other inputs are rejected rather than guessed at).
 *
 * Scope is deliberately narrow: read a few dictionaries by object number and
 * append replacement objects as an incremental update. Nothing is rewritten
 * in place, so every byte PDFium produced stays intact.
 */

export type PdfValue =
  | { t: 'null' }
  | { t: 'bool'; v: boolean }
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'str'; v: Uint8Array }
  | { t: 'arr'; v: PdfNode[] }
  | { t: 'dict'; v: Map<string, PdfNode> }
  | { t: 'ref'; num: number; gen: number };

/** A parsed value plus its exact source span, so it can be copied verbatim. */
export type PdfNode = PdfValue & { start: number; end: number };

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const latin1 = (b: Uint8Array, s: number, e: number) => {
  let out = '';
  for (let i = s; i < e; i++) out += String.fromCharCode(b[i]);
  return out;
};
const enc = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

class Lexer {
  constructor(public b: Uint8Array, public pos: number) {}
  skipWs() {
    const b = this.b;
    while (this.pos < b.length) {
      const c = b[this.pos];
      if (WS.has(c)) this.pos++;
      else if (c === 0x25) {
        while (this.pos < b.length && b[this.pos] !== 0x0a && b[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }
  regular(): string {
    const s = this.pos;
    while (this.pos < this.b.length && !WS.has(this.b[this.pos]) && !DELIM.has(this.b[this.pos])) this.pos++;
    return latin1(this.b, s, this.pos);
  }
  peekKeyword(kw: string): boolean {
    for (let i = 0; i < kw.length; i++) if (this.b[this.pos + i] !== kw.charCodeAt(i)) return false;
    const after = this.b[this.pos + kw.length];
    return after === undefined || WS.has(after) || DELIM.has(after);
  }
  value(): PdfNode {
    this.skipWs();
    const b = this.b;
    const start = this.pos;
    const c = b[this.pos];
    if (c === 0x2f) {
      this.pos++;
      const raw = this.regular();
      const v = raw.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      return { t: 'name', v, start, end: this.pos };
    }
    if (c === 0x3c && b[this.pos + 1] === 0x3c) {
      this.pos += 2;
      const map = new Map<string, PdfNode>();
      for (;;) {
        this.skipWs();
        if (b[this.pos] === 0x3e && b[this.pos + 1] === 0x3e) {
          this.pos += 2;
          break;
        }
        const k = this.value();
        if (k.t !== 'name') throw new Error(`dict key is not a name at ${k.start}`);
        map.set(k.v, this.value());
      }
      return { t: 'dict', v: map, start, end: this.pos };
    }
    if (c === 0x5b) {
      this.pos++;
      const arr: PdfNode[] = [];
      for (;;) {
        this.skipWs();
        if (b[this.pos] === 0x5d) {
          this.pos++;
          break;
        }
        arr.push(this.value());
      }
      return { t: 'arr', v: arr, start, end: this.pos };
    }
    if (c === 0x28) {
      // literal string with balanced parens and escapes
      this.pos++;
      let depth = 1;
      const bytes: number[] = [];
      while (this.pos < b.length && depth > 0) {
        const ch = b[this.pos++];
        if (ch === 0x5c) {
          const n = b[this.pos++];
          const map: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };
          if (n in map) bytes.push(map[n]);
          else if (n >= 0x30 && n <= 0x37) {
            let oct = n - 0x30;
            for (let k = 0; k < 2 && b[this.pos] >= 0x30 && b[this.pos] <= 0x37; k++) oct = oct * 8 + (b[this.pos++] - 0x30);
            bytes.push(oct & 0xff);
          } else if (n === 0x0d) {
            if (b[this.pos] === 0x0a) this.pos++;
          } else if (n !== 0x0a) bytes.push(n);
        } else {
          if (ch === 0x28) depth++;
          else if (ch === 0x29 && --depth === 0) break;
          bytes.push(ch);
        }
      }
      return { t: 'str', v: new Uint8Array(bytes), start, end: this.pos };
    }
    if (c === 0x3c) {
      this.pos++;
      const s = this.pos;
      while (this.pos < b.length && b[this.pos] !== 0x3e) this.pos++;
      const hex = latin1(b, s, this.pos).replace(/\s+/g, '');
      this.pos++;
      const padded = hex.length % 2 ? hex + '0' : hex;
      const v = new Uint8Array(padded.length / 2);
      for (let i = 0; i < v.length; i++) v[i] = parseInt(padded.substr(i * 2, 2), 16);
      return { t: 'str', v, start, end: this.pos };
    }
    const tok = this.regular();
    if (tok === 'true' || tok === 'false') return { t: 'bool', v: tok === 'true', start, end: this.pos };
    if (tok === 'null') return { t: 'null', start, end: this.pos };
    const num = Number(tok);
    if (tok === '' || Number.isNaN(num)) throw new Error(`unexpected token "${tok}" at ${start}`);
    // lookahead for "gen R"
    if (/^\d+$/.test(tok)) {
      const save = this.pos;
      this.skipWs();
      const genStart = this.pos;
      const gen = this.regular();
      if (/^\d+$/.test(gen) && this.pos > genStart) {
        this.skipWs();
        if (this.peekKeyword('R')) {
          this.pos += 1;
          return { t: 'ref', num, gen: Number(gen), start, end: this.pos };
        }
      }
      this.pos = save;
    }
    return { t: 'num', v: num, start, end: this.pos };
  }
}

export interface PdfObject {
  num: number;
  gen: number;
  value: PdfNode;
  /** offset of stream data (after "stream" EOL), when the object is a stream */
  streamStart?: number;
}

export class PdfLite {
  readonly xref = new Map<number, { offset: number; gen: number }>();
  readonly trailer: Map<string, PdfNode>;
  readonly startxref: number;

  constructor(readonly bytes: Uint8Array) {
    const tail = latin1(bytes, Math.max(0, bytes.length - 2048), bytes.length);
    const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
    if (!m) throw new Error('startxref not found');
    this.startxref = Number(m[1]);
    let at: number | undefined = this.startxref;
    let first: Map<string, PdfNode> | null = null;
    const seen = new Set<number>();
    while (at !== undefined && !seen.has(at)) {
      seen.add(at);
      const lx: Lexer = new Lexer(bytes, at);
      lx.skipWs();
      if (!lx.peekKeyword('xref')) throw new Error('xref stream: not a PDFium SaveAsCopy output');
      lx.pos += 4;
      for (;;) {
        lx.skipWs();
        if (lx.peekKeyword('trailer')) {
          lx.pos += 7;
          break;
        }
        const startNum = Number(lx.regular());
        lx.skipWs();
        const count = Number(lx.regular());
        for (let i = 0; i < count; i++) {
          lx.skipWs();
          const off = Number(lx.regular());
          lx.skipWs();
          const gen = Number(lx.regular());
          lx.skipWs();
          const kind = lx.regular();
          const num = startNum + i;
          if (kind === 'n' && !this.xref.has(num)) this.xref.set(num, { offset: off, gen });
        }
      }
      const tr: PdfNode = lx.value();
      if (tr.t !== 'dict') throw new Error('bad trailer');
      if (!first) first = tr.v;
      const prev: PdfNode | undefined = tr.v.get('Prev');
      at = prev && prev.t === 'num' ? prev.v : undefined;
    }
    this.trailer = first!;
  }

  get(num: number): PdfObject | null {
    const e = this.xref.get(num);
    if (!e) return null;
    const lx = new Lexer(this.bytes, e.offset);
    lx.skipWs();
    const n = Number(lx.regular());
    lx.skipWs();
    const g = Number(lx.regular());
    lx.skipWs();
    if (n !== num || !lx.peekKeyword('obj')) throw new Error(`xref offset mismatch for object ${num}`);
    lx.pos += 3;
    const value = lx.value();
    lx.skipWs();
    let streamStart: number | undefined;
    if (lx.peekKeyword('stream')) {
      lx.pos += 6;
      if (this.bytes[lx.pos] === 0x0d) lx.pos++;
      if (this.bytes[lx.pos] === 0x0a) lx.pos++;
      streamStart = lx.pos;
    }
    return { num, gen: g, value, streamStart };
  }

  /** Resolve a reference (one level) to its value. */
  resolve(node: PdfNode | undefined): PdfNode | undefined {
    if (!node || node.t !== 'ref') return node;
    return this.get(node.num)?.value;
  }

  raw(node: PdfNode): string {
    return latin1(this.bytes, node.start, node.end);
  }

  /** Append replacement objects as an incremental update. */
  appendUpdate(objs: { num: number; gen: number; data: Uint8Array }[]): Uint8Array {
    const parts: Uint8Array[] = [this.bytes];
    let offset = this.bytes.length;
    const needsNl = this.bytes[offset - 1] !== 0x0a;
    if (needsNl) {
      parts.push(enc('\n'));
      offset += 1;
    }
    const entries: { num: number; gen: number; offset: number }[] = [];
    for (const o of objs) {
      entries.push({ num: o.num, gen: o.gen, offset });
      parts.push(o.data);
      offset += o.data.byteLength;
    }
    const xrefAt = offset;
    entries.sort((a, b) => a.num - b.num);
    let xref = 'xref\n';
    for (let i = 0; i < entries.length; ) {
      let j = i;
      while (j + 1 < entries.length && entries[j + 1].num === entries[j].num + 1) j++;
      xref += `${entries[i].num} ${j - i + 1}\n`;
      for (let k = i; k <= j; k++) {
        xref += `${String(entries[k].offset).padStart(10, '0')} ${String(entries[k].gen).padStart(5, '0')} n\r\n`;
      }
      i = j + 1;
    }
    const keep = ['Root', 'Info', 'ID', 'Encrypt']
      .filter((k) => this.trailer.has(k))
      .map((k) => `/${k} ${this.raw(this.trailer.get(k)!)}`)
      .join(' ');
    const sizeNode = this.trailer.get('Size');
    const size = Math.max(sizeNode?.t === 'num' ? sizeNode.v : 0, ...entries.map((e) => e.num + 1));
    xref += `trailer\n<< /Size ${size} ${keep} /Prev ${this.startxref} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    parts.push(enc(xref));
    const out = new Uint8Array(parts.reduce((s, p) => s + p.byteLength, 0));
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.byteLength;
    }
    return out;
  }
}

export function encodeLatin1(s: string): Uint8Array {
  return enc(s);
}
