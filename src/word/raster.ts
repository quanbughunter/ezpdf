/**
 * Pictures that must be decoded pixel by pixel to be shown: TIFF, and the
 * TIFF or EPSI preview of an EPS. They become PNG, at most `maxSide` pixels
 * on the long side. In the app this runs in a worker (raster.worker.ts,
 * app/word/raster-client.ts), so a slow or crafted picture cannot freeze the
 * screen; in the tests it runs directly.
 */
import { dosEpsPreview, encodePng, epsiBitmap, shrink, sniffImage, type Bitmap } from './images';
import { decodeTiff } from './tiff';

export function rasterize(bytes: Uint8Array, maxSide: number): Uint8Array | null {
  const kind = sniffImage(bytes);
  let bm: Bitmap | null = null;
  if (kind === 'tiff') bm = decodeTiff(bytes);
  else if (kind === 'eps') {
    const dos = dosEpsPreview(bytes);
    if (dos?.kind === 'tiff') bm = decodeTiff(dos.bytes);
    else if (!dos) bm = epsiBitmap(bytes);
  }
  return bm ? encodePng(shrink(bm, maxSide)) : null;
}
