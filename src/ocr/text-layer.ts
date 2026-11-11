/**
 * What the searchable PDF needs of a page OCR read: its lines in reading
 * order, each with its baseline, the top of its letters and its words'
 * left and right edges, in the pixels of the page as read.
 */
import type { OcrTextPage } from '../engine/ocr-pdf';
import { readingLines, type PageLayout } from './model';

export function textPage(index: number, page: PageLayout): OcrTextPage {
  return {
    index,
    w: page.w,
    h: page.h,
    dpi: page.dpi,
    angle: page.angle,
    lines: readingLines(page)
      .filter((l) => l.words.length)
      .map((l) => ({ base: { ...l.base }, top: l.box.y0, words: l.words.map((w) => ({ text: w.text, x0: w.box.x0, x1: w.box.x1 })) })),
  };
}
