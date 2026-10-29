import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { FontCharset, type FontFallbackConfig } from '@embedpdf/engines';

/**
 * Self-hosted PDFium WASM (EmbedPDF's default is a CDN URL). Absolute, because
 * EmbedPDF's worker runs from a blob: URL where relative paths don't resolve.
 */
export const PDFIUM_WASM_URL = new URL(wasmUrl, window.location.href).href;

const fontBase = new URL(`${import.meta.env.BASE_URL}fonts/`, window.location.href).href;

/** Font embedded into FreeText appearances on export (OFL, Noto Sans subset, renamed). */
export const VN_FONT_URL = `${fontBase}ezSansVN-Regular.ttf`;

/**
 * Fallback fonts PDFium may request while rendering PDFs whose fonts are not
 * embedded. Local only: EmbedPDF's default config fetches from jsDelivr,
 * which would make the app reach the network for a local document.
 * CJK/Arabic/Hebrew packs are not bundled in this milestone.
 */
export const FONT_FALLBACK: FontFallbackConfig = {
  baseUrl: fontBase,
  fonts: {
    [FontCharset.ANSI]: 'ezSansVN-Regular.ttf',
    [FontCharset.VIETNAMESE]: 'ezSansVN-Regular.ttf',
  },
  defaultFont: 'ezSansVN-Regular.ttf',
};
