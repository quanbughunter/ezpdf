/// <reference lib="webworker" />
/**
 * Scanning work off the UI thread: decode the photo (EXIF orientation
 * applied, as the <img> on screen shows it), find the sheet, then warp,
 * brighten and encode a page as JPEG. Photos never leave the device.
 */
import { detectSheet } from './detect';
import { orderQuad, outputSize, sheetAspect, type Quad } from './geometry';
import { brighten, rotate, warp, type Img } from './process';

export type ScanRequest =
  | { id: number; kind: 'detect'; file: Blob }
  | { id: number; kind: 'process'; file: Blob; quad: Quad; rotation: number; enhance: boolean; maxSide?: number };

export type ScanResponse =
  | { id: number; ok: true; kind: 'detect'; width: number; height: number; quad: Quad; found: boolean }
  | { id: number; ok: true; kind: 'process'; jpeg: Blob; width: number; height: number; a4: boolean; ms: number }
  | { id: number; ok: false; error: string };

/** Largest side the photo is decoded at for the page itself. */
const DECODE_MAX = 3200;
const DETECT_SIZE = 400;

async function decode(file: Blob, maxSide: number): Promise<{ img: Img; fullW: number; fullH: number }> {
  const probe = await createImageBitmap(file);
  const fullW = probe.width, fullH = probe.height;
  const s = Math.min(1, maxSide / Math.max(fullW, fullH));
  let bmp = probe;
  if (s < 1) {
    probe.close();
    bmp = await createImageBitmap(file, { resizeWidth: Math.round(fullW * s), resizeHeight: Math.round(fullH * s), resizeQuality: 'high' });
  }
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const d = g.getImageData(0, 0, c.width, c.height);
  return { img: { width: d.width, height: d.height, data: d.data }, fullW, fullH };
}

const post = (m: ScanResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<ScanRequest>) => {
  const req = e.data;
  try {
    if (req.kind === 'detect') {
      const { img, fullW, fullH } = await decode(req.file, DETECT_SIZE);
      const det = detectSheet(img.data, img.width, img.height);
      // normalised to the photo: 0–1 on each axis
      const quad = det.quad.map((p) => ({ x: p.x / img.width, y: p.y / img.height })) as Quad;
      return post({ id: req.id, ok: true, kind: 'detect', width: fullW, height: fullH, quad, found: det.found });
    }
    const t0 = performance.now();
    const { img } = await decode(req.file, DECODE_MAX);
    const quad = orderQuad(req.quad.map((p) => ({ x: p.x * img.width, y: p.y * img.height }))) as Quad;
    const aspect = sheetAspect(quad, img.width, img.height);
    const size = outputSize(quad, aspect, req.maxSide ?? 2400);
    let page = warp(img, quad, size.width, size.height);
    if (req.enhance) page = brighten(page);
    page = rotate(page, req.rotation);
    const c = new OffscreenCanvas(page.width, page.height);
    c.getContext('2d')!.putImageData(new ImageData(page.data, page.width, page.height), 0, 0);
    const jpeg = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    post({ id: req.id, ok: true, kind: 'process', jpeg, width: page.width, height: page.height, a4: size.a4, ms: performance.now() - t0 });
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
