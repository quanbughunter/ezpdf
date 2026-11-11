/**
 * Tesseract in the page (tesseract.js 7, its own worker), loaded from the
 * app's files (build/ocr-assets.ts) with the Vietnamese model kept inside
 * the app: nothing is fetched from the network, nothing is cached elsewhere.
 * One instance, created on first use and kept for the next pages.
 */
import { createWorker, type Worker } from 'tesseract.js';
import type { TessBlock } from './tess-result';

/** the build carries OCR (the desktop app; the dev server for the tests) */
export const OCR_BUILT = typeof __EZPDF_OCR__ === 'boolean' && __EZPDF_OCR__;

const base = () => new URL(`${import.meta.env.BASE_URL}ocr/`, window.location.href).href;

/** WebAssembly SIMD (wasm-feature-detect's probe): the faster build of Tesseract */
function simd(): boolean {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    return false;
  }
}

let worker: Promise<Worker> | null = null;

function load(): Promise<Worker> {
  worker ??= createWorker('vie', 1, {
    workerPath: `${base()}worker.min.js`,
    corePath: `${base()}${simd() ? 'tesseract-core-simd-lstm.js' : 'tesseract-core-lstm.js'}`,
    langPath: base().replace(/\/$/, ''),
    gzip: true,
    cacheMethod: 'none',
    workerBlobURL: false,
  }).catch((e) => {
    worker = null;
    throw new Error(`Không khởi động được bộ nhận dạng chữ: ${e instanceof Error ? e.message : String(e)}`);
  });
  return worker;
}

const PSM = { page: '3', block: '6', line: '7' } as const;

interface RawWord {
  text: string;
  confidence: number;
  bbox: TessBlock['bbox'];
}

/** reads an image (PGM bytes) and returns its blocks, only what the layout uses */
export async function readImage(pgm: Uint8Array, dpi: number, mode: keyof typeof PSM): Promise<TessBlock[]> {
  const w = await load();
  await w.setParameters({ tessedit_pageseg_mode: PSM[mode] as never, preserve_interword_spaces: '1', user_defined_dpi: String(Math.round(dpi)) });
  const r = await w.recognize(pgm as never, {}, { blocks: true, text: false, hocr: false, tsv: false });
  return (r.data.blocks ?? []).map((b) => ({
    bbox: b.bbox,
    blocktype: b.blocktype as unknown as number,
    paragraphs: b.paragraphs.map((p) => ({
      bbox: p.bbox,
      lines: p.lines.map((l) => ({
        bbox: l.bbox,
        baseline: l.baseline,
        rowAttributes: l.rowAttributes,
        words: l.words.map((x: RawWord) => ({ text: x.text, confidence: x.confidence, bbox: x.bbox })),
      })),
    })),
  }));
}

/** loads Tesseract ahead of the first page (the model takes a moment) */
export function warmUp(): Promise<void> {
  return load().then(() => undefined);
}

export async function stopTesseract() {
  const w = worker;
  worker = null;
  if (w) await (await w.catch(() => null))?.terminate();
}
