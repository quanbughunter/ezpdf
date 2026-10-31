/// <reference lib="webworker" />
/**
 * TIFF and EPS pictures of a Word file decoded off the UI thread (raster.ts).
 * The page stops this worker when a picture takes too long
 * (app/word/raster-client.ts). Pictures never leave the device.
 */
import { rasterize } from './raster';

export type RasterRequest = { id: number; bytes: Uint8Array; side: number };
export type RasterResponse = { id: number; png: Uint8Array | null };

self.onmessage = (e: MessageEvent<RasterRequest>) => {
  let png: Uint8Array | null = null;
  try {
    png = rasterize(e.data.bytes, e.data.side);
  } catch {
    png = null;
  }
  const res: RasterResponse = { id: e.data.id, png };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, png ? [png.buffer] : []);
};
