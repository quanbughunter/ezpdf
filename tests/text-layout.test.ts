/** Unit checks for the shared FreeText layout (run: npx tsx tests/text-layout.test.ts). */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { readFontMetrics, textWidth } from '../src/engine/font-metrics';
import { layoutFreeText, wrapText, normalizeFreeText } from '../src/engine/text-layout';
import { resizeKeepingTop, type Box } from '../src/engine/geometry';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const m = readFontMetrics(new Uint8Array(readFileSync(join(root, 'public/fonts/ezSansVN-Regular.ttf'))));
const w = (s: string, size = 14) => textWidth(m, s, size);
let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('ok ', name);
};

t('metrics match the browser (Chromium measureText, 14px)', () => {
  assert.equal(w('Xin chào! Tiếng Việt: ắ ằ ẳ ẵ ặ ơ ư đ — Nguyễn').toFixed(1), '300.1');
  assert.equal(w(' ').toFixed(2), '3.64');
});

t('fits on one line when wide enough', () => {
  assert.deepEqual(wrapText(m, 'Một dòng ngắn', 14, 500), ['Một dòng ngắn']);
});

t('breaks at spaces, drops the space at the break', () => {
  const lines = wrapText(m, 'aaaa bbbb cccc', 14, w('aaaa bbbb'));
  assert.deepEqual(lines, ['aaaa bbbb', 'cccc']);
});

t('keeps runs of spaces inside a line (pre-wrap)', () => {
  assert.deepEqual(wrapText(m, 'a   b', 14, 500), ['a   b']);
});

t('keeps leading spaces of a paragraph', () => {
  assert.deepEqual(wrapText(m, '  thụt đầu dòng', 14, 500), ['  thụt đầu dòng']);
});

t('newlines and empty paragraphs', () => {
  assert.deepEqual(wrapText(m, 'một\n\nhai', 14, 500), ['một', '', 'hai']);
});

t('word wider than the box is split by characters', () => {
  const word = 'https://example.com/mot-duong-dan-rat-dai-khong-co-khoang-trang';
  const max = 120;
  const lines = wrapText(m, word, 14, max);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(''), word);
  for (const l of lines) assert.ok(w(l) <= max + 0.05, l);
});

t('NFD input (macOS) becomes NFC; tabs become 4 spaces', () => {
  const nfd = 'Tiếng Việt'.normalize('NFD');
  assert.notEqual(nfd, 'Tiếng Việt');
  assert.equal(normalizeFreeText(nfd), 'Tiếng Việt');
  assert.equal(normalizeFreeText('a\tb'), 'a    b');
});

t('layout: baselines, alignment, content height', () => {
  const base = { text: 'Hai\ndòng', fontSize: 10, align: 0, valign: 0, width: 200, height: 50, borderWidth: 0 };
  const L = layoutFreeText(m, base);
  assert.equal(L.lines.length, 2);
  assert.ok(Math.abs(L.lineHeight - 11.8) < 1e-9);
  // first baseline = half-leading + ascent = (11.8 - 13.62)/2 + 10.69
  assert.ok(Math.abs(L.lines[0].baselineFromTop - 9.78) < 1e-9);
  assert.ok(Math.abs(L.lines[1].baselineFromTop - L.lines[0].baselineFromTop - 11.8) < 1e-9);
  assert.ok(Math.abs(L.contentHeight - 23.6) < 1e-9);
  const R = layoutFreeText(m, { ...base, align: 2 });
  assert.ok(Math.abs(R.lines[0].x + R.lines[0].width - 200) < 1e-9);
  const C = layoutFreeText(m, { ...base, align: 1, valign: 1 });
  assert.ok(Math.abs(C.lines[0].x * 2 + C.lines[0].width - 200) < 1e-9);
  assert.ok(Math.abs(C.lines[0].baselineFromTop - (50 - 23.6) / 2 - 9.78) < 1e-9);
});

const corner = (b: Box, deg: number) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const cx = b.origin.x + b.size.width / 2, cy = b.origin.y + b.size.height / 2;
  const vx = -b.size.width / 2, vy = -b.size.height / 2;
  return [cx + vx * c - vy * s, cy + vx * s + vy * c];
};
for (const deg of [0, 90, 180, 270, 30]) {
  t(`grow keeps the visual top-left corner fixed (rotation ${deg}°)`, () => {
    const box: Box = { origin: { x: 100, y: 200 }, size: { width: 160, height: 22 } };
    const { local, rect } = resizeKeepingTop(box, deg, 80);
    assert.equal(local.size.height, 80);
    assert.equal(local.size.width, 160);
    const [a, b] = [corner(box, deg), corner(local, deg)];
    assert.ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9, `${a} vs ${b}`);
    const cx = local.origin.x + 80, cy = local.origin.y + 40;
    assert.ok(Math.abs(rect.origin.x + rect.size.width / 2 - cx) < 1e-9 && Math.abs(rect.origin.y + rect.size.height / 2 - cy) < 1e-9);
    if (deg === 0) assert.deepEqual(rect, local);
    if (deg === 90) assert.ok(Math.abs(rect.size.width - 80) < 1e-9 && Math.abs(rect.size.height - 160) < 1e-9);
  });
}

console.log(`\n${n} layout checks passed`);
