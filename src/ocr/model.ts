/**
 * What OCR makes of a page, as the Word and PDF writers take it. Positions
 * are pixels of the page image as read (straightened); `dpi` turns them into
 * inches.
 */
import type { Box } from './raster';

/** a word as Tesseract read it */
export interface Word {
  text: string;
  /** 0–100 */
  conf: number;
  box: Box;
  bold?: boolean;
  italic?: boolean;
}

/** a line of words, left to right */
export interface Line {
  words: Word[];
  box: Box;
  /** baseline at the line's left and right ends */
  base: { x0: number; y0: number; x1: number; y1: number };
  /** height of the small letters, px */
  xh: number;
  /** the size in points Times New Roman would need to fill the words' width (lines long enough to tell) */
  size?: number;
}

export type Align = 'left' | 'center' | 'right' | 'justify';

export interface Para {
  kind: 'para';
  box: Box;
  lines: Line[];
  align: Align;
  /** keep the page's line breaks (centred titles, addresses) instead of letting Word wrap */
  breaks: boolean;
  /** px from the left of what holds it (page text column or cell) */
  indent: number;
  /** first line's offset from indent, px (negative: hanging) */
  firstLine: number;
  /** px from the right of what holds it */
  indentRight: number;
  /** points */
  size: number;
  /** distance between baselines, px (0: one line) */
  pitch: number;
  /** space above, px */
  before: number;
  /** text side by side on one line: each later piece starts at a tab stop (px from the left edge) */
  tabs?: { at: number; kind: 'left' | 'right' }[];
}

export interface Cell {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
  box: Box;
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
  /** where its text sits */
  valign: 'top' | 'center' | 'bottom';
  paras: Para[];
}

export interface TableBlock {
  kind: 'table';
  box: Box;
  xs: number[];
  ys: number[];
  cells: Cell[];
  /** no lines drawn: text side by side (two-column headings, signature blocks) */
  borderless: boolean;
  before: number;
}

export interface Picture {
  kind: 'picture';
  box: Box;
  /** PNG of that part of the page, in colour */
  png: Uint8Array;
  /** over text (a stamp, a signature): floats behind it at its place on the page */
  behind: boolean;
  before: number;
}

/** a line drawn across on its own (Word: a paragraph border) */
export interface RuleBlock {
  kind: 'rule';
  box: Box;
  /** stroke, px */
  thick: number;
  /** two lines close together */
  double?: boolean;
  before: number;
}

export type Block = Para | TableBlock | Picture | RuleBlock;

export interface PageLayout {
  /** page image size, px, and its resolution */
  w: number;
  h: number;
  dpi: number;
  /** the page's size in points (as the PDF page, or the image at its resolution) */
  widthPt: number;
  heightPt: number;
  /** the text column: left, right, top, bottom of what is on the page (not header, footer) */
  body: Box;
  blocks: Block[];
  /** running header and footer, as drawn above and below a rule */
  header: Block[];
  footer: Block[];
  frame: (Box & { thick: number; double: boolean }) | null;
  /** the angle the page was straightened by, degrees */
  angle: number;
}

/** the lines of a page in reading order: header, the text and tables (cell by cell, row by row), footer */
export function readingLines(page: PageLayout): Line[] {
  const out: Line[] = [];
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.kind === 'para') out.push(...b.lines);
      else if (b.kind === 'table') {
        const cells = [...b.cells].sort((x, y) => x.r0 - y.r0 || x.c0 - y.c0);
        for (const c of cells) for (const p of c.paras) out.push(...p.lines);
      }
    }
  };
  walk(page.header);
  walk(page.blocks);
  walk(page.footer);
  return out;
}

/** all the text of a page, one line per line, for a quick check */
export function pageText(page: PageLayout): string {
  return readingLines(page)
    .map((l) => l.words.map((w) => w.text).join(' '))
    .join('\n');
}
