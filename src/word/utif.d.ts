/** UTIF.js ships no types; what ezPDF uses of it (src/word/tiff.ts). */
declare module 'utif' {
  type Page = Record<string, number[]> & { width?: number; height?: number; data?: Uint8Array };
  /** decodes one strip or tile: (page, pages, file, offset, length, compression, target, target offset, fill order) */
  type Decompress = (this: unknown, img: never, ifds: unknown, data: Uint8Array, off: number, len: number, cmpr: number, tgt: Uint8Array, toff: number, fo: number) => void;
  const UTIF: {
    decode: ((buffer: ArrayBuffer) => Page[]) & { _decompress: Decompress; _addNtimes: (this: unknown, arr: unknown[], n: number, val: number) => void };
    decodeImage(buffer: ArrayBuffer, page: Page, pages: Page[]): void;
    toRGBA8(page: Page): Uint8Array;
    /** the JPEG decoder UTIF builds for JPEG-compressed TIFFs (pdf.js's, minified); `B`: its colour transform switch */
    JpegDecoder: { new (): { B: number; parse(this: unknown, data: Uint8Array, again?: unknown): void } };
  };
  export default UTIF;
}
