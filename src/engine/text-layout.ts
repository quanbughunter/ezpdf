/**
 * FreeText layout shared by the screen renderer and the exporter.
 *
 * Both sides call `layoutFreeText` with the same font metrics, so the lines,
 * their x positions and their baselines are identical on screen (at any zoom)
 * and in the exported appearance stream. Nothing here depends on the browser's
 * own line breaking.
 */
import { textWidth, type FontMetrics } from './font-metrics';

/** Line height of a FreeText box, in em (matches the EmbedPDF editor default). */
export const FREETEXT_LINE_HEIGHT = 1.18;
/** Rounding slack when comparing a line width with the box width, in points. */
export const WRAP_TOLERANCE_PT = 0.05;

export interface FreeTextLayoutInput {
  text: string;
  fontSize: number;
  /** 0 left, 1 center, 2 right (PDF /Q) */
  align: number;
  /** 0 top, 1 middle, 2 bottom */
  valign: number;
  /** unrotated box, points */
  width: number;
  height: number;
  /** border width = inner padding, points */
  borderWidth: number;
}

export interface LaidOutLine {
  text: string;
  /** left edge of the line, points from the box's left edge */
  x: number;
  /** baseline, points from the box's top edge (y down) */
  baselineFromTop: number;
  width: number;
}

export interface FreeTextLayout {
  lines: LaidOutLine[];
  lineHeight: number;
  /** height the text needs (lines × line height + padding), points */
  contentHeight: number;
  /** distance from the top of a glyph line box to its baseline, points */
  ascent: number;
  /** ascent + descent, points */
  contentArea: number;
}

/** Tabs become 4 spaces and text is NFC so screen, contents and file agree. */
export function normalizeFreeText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
}

/**
 * Greedy wrap with CSS `white-space: pre-wrap; overflow-wrap: break-word`
 * semantics: newlines start paragraphs, spaces inside a line are kept,
 * spaces at a break are dropped, a word wider than the box is split by
 * characters.
 */
export function wrapText(m: FontMetrics, text: string, fontSize: number, maxWidth: number): string[] {
  const fits = (s: string) => textWidth(m, s, fontSize) <= maxWidth + WRAP_TOLERANCE_PT;
  const out: string[] = [];
  for (const para of normalizeFreeText(text).split('\n')) {
    const tokens = para.match(/ +|[^ ]+/g) ?? [];
    let line = '';
    let pending = '';
    const placeWord = (word: string) => {
      if (fits(word)) {
        line = word;
        return;
      }
      let chunk = '';
      for (const ch of word) {
        if (chunk && !fits(chunk + ch)) {
          out.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    };
    for (const tok of tokens) {
      if (tok[0] === ' ') {
        pending += tok;
        continue;
      }
      const cand = line + pending + tok;
      if (fits(cand)) {
        line = cand;
      } else if (line) {
        out.push(line);
        placeWord(tok);
      } else {
        placeWord(tok);
      }
      pending = '';
    }
    out.push(line);
  }
  return out;
}

export function layoutFreeText(m: FontMetrics, p: FreeTextLayoutInput): FreeTextLayout {
  const em = m.unitsPerEm;
  const inset = p.borderWidth;
  const lineHeight = FREETEXT_LINE_HEIGHT * p.fontSize;
  const ascent = (m.ascent / em) * p.fontSize;
  const contentArea = ((m.ascent + m.descent) / em) * p.fontSize;
  // CSS line box: half-leading + ascent puts the baseline here.
  const baselineInLine = (lineHeight - contentArea) / 2 + ascent;
  const texts = wrapText(m, p.text, p.fontSize, p.width - 2 * inset);
  const total = texts.length * lineHeight;
  const avail = p.height - 2 * inset;
  const top = p.valign === 1 ? inset + (avail - total) / 2 : p.valign === 2 ? inset + avail - total : inset;
  const lines = texts.map((text, i) => {
    const width = textWidth(m, text, p.fontSize);
    const x = p.align === 1 ? (p.width - width) / 2 : p.align === 2 ? p.width - inset - width : inset;
    return { text, x, baselineFromTop: top + i * lineHeight + baselineInLine, width };
  });
  return { lines, lineHeight, contentHeight: total + 2 * inset, ascent, contentArea };
}
