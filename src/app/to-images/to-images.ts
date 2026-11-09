/**
 * "Xuất thành ảnh": pages of the finished PDF (the same file "Xuất PDF"
 * writes: annotations, signatures, edits, rotation) drawn by ezPDF's PDFium
 * worker and encoded there as PNG, JPEG, WebP or TIFF, then handed one by
 * one to the platform (a folder on the desktop, the phone's pictures on
 * Android, the share sheet or a download in the browser). Nothing leaves
 * the device unless the user sends it on.
 */
import { closeRenderSession, openRenderSession, renderPageEncoded } from '@/engine/export-client';
import { tiffFile, type TiffPage } from '@/engine/tiff-write';
import type { ImageSink } from '@/platform/types';
import { dpiFor, FORMATS, pageFileName, tiffName, type ImageFormat } from './plan';

export * from './plan';

export interface ConvertOptions {
  format: ImageFormat;
  dpi: number;
  /** 0–1, JPEG and WebP */
  quality: number;
  gray: boolean;
  /** TIFF: every page in one file */
  oneTiff: boolean;
  /** 0-based, in order */
  pages: number[];
  /** the document's name without .pdf */
  base: string;
}

export interface ConvertProgress {
  done: number;
  total: number;
}

const aborted = () => new DOMException('Đã dừng.', 'AbortError');

/**
 * Draws and encodes `opts.pages` of `bytes` (the finished PDF; the buffer is
 * detached) and writes each picture to `sink` as soon as it is made. Returns
 * the pages drawn below the chosen resolution (sheets too big for it).
 */
export async function convertPages(
  bytes: ArrayBuffer,
  opts: ConvertOptions,
  sink: ImageSink,
  hooks: { signal?: AbortSignal; onProgress?: (p: ConvertProgress) => void } = {},
) {
  const { session, pages } = await openRenderSession(bytes);
  const lowered: number[] = [];
  const f = FORMATS[opts.format];
  const held: TiffPage[] = [];
  const one = opts.format === 'tiff' && opts.oneTiff && opts.pages.length > 1;
  try {
    if (!opts.pages.length) throw new Error('Chưa chọn trang nào.');
    if (opts.pages.some((p) => p < 0 || p >= pages.length)) throw new Error('Trang đã chọn không còn trong tài liệu.');
    hooks.onProgress?.({ done: 0, total: opts.pages.length });
    for (let k = 0; k < opts.pages.length; k++) {
      if (hooks.signal?.aborted) throw aborted();
      const index = opts.pages[k];
      const dpi = dpiFor(pages[index], opts.dpi);
      if (dpi < opts.dpi) lowered.push(index + 1);
      const r = await renderPageEncoded(session, index, dpi, {
        format: opts.format,
        quality: opts.quality,
        gray: opts.gray,
      });
      if (hooks.signal?.aborted) throw aborted();
      if (opts.format === 'tiff') {
        if (!r.tiff) throw new Error('Không tạo được ảnh TIFF.');
        if (one) held.push(r.tiff);
        else await sink.write({ name: pageFileName(opts.base, index + 1, pages.length, f.ext), type: f.type, bytes: tiffFile([r.tiff], 'ezPDF') });
      } else {
        if (!r.image) throw new Error(`Không tạo được ảnh ${f.label}.`);
        await sink.write({ name: pageFileName(opts.base, index + 1, pages.length, f.ext), type: f.type, bytes: new Uint8Array(await r.image.arrayBuffer()) });
      }
      hooks.onProgress?.({ done: k + 1, total: opts.pages.length });
    }
    if (one) await sink.write({ name: tiffName(opts.base, opts.pages, pages.length), type: f.type, bytes: tiffFile(held, 'ezPDF') });
  } catch (e) {
    await sink.abort().catch(() => {});
    throw e;
  } finally {
    void closeRenderSession(session);
  }
  return { lowered, pageCount: pages.length };
}
