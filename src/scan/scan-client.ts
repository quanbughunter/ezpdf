import type { ScanRequest, ScanResponse } from './scan.worker';
import type { Quad } from './geometry';
import type { Img } from './process';

/**
 * Photos are decoded here, on the page, by the same decoder as the <img> the
 * user drags the corners on: EXIF orientation is applied the same way and
 * Safari's own formats (HEIC) open. The worker gets the pixels, already
 * scaled down. Decoding in the worker with createImageBitmap did not hold on
 * iPhone: Safari ignores its resize options there, so a 24-megapixel photo
 * went to the sheet finder at full size (very slow), and it does not turn
 * the picture by its EXIF orientation as the <img> does.
 */

/**
 * Long side of the picture the sheet is looked for in (enough to see the
 * faint shadow of a page lying on another), and of the one the page is cut from.
 */
const DETECT_SIZE = 512;
const PROCESS_SIZE = 3200;

/** Decoded photo; `release` frees its address once its pixels are taken (Safari may re-read it until then). */
async function loadPhoto(file: Blob) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('trình duyệt không đọc được định dạng ảnh này');
  }
  if (!img.naturalWidth || !img.naturalHeight) {
    URL.revokeObjectURL(url);
    throw new Error('ảnh trống');
  }
  return { img, release: () => URL.revokeObjectURL(url) };
}

/** Pixels of the photo at most `maxSide` on the long side, plus its full size as shown. */
async function photoPixels(file: Blob, maxSide: number) {
  const { img, release } = await loadPhoto(file);
  try {
    return { img: pixels(img, maxSide), width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    release();
  }
}

/**
 * The photo at most `maxSide` pixels on its long side. Scaled in halving
 * steps: one big step from 24 megapixels to 500 pixels would skip most of the
 * picture and alias. Every canvas is released at once (iOS limits their total).
 */
function pixels(img: HTMLImageElement, maxSide: number): Img {
  const fullW = img.naturalWidth;
  const fullH = img.naturalHeight;
  const s = Math.min(1, maxSide / Math.max(fullW, fullH));
  const tw = Math.max(1, Math.round(fullW * s));
  const th = Math.max(1, Math.round(fullH * s));
  const used: HTMLCanvasElement[] = [];
  const canvas = (w: number, h: number) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    used.push(c);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    return { c, g };
  };
  try {
    let src: CanvasImageSource = img;
    let w = fullW;
    let h = fullH;
    while (w / 2 >= tw && h / 2 >= th) {
      const half = canvas(Math.round(w / 2), Math.round(h / 2));
      half.g.drawImage(src, 0, 0, half.c.width, half.c.height);
      src = half.c;
      w = half.c.width;
      h = half.c.height;
    }
    const out = canvas(tw, th);
    out.g.drawImage(src, 0, 0, tw, th);
    const d = out.g.getImageData(0, 0, tw, th);
    return { width: d.width, height: d.height, data: d.data as Uint8ClampedArray<ArrayBuffer> };
  } finally {
    for (const c of used) {
      c.width = 0;
      c.height = 0;
    }
  }
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: ScanResponse & { ok: true }) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./scan.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<ScanResponse>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data);
    else p.reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'scan worker crashed'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

type Payload<R> = R extends unknown ? Omit<R, 'id'> : never;

/** Sends the pixels over without copying them (the buffer moves to the worker). */
function call<T>(msg: Payload<ScanRequest>): Promise<T> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: ScanResponse & { ok: true }) => void, reject });
    getWorker().postMessage({ ...msg, id }, [msg.img.data.buffer]);
  });
}

/** Size of the photo as shown (EXIF orientation applied) and the sheet's corners, 0–1. */
export async function detectSheetIn(file: Blob) {
  const photo = await photoPixels(file, DETECT_SIZE);
  const r = await call<{ quad: Quad; found: boolean }>({ kind: 'detect', img: photo.img });
  return { width: photo.width, height: photo.height, quad: r.quad, found: r.found };
}

/** The flat page as a JPEG. `quad` is 0–1 in the photo as shown. */
export async function processPage(file: Blob, quad: Quad, rotation: number, enhance: boolean) {
  const photo = await photoPixels(file, PROCESS_SIZE);
  return call<{ jpeg: Blob; width: number; height: number; a4: boolean; ms: number }>({
    kind: 'process',
    img: photo.img,
    quad,
    rotation,
    enhance,
  });
}
