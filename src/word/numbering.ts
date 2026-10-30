/**
 * Lists: numbering.xml maps a paragraph's numId + level to a format
 * ("%1.", "a)", a bullet) and an indent. The numbers themselves are not in
 * the file; Word counts them, and so does ezPDF (markers()), again after
 * every edit, so a paragraph added to a list gets the next number.
 */
import { elements, isW, num, wAttr, wChild, wVal } from './xml';
import { readParaProps, readRunProps, type ParaProps, type RunProps, type Theme } from './styles';

export interface Level {
  fmt: string;
  text: string;
  start: number;
  p: ParaProps;
  r: RunProps;
  isLgl: boolean;
}

export class Numbering {
  private abstract = new Map<string, Map<number, Level>>();
  /** abstractNumId → the numbering style it takes its levels from (w:numStyleLink) */
  private links = new Map<string, string>();
  private nums = new Map<string, { abstractId: string; overrides: Map<number, { start?: number; level?: Level }> }>();

  /** `styleNum`: the numId a numbering style points to (styles.xml), for w:numStyleLink */
  constructor(
    doc: Document | null,
    theme: Theme,
    private styleNum: (styleId: string) => string | undefined = () => undefined,
  ) {
    if (!doc) return;
    const levelOf = (lvl: Element): Level => ({
      fmt: wVal(lvl, 'numFmt') ?? 'decimal',
      text: wVal(lvl, 'lvlText') ?? '',
      start: num(wVal(lvl, 'start')) ?? 1,
      p: readParaProps(wChild(lvl, 'pPr')),
      r: readRunProps(wChild(lvl, 'rPr'), theme),
      isLgl: !!wChild(lvl, 'isLgl'),
    });
    for (const el of elements(doc.documentElement)) {
      if (isW(el, 'abstractNum')) {
        const levels = new Map<number, Level>();
        for (const lvl of elements(el)) if (isW(lvl, 'lvl')) levels.set(num(wAttr(lvl, 'ilvl')) ?? 0, levelOf(lvl));
        this.abstract.set(wAttr(el, 'abstractNumId') ?? '', levels);
        const link = wVal(el, 'numStyleLink');
        if (link) this.links.set(wAttr(el, 'abstractNumId') ?? '', link);
      } else if (isW(el, 'num')) {
        const overrides = new Map<number, { start?: number; level?: Level }>();
        for (const o of elements(el)) {
          if (!isW(o, 'lvlOverride')) continue;
          const ilvl = num(wAttr(o, 'ilvl')) ?? 0;
          const lvl = wChild(o, 'lvl');
          overrides.set(ilvl, { start: num(wVal(o, 'startOverride')), level: lvl ? levelOf(lvl) : undefined });
        }
        this.nums.set(wAttr(el, 'numId') ?? '', { abstractId: wVal(el, 'abstractNumId') ?? '', overrides });
      }
    }
  }

  level(numId: string | undefined, ilvl = 0, depth = 0): Level | null {
    if (!numId || numId === '0') return null;
    const n = this.nums.get(numId);
    if (!n) return null;
    const o = n.overrides.get(ilvl);
    let base = o?.level ?? this.abstract.get(n.abstractId)?.get(ilvl);
    const link = this.links.get(n.abstractId);
    if (!base && link && depth < 4) {
      // the levels live in the list style's own numbering
      const via = this.styleNum(link);
      base = via && via !== numId ? (this.level(via, ilvl, depth + 1) ?? undefined) : undefined;
    }
    if (!base) return null;
    return o?.start !== undefined ? { ...base, start: o.start } : base;
  }
}

const ROMAN: [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

function roman(n: number) {
  let s = '';
  for (const [v, r] of ROMAN) while (n >= v) (s += r), (n -= v);
  return s;
}

function letters(n: number) {
  // Word: a…z, then aa…zz, aaa…
  const i = (n - 1) % 26;
  const times = Math.floor((n - 1) / 26) + 1;
  return String.fromCharCode(97 + i).repeat(times);
}

export function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case 'none':
      return '';
    case 'bullet':
      return '•';
    case 'decimalZero':
      return n < 10 ? `0${n}` : String(n);
    case 'lowerLetter':
      return letters(n);
    case 'upperLetter':
      return letters(n).toUpperCase();
    case 'lowerRoman':
      return roman(n);
    case 'upperRoman':
      return roman(n).toUpperCase();
    default:
      return String(n);
  }
}

/** Symbol, Wingdings bullets are private-use characters; shown as the nearest Unicode signs. */
const PUA_BULLETS: Record<string, string> = {
  '': '•',
  '': '▪',
  '': '◦',
  '': '➢',
  '': '❖',
  '': '✓',
  '': '□',
  '': '❑',
  '': '➔',
  '': '–',
  o: '◦',
};

export function bulletText(text: string) {
  return [...text].map((c) => PUA_BULLETS[c] ?? (c.charCodeAt(0) >= 0xf000 && c.charCodeAt(0) <= 0xf0ff ? '•' : c)).join('');
}

export interface ListRef {
  numId: string;
  ilvl: number;
}

/**
 * The label of each list paragraph, in document order (null: not in a list).
 * Counters live per numId; a paragraph at level L restarts the levels below.
 */
export function markers(numbering: Numbering, items: (ListRef | null)[]): (string | null)[] {
  const counters = new Map<string, number[]>();
  return items.map((it) => {
    if (!it) return null;
    const lvl = numbering.level(it.numId, it.ilvl);
    if (!lvl) return null;
    let c = counters.get(it.numId);
    if (!c) counters.set(it.numId, (c = []));
    c[it.ilvl] = c[it.ilvl] === undefined ? lvl.start : c[it.ilvl] + 1;
    for (let k = it.ilvl + 1; k < c.length; k++) c[k] = undefined as unknown as number;
    if (lvl.fmt === 'bullet') return bulletText(lvl.text);
    return lvl.text.replace(/%([1-9])/g, (_, d: string) => {
      const k = Number(d) - 1;
      const at = numbering.level(it.numId, k);
      const value = c![k] ?? at?.start ?? 1;
      return formatNumber(value, lvl.isLgl ? 'decimal' : (at?.fmt ?? 'decimal'));
    });
  });
}
