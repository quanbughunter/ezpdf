/**
 * Scan engine in a real browser, through the same worker the app uses, on
 * the synthetic photos of tests/fixtures/scan (scripts/make_scan_fixtures.py).
 * Results land in window.__scan for scripts/e2e-scan.cjs.
 */
import { detectSheetIn, processPage } from '../src/scan/scan-client';
import { jpegPagesToPdf, pageSizeFor } from '../src/scan/jpeg-pdf';
import type { Quad } from '../src/scan/geometry';

interface Truth {
  doc: string;
  docSize: [number, number];
  photos: { file: string; quad: [number, number][]; width: number; height: number; note: string }[];
}

const base = '/tests/fixtures/scan/';
const get = async (f: string) => (await fetch(base + f)).blob();

async function pixels(blob: Blob, w?: number, h?: number) {
  const bmp = await createImageBitmap(blob, w ? { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' } : undefined);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, bmp.width, bmp.height);
}

const gray = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** Grey levels blurred by a box of radius r: comparisons that tolerate a few pixels of offset. */
function blurGray(img: ImageData, r: number): Float32Array {
  const w = img.width, h = img.height;
  const g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = gray(img.data, i * 4);
  const t = new Float32Array(g.length), o = new Float32Array(g.length);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x < w + r; x++) {
      if (x + r < w && x + r >= 0) s += g[y * w + x + r];
      if (x - r - 1 >= 0 && x - r - 1 < w) s -= g[y * w + x - r - 1];
      if (x >= 0 && x < w) t[y * w + x] = s / (2 * r + 1);
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y < h + r; y++) {
      if (y + r < h && y + r >= 0) s += t[(y + r) * w + x];
      if (y - r - 1 >= 0 && y - r - 1 < h) s -= t[(y - r - 1) * w + x];
      if (y >= 0 && y < h) o[y * w + x] = s / (2 * r + 1);
    }
  }
  return o;
}

function nccBlur(a: ImageData, b: ImageData, r: number) {
  const A = blurGray(a, r), B = blurGray(b, r);
  let ma = 0, mb = 0;
  for (let i = 0; i < A.length; i++) (ma += A[i]), (mb += B[i]);
  ma /= A.length;
  mb /= B.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < A.length; i++) {
    const x = A[i] - ma, y = B[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db);
}

/** Darkest 3 % of the text block: how dark the writing is, wherever it landed. */
function inkLevel(img: ImageData) {
  const v: number[] = [];
  const x0 = Math.round(img.width * 0.08), x1 = Math.round(img.width * 0.92);
  const y0 = Math.round(img.height * 0.23), y1 = Math.round(img.height * 0.62);
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) v.push(gray(img.data, (y * img.width + x) * 4));
  v.sort((a, b) => a - b);
  return Math.round(v.slice(0, Math.floor(v.length * 0.03)).reduce((s, x) => s + x, 0) / Math.floor(v.length * 0.03));
}

function ncc(a: ImageData, b: ImageData) {
  let sa = 0, sb = 0, n = 0;
  for (let i = 0; i < a.data.length; i += 4) (sa += gray(a.data, i)), (sb += gray(b.data, i)), n++;
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const x = gray(a.data, i) - ma, y = gray(b.data, i) - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db);
}

/** Cells of the document that are blank paper, and the ink / stamp pixels. */
function regions(doc: ImageData, cell: number) {
  const blank: [number, number][] = [];
  for (let y = 0; y + cell <= doc.height; y += cell)
    for (let x = 0; x + cell <= doc.width; x += cell) {
      let white = true;
      for (let yy = y; yy < y + cell && white; yy += 2)
        for (let xx = x; xx < x + cell; xx += 2) if (gray(doc.data, (yy * doc.width + xx) * 4) < 250) (white = false);
      if (white) blank.push([x, y]);
    }
  const ink: number[] = [], red: number[] = [];
  for (let i = 0; i < doc.data.length; i += 4) {
    const r = doc.data[i], g = doc.data[i + 1], b = doc.data[i + 2];
    if (r < 40 && g < 40 && b < 40) ink.push(i);
    else if (r > 180 && g < 60 && b < 60) red.push(i);
  }
  return { blank, ink, red };
}

function measure(img: ImageData, doc: ReturnType<typeof regions>, cell: number) {
  const cellMeans = doc.blank.map(([x, y]) => {
    let s = 0, n = 0;
    for (let yy = y + 4; yy < y + cell - 4; yy += 2)
      for (let xx = x + 4; xx < x + cell - 4; xx += 2) (s += gray(img.data, (yy * img.width + xx) * 4)), n++;
    return s / n;
  });
  cellMeans.sort((a, b) => a - b);
  const p = (q: number) => cellMeans[Math.floor((cellMeans.length - 1) * q)];
  const mean = (idx: number[], f: (i: number) => number) => idx.reduce((s, i) => s + f(i), 0) / idx.length;
  return {
    paper: Math.round(p(0.5)),
    paperSpread: Math.round(p(0.95) - p(0.05)),
    ink: Math.round(mean(doc.ink, (i) => gray(img.data, i))),
    redMinusGreen: Math.round(mean(doc.red, (i) => img.data[i] - img.data[i + 1])),
    blueMinusRed: 0,
  };
}

(async () => {
  const truth: Truth = await (await fetch(base + 'truth.json')).json();
  const [W, H] = truth.docSize;
  const docImg = await pixels(await get(truth.doc));
  const cell = 40;
  const docRegions = regions(docImg, cell);
  const results: unknown[] = [];
  const pages: Parameters<typeof jpegPagesToPdf>[0] = [];
  for (const ph of truth.photos) {
    const file = await get(ph.file);
    const t0 = performance.now();
    const det = await detectSheetIn(file);
    const tDetect = performance.now() - t0;
    const diag = Math.hypot(det.width, det.height);
    const err = Math.max(...det.quad.map((p, i) => Math.hypot((p.x - ph.quad[i][0]) * det.width, (p.y - ph.quad[i][1]) * det.height))) / diag;
    const page = await processPage(file, det.quad, 0, true);
    const plain = await processPage(file, det.quad, 0, false);
    const out = await pixels(page.jpeg, W, H);
    const outPlain = await pixels(plain.jpeg, W, H);
    // the photo's own paper, warped with the true corners and no brightening, for comparison
    const raw = await pixels((await processPage(file, ph.quad.map(([x, y]) => ({ x, y })) as Quad, 0, false)).jpeg, W, H);
    results.push({
      file: ph.file,
      note: ph.note,
      shown: [det.width, det.height],
      found: det.found,
      cornerError: Math.round(err * 1000) / 10, // % of the diagonal
      size: [page.width, page.height],
      a4: page.a4,
      aspect: Math.round((page.height / page.width) * 1000) / 1000,
      ncc: Math.round(nccBlur(out, docImg, 6) * 1000) / 1000,
      inkEnhanced: inkLevel(out),
      inkPlain: inkLevel(outPlain),
      enhanced: measure(out, docRegions, cell),
      plain: measure(outPlain, docRegions, cell),
      photo: measure(raw, docRegions, cell),
      msDetect: Math.round(tDetect),
      msProcess: Math.round(page.ms),
      jpegKB: Math.round(page.jpeg.size / 1024),
    });
    pages.push({ jpeg: new Uint8Array(await page.jpeg.arrayBuffer()), width: page.width, height: page.height, ...pageSizeFor(page.width, page.height, page.a4) });
    ((window as any).__scanImages ??= {})[ph.file] = { enhanced: await blobToB64(page.jpeg), plain: await blobToB64(plain.jpeg) };
  }
  const pdf = jpegPagesToPdf(pages, { title: 'ezPDF scan test', date: new Date(2026, 9, 29, 15, 30) });
  (window as any).__scan = { results, pdf: btoa(Array.from(pdf, (c) => String.fromCharCode(c)).join('')) };
  document.getElementById('out')!.textContent = JSON.stringify(results, null, 1);
})().catch((e) => {
  (window as any).__scan = { error: String(e?.stack ?? e) };
  document.getElementById('out')!.textContent = String(e?.stack ?? e);
});

async function blobToB64(b: Blob) {
  const u = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
