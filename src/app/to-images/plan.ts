/**
 * What "Xuất thành ảnh" offers and how it names things, apart from the
 * engine (tests/images-probe.ts runs it on Node): formats, resolutions, the
 * cap for huge sheets, file names.
 */
import { pagesLabel } from '../pages/ranges';

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'tiff';

export const FORMATS: Record<ImageFormat, { label: string; ext: string; type: string; hint: string }> = {
  png: { label: 'PNG', ext: 'png', type: 'image/png', hint: 'Giữ nguyên nét, hợp với trang chữ, bảng, công thức.' },
  jpeg: { label: 'JPEG', ext: 'jpg', type: 'image/jpeg', hint: 'Nhẹ hơn nhiều, hợp với trang có ảnh chụp.' },
  tiff: { label: 'TIFF', ext: 'tif', type: 'image/tiff', hint: 'Không mất nét (nén LZW), một trang hay cả tài liệu trong một tệp; hay dùng để lưu hồ sơ.' },
  webp: { label: 'WebP', ext: 'webp', type: 'image/webp', hint: 'Nhẹ như JPEG mà nét hơn; vài ứng dụng cũ chưa mở được.' },
};

export const DPIS = [72, 96, 150, 200, 300, 600] as const;

export const DPI_HINT: Record<number, string> = {
  72: 'nhẹ nhất, xem nhanh',
  96: 'vừa màn hình máy tính',
  150: 'xem trên điện thoại, gửi qua Zalo',
  200: 'đọc rõ chữ nhỏ',
  300: 'in ra giấy, lưu hồ sơ',
  600: 'in chất lượng cao, ảnh rất nặng',
};

export interface PageSize {
  /** points, as shown (page rotation applied) */
  w: number;
  h: number;
}

/**
 * Pixels in one page at most: A4 at 600 dpi (≈ 35 Mpx) fits; a larger sheet
 * gets a lower resolution, so neither the worker nor a phone runs out of memory.
 */
export const PAGE_PIXELS = 36e6;

/** the resolution a page is drawn at: `dpi`, or lower for a sheet too big for it */
export function dpiFor(p: PageSize, dpi: number) {
  const sqIn = Math.max(1e-6, (p.w / 72) * (p.h / 72));
  return Math.max(36, Math.min(dpi, Math.floor(Math.sqrt(PAGE_PIXELS / sqIn))));
}

/** the page's size in pixels at `dpi` (as the worker computes it) */
export const pixelSize = (p: PageSize, dpi: number) => ({
  w: Math.max(1, Math.round((p.w * dpi) / 72)),
  h: Math.max(1, Math.round((p.h * dpi) / 72)),
});

/** A name every system accepts, from the document's name. */
export function safeBase(base: string) {
  const s = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return (s || 'tai-lieu').slice(0, 100);
}

/** "Tên - trang 03.png": numbers padded to the page count, so the files sort in order */
export function pageFileName(base: string, pageNo: number, pageCount: number, ext: string) {
  const width = String(pageCount).length;
  return `${safeBase(base)} - trang ${String(pageNo).padStart(width, '0')}.${ext}`;
}

/** the one TIFF holding several pages: the document's name, with the pages when not all of them */
export function tiffName(base: string, pages: number[], pageCount: number) {
  const all = pages.length === pageCount && pages.every((p, i) => p === i);
  return `${safeBase(base)}${all ? '' : ` - ${pagesLabel(pages.map((p) => p + 1)).replace(/–/g, '-')}`}.tif`;
}
