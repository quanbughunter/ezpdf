/** Unit checks for page ranges used by "Tách tệp" (run: npx tsx tests/ranges.test.ts). */
import assert from 'node:assert/strict';
import { everyN, pagesLabel, parseRanges, partFileName } from '../src/app/pages/ranges';

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('ok ', name);
};
const parts = (text: string, total: number) => {
  const r = parseRanges(text, total);
  return r.ok ? r.parts.map((p) => `${p.from}-${p.to}`).join(',') : `error: ${r.error}`;
};

t('ranges, single pages and an open end', () => assert.equal(parts('1-3, 5, 7-', 9), '1-3,5-5,7-9'));
t('spaces around the dash and an en dash', () => assert.equal(parts('1 - 3; 4 – 6', 6), '1-3,4-6'));
t('an open start runs from page 1', () => assert.equal(parts('-2, 3-', 4), '1-2,3-4'));
t('outside the document is refused', () => assert.match(parts('1-2, 9-', 8), /nằm ngoài/));
t('overlapping ranges are refused', () => assert.match(parts('1-4, 3-5', 8), /chồng/));
t('backwards ranges are refused', () => assert.match(parts('5-2', 8), /nằm ngoài/));
t('words are refused', () => assert.match(parts('một', 8), /không phải/));
t('empty input asks for ranges', () => assert.match(parts('  ', 8), /Hãy ghi/));
t('every n pages, the last part takes the rest', () => assert.deepEqual(everyN(3, 8).map((p) => `${p.from}-${p.to}`), ['1-3', '4-6', '7-8']));
t('labels', () => {
  assert.equal(pagesLabel([3]), 'trang 3');
  assert.equal(pagesLabel([2, 3, 4]), 'trang 2–4');
  assert.equal(pagesLabel([1, 3, 5]), 'trang 1, 3, 5');
  assert.equal(pagesLabel([1, 3, 5, 7, 9]), '5 trang');
  assert.equal(partFileName('Hop dong', 'trang 1–3'), 'Hop dong (trang 1-3).pdf');
});
console.log(`\n${n} range checks passed`);
