/**
 * One page through OCR (pure apart from `read`, which runs Tesseract): the
 * same steps in the app's worker and in the Node tests.
 *
 * The page is read once without its tables (painted out), with Tesseract
 * finding the blocks of text itself; then each table cell that has ink in
 * it is read on its own, as one block. Cells read on their own come out far
 * better than a whole table read as a page: Tesseract's page analysis
 * splits a table's rows and columns badly and drops short entries.
 */
import { layoutPage, prepare } from './layout';
import type { Line, PageLayout } from './model';
import { crop, enlarge, inkIn, rgbaToGray, toPgm, type Box, type Gray } from './raster';
import { linesFromTesseract, type TessBlock } from './tess-result';

export interface PageImage {
  /** RGBA, as rendered */
  rgba: Uint8Array | Uint8ClampedArray;
  w: number;
  h: number;
  dpi: number;
  /** the page's size in points */
  widthPt: number;
  heightPt: number;
}

/**
 * Reads an image (PGM bytes) with Tesseract and returns its blocks. page:
 * find the blocks of text (page segmentation 3); block: one block of text
 * (6), for a table cell; line: one line (7), for a cell one line high
 * (Tesseract reads a lone short entry, a "1", far better that way).
 */
export type Read = (pgm: Uint8Array, dpi: number, mode: 'page' | 'block' | 'line') => Promise<TessBlock[]>;

const shift = (b: Box, dx: number, dy: number): Box => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });

/**
 * A cell as Tesseract should see it: paper made white (the faint edge of a
 * painted-out border, grey paper) and lone specks of one or two pixels
 * removed (Tesseract takes them for accents: a clean "7,2" came out "đun").
 */
function cleanCell(g: Gray): Gray {
  const { w, h } = g;
  const data = g.data.slice();
  for (let i = 0; i < data.length; i++) if (data[i] > 190) data[i] = 255;
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] < 190;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!dark(x, y)) continue;
      // dark neighbours within two pixels: a speck has at most one
      let n = 0;
      for (let dy = -2; dy <= 2 && n < 3; dy++) for (let dx = -2; dx <= 2 && n < 3; dx++) if ((dx || dy) && dark(x + dx, y + dy)) n++;
      if (n <= 1) data[y * w + x] = 255;
    }
  return { w, h, data };
}

/** the lines of text a cell holds (bands of rows with ink, split by rows without), and the tallest */
function textRows(g: Gray): { rows: number; tallest: number } {
  let rows = 0;
  let tallest = 0;
  let run = 0;
  let gap = 0;
  for (let y = 0; y < g.h; y++) {
    let n = 0;
    for (let x = 0; x < g.w; x++) if (g.data[y * g.w + x] < 160) n++;
    if (n > 0) {
      if (run === 0 && (rows === 0 || gap >= 2)) rows++;
      run++;
      gap = 0;
      tallest = Math.max(tallest, run);
    } else {
      run = 0;
      gap++;
    }
  }
  return { rows, tallest };
}

export async function ocrPage(img: PageImage, read: Read, cancelled: () => boolean = () => false): Promise<PageLayout> {
  const gray = rgbaToGray(img.rgba, img.w, img.h);
  const { prep, forOcr } = prepare(gray, img.dpi);
  const { dpi } = img;
  // the page without its tables
  const page = { w: forOcr.w, h: forOcr.h, data: forOcr.data.slice() };
  for (const t of prep.ruling.tables) {
    for (let y = Math.max(0, Math.floor(t.box.y0)); y < Math.min(page.h, Math.ceil(t.box.y1)); y++) page.data.fill(255, y * page.w + Math.max(0, Math.floor(t.box.x0)), y * page.w + Math.min(page.w, Math.ceil(t.box.x1)));
  }
  const lines: Line[] = linesFromTesseract(await read(toPgm(page), dpi, 'page'));
  // big type (a cover's title): read again line by line; in the whole page Tesseract takes
  // the accents of big capitals for specks ("BAO CAO" for "BÁO CÁO")
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const hgt = l.box.y1 - l.box.y0;
    if (hgt < dpi * 0.3 || hgt > dpi * 1.5) continue;
    if (cancelled()) throw new Error('cancelled');
    const around = { x0: l.box.x0 - hgt * 0.3, y0: l.box.y0 - hgt * 0.45, x1: l.box.x1 + hgt * 0.3, y1: l.box.y1 + hgt * 0.2 };
    const pad = Math.round(dpi / 12);
    const part = crop(page, around, pad);
    const dx = Math.max(0, Math.floor(around.x0)) - pad;
    const dy = Math.max(0, Math.floor(around.y0)) - pad;
    const again = linesFromTesseract(await read(toPgm(part), dpi, 'line'));
    const words = again.flatMap((x) => x.words);
    const mean = (ws: { conf: number }[]) => (ws.length ? ws.reduce((a, w) => a + w.conf, 0) / ws.length : 0);
    if (!words.length || mean(words) < mean(l.words) - 3) continue;
    const best = again.reduce((a, b) => (b.words.length > a.words.length ? b : a));
    lines[i] = {
      box: shift(best.box, dx, dy),
      base: { x0: best.base.x0 + dx, y0: best.base.y0 + dy, x1: best.base.x1 + dx, y1: best.base.y1 + dy },
      xh: best.xh,
      words: words.map((w) => ({ ...w, box: shift(w.box, dx, dy) })),
    };
  }
  // each cell on its own
  const inset = Math.max(2, Math.round(dpi / 80));
  const margin = Math.round(dpi / 12);
  for (const t of prep.ruling.tables) {
    for (const c of t.cells) {
      if (cancelled()) throw new Error('cancelled');
      const inner = { x0: c.box.x0 + inset, y0: c.box.y0 + inset, x1: c.box.x1 - inset, y1: c.box.y1 - inset };
      if (inner.x1 - inner.x0 < 4 || inner.y1 - inner.y0 < 4) continue;
      if (inkIn(prep.ink, prep.w, inner) < dpi * 0.06) continue;
      const clean = cleanCell(crop(forOcr, inner, margin));
      const text = textRows(clean);
      if (!text.rows) continue;
      const dx = Math.floor(inner.x0) - margin;
      const dy = Math.floor(inner.y0) - margin;
      // small print (under about 10 pt) reads far better at twice the size
      const small = text.tallest < dpi * 0.11;
      const tries: { f: number; mode: 'line' | 'block' }[] = [{ f: small ? 2 : 1, mode: text.rows <= 1 ? 'line' : 'block' }];
      // a short entry read with little confidence is read again the other way (size, segmentation)
      tries.push({ f: small ? 1 : 2, mode: tries[0].mode }, { f: tries[0].f, mode: tries[0].mode === 'line' ? 'block' : 'line' });
      let best: { lines: Line[]; conf: number } | null = null;
      for (const { f, mode } of tries) {
        const got = linesFromTesseract(await read(toPgm(enlarge(clean, f)), dpi * f, mode));
        const words = got.flatMap((l) => l.words);
        const conf = words.length ? words.reduce((a, w) => a + w.conf, 0) / words.length : 0;
        const back = (b: Box): Box => shift({ x0: Math.floor(b.x0 / f), y0: Math.floor(b.y0 / f), x1: Math.ceil(b.x1 / f), y1: Math.ceil(b.y1 / f) }, dx, dy);
        const placed = got.map((l) => {
          const base = back(l.base);
          return { box: back(l.box), base: { x0: base.x0, y0: base.y0, x1: base.x1, y1: base.y1 }, xh: l.xh / f, words: l.words.map((w) => ({ ...w, box: back(w.box) })) };
        });
        if (!best || conf > best.conf) best = { lines: placed, conf };
        if (conf >= 60 || words.length > 4) break;
      }
      if (best) lines.push(...best.lines);
    }
  }
  return layoutPage({ prep, lines, rgba: { data: img.rgba, w: img.w, h: img.h }, widthPt: img.widthPt, heightPt: img.heightPt });
}
