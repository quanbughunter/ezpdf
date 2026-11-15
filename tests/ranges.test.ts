/** Unit checks for page ranges used by "Tách tệp" (run: npx tsx tests/ranges.test.ts). */
import assert from 'node:assert/strict';
import { cutsToParts, everyN, pagesLabel, parseCuts, parseRanges, partFileName, partsToCuts } from '../src/app/pages/ranges';

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
const cut = (cuts: number[], total: number) => cutsToParts(cuts, total).map((p) => `${p.from}-${p.to}`).join(',');
t('no cut: one part, the whole document', () => assert.equal(cut([], 5), '1-5'));
t('two cuts make three parts, in page order whatever the order of the cuts', () => assert.equal(cut([7, 3], 12), '1-3,4-7,8-12'));
t('cuts outside 1…total-1 and repeated cuts are ignored', () => assert.equal(cut([0, 3, 3, 12, 15], 12), '1-3,4-12'));
t('a cut after every page', () => assert.equal(cut([1, 2, 3], 4), '1-1,2-2,3-3,4-4'));
t('parts covering every page back to cuts', () => {
  assert.deepEqual(partsToCuts(cutsToParts([3, 7], 12), 12), [3, 7]);
  assert.deepEqual(partsToCuts(everyN(4, 10), 10), [4, 8]);
  assert.deepEqual(partsToCuts([{ from: 1, to: 6 }], 6), []);
});
t('parts that leave a page out are not cuts', () => {
  assert.equal(partsToCuts([{ from: 2, to: 2 }, { from: 4, to: 8 }], 8), null);
  assert.equal(partsToCuts([{ from: 1, to: 3 }, { from: 5, to: 8 }], 8), null);
  assert.equal(partsToCuts([{ from: 1, to: 3 }], 8), null);
});
t('typed cuts', () => {
  const c = parseCuts('7, 3 3;10', 12);
  assert.ok(c.ok && c.cuts.join() === '3,7,10');
  const last = parseCuts('12', 12);
  assert.ok(!last.ok && /chỉ cắt được sau trang 1–11/.test(last.error));
  const word = parseCuts('3, hai', 12);
  assert.ok(!word.ok && /không phải số trang/.test(word.error));
  const empty = parseCuts(' ', 12);
  assert.ok(!empty.ok && /Hãy ghi/.test(empty.error));
});
console.log(`\n${n} range checks passed`);
