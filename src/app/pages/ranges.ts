/**
 * Page numbers as people write them, for splitting a document into files:
 * "1-3, 4-6, 7-" (a part per range; "7-" runs to the last page), or every
 * n pages. Numbers are 1-based here, as on screen.
 */

export interface Part {
  /** 1-based, inclusive */
  from: number;
  to: number;
}

export type RangeResult = { ok: true; parts: Part[] } | { ok: false; error: string };

/** "1-3, 5, 7-" → parts. Each part must lie within 1…total; parts may not overlap. */
export function parseRanges(text: string, total: number): RangeResult {
  const items = text
    .replace(/\s*[-–]\s*/g, '-') // "1 - 3" is one range
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!items.length) return { ok: false, error: 'Hãy ghi các khoảng trang, ví dụ 1-3, 4-6, 7-.' };
  const parts: Part[] = [];
  for (const item of items) {
    const m = /^(\d+)?\s*[-–]\s*(\d+)?$|^(\d+)$/.exec(item);
    if (!m) return { ok: false, error: `“${item}” không phải số trang hay khoảng trang.` };
    const from = m[3] ? +m[3] : m[1] ? +m[1] : 1;
    const to = m[3] ? +m[3] : m[2] ? +m[2] : total;
    if (from < 1 || to > total || from > to)
      return { ok: false, error: `Khoảng “${item}” nằm ngoài tài liệu (trang 1–${total}).` };
    parts.push({ from, to });
  }
  const sorted = [...parts].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].from <= sorted[i - 1].to) return { ok: false, error: 'Các khoảng trang đang chồng lên nhau.' };
  return { ok: true, parts };
}

/** Every `n` pages a file; the last one takes what is left. */
export function everyN(n: number, total: number): Part[] {
  const size = Math.max(1, Math.floor(n));
  const parts: Part[] = [];
  for (let from = 1; from <= total; from += size) parts.push({ from, to: Math.min(total, from + size - 1) });
  return parts;
}

/** "trang 3", "trang 1–4", for names and lists. */
export const partLabel = (p: Part) => (p.from === p.to ? `trang ${p.from}` : `trang ${p.from}–${p.to}`);

/** Page numbers (1-based) as a short label: "trang 2", "trang 1, 3, 5", "trang 4–7", "8 trang". */
export function pagesLabel(nums: number[]): string {
  if (!nums.length) return '';
  const sorted = [...nums].sort((a, b) => a - b);
  const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  if (sorted.length === 1) return `trang ${sorted[0]}`;
  if (contiguous && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)) return `trang ${sorted[0]}–${sorted[sorted.length - 1]}`;
  if (nums.length <= 4) return `trang ${nums.join(', ')}`;
  return `${nums.length} trang`;
}

/** A file name from the document's name and a label: "Hop dong (trang 1–3).pdf". */
export function partFileName(base: string, label: string) {
  const clean = label.replace(/–/g, '-');
  return `${base} (${clean}).pdf`;
}
