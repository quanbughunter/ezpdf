/**
 * Scan filters on photographed pages (tests/fixtures/scan-filter, made by
 * scripts/make_scan_filter_fixtures.py): every case goes through every
 * filter exactly as the scan worker runs it; the pages are written for
 * scripts/verify_scan_filters.py, which compares them with the document.
 *
 *   tsx tests/scan-filter-test.ts [fixture dir] [out dir]
 *
 * Python (Pillow) decodes the JPEGs; nothing else here needs it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Img } from '../src/scan/process';
import { blackWhite, brighten, clean, gray, type CleanStats } from '../src/scan/filters';

const dir = process.argv[2] ?? 'tests/fixtures/scan-filter';
const out = process.argv[3] ?? 'out/scan-filter';
mkdirSync(out, { recursive: true });

function decode(file: string): Img {
  const raw = join(out, '_in.rgba');
  const size = execFileSync('python3', [
    '-c',
    'import sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]).convert("RGBA")\nopen(sys.argv[2], "wb").write(im.tobytes())\nprint(im.width, im.height)',
    file,
    raw,
  ])
    .toString()
    .trim()
    .split(' ')
    .map(Number);
  const buf = readFileSync(raw);
  return { width: size[0], height: size[1], data: new Uint8ClampedArray(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)) as Uint8ClampedArray<ArrayBuffer> };
}

const cases = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8')) as { cases: { name: string; file: string; note: string }[] };
const filters: Record<string, (img: Img) => Img> = { brighten, clean, gray, bw: blackWhite };
const results: unknown[] = [];
for (const c of cases.cases) {
  const img = decode(join(dir, c.file));
  const row: Record<string, unknown> = { name: c.name, note: c.note, width: img.width, height: img.height, filters: {} };
  writeFileSync(join(out, `${c.name}-original.rgba`), img.data);
  (row.filters as Record<string, unknown>).original = { file: `${c.name}-original.rgba`, ms: 0 };
  for (const [name, f] of Object.entries(filters)) {
    let stats: CleanStats | undefined;
    const t0 = performance.now();
    const r = name === 'clean' ? clean(img, (s) => (stats = s)) : f(img);
    const ms = Math.round(performance.now() - t0);
    writeFileSync(join(out, `${c.name}-${name}.rgba`), r.data);
    (row.filters as Record<string, unknown>)[name] = { file: `${c.name}-${name}.rgba`, ms, stats };
  }
  results.push(row);
  console.log(`${c.name}: ${Object.entries(row.filters as Record<string, { ms: number }>).map(([k, v]) => `${k} ${v.ms} ms`).join(', ')}`);
}
writeFileSync(join(out, 'expected.json'), JSON.stringify({ fixtures: dir, cases: results }, null, 1));
