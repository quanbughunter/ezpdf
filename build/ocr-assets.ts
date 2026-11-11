/**
 * OCR's own files (tesseract.js 7 and the Vietnamese model), served from the
 * app itself so recognition never reaches the network:
 *   ocr/worker.min.js                         tesseract.js's worker
 *   ocr/tesseract-core-simd-lstm.{js,wasm}    Tesseract 5 (WASM, SIMD), LSTM engine only
 *   ocr/tesseract-core-lstm.{js,wasm}         the same without SIMD, for older machines
 *   ocr/vie.traineddata.gz                    tessdata_best (integer), Vietnamese
 * Copied into the desktop build (OCR is a desktop feature for now) and served
 * by the dev server for the tests; the web and Android builds do not carry
 * them. The service worker never lists them (build/pwa.ts).
 */
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

export const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract-core-simd-lstm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.js',
  'tesseract-core-simd-lstm.wasm': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm',
  'tesseract-core-lstm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.js',
  'tesseract-core-lstm.wasm': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
  'vie.traineddata.gz': 'node_modules/@tesseract.js-data/vie/4.0.0_best_int/vie.traineddata.gz',
};

const TYPES: Record<string, string> = { js: 'text/javascript', wasm: 'application/wasm', gz: 'application/octet-stream' };

/** the builds that carry OCR */
export const OCR_MODES = new Set(['desktop']);

export function ezpdfOcrAssets(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'ezpdf-ocr-assets',
    configResolved(c) {
      config = c;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/ocr\/([\w.-]+)$/.exec((req.url ?? '').split('?')[0]);
        const src = m && OCR_FILES[m[1]];
        if (!src) return next();
        const path = join(config.root, src);
        if (!existsSync(path)) return next();
        res.setHeader('Content-Type', TYPES[m[1].split('.').pop()!] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(path).size));
        createReadStream(path).pipe(res);
      });
    },
    writeBundle() {
      if (config.command !== 'build' || !OCR_MODES.has(config.mode)) return;
      const dir = join(config.build.outDir, 'ocr');
      mkdirSync(dir, { recursive: true });
      for (const [name, src] of Object.entries(OCR_FILES)) {
        const from = join(config.root, src);
        if (!existsSync(from)) throw new Error(`OCR: ${src} is missing (npm install)`);
        copyFileSync(from, join(dir, name));
      }
    },
  };
}
