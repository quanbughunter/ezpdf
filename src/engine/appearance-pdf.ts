/**
 * Builds a one-page PDF (in memory) that draws one FreeText appearance with an
 * embedded TrueType font: Type0 / CIDFontType2 / Identity-H, /W widths from
 * hmtx, ToUnicode for copy & search, FontFile2 = the whole (small) subset.
 *
 * The page content is only `q /EPDFWRAP Do Q`; the drawing lives in a form
 * XObject under that resource name. EmbedPDF 2.15.1's
 * EPDFAnnot_SetAppearanceFromPage copies the page content into AP/N and moves
 * the page resources one level down into AP/N/Resources/XObject/EPDFWRAP.
 * With this layout both levels stay valid, so PDFium writes the final AP
 * itself — including encryption when the target file is encrypted.
 */
import type { FontMetrics } from './font-metrics';

export interface DrawSpec {
  width: number;
  height: number;
  lines: { text: string; x: number; y: number }[]; // y = baseline, PDF y-up
  fontSize: number;
  color: [number, number, number];
  background: [number, number, number] | null;
  borderWidth: number;
}

export interface EmbeddableFont {
  postscriptName: string;
  metrics: FontMetrics;
  /** FlateDecode-compressed font program, or raw bytes if `compressed` is false */
  program: Uint8Array;
  programLength1: number;
  compressed: boolean;
}

const n = (v: number) => {
  const s = (Math.round(v * 1000) / 1000).toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
};
const rgb = (c: [number, number, number]) => c.map((v) => n(v / 255)).join(' ');
const hex4 = (v: number) => v.toString(16).toUpperCase().padStart(4, '0');

function utf16beHex(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) out += hex4(s.charCodeAt(i));
  return out;
}

function toUnicodeCMap(map: Map<number, string>): string {
  const entries = [...map.entries()].sort((a, b) => a[0] - b[0]);
  let body = '';
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    body += `${chunk.length} beginbfchar\n`;
    for (const [gid, ch] of chunk) body += `<${hex4(gid)}> <${utf16beHex(ch)}>\n`;
    body += 'endbfchar\n';
  }
  return (
    '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
    body +
    'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n'
  );
}

class PdfWriter {
  private chunks: Uint8Array[] = [];
  private length = 0;
  private offsets: number[] = [];
  private enc = new TextEncoder();
  private push(b: Uint8Array) {
    this.chunks.push(b);
    this.length += b.byteLength;
  }
  raw(s: string) {
    // Everything we write as text is ASCII (strings are hex-encoded).
    this.push(this.enc.encode(s));
  }
  obj(num: number, body: string) {
    this.offsets[num] = this.length;
    this.raw(`${num} 0 obj\n${body}\nendobj\n`);
  }
  stream(num: number, dict: string, data: Uint8Array) {
    this.offsets[num] = this.length;
    this.raw(`${num} 0 obj\n<< ${dict} /Length ${data.byteLength} >>\nstream\n`);
    this.push(data);
    this.raw('\nendstream\nendobj\n');
  }
  finish(rootNum: number): Uint8Array {
    const xrefAt = this.length;
    const count = this.offsets.length;
    let x = `xref\n0 ${count}\n0000000000 65535 f\r\n`;
    for (let i = 1; i < count; i++) x += `${String(this.offsets[i] ?? 0).padStart(10, '0')} 00000 n\r\n`;
    x += `trailer\n<< /Size ${count} /Root ${rootNum} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    this.raw(x);
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    return out;
  }
}

export function buildAppearancePdf(spec: DrawSpec, font: EmbeddableFont): Uint8Array {
  const m = font.metrics;
  const toPdf = (fu: number) => Math.round((fu * 1000) / m.unitsPerEm);
  const used = new Map<number, string>(); // gid -> char
  let content = 'q\n';
  if (spec.background) {
    content += `${rgb(spec.background)} rg 0 0 ${n(spec.width)} ${n(spec.height)} re f\n`;
  }
  if (spec.borderWidth > 0) {
    const b = spec.borderWidth;
    content += `${rgb(spec.color)} RG ${n(b)} w ${n(b / 2)} ${n(b / 2)} ${n(spec.width - b)} ${n(spec.height - b)} re S\n`;
  }
  content += `BT\n/F1 ${n(spec.fontSize)} Tf\n${rgb(spec.color)} rg\n`;
  for (const line of spec.lines) {
    if (!line.text) continue;
    let codes = '';
    for (const ch of line.text) {
      const gid = m.glyph(ch.codePointAt(0)!);
      if (gid && !used.has(gid)) used.set(gid, ch);
      codes += hex4(gid);
    }
    content += `1 0 0 1 ${n(line.x)} ${n(line.y)} Tm <${codes}> Tj\n`;
  }
  content += 'ET\nQ\n';

  const widths = [...used.keys()]
    .sort((a, b) => a - b)
    .map((gid) => `${gid} [${toPdf(m.glyphAdvance(gid))}]`)
    .join(' ');
  const [x0, y0, x1, y1] = m.bbox.map(toPdf);
  const name = font.postscriptName;
  const box = `[0 0 ${n(spec.width)} ${n(spec.height)}]`;

  const w = new PdfWriter();
  w.raw('%PDF-1.7\n');
  w.obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  w.obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  w.obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox ${box} /Resources << /XObject << /EPDFWRAP 4 0 R >> >> /Contents 5 0 R >>`);
  const enc = new TextEncoder();
  w.stream(4, `/Type /XObject /Subtype /Form /BBox ${box} /Resources << /Font << /F1 6 0 R >> >>`, enc.encode(content));
  w.stream(5, '', enc.encode('q /EPDFWRAP Do Q'));
  w.obj(6, `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 10 0 R >>`);
  w.obj(
    7,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
      `/FontDescriptor 8 0 R /CIDToGIDMap /Identity /DW 1000 /W [${widths}] >>`,
  );
  w.obj(
    8,
    `<< /Type /FontDescriptor /FontName /${name} /Flags 32 /FontBBox [${x0} ${y0} ${x1} ${y1}] /ItalicAngle 0 ` +
      `/Ascent ${toPdf(m.ascent)} /Descent ${-toPdf(m.descent)} /CapHeight ${toPdf(m.capHeight)} /StemV 80 /FontFile2 9 0 R >>`,
  );
  w.stream(9, `/Length1 ${font.programLength1}${font.compressed ? ' /Filter /FlateDecode' : ''}`, font.program);
  w.stream(10, '', enc.encode(toUnicodeCMap(used)));
  return w.finish(1);
}

/** zlib (RFC 1950) = PDF FlateDecode; CompressionStream exists in browsers, workers and Node ≥ 18. */
export async function flate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
