/**
 * Where "Nhận dạng chữ (OCR)" is offered: in the desktop app, whose build
 * carries Tesseract and the Vietnamese model (build/ocr-assets.ts). The web
 * app and the Android app do not have it yet, so they show no button for it.
 * The dev server has the files too and shows it with ?ocr in the address,
 * for the tests.
 */
import type { Platform } from '@/platform/types';

export function ocrAvailable(platform: Platform): boolean {
  if (typeof __EZPDF_OCR__ !== 'boolean' || !__EZPDF_OCR__) return false;
  if (platform.kind === 'desktop') return true;
  return import.meta.env.DEV && new URLSearchParams(window.location.search).has('ocr');
}

/** what the file input takes for OCR (the desktop uses its own picker) */
export const OCR_ACCEPT = '.pdf,application/pdf,image/jpeg,image/png,image/tiff,image/bmp,image/gif,image/webp,.jpg,.jpeg,.png,.tif,.tiff,.bmp,.gif,.webp';
