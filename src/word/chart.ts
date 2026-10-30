/**
 * A chart in a Word file (c:chartSpace) → SVG, from the values Word saved
 * with it (the cached numbers; the embedded workbook is not opened). For
 * display only: the chart's parts are written back as they were.
 *
 * Column and bar (clustered, stacked, 100 %), line, area, pie and doughnut,
 * scatter; title, legend, axes with their category labels and value ticks.
 * Series colours from the chart, or the theme's accents in Word's order.
 */
import { elements, escapeHtml } from './xml';
import { colorIn, css, type Rgb } from './drawing';
import type { Theme } from './styles';

const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

const kids = elements;
const cChild = (el: Element | null | undefined, name: string) => (el ? kids(el).find((k) => k.namespaceURI === C && k.localName === name) ?? null : null);
const cChildren = (el: Element | null | undefined, name: string) => (el ? kids(el).filter((k) => k.namespaceURI === C && k.localName === name) : []);
const cVal = (el: Element | null | undefined, name: string) => cChild(el, name)?.getAttribute('val') ?? null;
const aChild = (el: Element | null | undefined, name: string) => (el ? kids(el).find((k) => k.namespaceURI === A && k.localName === name) ?? null : null);
/** a chart larger than this is not drawn (it shows as a labelled chip): points per series, series, markup */
const MAX_POINTS = 1000;
const MAX_SERIES = 60;
const MAX_MARKUP = 3 * 1024 * 1024;

const r2 = (x: number) => Math.round((Number.isFinite(x) ? x : 0) * 100) / 100;
const num = (x: number) => String(r2(x));

interface Series {
  name: string;
  cats: string[];
  vals: (number | null)[];
  xs: (number | null)[];
  color: string;
  /** per-point colours (pie) */
  points: string[];
}

interface Group {
  type: 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'scatter';
  horizontal: boolean;
  grouping: string;
  series: Series[];
  hole: number;
}

/** the cached points of a reference or literal (c:strRef, c:numRef, c:strLit, c:numLit, multi-level) */
function cached(el: Element | null): { strs: string[]; nums: (number | null)[] } {
  const strs: string[] = [];
  const nums: (number | null)[] = [];
  if (!el) return { strs, nums };
  const holder =
    cChild(cChild(el, 'strRef'), 'strCache') ??
    cChild(cChild(el, 'numRef'), 'numCache') ??
    cChild(el, 'strLit') ??
    cChild(el, 'numLit') ??
    cChild(cChild(el, 'multiLvlStrRef'), 'multiLvlStrCache') ??
    cChild(el, 'strCache') ??
    cChild(el, 'numCache');
  if (!holder) return { strs, nums };
  // multi-level categories: the innermost level
  const level = cChild(holder, 'lvl') ?? holder;
  const count = Math.min(MAX_POINTS, Number(cVal(holder, 'ptCount') ?? 0) || 0);
  for (const pt of cChildren(level, 'pt')) {
    const i = Number(pt.getAttribute('idx'));
    if (!Number.isInteger(i) || i < 0 || i >= MAX_POINTS) continue;
    const v = cChild(pt, 'v')?.textContent ?? '';
    strs[i] = v;
    const x = Number(v);
    nums[i] = v.trim() !== '' && Number.isFinite(x) ? x : null;
  }
  const n = Math.max(count, strs.length);
  for (let i = 0; i < n; i++) {
    strs[i] ??= '';
    nums[i] ??= null;
  }
  return { strs, nums };
}

/** the theme accents in Word's order, darker or lighter for series after the sixth */
function accent(theme: Theme, i: number): string {
  const hex = theme.colors[`accent${(i % 6) + 1}`] ?? '4472C4';
  const round = Math.floor(i / 6);
  const c: Rgb = { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
  const k = round === 0 ? 1 : round % 2 ? 0.6 : 1.4;
  const f = (v: number) => (k <= 1 ? v * k : v + (255 - v) * (k - 1));
  return css({ r: f(c.r), g: f(c.g), b: f(c.b), a: 1 });
}

function seriesColor(spPr: Element | null, theme: Theme, line: boolean): string | null {
  const fill = line ? aChild(aChild(spPr, 'ln'), 'solidFill') : aChild(spPr, 'solidFill');
  const c = colorIn(fill, theme) ?? colorIn(aChild(aChild(spPr, 'ln'), 'solidFill'), theme);
  return c ? css(c) : null;
}

const TYPES: Record<string, Group['type']> = {
  barChart: 'bar', bar3DChart: 'bar', lineChart: 'line', line3DChart: 'line', stockChart: 'line', radarChart: 'line',
  areaChart: 'area', area3DChart: 'area', pieChart: 'pie', pie3DChart: 'pie', ofPieChart: 'pie', doughnutChart: 'doughnut',
  scatterChart: 'scatter', bubbleChart: 'scatter',
  // a surface: its series drawn as lines over the categories (no 3D surface)
  surfaceChart: 'line', surface3DChart: 'line',
};

function readGroups(plot: Element, theme: Theme): Group[] {
  const groups: Group[] = [];
  let index = 0;
  for (const g of kids(plot)) {
    const type = g.namespaceURI === C ? TYPES[g.localName] : undefined;
    if (!type) continue;
    const vary = cVal(g, 'varyColors') === '1';
    const series = cChildren(g, 'ser').slice(0, MAX_SERIES).map((ser) => {
      const i = Number(cVal(ser, 'idx') ?? index);
      index++;
      const spPr = cChild(ser, 'spPr');
      const name = cached(cChild(ser, 'tx')).strs.join(' ') || cChild(ser, 'tx')?.textContent?.trim() || `Chuỗi ${index}`;
      const cat = cached(cChild(ser, 'cat') ?? cChild(ser, 'xVal'));
      const val = cached(cChild(ser, 'val') ?? cChild(ser, 'yVal'));
      const color = seriesColor(spPr, theme, type === 'line' || type === 'scatter') ?? accent(theme, Number.isFinite(i) ? i : index - 1);
      const points: string[] = [];
      if (type === 'pie' || type === 'doughnut' || vary) {
        const own = new Map<number, string>();
        for (const dPt of cChildren(ser, 'dPt')) {
          const c = seriesColor(cChild(dPt, 'spPr'), theme, false);
          if (c) own.set(Number(cVal(dPt, 'idx')), c);
        }
        for (let k = 0; k < val.nums.length; k++) points.push(own.get(k) ?? accent(theme, k));
      }
      return { name, cats: cat.strs, vals: val.nums, xs: cat.nums, color, points };
    });
    if (!series.length) continue;
    groups.push({
      type,
      horizontal: cVal(g, 'barDir') === 'bar',
      grouping: cVal(g, 'grouping') ?? (type === 'bar' ? 'clustered' : 'standard'),
      series,
      hole: Math.max(10, Math.min(90, Number(cVal(g, 'holeSize') ?? 50) || 50)),
    });
  }
  return groups;
}

function richText(el: Element | null): string {
  if (!el) return '';
  const paras = el.getElementsByTagNameNS(A, 'p');
  const out: string[] = [];
  for (let i = 0; i < paras.length; i++) {
    let s = '';
    const ts = paras[i].getElementsByTagNameNS(A, 't');
    for (let k = 0; k < ts.length; k++) s += ts[k].textContent ?? '';
    if (s) out.push(s);
  }
  return out.join(' ');
}

function niceStep(range: number, target = 5) {
  if (!(range > 0)) return 1;
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

const fmt = (v: number, pct: boolean) => {
  if (pct) return `${Math.round(v * 100)}%`;
  const a = Math.abs(v);
  if (a >= 1e6) return `${r2(v / 1e6)}M`;
  if (a >= 1e4) return `${r2(v / 1e3)}K`;
  return String(Math.round(v * 1000) / 1000).replace('.', ',');
};

const FONT = `font-family="Calibri, Carlito, 'Segoe UI', Arial, sans-serif"`;
const text = (x: number, y: number, s: string, size: number, anchor: 'start' | 'middle' | 'end', extra = '') =>
  `<text x="${num(x)}" y="${num(y)}" font-size="${num(size)}" text-anchor="${anchor}" fill="#595959" ${FONT}${extra}>${escapeHtml(s)}</text>`;

/** fits a label into `room` px (about 0.55 em per character) */
const clip = (s: string, room: number, size: number) => {
  const max = Math.max(1, Math.floor(room / (size * 0.55)));
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
};

/** The chart as SVG content drawn in a w × h box, or null when it holds nothing to draw. */
export function chartSvg(space: Element, w: number, h: number, theme: Theme): string | null {
  const chart = cChild(space, 'chart');
  const plot = cChild(chart, 'plotArea');
  if (!chart || !plot) return null;
  const groups = readGroups(plot, theme);
  if (!groups.length || groups.reduce((k, g) => k + g.series.length, 0) > MAX_SERIES) return null;
  const size = Math.max(8, Math.min(13, h / 22));
  let out = `<rect x="0" y="0" width="${num(w)}" height="${num(h)}" fill="#fff" stroke="#d9d9d9" stroke-width="0.75"/>`;
  let top = 8, bottom = h - 8, left = 8, right = w - 8;

  // title
  const titleEl = cChild(chart, 'title');
  const deleted = cVal(chart, 'autoTitleDeleted') === '1';
  let title = titleEl ? richText(cChild(cChild(titleEl, 'tx'), 'rich')) || cached(cChild(titleEl, 'tx')).strs.join(' ') : '';
  if (titleEl && !title && !deleted && groups[0].series.length === 1) title = groups[0].series[0].name;
  if (title) {
    out += text(w / 2, top + size * 1.3, clip(title, w - 16, size * 1.3), size * 1.3, 'middle', ' font-weight="bold"');
    top += size * 2;
  }

  // legend: series names, or the categories of a pie
  const legendEl = cChild(chart, 'legend');
  const pie = groups.find((g) => g.type === 'pie' || g.type === 'doughnut');
  const entries: { name: string; color: string }[] = [];
  if (legendEl) {
    if (pie) pie.series[0].cats.forEach((c, i) => entries.push({ name: c || String(i + 1), color: pie.series[0].points[i] ?? accent(theme, i) }));
    else for (const g of groups) for (const s of g.series) entries.push({ name: s.name, color: s.color });
  }
  const pos = cVal(legendEl, 'legendPos') ?? 'r';
  if (entries.length) {
    if (pos === 'r' || pos === 'l') {
      const lw = Math.min(w * 0.3, Math.max(...entries.map((e) => e.name.length)) * size * 0.55 + size * 2);
      const x0 = pos === 'r' ? right - lw : left;
      const y0 = (top + bottom) / 2 - (entries.length * size * 1.5) / 2;
      entries.forEach((e, i) => {
        const y = y0 + i * size * 1.5;
        out += `<rect x="${num(x0)}" y="${num(y)}" width="${num(size * 0.7)}" height="${num(size * 0.7)}" fill="${e.color}"/>`;
        out += text(x0 + size, y + size * 0.7, clip(e.name, lw - size, size), size, 'start');
      });
      if (pos === 'r') right -= lw + 6;
      else left += lw + 6;
    } else {
      const items = entries.map((e) => ({ ...e, label: clip(e.name, w / Math.max(1, entries.length) - size * 2, size) }));
      const widths = items.map((e) => e.label.length * size * 0.55 + size * 1.6);
      const total = widths.reduce((a, b) => a + b, 0);
      let x = Math.max(left, w / 2 - total / 2);
      const y = pos === 't' ? top + size : bottom - size * 0.4;
      items.forEach((e, i) => {
        out += `<rect x="${num(x)}" y="${num(y - size * 0.7)}" width="${num(size * 0.7)}" height="${num(size * 0.7)}" fill="${e.color}"/>`;
        out += text(x + size, y, e.label, size, 'start');
        x += widths[i];
      });
      if (pos === 't') top += size * 2;
      else bottom -= size * 2;
    }
  }

  // pie and doughnut: the first series, as slices
  if (pie) {
    const s = pie.series[0];
    const vals = s.vals.map((v) => Math.max(0, v ?? 0));
    const sum = vals.reduce((a, b) => a + b, 0);
    if (!(sum > 0)) return null;
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    const R = Math.max(4, Math.min(right - left, bottom - top) / 2 - 4);
    const r0 = pie.type === 'doughnut' ? (R * pie.hole) / 100 : 0;
    let a = -Math.PI / 2;
    vals.forEach((v, i) => {
      if (!v) return;
      const da = (v / sum) * Math.PI * 2;
      const color = s.points[i] ?? accent(theme, i);
      if (da >= Math.PI * 2 - 1e-6) {
        out += `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(R)}" fill="${color}" stroke="#fff"/>`;
      } else {
        const p = (ang: number, r: number) => `${num(cx + r * Math.cos(ang))},${num(cy + r * Math.sin(ang))}`;
        const large = da > Math.PI ? 1 : 0;
        const d = r0
          ? `M${p(a, R)} A${num(R)},${num(R)} 0 ${large} 1 ${p(a + da, R)} L${p(a + da, r0)} A${num(r0)},${num(r0)} 0 ${large} 0 ${p(a, r0)} Z`
          : `M${num(cx)},${num(cy)} L${p(a, R)} A${num(R)},${num(R)} 0 ${large} 1 ${p(a + da, R)} Z`;
        out += `<path d="${d}" fill="${color}" stroke="#fff" stroke-width="1"/>`;
      }
      a += da;
    });
    if (r0) out += `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r0)}" fill="#fff"/>`;
    return out;
  }

  // axes charts: one value scale for everything plotted
  const scatter = groups.every((g) => g.type === 'scatter');
  const cats = groups.flatMap((g) => g.series).reduce((best, s) => (s.cats.length > best.length ? s.cats : best), [] as string[]);
  const nCat = Math.max(1, cats.length, ...groups.flatMap((g) => g.series.map((s) => s.vals.length)));
  const pct = groups.some((g) => g.grouping === 'percentStacked');
  let lo = 0, hi = 0;
  for (const g of groups) {
    if (g.grouping === 'stacked' || g.grouping === 'percentStacked') {
      for (let i = 0; i < nCat; i++) {
        let pos = 0, neg = 0;
        const total = g.series.reduce((a, s) => a + Math.abs(s.vals[i] ?? 0), 0) || 1;
        for (const s of g.series) {
          const v = (s.vals[i] ?? 0) / (g.grouping === 'percentStacked' ? total : 1);
          if (v >= 0) pos += v;
          else neg += v;
        }
        hi = Math.max(hi, pos);
        lo = Math.min(lo, neg);
      }
    } else
      for (const s of g.series)
        for (const v of s.vals) {
          if (v === null) continue;
          hi = Math.max(hi, v);
          lo = Math.min(lo, v);
        }
  }
  if (hi === lo) hi = lo + 1;
  const step = pct ? 0.2 : niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step - 1e-9) * step;
  const horizontal = groups.some((g) => g.type === 'bar' && g.horizontal);

  // scatter: a numeric x scale too
  let xlo = 0, xhi = nCat;
  if (scatter) {
    const xs = groups.flatMap((g) => g.series.flatMap((s) => s.xs.filter((x): x is number => x !== null)));
    xlo = Math.min(0, ...xs);
    xhi = Math.max(1, ...xs);
    const xs2 = niceStep(xhi - xlo);
    xlo = Math.floor(xlo / xs2) * xs2;
    xhi = Math.ceil(xhi / xs2) * xs2;
  }

  // room for the tick labels
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1000 && ticks.length < 30; v += step) ticks.push(Math.round(v / step) * step);
  const tickLabel = Math.max(...ticks.map((t) => fmt(t, pct).length)) * size * 0.55 + 6;
  if (horizontal) {
    const catLabel = Math.min(w * 0.3, Math.max(1, ...cats.map((c) => c.length)) * size * 0.55 + 6);
    left += catLabel;
    bottom -= size * 1.6;
  } else {
    left += tickLabel;
    bottom -= size * 1.6;
  }
  right -= 4;
  if (right - left < 10 || bottom - top < 10) return out;

  const span = (v: number) => (v - lo) / (hi - lo);
  // value → px along the value axis; the category band i → its start and width
  const vPos = (v: number) => (horizontal ? left + span(v) * (right - left) : bottom - span(v) * (bottom - top));
  const bandLen = (horizontal ? bottom - top : right - left) / nCat;
  const band = (i: number) => (horizontal ? top + i * bandLen : left + i * bandLen);
  const xPos = (x: number) => left + ((x - xlo) / (xhi - xlo || 1)) * (right - left);

  // gridlines and value labels
  for (const t of ticks) {
    const p = vPos(t);
    if (horizontal) {
      out += `<line x1="${num(p)}" y1="${num(top)}" x2="${num(p)}" y2="${num(bottom)}" stroke="#d9d9d9" stroke-width="0.75"/>`;
      out += text(p, bottom + size * 1.2, fmt(t, pct), size, 'middle');
    } else {
      out += `<line x1="${num(left)}" y1="${num(p)}" x2="${num(right)}" y2="${num(p)}" stroke="#d9d9d9" stroke-width="0.75"/>`;
      out += text(left - 4, p + size * 0.35, fmt(t, pct), size, 'end');
    }
  }
  // category labels (every k-th when crowded)
  if (scatter) {
    const xs2 = niceStep(xhi - xlo);
    for (let x = xlo, k = 0; x <= xhi + xs2 / 1000 && k < 30; x += xs2, k++) out += text(xPos(x), bottom + size * 1.2, fmt(x, false), size, 'middle');
  } else {
    const every = Math.max(1, Math.ceil((nCat * size * 3) / Math.max(1, horizontal ? (bottom - top) * 2 : right - left)));
    cats.forEach((c, i) => {
      if (i % every) return;
      if (horizontal) out += text(left - 4, band(i) + bandLen / 2 + size * 0.35, clip(c, w * 0.3, size), size, 'end');
      else out += text(band(i) + bandLen / 2, bottom + size * 1.2, clip(c, bandLen * every, size), size, 'middle');
    });
  }
  const zero = vPos(Math.max(lo, Math.min(hi, 0)));
  out += horizontal
    ? `<line x1="${num(zero)}" y1="${num(top)}" x2="${num(zero)}" y2="${num(bottom)}" stroke="#bfbfbf"/>`
    : `<line x1="${num(left)}" y1="${num(zero)}" x2="${num(right)}" y2="${num(zero)}" stroke="#bfbfbf"/>`;

  // bars, then areas, then lines and points
  const order: Group['type'][] = ['bar', 'area', 'line', 'scatter'];
  for (const type of order) {
    for (const g of groups.filter((x) => x.type === type)) {
      const stacked = g.grouping === 'stacked' || g.grouping === 'percentStacked';
      const totals = Array.from({ length: nCat }, (_, i) => g.series.reduce((a, s) => a + Math.abs(s.vals[i] ?? 0), 0) || 1);
      const value = (s: Series, i: number) => (s.vals[i] ?? 0) / (g.grouping === 'percentStacked' ? totals[i] : 1);
      const base = { pos: new Array(nCat).fill(0), neg: new Array(nCat).fill(0) };
      if (type === 'bar') {
        const inner = bandLen / 1.5 / (stacked ? 1 : g.series.length);
        g.series.forEach((s, si) => {
          for (let i = 0; i < nCat; i++) {
            if (s.vals[i] === null || s.vals[i] === undefined) continue;
            const v = value(s, i);
            const from = stacked ? (v >= 0 ? base.pos[i] : base.neg[i]) : 0;
            const to = from + v;
            if (stacked) {
              if (v >= 0) base.pos[i] = to;
              else base.neg[i] = to;
            }
            const a = vPos(Math.max(lo, Math.min(hi, from))), b = vPos(Math.max(lo, Math.min(hi, to)));
            const off = band(i) + (bandLen - inner * (stacked ? 1 : g.series.length)) / 2 + (stacked ? 0 : si * inner);
            out += horizontal
              ? `<rect x="${num(Math.min(a, b))}" y="${num(off)}" width="${num(Math.abs(b - a))}" height="${num(inner)}" fill="${s.color}"/>`
              : `<rect x="${num(off)}" y="${num(Math.min(a, b))}" width="${num(inner)}" height="${num(Math.abs(b - a))}" fill="${s.color}"/>`;
          }
        });
      } else if (type === 'area' || type === 'line') {
        g.series.forEach((s) => {
          const pts: [number, number][] = [];
          const floor: [number, number][] = [];
          for (let i = 0; i < nCat; i++) {
            if (s.vals[i] === null || s.vals[i] === undefined) continue;
            const v = value(s, i);
            const from = stacked ? base.pos[i] : 0;
            const to = from + v;
            if (stacked) base.pos[i] = to;
            const x = band(i) + bandLen / 2;
            pts.push([x, vPos(Math.max(lo, Math.min(hi, to)))]);
            floor.push([x, vPos(Math.max(lo, Math.min(hi, from)))]);
          }
          if (!pts.length) return;
          const line = pts.map((p, k) => `${k ? 'L' : 'M'}${num(p[0])},${num(p[1])}`).join(' ');
          if (type === 'area') {
            const back = floor.reverse().map((p) => `L${num(p[0])},${num(p[1])}`).join(' ');
            out += `<path d="${line} ${back} Z" fill="${s.color}" fill-opacity="0.85"/>`;
          } else {
            out += `<path d="${line}" fill="none" stroke="${s.color}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`;
            for (const p of pts) out += `<circle cx="${num(p[0])}" cy="${num(p[1])}" r="2.5" fill="${s.color}"/>`;
          }
        });
      } else {
        g.series.forEach((s) => {
          const pts: [number, number][] = [];
          s.vals.forEach((v, i) => {
            if (v === null) return;
            const x = s.xs[i] ?? i + 1;
            pts.push([xPos(x), vPos(Math.max(lo, Math.min(hi, v)))]);
          });
          for (const p of pts) out += `<circle cx="${num(p[0])}" cy="${num(p[1])}" r="3" fill="${s.color}"/>`;
        });
      }
      if (out.length > MAX_MARKUP) return null;
    }
  }
  return out.length > MAX_MARKUP ? null : out;
}
