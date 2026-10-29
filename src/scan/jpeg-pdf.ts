/**
 * A PDF with one JPEG per page, written directly: each image is embedded as
 * is (DCTDecode), so nothing is re-compressed and nothing leaves the device.
 */

export interface JpegPage {
  jpeg: Uint8Array;
  /** pixels */
  width: number;
  height: number;
  /** page size in points */
  pageWidth: number;
  pageHeight: number;
}

const enc = new TextEncoder();
const num = (n: number) => (Math.round(n * 100) / 100).toString();

/** PDF date for the Info dictionary, local time with its offset. */
function pdfDate(d: Date) {
  const p = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${off >= 0 ? '+' : '-'}${p(Math.trunc(off / 60))}'${p(off % 60)}'`;
}

export function jpegPagesToPdf(pages: JpegPage[], opts: { title?: string; date?: Date } = {}): Uint8Array {
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
  // 1 catalog, 2 pages, 3 info, then per page: page, contents, image
  const n = pages.length;
  const pageObj = (i: number) => 4 + i * 3;
  add('%PDF-1.4\n%âãÏÓ\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`);
  const title = (opts.title ?? '').replace(/[^\x20-\x7e]/g, '?').replace(/[()\\]/g, '\\$&');
  obj(3, `<< /Producer (ezPDF) /Creator (ezPDF scan)${title ? ` /Title (${title})` : ''} /CreationDate (${pdfDate(opts.date ?? new Date())}) >>`);
  pages.forEach((p, i) => {
    const page = pageObj(i), contents = page + 1, image = page + 2;
    obj(
      page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.pageWidth)} ${num(p.pageHeight)}] /Resources << /XObject << /Im0 ${image} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${contents} 0 R >>`,
    );
    const draw = `q ${num(p.pageWidth)} 0 0 ${num(p.pageHeight)} 0 0 cm /Im0 Do Q`;
    obj(contents, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    obj(image, () => {
      add(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.byteLength} >>\nstream\n`);
      add(p.jpeg);
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

/** A4 short side in points. */
export const A4_SHORT = 595.28;
export const A4_LONG = 841.89;

/**
 * Page size for a scanned sheet: the short side is A4's, the long side keeps
 * the sheet's proportions (exactly A4 when the sheet was snapped to A4).
 */
export function pageSizeFor(width: number, height: number, a4: boolean): { pageWidth: number; pageHeight: number } {
  const portrait = height >= width;
  const long = a4 ? A4_LONG : (A4_SHORT * Math.max(width, height)) / Math.min(width, height);
  return portrait ? { pageWidth: A4_SHORT, pageHeight: long } : { pageWidth: long, pageHeight: A4_SHORT };
}
