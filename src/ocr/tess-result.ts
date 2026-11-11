/**
 * Tesseract's answer (tesseract.js `blocks`) as lines of words (pure).
 * Words that are not text are left out: marks Tesseract was unsure of with
 * no letter or digit in them (specks, the stub of a painted-out line).
 */
import type { Line, Word } from './model';

interface TBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface TessWord {
  text: string;
  confidence: number;
  bbox: TBox;
}
export interface TessLine {
  bbox: TBox;
  baseline: TBox;
  rowAttributes?: { rowHeight: number; ascenders: number; descenders: number };
  words: TessWord[];
}
export interface TessBlock {
  bbox: TBox;
  blocktype?: number;
  paragraphs: { bbox: TBox; lines: TessLine[] }[];
}

const TEXTY = /[\p{L}\p{N}]/u;
const MARKS = new Set(['-', '–', '—', '+', '•', '*', '(', ')', ':', ';', ',', '.', '%', '/', '"', '“', '”', '…']);

export function keepWord(text: string, conf: number): boolean {
  const t = text.trim();
  if (!t) return false;
  // (a lone | ] [ ! may be a 1 in a column of figures: the layout decides)
  if (/^[|\][!]$/.test(t)) return conf >= 30;
  if (!TEXTY.test(t)) return conf >= 50 && [...t].every((c) => MARKS.has(c));
  // Tesseract gives some real words a confidence of 0; only short unsure ones are specks
  return conf >= 25 || [...t].length >= 3;
}

export function linesFromTesseract(blocks: TessBlock[]): Line[] {
  const out: Line[] = [];
  for (const b of blocks ?? [])
    for (const p of b.paragraphs ?? [])
      for (const l of p.lines ?? []) {
        const words: Word[] = l.words
          .map((w) => ({ text: w.text.normalize('NFC').trim(), conf: w.confidence, box: { ...w.bbox } }))
          .filter((w) => keepWord(w.text, w.conf));
        if (!words.length) continue;
        // pixel boxes (the layout indexes the page with them)
        for (const w of words) w.box = { x0: Math.floor(w.box.x0), y0: Math.floor(w.box.y0), x1: Math.ceil(w.box.x1), y1: Math.ceil(w.box.y1) };
        const ra = l.rowAttributes;
        let xh = ra ? ra.rowHeight - ra.ascenders - ra.descenders : 0;
        const hgt = l.bbox.y1 - l.bbox.y0;
        if (!(xh > 2) || xh > hgt) xh = Math.max(3, hgt * 0.45);
        out.push({ words, box: { ...l.bbox }, base: { ...l.baseline }, xh });
      }
  return out;
}
