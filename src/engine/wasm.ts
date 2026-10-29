import type { WrappedPdfiumModule } from '@embedpdf/pdfium';

/** Small helpers around the PDFium WASM heap. */
export class Wasm {
  constructor(private m: WrappedPdfiumModule) {}
  get p() {
    return this.m.pdfium;
  }
  /** Re-read on every access: the view is replaced when WASM memory grows. */
  get heap(): Uint8Array {
    return (this.m.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8;
  }
  malloc(n: number): number {
    const ptr = this.p.wasmExports.malloc(n);
    if (!ptr) throw new Error('wasm malloc failed');
    return ptr;
  }
  free(ptr: number) {
    if (ptr) this.p.wasmExports.free(ptr);
  }
  copyIn(data: Uint8Array): number {
    const ptr = this.malloc(data.byteLength);
    this.heap.set(data, ptr);
    return ptr;
  }
  withScratch<T>(n: number, fn: (ptr: number) => T): T {
    const ptr = this.malloc(n);
    this.heap.fill(0, ptr, ptr + n);
    try {
      return fn(ptr);
    } finally {
      this.free(ptr);
    }
  }
  f32(ptr: number) {
    return this.p.getValue(ptr, 'float') as number;
  }
  i32(ptr: number) {
    return this.p.getValue(ptr, 'i32') as number;
  }
}

/** Null-terminated UTF-16LE copy of `s` on the heap (free it after use). */
export function wideString(w: Wasm, s: string): number {
  const ptr = w.malloc((s.length + 1) * 2);
  for (let i = 0; i < s.length; i++) w.p.setValue(ptr + i * 2, s.charCodeAt(i), 'i16');
  w.p.setValue(ptr + s.length * 2, 0, 'i16');
  return ptr;
}
