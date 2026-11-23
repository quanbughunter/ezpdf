/// <reference lib="webworker" />
/**
 * Scanning work off the UI thread: find the sheet, then cut it out (warp),
 * run the chosen filter (filters.ts) and encode the page as JPEG. The photo
 * arrives already decoded and scaled down by the page (scan-client.ts),
 * exactly as the <img> on screen shows it. Photos never leave the device.
 *
 * The last few cut pages are kept here by their key (page and corners), so
 * trying another filter or turning the page does not decode the photo again:
 * a request without the photo is answered from them, or with MISS.
 */
import { detectSheet } from './detect';
import { blackWhite, clean, gray, MISS, type ScanFilter } from './filters';
import { orderQuad, outputSize, sheetAspect, type Quad } from './geometry';
import { brighten, rotate, warp, type Img } from './process';

export type ScanRequest =
  | { id: number; kind: 'detect'; img: Img }
  | { id: number; kind: 'process'; key: string; img: Img | null; quad: Quad; rotation: number; filter: ScanFilter; maxSide?: number };

export type ScanResponse =
  | { id: number; ok: true; kind: 'detect'; quad: Quad; found: boolean }
  | { id: number; ok: true; kind: 'process'; jpeg: Blob; width: number; height: number; a4: boolean; ms: number }
  | { id: number; ok: false; error: string };


const KEEP = 3;
const cut = new Map<string, { page: Img; a4: boolean }>();

function filtered(page: Img, filter: ScanFilter): Img {
  switch (filter) {
    case 'original':
      return page;
    case 'brighten':
      return brighten(page);
    case 'clean':
      return clean(page);
    case 'gray':
      return gray(page);
    case 'bw':
      return blackWhite(page);
  }
}

const post = (m: ScanResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = async (e: MessageEvent<ScanRequest>) => {
  const req = e.data;
  try {
    if (req.kind === 'detect') {
      const img = req.img;
      const det = detectSheet(img.data, img.width, img.height);
      // normalised to the photo: 0–1 on each axis
      const quad = det.quad.map((p) => ({ x: p.x / img.width, y: p.y / img.height })) as Quad;
      return post({ id: req.id, ok: true, kind: 'detect', quad, found: det.found });
    }
    const t0 = performance.now();
    let kept = cut.get(req.key);
    if (!kept) {
      const img = req.img;
      if (!img) return post({ id: req.id, ok: false, error: MISS });
      const quad = orderQuad(req.quad.map((p) => ({ x: p.x * img.width, y: p.y * img.height }))) as Quad;
      const aspect = sheetAspect(quad, img.width, img.height);
      const size = outputSize(quad, aspect, req.maxSide ?? 2400);
      kept = { page: warp(img, quad, size.width, size.height), a4: size.a4 };
    }
    // most recently used last; the oldest go
    cut.delete(req.key);
    cut.set(req.key, kept);
    while (cut.size > KEEP) cut.delete(cut.keys().next().value!);
    const page = rotate(filtered(kept.page, req.filter), req.rotation);
    const c = new OffscreenCanvas(page.width, page.height);
    c.getContext('2d')!.putImageData(new ImageData(page.data, page.width, page.height), 0, 0);
    const jpeg = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    post({ id: req.id, ok: true, kind: 'process', jpeg, width: page.width, height: page.height, a4: kept.a4, ms: performance.now() - t0 });
  } catch (err) {
    post({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
