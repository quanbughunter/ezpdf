/**
 * Xuất thành ảnh (0.8.7), the parts that run without a browser:
 *  - tiff-write.ts: ezPDF's own TIFF writer (LZW with the horizontal
 *    predictor), read back by Pillow (libtiff) and tifffile (imagecodecs'
 *    own LZW), pixel for pixel: photographs, text, grey, a 1×1 page, a
 *    blank A4 at 300 dpi, four pages in one file, and 400 strips whose
 *    lengths fall on every code-width and table-full boundary of LZW
 *  - image-meta.ts: the dpi written into PNG (pHYs, CRC right, an old pHYs
 *    replaced, other chunks kept) and JPEG (JFIF density, or a JFIF segment
 *    added before an EXIF one)
 *  - to-images.ts: resolutions capped for huge sheets, file names that sort
 *    and that every system accepts, the multi-page TIFF's name
 * Needs python3 with Pillow, numpy and tifffile (imagecodecs).
 *
 * Usage: npm run test:images
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { tiffFile, tiffPage, LzwEncoder } from '../src/engine/tiff-write';
import { crc32, jpegWithDpi, pngWithDpi } from '../src/engine/image-meta';
import { dpiFor, pageFileName, pixelSize, safeBase, tiffName } from '../src/app/to-images/plan';

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const dir = mkdtempSync(path.join(tmpdir(), 'ezpdf-images-'));
const py = (code: string, ...args: string[]) => execFileSync('python3', ['-c', code, ...args], { encoding: 'utf8' }).trim();

// ── TIFF ────────────────────────────────────────────────────────────────────
let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 16) & 0xff;
function picture(w: number, h: number, kind: 'noise' | 'text' | 'grad' | 'white') {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = 255, g = 255, b = 255;
      if (kind === 'noise') [r, g, b] = [rnd(), rnd(), rnd()];
      else if (kind === 'text' && (x * 7 + y * 3) % 23 < 3 && y % 40 < 30) r = g = b = 20;
      else if (kind === 'grad') [r, g, b] = [(x * 255) / w, (y * 255) / h, (x + y) & 0xff].map((v) => v | 0);
      px.set([r, g, b, 255], i);
    }
  return px;
}
const cases: [string, number, number, 'noise' | 'text' | 'grad' | 'white', boolean][] = [
  ['noise', 333, 211, 'noise', false],
  ['text', 1240, 1754, 'text', false],
  ['grad', 640, 480, 'grad', false],
  ['graynoise', 257, 199, 'noise', true],
  ['tiny', 1, 1, 'grad', false],
  ['white', 2480, 3508, 'white', false],
];
const pages = [];
for (const [name, w, h, kind, gray] of cases) {
  const px = picture(w, h, kind);
  const p = tiffPage(px, w, h, { gray, dpi: 150 });
  writeFileSync(path.join(dir, `${name}.tif`), tiffFile([p]));
  writeFileSync(path.join(dir, `${name}.rgba`), px);
  if (name !== 'white') pages.push(p);
}
writeFileSync(path.join(dir, 'multi.tif'), tiffFile(pages, 'ezPDF test'));
writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(cases));
const READ = `
import json, os, sys, numpy as np, tifffile
from PIL import Image
d = sys.argv[1]
cases = json.load(open(os.path.join(d, 'cases.json')))
def expect(name, w, h, gray):
    raw = np.fromfile(os.path.join(d, name + '.rgba'), np.uint8).reshape(h, w, 4)[..., :3].astype(int)
    return (raw[..., 0] * 299 + raw[..., 1] * 587 + raw[..., 2] * 114 + 500) // 1000 if gray else raw
out = {}
for name, w, h, kind, gray in cases:
    f = os.path.join(d, name + '.tif')
    e = expect(name, w, h, gray)
    im = Image.open(f); im.load()
    t = tifffile.TiffFile(f); p = t.pages[0]
    out[name] = {'pillow': bool(np.array_equal(np.asarray(im).astype(int), e)), 'tifffile': bool(np.array_equal(p.asarray().astype(int), e)),
                 'dpi': [float(v) for v in im.info.get('dpi', (0, 0))], 'comp': p.compression.name, 'pred': p.predictor.name, 'size': os.path.getsize(f)}
f = os.path.join(d, 'multi.tif')
t = tifffile.TiffFile(f); im = Image.open(f)
same = []
for i, (name, w, h, kind, gray) in enumerate([c for c in cases if c[0] != 'white']):
    im.seek(i)
    e = expect(name, w, h, gray)
    same.append(bool(np.array_equal(t.pages[i].asarray().astype(int), e) and np.array_equal(np.asarray(im).astype(int), e)))
out['multi'] = {'pages': len(t.pages), 'frames': im.n_frames, 'same': same, 'software': t.pages[0].tags['Software'].value, 'pageno': list(t.pages[2].tags['PageNumber'].value)}
print(json.dumps(out))
`;
const r = JSON.parse(py(READ, dir));
const single = cases.map(([n]) => r[n]);
check(
  'TIFF pages read back pixel for pixel by Pillow (libtiff) and tifffile: noise, text, gradient, grey, 1×1, blank A4 at 300 dpi',
  single.every((x) => x.pillow && x.tifffile && x.comp === 'LZW' && x.pred === 'HORIZONTAL' && x.dpi[0] === 150),
  cases.map(([n]) => `${n} ${r[n].size} B`).join(', '),
);
check('a blank A4 page at 300 dpi stays small (LZW): under 250 KB', r.white.size < 250_000, `${r.white.size} B`);
check(
  'five pages in one TIFF: five IFDs, each page intact, PageNumber and Software written',
  r.multi.pages === 5 && r.multi.frames === 5 && r.multi.same.every(Boolean) && r.multi.software === 'ezPDF test' && r.multi.pageno.join() === '2,5',
  JSON.stringify(r.multi),
);

// LZW across every boundary: strips whose lengths end on 511/1023/2047 codes and the table-full clear
let s2 = 99;
const rnd2 = (n: number) => (s2 = (Math.imul(s2, 1664525) + 1013904223) >>> 0) % n;
const fuzz: [number, number][] = [];
for (let k = 0; k < 400; k++) {
  const w = k < 200 ? 200 + rnd2(9000) : [509, 510, 511, 512, 513, 1021, 1022, 1023, 1024, 2045, 2046, 2047, 2048, 4092, 4093, 4094, 4095, 8190][k % 18] + rnd2(3);
  const alpha = [2, 3, 7, 50, 256][rnd2(5)];
  const px = new Uint8Array(w * 4);
  for (let x = 0; x < w; x++) {
    const v = (rnd2(alpha) * Math.floor(255 / Math.max(1, alpha - 1))) & 0xff;
    px.set([v, v, v, 255], x * 4);
  }
  writeFileSync(path.join(dir, `f${k}.tif`), tiffFile([tiffPage(px, w, 1, { gray: true, dpi: 72 })]));
  writeFileSync(path.join(dir, `f${k}.raw`), px);
  fuzz.push([k, w]);
}
writeFileSync(path.join(dir, 'fuzz.json'), JSON.stringify(fuzz));
const bad = py(
  `
import json, os, sys, numpy as np, tifffile
from PIL import Image
d = sys.argv[1]; bad = []
for k, w in json.load(open(os.path.join(d, 'fuzz.json'))):
    e = np.fromfile(os.path.join(d, f'f{k}.raw'), np.uint8).reshape(1, w, 4)[..., 0].astype(int)
    try:
        im = Image.open(os.path.join(d, f'f{k}.tif')); im.load()
        if not (np.array_equal(np.asarray(im).astype(int), e) and np.array_equal(tifffile.imread(os.path.join(d, f'f{k}.tif')).astype(int).reshape(1, w), e)): bad.append(k)
    except Exception as ex:
        bad.append(f'{k}:{ex}')
print(json.dumps(bad))
`,
  dir,
);
check('LZW: 400 strips ending on every code-width and table-full boundary read back exactly by both readers', bad === '[]', bad);

// the encoder is reused: a clear between strips leaves nothing of the last one
const lzw = new LzwEncoder();
const a1 = lzw.encode(new Uint8Array(5000).map((_, i) => i & 0x3f));
const a2 = lzw.encode(new Uint8Array([1, 2, 3]));
const a3 = new LzwEncoder().encode(new Uint8Array([1, 2, 3]));
check('one LZW encoder for many strips gives the same bytes as a new one (its table is cleared)', a1.length > 0 && a2.join() === a3.join(), `${a2.join()} / ${a3.join()}`);

// ── dpi in PNG and JPEG ────────────────────────────────────────────────────
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const p96 = pngWithDpi(new Uint8Array(png), 96);
const p300 = pngWithDpi(p96, 300);
writeFileSync(path.join(dir, 'p96.png'), p96);
writeFileSync(path.join(dir, 'p300.png'), p300);
const phys = (b: Uint8Array) => {
  const out: string[] = [];
  for (let at = 8; at + 12 <= b.length; ) {
    const dv = new DataView(b.buffer, b.byteOffset + at);
    const len = dv.getUint32(0);
    out.push(String.fromCharCode(...b.subarray(at + 4, at + 8)));
    at += 12 + len;
  }
  return out.join(',');
};
const pngRead = JSON.parse(py(`
import json, sys
from PIL import Image
out = []
for f in sys.argv[1:]:
    im = Image.open(f); im.load(); out.append([round(im.info['dpi'][0], 1), im.size])
print(json.dumps(out))`, path.join(dir, 'p96.png'), path.join(dir, 'p300.png')));
check(
  'PNG: pHYs written after IHDR with a right CRC, an earlier one replaced, the picture unchanged (Pillow reads 96 then 300 dpi)',
  phys(p96) === 'IHDR,pHYs,IDAT,IEND' && phys(p300) === 'IHDR,pHYs,IDAT,IEND' && pngRead[0][0] === 96 && pngRead[1][0] === 300 && crc32(new TextEncoder().encode('IEND')) === 0xae426082,
  `${phys(p300)} · ${JSON.stringify(pngRead)}`,
);
const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const j1 = jpegWithDpi(jfif, 150);
const exifFirst = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 0, 0, 0xff, 0xd9]);
const j2 = jpegWithDpi(exifFirst, 300);
check(
  'JPEG: the JFIF density set to dots per inch; a JFIF segment put first when the encoder wrote only EXIF',
  j1.length === jfif.length && j1[13] === 1 && ((j1[14] << 8) | j1[15]) === 150 && ((j1[16] << 8) | j1[17]) === 150 &&
    j2[2] === 0xff && j2[3] === 0xe0 && ((j2[14] << 8) | j2[15]) === 300 && j2[20] === 0xff && j2[21] === 0xe1,
  `${[...j1.subarray(11, 18)].join(' ')} · ${[...j2.subarray(0, 22)].map((x) => x.toString(16)).join(' ')}`,
);
check('not a PNG or not a JPEG: handed back untouched', pngWithDpi(jfif, 96) === jfif && jpegWithDpi(new Uint8Array(png), 96).length === png.length);

// ── sizes and names ────────────────────────────────────────────────────────
const a4 = { w: 595.28, h: 841.89 };
const a0 = { w: 2383.94, h: 3370.39 };
const px600 = pixelSize(a4, dpiFor(a4, 600));
check(
  'A4 at 600 dpi kept (≈ 35 Mpx); an A0 sheet at 600 dpi lowered to fit 36 Mpx',
  dpiFor(a4, 600) === 600 && px600.w === 4961 && px600.h === 7016 && dpiFor(a0, 600) < 160 && pixelSize(a0, dpiFor(a0, 600)).w * pixelSize(a0, dpiFor(a0, 600)).h <= 36e6,
  `A4 ${px600.w}×${px600.h}; A0 ${dpiFor(a0, 600)} dpi`,
);
check(
  'file names sort in page order and every system accepts them',
  pageFileName('Đề khảo sát', 3, 12, 'png') === 'Đề khảo sát - trang 03.png' &&
    pageFileName('a', 7, 9, 'jpg') === 'a - trang 7.jpg' &&
    safeBase('../hồ sơ: "mới"?*<>|') === '_hồ sơ_ _mới______' &&
    safeBase('   ') === 'tai-lieu' &&
    safeBase('x'.repeat(300)).length === 100,
  `${pageFileName('Đề khảo sát', 3, 12, 'png')} · ${safeBase('../hồ sơ: "mới"?*<>|')}`,
);
check(
  'one TIFF: the document’s name, with the pages when not all of them',
  tiffName('báo cáo', [0, 1, 2, 3], 4) === 'báo cáo.tif' && tiffName('báo cáo', [1, 2], 4) === 'báo cáo - trang 2-3.tif' && tiffName('x', [0, 2, 4], 9) === 'x - trang 1, 3, 5.tif',
  `${tiffName('báo cáo', [1, 2], 4)} · ${tiffName('x', [0, 2, 4], 9)}`,
);

rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} of ${passed + failed} image checks FAILED` : `\n${passed}/${passed} image checks passed`);
process.exit(failed ? 1 : 0);
