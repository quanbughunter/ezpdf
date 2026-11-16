/**
 * Resolutions OCR draws a page at (pure; the app and the Node tests).
 */

/** to read it: twice the scan's resolution, within 200–300 (no scan: 250), at most about 16 million pixels */
export function ocrDpi(scanDpi: number, size: { w: number; h: number }): number {
  let dpi = scanDpi >= 200 ? Math.min(scanDpi, 300) : scanDpi > 0 ? Math.min(300, Math.max(200, scanDpi * 2)) : 250;
  const px = ((size.w / 72) * dpi) * ((size.h / 72) * dpi);
  if (px > 16e6) dpi = Math.floor(dpi * Math.sqrt(16e6 / px));
  return Math.max(100, Math.round(dpi));
}

/**
 * For the editable PDF's picture: the scan's own resolution (its pixels as
 * they are, the file no bigger than it needs), within 100–300; no scan:
 * 200. At most about 16 million pixels.
 */
export function editableDpi(scanDpi: number, size: { w: number; h: number }): number {
  let dpi = scanDpi > 0 ? Math.min(300, Math.max(100, scanDpi)) : 200;
  const px = ((size.w / 72) * dpi) * ((size.h / 72) * dpi);
  if (px > 16e6) dpi = Math.floor(dpi * Math.sqrt(16e6 / px));
  return Math.max(72, Math.round(dpi));
}
