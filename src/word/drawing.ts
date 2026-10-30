/**
 * Shapes in a Word file → SVG, for display. The shapes' XML is kept and
 * written back as it was; this is only how ezPDF shows them.
 *
 *  - DrawingML (Word 2010+): a shape (wps), a group (wpg), a drawing canvas
 *    (wpc), SmartArt through its saved drawing (dsp), pictures inside them.
 *    Preset geometries (rectangles, ellipses, the flowchart set, arrows,
 *    connectors…), custom geometry paths, theme colours with their
 *    modifiers, line width, dashes, arrow heads, rotation and flips, and the
 *    text of text boxes (laid out by the page's own paragraph renderer).
 *  - VML (Word 2003 and the fallback Word writes beside DrawingML): groups,
 *    rectangles, rounded rectangles, ovals, lines, polylines, paths, text
 *    boxes, pictures.
 *
 * Coordinates are CSS pixels (EMU / 9525); text in boxes keeps its sizes in
 * pt, so a drawing shown at its own size matches Word, and a drawing on a
 * narrow screen shrinks as one picture (the SVG scales, text included).
 * Everything taken from the file is checked before it reaches the markup:
 * numbers are numbers, colours are hex, text is escaped.
 */
import { elements, escapeHtml, NS } from './xml';
import type { Theme } from './styles';

const A = NS.a;
const EMU_PX = 9525;
const XHTML = 'http://www.w3.org/1999/xhtml';

export interface DrawCtx {
  theme: Theme;
  /** URL of a picture (relationship id of the part being drawn) */
  image(rid: string): string | null;
  /** HTML of a text box's content (w:txbxContent) */
  text(txbx: Element): string;
  /** SVG of a chart (relationship id), w × h px */
  chart(rid: string, w: number, h: number): string | null;
  /** the saved drawing of a SmartArt (relationship id of its data part), with the context of its part */
  diagram(dmRid: string): { root: Element; ctx: DrawCtx } | null;
  /** a unique id (arrow markers) */
  uid(): string;
}

export interface Drawn {
  html: string;
  /** px */
  w: number;
  h: number;
  /** a floating drawing: on its own line */
  block: boolean;
  align: 'left' | 'center' | 'right' | null;
  /** px from the left of the text column (a floating drawing placed by an offset) */
  offset: number;
  label: string;
}

// ---- small helpers ----------------------------------------------------------

const kids = elements;
const byName = (el: Element | null | undefined, name: string) => (el ? kids(el).find((k) => k.localName === name) ?? null : null);
const byNames = (el: Element | null | undefined, name: string) => (el ? kids(el).filter((k) => k.localName === name) : []);
const aChild = (el: Element | null | undefined, name: string) => (el ? kids(el).find((k) => k.namespaceURI === A && k.localName === name) ?? null : null);
const firstDesc = (el: Element, ns: string, name: string) => el.getElementsByTagNameNS(ns, name)[0] ?? null;
/** a number attribute; missing or not a number → the default (Number(null) would be 0) */
const n = (v: string | null | undefined, d = 0) => {
  if (v === null || v === undefined || v.trim() === '') return d;
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
const r2 = (x: number) => Math.round(x * 100) / 100;
const num = (x: number) => String(r2(Number.isFinite(x) ? x : 0));

// ---- colours ----------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

const PRESET: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080',
  grey: '808080', silver: 'C0C0C0', navy: '000080', teal: '008080', maroon: '800000', purple: '800080', olive: '808000',
  orange: 'FFA500', lime: '00FF00', aqua: '00FFFF', fuchsia: 'FF00FF', ltGray: 'C0C0C0', dkGray: '808080',
};

const hexRgb = (hex: string): Rgb => ({ r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 });

function toHsl({ r, g, b }: Rgb) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}

function fromHsl(h: number, s: number, l: number, a: number): Rgb {
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255, a };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return { r: f(p, q, h + 1 / 3) * 255, g: f(p, q, h) * 255, b: f(p, q, h - 1 / 3) * 255, a };
}

export const css = (c: Rgb) => {
  const k = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  return c.a >= 1 ? `rgb(${k(c.r)},${k(c.g)},${k(c.b)})` : `rgba(${k(c.r)},${k(c.g)},${k(c.b)},${r2(Math.max(0, c.a))})`;
};

const SCHEME_ALIAS: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };

/** A DrawingML colour element (srgbClr, schemeClr…) with its modifiers → CSS colour. */
function colorEl(c: Element | null, theme: Theme, ph: Rgb | null): Rgb | null {
  if (!c || c.namespaceURI !== A) return null;
  let base: Rgb | null = null;
  const val = c.getAttribute('val') ?? '';
  switch (c.localName) {
    case 'srgbClr':
      base = /^[0-9a-f]{6}$/i.test(val) ? hexRgb(val) : null;
      break;
    case 'schemeClr': {
      if (val === 'phClr') base = ph ? { ...ph } : null;
      else {
        const hex = theme.colors[SCHEME_ALIAS[val] ?? val];
        base = hex ? hexRgb(hex) : null;
      }
      break;
    }
    case 'sysClr': {
      const last = c.getAttribute('lastClr') ?? '';
      base = /^[0-9a-f]{6}$/i.test(last) ? hexRgb(last) : val === 'window' ? hexRgb('FFFFFF') : hexRgb('000000');
      break;
    }
    case 'prstClr':
      base = PRESET[val] ? hexRgb(PRESET[val]) : null;
      break;
    case 'scrgbClr':
      base = { r: n(c.getAttribute('r')) / 100000 * 255, g: n(c.getAttribute('g')) / 100000 * 255, b: n(c.getAttribute('b')) / 100000 * 255, a: 1 };
      break;
  }
  if (!base) return null;
  let col = base;
  for (const m of kids(c)) {
    const v = n(m.getAttribute('val'), 100000) / 100000;
    const hsl = () => toHsl(col);
    switch (m.localName) {
      case 'lumMod': {
        const x = hsl();
        col = fromHsl(x.h, x.s, Math.min(1, x.l * v), col.a);
        break;
      }
      case 'lumOff': {
        const x = hsl();
        col = fromHsl(x.h, x.s, Math.min(1, Math.max(0, x.l + v)), col.a);
        break;
      }
      case 'satMod': {
        const x = hsl();
        col = fromHsl(x.h, Math.min(1, x.s * v), x.l, col.a);
        break;
      }
      case 'tint':
        col = { r: col.r * v + 255 * (1 - v), g: col.g * v + 255 * (1 - v), b: col.b * v + 255 * (1 - v), a: col.a };
        break;
      case 'shade':
        col = { r: col.r * v, g: col.g * v, b: col.b * v, a: col.a };
        break;
      case 'alpha':
        col = { ...col, a: v };
        break;
    }
  }
  return col;
}

/** the colour inside a fill-like element (a:solidFill, a:fillRef…) */
export const colorIn = (el: Element | null, theme: Theme, ph: Rgb | null = null) => (el ? colorEl(kids(el).find((k) => k.namespaceURI === A && /Clr$/.test(k.localName)) ?? null, theme, ph) : null);

// ---- fills and lines ----------------------------------------------------------

/** an arrow head: its type and size (Word's sm / med / lg) */
interface End {
  type: string;
  size: number;
}

interface Paint {
  fill: string;
  stroke: string | null;
  width: number;
  dash: string | null;
  head: End | null;
  tail: End | null;
  image: string | null;
}

const LINE_IDX = [0, 0.75, 1, 1.5].map((pt) => (pt * 4) / 3);

function paint(spPr: Element | null, style: Element | null, ctx: DrawCtx, line: boolean): Paint {
  const theme = ctx.theme;
  const fillRef = byName(style, 'fillRef');
  const lnRef = byName(style, 'lnRef');
  const styleFill = fillRef && n(fillRef.getAttribute('idx')) > 0 ? colorIn(fillRef, theme) : null;
  const styleLine = lnRef && n(lnRef.getAttribute('idx')) > 0 ? colorIn(lnRef, theme) : null;
  let fill = 'none';
  let image: string | null = null;
  const solid = aChild(spPr, 'solidFill');
  const grad = aChild(spPr, 'gradFill');
  const patt = aChild(spPr, 'pattFill');
  const blip = aChild(spPr, 'blipFill');
  if (aChild(spPr, 'noFill') || line) fill = 'none';
  else if (solid) fill = css(colorIn(solid, theme, styleFill) ?? { r: 255, g: 255, b: 255, a: 1 });
  else if (grad) {
    const stop = firstDesc(grad, A, 'gs');
    const c = stop ? colorIn(stop, theme, styleFill) : null;
    fill = c ? css(c) : 'none';
  } else if (patt) {
    const c = colorIn(aChild(patt, 'fgClr'), theme, styleFill);
    fill = c ? css(c) : 'none';
  } else if (blip) {
    const b = aChild(blip, 'blip');
    const rid = b?.getAttributeNS(NS.r, 'embed');
    image = rid ? ctx.image(rid) : null;
  } else if (styleFill) fill = css(styleFill);

  const ln = aChild(spPr, 'ln');
  let stroke: string | null = null;
  let width = 0;
  if (ln && aChild(ln, 'noFill')) stroke = null;
  else {
    const lc = (ln && colorIn(aChild(ln, 'solidFill'), theme, styleLine)) ?? styleLine;
    if (lc && (ln || lnRef)) {
      stroke = css(lc);
      const w = ln?.getAttribute('w');
      width = w ? n(w) / EMU_PX : LINE_IDX[Math.min(3, n(lnRef?.getAttribute('idx')))] || 1;
      if (width < 0.5) width = 0.75;
    } else if (ln && aChild(ln, 'solidFill')) {
      stroke = '#000';
      width = n(ln.getAttribute('w'), 9525) / EMU_PX;
    }
  }
  const dashV = aChild(ln, 'prstDash')?.getAttribute('val') ?? 'solid';
  const w = Math.max(width, 1);
  const DASH: Record<string, string> = {
    dash: `${4 * w} ${3 * w}`, sysDash: `${3 * w} ${w}`, dot: `${w} ${w}`, sysDot: `${w} ${w}`, lgDash: `${8 * w} ${3 * w}`,
    dashDot: `${4 * w} ${3 * w} ${w} ${3 * w}`, lgDashDot: `${8 * w} ${3 * w} ${w} ${3 * w}`, sysDashDot: `${3 * w} ${w} ${w} ${w}`,
  };
  const end = (name: string): End | null => {
    const e = aChild(ln, name);
    const t = e?.getAttribute('type');
    if (!t || t === 'none' || !/^[a-z]+$/i.test(t)) return null;
    return { type: t, size: arrowSize(width, e!.getAttribute('w'), e!.getAttribute('len')) };
  };
  return { fill, stroke, width, dash: DASH[dashV] ?? null, head: end('headEnd'), tail: end('tailEnd'), image };
}

/** arrow head size in px: grows with the line, never too small to see */
function arrowSize(width: number, w: string | null, len: string | null) {
  const k = (v: string | null) => (v === 'sm' ? 0.7 : v === 'lg' ? 1.5 : 1);
  return Math.max(7, width * 3.5) * Math.max(k(w), k(len));
}

/** an arrow head; `start`: at the start of the line (points backwards) */
function markerDefs(id: string, type: string, color: string, size: number, start: boolean): string {
  const shape: Record<string, string> = {
    triangle: 'M0,0 L10,5 L0,10 z',
    arrow: 'M0,0 L10,5 L0,10',
    stealth: 'M0,0 L10,5 L0,10 L3,5 z',
    diamond: 'M0,5 L5,0 L10,5 L5,10 z',
    oval: 'M5,0 A5,5 0 1 1 5,10 A5,5 0 1 1 5,0 z',
  };
  const d = shape[type] ?? shape.triangle;
  const open = type === 'arrow';
  const centred = type === 'oval' || type === 'diamond';
  const refX = centred ? 5 : start ? 1 : 9;
  return (
    `<marker id="${id}" viewBox="-1 -1 12 12" refX="${refX}" refY="5" markerUnits="userSpaceOnUse" markerWidth="${num(size)}" markerHeight="${num(size)}" orient="auto">` +
    `<path d="${d}"${start ? ' transform="rotate(180 5 5)"' : ''} fill="${open ? 'none' : color}" stroke="${color}" stroke-width="${open ? 1.5 : 0.5}"/></marker>`
  );
}

/** marker definitions and attributes for a line's arrow heads */
function arrows(ctx: DrawCtx, color: string | null, head: End | null, tail: End | null): { defs: string; attrs: string } {
  let defs = '';
  let attrs = '';
  if (!color) return { defs, attrs };
  if (tail) {
    const id = `ezm${ctx.uid()}`;
    defs += markerDefs(id, tail.type, color, tail.size, false);
    attrs += ` marker-end="url(#${id})"`;
  }
  if (head) {
    const id = `ezm${ctx.uid()}`;
    defs += markerDefs(id, head.type, color, head.size, true);
    attrs += ` marker-start="url(#${id})"`;
  }
  return { defs, attrs };
}

// ---- geometry -----------------------------------------------------------------

/** adjust values of a preset shape (a:avLst), in 1/100000 */
function adjust(geom: Element | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const gd of kids(aChild(geom, 'avLst'))) {
    const m = /^val\s+(-?\d+)/.exec(gd.getAttribute('fmla') ?? '');
    if (m) out[gd.getAttribute('name') ?? ''] = Number(m[1]);
  }
  return out;
}

const poly = (pts: number[][]) => `M${pts.map((p) => `${num(p[0])},${num(p[1])}`).join(' L')} Z`;

function ellipse(x: number, y: number, w: number, h: number) {
  const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
  return `M${num(cx - rx)},${num(cy)} A${num(rx)},${num(ry)} 0 1 0 ${num(cx + rx)},${num(cy)} A${num(rx)},${num(ry)} 0 1 0 ${num(cx - rx)},${num(cy)} Z`;
}

function roundRect(w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${num(r)},0 H${num(w - r)} A${num(r)},${num(r)} 0 0 1 ${num(w)},${num(r)} V${num(h - r)} A${num(r)},${num(r)} 0 0 1 ${num(w - r)},${num(h)} H${num(r)} A${num(r)},${num(r)} 0 0 1 0,${num(h - r)} V${num(r)} A${num(r)},${num(r)} 0 0 1 ${num(r)},0 Z`;
}

function regular(w: number, h: number, sides: number, rot = -Math.PI / 2) {
  const pts: number[][] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    pts.push([w / 2 + (w / 2) * Math.cos(a), h / 2 + (h / 2) * Math.sin(a)]);
  }
  return poly(pts);
}

function star(w: number, h: number, points: number, inner: number) {
  const pts: number[][] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const k = i % 2 ? inner : 1;
    pts.push([w / 2 + (w / 2) * k * Math.cos(a), h / 2 + (h / 2) * k * Math.sin(a)]);
  }
  return poly(pts);
}

/** SVG path of a preset shape in a w × h box; `open`: a line (no fill) */
export function presetPath(prst: string, w: number, h: number, adj: Record<string, number> = {}): { d: string; open: boolean; extra?: string } {
  const a = (name: string, d: number) => (adj[name] ?? d) / 100000;
  const ss = Math.min(w, h);
  switch (prst) {
    case 'line':
    case 'straightConnector1':
      return { d: `M0,0 L${num(w)},${num(h)}`, open: true };
    case 'bentConnector2':
      return { d: `M0,0 L${num(w)},0 L${num(w)},${num(h)}`, open: true };
    case 'bentConnector3':
    case 'bentConnector4':
    case 'bentConnector5': {
      const x = w * a('adj1', 50000);
      return { d: `M0,0 L${num(x)},0 L${num(x)},${num(h)} L${num(w)},${num(h)}`, open: true };
    }
    case 'curvedConnector2':
    case 'curvedConnector3':
    case 'curvedConnector4':
    case 'curvedConnector5': {
      const x = w * a('adj1', 50000);
      return { d: `M0,0 C${num(x)},0 ${num(x)},${num(h)} ${num(w)},${num(h)}`, open: true };
    }
    case 'arc': {
      return { d: `M${num(w / 2)},0 A${num(w / 2)},${num(h / 2)} 0 0 1 ${num(w)},${num(h / 2)}`, open: true };
    }
    case 'leftBracket':
      return { d: `M${num(w)},0 Q0,0 0,${num(h / 2)} Q0,${num(h)} ${num(w)},${num(h)}`, open: true };
    case 'rightBracket':
      return { d: `M0,0 Q${num(w)},0 ${num(w)},${num(h / 2)} Q${num(w)},${num(h)} 0,${num(h)}`, open: true };
    case 'leftBrace':
      return { d: `M${num(w)},0 Q${num(w / 2)},0 ${num(w / 2)},${num(h / 4)} L${num(w / 2)},${num(h / 2 - h / 8)} Q${num(w / 2)},${num(h / 2)} 0,${num(h / 2)} Q${num(w / 2)},${num(h / 2)} ${num(w / 2)},${num(h / 2 + h / 8)} L${num(w / 2)},${num((h * 3) / 4)} Q${num(w / 2)},${num(h)} ${num(w)},${num(h)}`, open: true };
    case 'rightBrace':
      return { d: `M0,0 Q${num(w / 2)},0 ${num(w / 2)},${num(h / 4)} L${num(w / 2)},${num(h / 2 - h / 8)} Q${num(w / 2)},${num(h / 2)} ${num(w)},${num(h / 2)} Q${num(w / 2)},${num(h / 2)} ${num(w / 2)},${num(h / 2 + h / 8)} L${num(w / 2)},${num((h * 3) / 4)} Q${num(w / 2)},${num(h)} 0,${num(h)}`, open: true };
    case 'bracketPair': {
      const r = ss * a('adj', 16667);
      return { d: `M${num(r)},0 Q0,0 0,${num(r)} V${num(h - r)} Q0,${num(h)} ${num(r)},${num(h)} M${num(w - r)},0 Q${num(w)},0 ${num(w)},${num(r)} V${num(h - r)} Q${num(w)},${num(h)} ${num(w - r)},${num(h)}`, open: true };
    }
    case 'roundRect':
      return { d: roundRect(w, h, ss * a('adj', 16667)), open: false };
    case 'flowChartAlternateProcess':
      return { d: roundRect(w, h, ss / 6), open: false };
    case 'flowChartTerminator':
      return { d: roundRect(w, h, Math.min(h, w) / 2), open: false };
    case 'ellipse':
    case 'flowChartConnector':
      return { d: ellipse(0, 0, w, h), open: false };
    case 'flowChartOr':
    case 'flowChartSummingJunction': {
      const cx = w / 2, cy = h / 2;
      const extra =
        prst === 'flowChartOr'
          ? `M${num(cx)},0 V${num(h)} M0,${num(cy)} H${num(w)}`
          : `M${num(cx - (w / 2) * 0.707)},${num(cy - (h / 2) * 0.707)} L${num(cx + (w / 2) * 0.707)},${num(cy + (h / 2) * 0.707)} M${num(cx + (w / 2) * 0.707)},${num(cy - (h / 2) * 0.707)} L${num(cx - (w / 2) * 0.707)},${num(cy + (h / 2) * 0.707)}`;
      return { d: ellipse(0, 0, w, h), open: false, extra };
    }
    case 'diamond':
    case 'flowChartDecision':
      return { d: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), open: false };
    case 'triangle':
    case 'flowChartExtract': {
      const x = prst === 'triangle' ? w * a('adj', 50000) : w / 2;
      return { d: poly([[x, 0], [w, h], [0, h]]), open: false };
    }
    case 'flowChartMerge':
      return { d: poly([[0, 0], [w, 0], [w / 2, h]]), open: false };
    case 'rtTriangle':
      return { d: poly([[0, 0], [w, h], [0, h]]), open: false };
    case 'parallelogram':
    case 'flowChartInputOutput':
    case 'flowChartData': {
      const o = prst === 'parallelogram' ? ss * a('adj', 25000) : w / 5;
      return { d: poly([[o, 0], [w, 0], [w - o, h], [0, h]]), open: false };
    }
    case 'trapezoid': {
      const o = ss * a('adj', 25000);
      return { d: poly([[o, 0], [w - o, 0], [w, h], [0, h]]), open: false };
    }
    case 'flowChartManualOperation':
      return { d: poly([[0, 0], [w, 0], [w * 0.8, h], [w * 0.2, h]]), open: false };
    case 'hexagon':
    case 'flowChartPreparation': {
      const o = prst === 'hexagon' ? ss * a('adj', 25000) : w / 5;
      return { d: poly([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]), open: false };
    }
    case 'octagon': {
      const o = ss * a('adj', 29289);
      return { d: poly([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]), open: false };
    }
    case 'pentagon':
      return { d: regular(w, h, 5), open: false };
    case 'heptagon':
      return { d: regular(w, h, 7), open: false };
    case 'decagon':
      return { d: regular(w, h, 10), open: false };
    case 'homePlate': {
      const o = ss * a('adj', 50000);
      return { d: poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]]), open: false };
    }
    case 'chevron': {
      const o = ss * a('adj', 50000);
      return { d: poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]]), open: false };
    }
    case 'flowChartPredefinedProcess':
      return { d: poly([[0, 0], [w, 0], [w, h], [0, h]]), open: false, extra: `M${num(w / 8)},0 V${num(h)} M${num((w * 7) / 8)},0 V${num(h)}` };
    case 'flowChartInternalStorage':
      return { d: poly([[0, 0], [w, 0], [w, h], [0, h]]), open: false, extra: `M${num(w / 8)},0 V${num(h)} M0,${num(h / 8)} H${num(w)}` };
    case 'flowChartDocument':
      return { d: `M0,0 H${num(w)} V${num(h * 0.83)} C${num(w * 0.7)},${num(h * 0.65)} ${num(w * 0.3)},${num(h * 1.05)} 0,${num(h * 0.9)} Z`, open: false };
    case 'flowChartMultidocument': {
      const doc = (x: number, y: number, ww: number, hh: number) => `M${num(x)},${num(y)} H${num(x + ww)} V${num(y + hh * 0.83)} C${num(x + ww * 0.7)},${num(y + hh * 0.65)} ${num(x + ww * 0.3)},${num(y + hh * 1.05)} ${num(x)},${num(y + hh * 0.9)} Z`;
      return { d: `${doc(w * 0.1, 0, w * 0.9, h * 0.85)} ${doc(w * 0.05, h * 0.05, w * 0.9, h * 0.85)} ${doc(0, h * 0.1, w * 0.9, h * 0.9)}`, open: false };
    }
    case 'flowChartManualInput':
      return { d: poly([[0, h * 0.2], [w, 0], [w, h], [0, h]]), open: false };
    case 'flowChartPunchedCard':
      return { d: poly([[w * 0.2, 0], [w, 0], [w, h], [0, h], [0, h * 0.2]]), open: false };
    case 'flowChartPunchedTape':
      return { d: `M0,${num(h * 0.1)} C${num(w * 0.25)},${num(-h * 0.1)} ${num(w * 0.25)},${num(h * 0.3)} ${num(w / 2)},${num(h * 0.1)} C${num(w * 0.75)},${num(-h * 0.1)} ${num(w * 0.75)},${num(h * 0.3)} ${num(w)},${num(h * 0.1)} V${num(h * 0.9)} C${num(w * 0.75)},${num(h * 1.1)} ${num(w * 0.75)},${num(h * 0.7)} ${num(w / 2)},${num(h * 0.9)} C${num(w * 0.25)},${num(h * 1.1)} ${num(w * 0.25)},${num(h * 0.7)} 0,${num(h * 0.9)} Z`, open: false };
    case 'flowChartOffpageConnector':
      return { d: poly([[0, 0], [w, 0], [w, h * 0.8], [w / 2, h], [0, h * 0.8]]), open: false };
    case 'flowChartDelay':
      return { d: `M0,0 H${num(w / 2)} A${num(w / 2)},${num(h / 2)} 0 0 1 ${num(w / 2)},${num(h)} H0 Z`, open: false };
    case 'flowChartDisplay':
      return { d: `M0,${num(h / 2)} L${num(w / 6)},0 H${num((w * 5) / 6)} A${num(w / 6)},${num(h / 2)} 0 0 1 ${num((w * 5) / 6)},${num(h)} H${num(w / 6)} Z`, open: false };
    case 'flowChartOnlineStorage':
      return { d: `M${num(w / 6)},0 H${num(w)} A${num(w / 6)},${num(h / 2)} 0 0 0 ${num(w)},${num(h)} H${num(w / 6)} A${num(w / 6)},${num(h / 2)} 0 0 1 ${num(w / 6)},0 Z`, open: false };
    case 'can':
    case 'flowChartMagneticDisk': {
      const e = h * (prst === 'can' ? a('adj', 25000) : 0.15);
      return {
        d: `M0,${num(e / 2)} A${num(w / 2)},${num(e / 2)} 0 0 1 ${num(w)},${num(e / 2)} V${num(h - e / 2)} A${num(w / 2)},${num(e / 2)} 0 0 1 0,${num(h - e / 2)} Z`,
        open: false,
        extra: `M0,${num(e / 2)} A${num(w / 2)},${num(e / 2)} 0 0 0 ${num(w)},${num(e / 2)}`,
      };
    }
    case 'flowChartMagneticDrum':
      return { d: `M${num(w * 0.15)},0 H${num(w * 0.85)} A${num(w * 0.15)},${num(h / 2)} 0 0 1 ${num(w * 0.85)},${num(h)} H${num(w * 0.15)} A${num(w * 0.15)},${num(h / 2)} 0 0 1 ${num(w * 0.15)},0 Z`, open: false, extra: `M${num(w * 0.85)},0 A${num(w * 0.15)},${num(h / 2)} 0 0 0 ${num(w * 0.85)},${num(h)}` };
    case 'flowChartCollate':
      return { d: poly([[0, 0], [w, 0], [0, h], [w, h]]), open: false };
    case 'flowChartSort':
      return { d: poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), open: false, extra: `M0,${num(h / 2)} H${num(w)}` };
    case 'flowChartOfflineStorage':
      return { d: poly([[0, 0], [w, 0], [w / 2, h]]), open: false, extra: `M${num(w * 0.4)},${num(h * 0.8)} H${num(w * 0.6)}` };
    case 'plus':
    case 'flowChartOr2': {
      const o = ss * a('adj', 25000);
      return { d: poly([[o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o], [0, o], [o, o]]), open: false };
    }
    case 'star4':
      return { d: star(w, h, 4, 0.38), open: false };
    case 'star5':
      return { d: star(w, h, 5, 0.38), open: false };
    case 'star6':
      return { d: star(w, h, 6, 0.5), open: false };
    case 'star8':
      return { d: star(w, h, 8, 0.6), open: false };
    case 'rightArrow':
    case 'leftArrow':
    case 'upArrow':
    case 'downArrow':
    case 'leftRightArrow':
    case 'upDownArrow': {
      const vertical = prst === 'upArrow' || prst === 'downArrow' || prst === 'upDownArrow';
      const L = vertical ? h : w;
      const T = vertical ? w : h;
      const shaft = T * a('adj1', 50000);
      const head = Math.min(L / (prst.includes('Right') || prst.includes('Down') ? 2 : 1), Math.min(w, h) * a('adj2', 50000));
      const y0 = (T - shaft) / 2, y1 = (T + shaft) / 2;
      let pts: number[][];
      if (prst === 'leftRightArrow' || prst === 'upDownArrow')
        pts = [[0, T / 2], [head, 0], [head, y0], [L - head, y0], [L - head, 0], [L, T / 2], [L - head, T], [L - head, y1], [head, y1], [head, T]];
      else pts = [[0, y0], [L - head, y0], [L - head, 0], [L, T / 2], [L - head, T], [L - head, y1], [0, y1]];
      if (prst === 'leftArrow' || prst === 'upArrow') pts = pts.map(([x, y]) => [L - x, y]);
      if (vertical) pts = pts.map(([x, y]) => [y, x]);
      return { d: poly(pts), open: false };
    }
    case 'frame': {
      const t = ss * a('adj1', 12500);
      return { d: `${poly([[0, 0], [w, 0], [w, h], [0, h]])} ${poly([[t, t], [t, h - t], [w - t, h - t], [w - t, t]])}`, open: false };
    }
    case 'donut': {
      const t = ss * a('adj', 25000);
      return { d: `${ellipse(0, 0, w, h)} ${ellipse(t, t, w - 2 * t, h - 2 * t)}`, open: false };
    }
    case 'wedgeRectCallout':
    case 'wedgeRoundRectCallout':
    case 'wedgeEllipseCallout':
    case 'cloudCallout': {
      const tx = w / 2 + w * a('adj1', -20833), ty = h / 2 + h * a('adj2', 62500);
      const body = prst === 'wedgeRectCallout' ? poly([[0, 0], [w, 0], [w, h], [0, h]]) : prst === 'wedgeRoundRectCallout' ? roundRect(w, h, ss / 6) : ellipse(0, 0, w, h);
      const bx = Math.max(0, Math.min(w, tx)), by = Math.max(0, Math.min(h, ty));
      const tail = poly([[bx - w * 0.08, Math.min(h, Math.max(0, by - h * 0.08))], [tx, ty], [bx + w * 0.08, Math.min(h, Math.max(0, by))]]);
      return { d: `${body} ${tail}`, open: false };
    }
    case 'cloud':
      return { d: roundRect(w, h, ss / 2), open: false };
    case 'heart':
      return { d: `M${num(w / 2)},${num(h * 0.3)} C${num(w / 2)},0 0,0 0,${num(h * 0.3)} C0,${num(h * 0.6)} ${num(w / 2)},${num(h * 0.8)} ${num(w / 2)},${num(h)} C${num(w / 2)},${num(h * 0.8)} ${num(w)},${num(h * 0.6)} ${num(w)},${num(h * 0.3)} C${num(w)},0 ${num(w / 2)},0 ${num(w / 2)},${num(h * 0.3)} Z`, open: false };
    case 'snip1Rect': {
      const o = ss * a('adj', 16667);
      return { d: poly([[0, 0], [w - o, 0], [w, o], [w, h], [0, h]]), open: false };
    }
    case 'snip2SameRect': {
      const o = ss * a('adj1', 16667);
      return { d: poly([[o, 0], [w - o, 0], [w, o], [w, h], [0, h], [0, o]]), open: false };
    }
    case 'round1Rect':
    case 'round2SameRect':
      return { d: roundRect(w, h, ss * a('adj1', 16667)), open: false };
    case 'cube': {
      const o = ss * a('adj', 25000);
      return { d: poly([[o, 0], [w, 0], [w, h - o], [w - o, h], [0, h], [0, o]]), open: false, extra: `M0,${num(o)} H${num(w - o)} L${num(w)},0 M${num(w - o)},${num(o)} V${num(h)}` };
    }
    case 'bevel': {
      const o = ss * a('adj', 12500);
      return { d: poly([[0, 0], [w, 0], [w, h], [0, h]]), open: false, extra: poly([[o, o], [w - o, o], [w - o, h - o], [o, h - o]]) };
    }
    default:
      return { d: poly([[0, 0], [w, 0], [w, h], [0, h]]), open: false };
  }
}

/**
 * Where a preset shape puts its text (its text rectangle, as Word's shape
 * definitions give it): inside an ellipse, the middle of a diamond, an
 * arrow's shaft. The whole box for shapes not listed.
 */
export function textRect(prst: string, w: number, h: number, adj: Record<string, number> = {}): Box {
  const a = (name: string, d: number) => (adj[name] ?? d) / 100000;
  const ss = Math.min(w, h);
  const box = (l: number, t: number, r: number, b: number): Box => ({ x: l, y: t, w: Math.max(1, r - l), h: Math.max(1, b - t) });
  switch (prst) {
    case 'ellipse':
    case 'flowChartConnector':
    case 'flowChartOr':
    case 'flowChartSummingJunction':
    case 'wedgeEllipseCallout':
    case 'donut': {
      const k = (1 - Math.SQRT1_2) / 2;
      return box(w * k, h * k, w * (1 - k), h * (1 - k));
    }
    case 'diamond':
    case 'flowChartDecision':
    case 'flowChartSort':
      return box(w / 4, h / 4, (w * 3) / 4, (h * 3) / 4);
    case 'triangle': {
      const x1 = (w * a('adj', 50000)) / 2;
      return box(x1, h / 2, x1 + w / 2, h);
    }
    case 'flowChartExtract':
      return box(w / 4, h / 2, (w * 3) / 4, h);
    case 'flowChartMerge':
      return box(w / 4, 0, (w * 3) / 4, h / 2);
    case 'rtTriangle':
      return box(w / 12, (h * 7) / 12, (w * 7) / 12, (h * 11) / 12);
    case 'roundRect':
    case 'round1Rect':
    case 'round2SameRect': {
      const r = ss * a(prst === 'roundRect' ? 'adj' : 'adj1', 16667) * 0.29289;
      return box(r, r, w - r, h - r);
    }
    case 'flowChartAlternateProcess':
      return box((ss / 6) * 0.29289, (ss / 6) * 0.29289, w - (ss / 6) * 0.29289, h - (ss / 6) * 0.29289);
    case 'flowChartTerminator':
      return box((w * 1018) / 21600, (h * 3163) / 21600, (w * 20582) / 21600, (h * 18437) / 21600);
    case 'flowChartInputOutput':
    case 'flowChartData':
      return box(w / 5, 0, (w * 4) / 5, h);
    case 'parallelogram': {
      const o = ss * a('adj', 25000);
      return box(o / 2, 0, w - o / 2, h);
    }
    case 'trapezoid': {
      const o = ss * a('adj', 25000);
      return box(o / 3, 0, w - o / 3, h);
    }
    case 'flowChartManualOperation':
      return box(w / 5, 0, (w * 4) / 5, h);
    case 'hexagon':
    case 'flowChartPreparation':
    case 'octagon': {
      const o = prst === 'flowChartPreparation' ? w / 5 : ss * a('adj', prst === 'octagon' ? 29289 : 25000);
      return box(o / 2, 0, w - o / 2, h);
    }
    case 'flowChartPredefinedProcess':
      return box(w / 8, 0, (w * 7) / 8, h);
    case 'flowChartInternalStorage':
      return box(w / 8, h / 8, w, h);
    case 'flowChartDocument':
    case 'flowChartMultidocument':
      return box(0, 0, prst === 'flowChartMultidocument' ? w * 0.9 : w, h * 0.8);
    case 'flowChartManualInput':
      return box(0, h / 5, w, h);
    case 'flowChartPunchedTape':
      return box(0, h / 5, w, (h * 4) / 5);
    case 'flowChartOffpageConnector':
      return box(0, 0, w, h * 0.8);
    case 'flowChartDelay':
      return box(0, h * 0.146, w * 0.854, h * 0.854);
    case 'flowChartDisplay':
      return box(w / 6, 0, (w * 5) / 6, h);
    case 'can':
    case 'flowChartMagneticDisk': {
      const e = h * (prst === 'can' ? a('adj', 25000) : 0.15);
      return box(0, e, w, h - e / 2);
    }
    case 'cube': {
      const o = ss * a('adj', 25000);
      return box(0, o, w - o, h);
    }
    case 'plus': {
      const o = ss * a('adj', 25000);
      return box(0, o, w, h - o);
    }
    case 'star5':
      return box(w * 0.31, h * 0.36, w * 0.69, h * 0.75);
    case 'star4':
    case 'star6':
    case 'star8':
      return box(w * 0.27, h * 0.27, w * 0.73, h * 0.73);
    case 'pentagon':
      return box(w * 0.19, h * 0.27, w * 0.81, h);
    case 'homePlate':
    case 'chevron': {
      const o = ss * a('adj', 50000);
      return box(prst === 'chevron' ? o : 0, 0, w - o / 2, h);
    }
    case 'rightArrow':
    case 'leftArrow':
    case 'leftRightArrow': {
      const shaft = h * a('adj1', 50000);
      const head = Math.min(w, h) * a('adj2', 50000);
      const l = prst === 'rightArrow' ? 0 : head / 2;
      const r = prst === 'leftArrow' ? w : w - head / 2;
      return box(l, (h - shaft) / 2, r, (h + shaft) / 2);
    }
    case 'upArrow':
    case 'downArrow':
    case 'upDownArrow': {
      const shaft = w * a('adj1', 50000);
      const head = Math.min(w, h) * a('adj2', 50000);
      const t = prst === 'downArrow' ? 0 : head / 2;
      const b = prst === 'upArrow' ? h : h - head / 2;
      return box((w - shaft) / 2, t, (w + shaft) / 2, b);
    }
    case 'heart':
      return box(w / 6, h / 6, (w * 5) / 6, (h * 2) / 3);
    case 'cloud':
    case 'cloudCallout':
      return box(w * 0.15, h * 0.15, w * 0.85, h * 0.85);
    case 'frame':
    case 'bevel': {
      const t = ss * (prst === 'frame' ? a('adj1', 12500) : a('adj', 12500));
      return box(t, t, w - t, h - t);
    }
    default:
      return box(0, 0, w, h);
  }
}

/** a:custGeom → SVG path, scaled to w × h */
function customPath(geom: Element, w: number, h: number): { d: string; open: boolean } {
  let d = '';
  let open = true;
  for (const path of kids(aChild(geom, 'pathLst'))) {
    const pw = n(path.getAttribute('w'), w) || w;
    const ph = n(path.getAttribute('h'), h) || h;
    const sx = w / pw, sy = h / ph;
    let cx = 0, cy = 0;
    const pt = (p: Element | null) => [n(p?.getAttribute('x')) * sx, n(p?.getAttribute('y')) * sy];
    if (path.getAttribute('fill') !== 'none') open = false;
    for (const c of kids(path)) {
      const pts = byNames(c, 'pt').map(pt);
      switch (c.localName) {
        case 'moveTo':
          [cx, cy] = pts[0] ?? [0, 0];
          d += `M${num(cx)},${num(cy)} `;
          break;
        case 'lnTo':
          [cx, cy] = pts[0] ?? [cx, cy];
          d += `L${num(cx)},${num(cy)} `;
          break;
        case 'cubicBezTo':
          if (pts.length === 3) {
            d += `C${pts.map((p) => `${num(p[0])},${num(p[1])}`).join(' ')} `;
            [cx, cy] = pts[2];
          }
          break;
        case 'quadBezTo':
          if (pts.length === 2) {
            d += `Q${pts.map((p) => `${num(p[0])},${num(p[1])}`).join(' ')} `;
            [cx, cy] = pts[1];
          }
          break;
        case 'arcTo': {
          const wR = n(c.getAttribute('wR')) * sx, hR = n(c.getAttribute('hR')) * sy;
          const st = (n(c.getAttribute('stAng')) / 60000) * (Math.PI / 180);
          const sw = (n(c.getAttribute('swAng')) / 60000) * (Math.PI / 180);
          const ox = cx - wR * Math.cos(st), oy = cy - hR * Math.sin(st);
          const ex = ox + wR * Math.cos(st + sw), ey = oy + hR * Math.sin(st + sw);
          d += `A${num(wR)},${num(hR)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${num(ex)},${num(ey)} `;
          [cx, cy] = [ex, ey];
          break;
        }
        case 'close':
          d += 'Z ';
          break;
      }
    }
  }
  return { d: d.trim() || poly([[0, 0], [w, 0], [w, h], [0, h]]), open };
}

// ---- text in shapes -------------------------------------------------------------

/** DrawingML text (a:txBody: SmartArt, some text boxes) → HTML */
function dmlText(txBody: Element, theme: Theme, color: string | null): string {
  let html = '';
  for (const p of kids(txBody).filter((k) => k.localName === 'p')) {
    const algn = aChild(p, 'pPr')?.getAttribute('algn');
    const align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left';
    let inner = '';
    for (const r of kids(p)) {
      if (r.localName === 'br') inner += '<br/>';
      if (r.localName !== 'r' && r.localName !== 'fld') continue;
      const rPr = aChild(r, 'rPr');
      const st: string[] = [];
      const sz = n(rPr?.getAttribute('sz'));
      if (sz) st.push(`font-size:${r2(sz / 100)}pt`);
      if (rPr?.getAttribute('b') === '1') st.push('font-weight:bold');
      if (rPr?.getAttribute('i') === '1') st.push('font-style:italic');
      if (rPr?.getAttribute('u') && rPr.getAttribute('u') !== 'none') st.push('text-decoration:underline');
      const c = colorIn(aChild(rPr, 'solidFill'), theme);
      if (c) st.push(`color:${css(c)}`);
      inner += `<span style="${st.join(';')}">${escapeHtml(aChild(r, 't')?.textContent ?? '')}</span>`;
    }
    html += `<p style="margin:0;text-align:${align}">${inner || '<br/>'}</p>`;
  }
  return color ? `<div style="color:${color}">${html}</div>` : html;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** the shape's text: a Word text box (w:txbxContent) or DrawingML text (a:txBody) */
function shapeText(sp: Element, box: Box, ctx: DrawCtx, defColor: string | null): string {
  const txbx = byName(sp, 'txbx');
  const content = txbx ? kids(txbx).find((k) => k.localName === 'txbxContent') : null;
  const txBody = byName(sp, 'txBody');
  if (!content && !txBody) return '';
  const bodyPr = byName(sp, 'bodyPr') ?? (txBody ? aChild(txBody, 'bodyPr') : null);
  const ins = (name: string, d: number) => n(bodyPr?.getAttribute(name), d) / EMU_PX;
  const anchor = bodyPr?.getAttribute('anchor') ?? 't';
  const vert = bodyPr?.getAttribute('vert') ?? 'horz';
  const justify = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start';
  const writing = vert === 'vert' || vert === 'eaVert' ? 'writing-mode:vertical-rl;' : vert === 'vert270' ? 'writing-mode:vertical-rl;transform:rotate(180deg);' : '';
  // wrap="none": one line per paragraph, however wide
  const nowrap = bodyPr?.getAttribute('wrap') === 'none' ? 'white-space:nowrap;' : '';
  const inner = content ? ctx.text(content) : dmlText(txBody!, ctx.theme, defColor);
  const style =
    `width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;justify-content:${justify};` +
    `padding:${num(ins('tIns', 45720))}px ${num(ins('rIns', 91440))}px ${num(ins('bIns', 45720))}px ${num(ins('lIns', 91440))}px;` +
    `overflow:visible;${writing}${nowrap}${defColor ? `color:${defColor};` : ''}`;
  return `<foreignObject x="${num(box.x)}" y="${num(box.y)}" width="${num(Math.max(1, box.w))}" height="${num(Math.max(1, box.h))}" style="overflow:visible"><div xmlns="${XHTML}" class="ez-wtxbx" style="${style}">${inner}</div></foreignObject>`;
}

// ---- shapes and groups ------------------------------------------------------------

interface Xfrm {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  flipH: boolean;
  flipV: boolean;
  chX: number;
  chY: number;
  chW: number;
  chH: number;
}

function xfrmOf(el: Element | null): Xfrm | null {
  const x = el ? (kids(el).find((k) => k.localName === 'xfrm') ?? null) : null;
  if (!x) return null;
  const off = aChild(x, 'off'), ext = aChild(x, 'ext'), chOff = aChild(x, 'chOff'), chExt = aChild(x, 'chExt');
  return {
    x: n(off?.getAttribute('x')),
    y: n(off?.getAttribute('y')),
    w: n(ext?.getAttribute('cx')),
    h: n(ext?.getAttribute('cy')),
    rot: n(x.getAttribute('rot')) / 60000,
    flipH: x.getAttribute('flipH') === '1',
    flipV: x.getAttribute('flipV') === '1',
    chX: n(chOff?.getAttribute('x')),
    chY: n(chOff?.getAttribute('y')),
    chW: n(chExt?.getAttribute('cx')),
    chH: n(chExt?.getAttribute('cy')),
  };
}

/** maps child coordinates (EMU, in the group's child space) to px */
type Map2 = (x: number, y: number, w: number, h: number) => Box;

function transformAttr(box: Box, rot: number, flipH: boolean, flipV: boolean) {
  const flip = flipAttr(box, flipH, flipV);
  return placeAttr(box, rot) + (flip ? ` ${flip}` : '');
}

/** where a shape sits, and its rotation (about its centre) */
function placeAttr(box: Box, rot: number) {
  return `translate(${num(box.x)} ${num(box.y)})${rot ? ` rotate(${num(rot)} ${num(box.w / 2)} ${num(box.h / 2)})` : ''}`;
}

/** a mirrored shape (its text is not mirrored) */
function flipAttr(box: Box, flipH: boolean, flipV: boolean) {
  return flipH || flipV ? `translate(${flipH ? num(box.w) : 0} ${flipV ? num(box.h) : 0}) scale(${flipH ? -1 : 1} ${flipV ? -1 : 1})` : '';
}

/** mirroring a group passes to what is in it */
interface Flip {
  h: boolean;
  v: boolean;
}
const NO_FLIP: Flip = { h: false, v: false };
/** a shape's rotation as seen inside groups mirrored an odd number of times turns the other way */
const turn = (rot: number, inh: Flip) => (inh.h !== inh.v ? -rot : rot);

/**
 * `whole`: the box of a shape that is the whole drawing (used when it has no a:xfrm);
 * `inh`: the mirroring of the groups it is in (its outline mirrors, its text does not)
 */
function shapeSvg(sp: Element, map: Map2, ctx: DrawCtx, whole?: Box, inh: Flip = NO_FLIP): string {
  const spPr = byName(sp, 'spPr');
  const xf = xfrmOf(spPr) ?? (whole ? { x: 0, y: 0, w: 0, h: 0, rot: 0, flipH: false, flipV: false, chX: 0, chY: 0, chW: 0, chH: 0 } : null);
  if (!xf) return '';
  const box = whole && !xfrmOf(spPr) ? whole : map(xf.x, xf.y, xf.w, xf.h);
  const local: Box = { x: 0, y: 0, w: box.w, h: box.h };
  const style = byName(sp, 'style');
  const prstGeom = aChild(spPr, 'prstGeom');
  const custGeom = aChild(spPr, 'custGeom');
  const prst = prstGeom?.getAttribute('prst') ?? (custGeom ? '' : 'rect');
  const connector = /Connector|^line$/.test(prst) || !!byName(sp, 'cNvCnPr');
  const geom = custGeom ? customPath(custGeom, box.w, box.h) : presetPath(prst, box.w, box.h, adjust(prstGeom));
  const p = paint(spPr, style, ctx, connector || geom.open);
  const fontColor = colorIn(byName(style, 'fontRef'), ctx.theme);
  const { defs, attrs: marks } = arrows(ctx, p.stroke, p.head, p.tail);
  const strokeAttr = p.stroke ? ` stroke="${p.stroke}" stroke-width="${num(p.width)}"${p.dash ? ` stroke-dasharray="${p.dash}"` : ''} stroke-linejoin="round"` : ' stroke="none"';
  let geo = '';
  if (p.image) geo += `<image href="${escapeHtml(p.image)}" x="0" y="0" width="${num(box.w)}" height="${num(box.h)}" preserveAspectRatio="none"/>`;
  geo += `<path d="${geom.d}" fill="${geom.open ? 'none' : p.fill}" fill-rule="evenodd"${strokeAttr}${marks}/>`;
  if ('extra' in geom && geom.extra && p.stroke) geo += `<path d="${geom.extra}" fill="none"${strokeAttr}/>`;
  const flip = flipAttr(box, xf.flipH !== inh.h, xf.flipV !== inh.v);
  // custom geometry may name its own text rectangle; presets have theirs
  const text = shapeText(sp, custGeom ? local : textRect(prst, box.w, box.h, adjust(prstGeom)), ctx, fontColor ? css(fontColor) : null);
  return `<g transform="${placeAttr(box, turn(xf.rot, inh))}">${defs ? `<defs>${defs}</defs>` : ''}${flip ? `<g transform="${flip}">${geo}</g>` : geo}${text}</g>`;
}

function pictureSvg(pic: Element, map: Map2, ctx: DrawCtx, inh: Flip = NO_FLIP): string {
  const xf = xfrmOf(byName(pic, 'spPr'));
  const blip = firstDesc(pic, A, 'blip');
  const rid = blip?.getAttributeNS(NS.r, 'embed') ?? null;
  const url = rid ? ctx.image(rid) : null;
  if (!xf || !url) return '';
  const box = map(xf.x, xf.y, xf.w, xf.h);
  return `<g transform="${transformAttr(box, turn(xf.rot, inh), xf.flipH !== inh.h, xf.flipV !== inh.v)}"><image href="${escapeHtml(url)}" x="0" y="0" width="${num(box.w)}" height="${num(box.h)}" preserveAspectRatio="none"/></g>`;
}

/** the children of a group or canvas: shapes, pictures, groups, in drawing order */
function childrenSvg(parent: Element, map: Map2, ctx: DrawCtx, inh: Flip = NO_FLIP): string {
  let out = '';
  for (const c of kids(parent)) {
    switch (c.localName) {
      case 'wsp':
      case 'sp':
      case 'cxnSp':
        out += shapeSvg(c, map, ctx, undefined, inh);
        break;
      case 'pic':
        out += pictureSvg(c, map, ctx, inh);
        break;
      case 'grpSp':
      case 'wgp':
        out += groupSvg(c, map, ctx, inh);
        break;
      case 'graphicFrame': {
        const xf = xfrmOf(c);
        const chartEl = c.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/chart', 'chart')[0];
        const rid = chartEl?.getAttributeNS(NS.r, 'id');
        if (xf && rid) {
          const box = map(xf.x, xf.y, xf.w, xf.h);
          const svg = ctx.chart(rid, box.w, box.h);
          if (svg) out += `<g transform="translate(${num(box.x)} ${num(box.y)})">${svg}</g>`;
        }
        break;
      }
    }
  }
  return out;
}

/**
 * A group: its children laid out in its own box (px). A mirrored group
 * places its children mirrored and passes the mirroring on, so each shape
 * mirrors its outline while its text stays readable, as in Word.
 */
function groupSvg(grp: Element, map: Map2, ctx: DrawCtx, inh: Flip = NO_FLIP): string {
  const xf = xfrmOf(byName(grp, 'grpSpPr'));
  if (!xf) return childrenSvg(grp, map, ctx, inh);
  const box = map(xf.x, xf.y, xf.w, xf.h);
  const sx = xf.chW ? box.w / xf.chW : 1 / EMU_PX;
  const sy = xf.chH ? box.h / xf.chH : 1 / EMU_PX;
  const flip: Flip = { h: xf.flipH !== inh.h, v: xf.flipV !== inh.v };
  const inner: Map2 = (x, y, w, h) => {
    const bx = (x - xf.chX) * sx, by = (y - xf.chY) * sy, bw = w * sx, bh = h * sy;
    return { x: flip.h ? box.w - bx - bw : bx, y: flip.v ? box.h - by - bh : by, w: bw, h: bh };
  };
  return `<g transform="${placeAttr(box, turn(xf.rot, inh))}">${childrenSvg(grp, inner, ctx, flip)}</g>`;
}

/**
 * lc:lockedCanvas: like a group, but its own box is often left empty (0 × 0);
 * then what its shapes cover is fitted to the drawing.
 */
function lockedCanvasSvg(canvas: Element, W: number, H: number, ctx: DrawCtx): string {
  const xf = xfrmOf(byName(canvas, 'grpSpPr'));
  let x0 = xf?.chX ?? 0, y0 = xf?.chY ?? 0, cw = xf?.chW ?? 0, ch = xf?.chH ?? 0;
  if (!(cw > 0 && ch > 0)) {
    let x1 = -Infinity, y1 = -Infinity;
    x0 = Infinity;
    y0 = Infinity;
    for (const c of kids(canvas)) {
      const box = xfrmOf(byName(c, 'spPr') ?? byName(c, 'grpSpPr'));
      if (!box || !(box.w > 0 || box.h > 0)) continue;
      x0 = Math.min(x0, box.x);
      y0 = Math.min(y0, box.y);
      x1 = Math.max(x1, box.x + box.w);
      y1 = Math.max(y1, box.y + box.h);
    }
    if (!Number.isFinite(x0) || !(x1 > x0) || !(y1 > y0)) return '';
    cw = x1 - x0;
    ch = y1 - y0;
  }
  const sx = W / cw, sy = H / ch;
  return childrenSvg(canvas, (x, y, w, h) => ({ x: (x - x0) * sx, y: (y - y0) * sy, w: w * sx, h: h * sy }), ctx);
}

/**
 * The drawing as one SVG. What it paints is clipped a little outside its box:
 * enough for strokes, arrow heads and text running over the edge, as in
 * Word, but no shape of the file can paint over the rest of the page.
 */
const svgWrap = (w: number, h: number, inner: string, label: string, clipId: string) => {
  const m = 24 + Math.max(w, h) * 0.1;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="ez-wsvg" viewBox="0 0 ${num(w)} ${num(h)}" width="${num(w)}" style="width:${num(w)}px;max-width:100%;height:auto;overflow:visible" role="img" aria-label="${escapeHtml(label)}">` +
    `<defs><clipPath id="${clipId}"><rect x="${num(-m)}" y="${num(-m)}" width="${num(w + 2 * m)}" height="${num(h + 2 * m)}"/></clipPath></defs>` +
    `<g clip-path="url(#${clipId})">${inner}</g></svg>`
  );
};

/** how a drawing sits in the text: inline, or floating (shown on its own line) with its alignment */
export function placement(drawing: Element): { block: boolean; align: Drawn['align']; offset: number } {
  const anchor = kids(drawing).find((k) => k.localName === 'anchor');
  if (!anchor) return { block: false, align: null, offset: 0 };
  const posH = byName(anchor, 'positionH');
  const al = byName(posH, 'align')?.textContent?.trim();
  if (al === 'center') return { block: true, align: 'center', offset: 0 };
  if (al === 'right' || al === 'outside') return { block: true, align: 'right', offset: 0 };
  // placed by an offset from the column or the margin: kept, within reason (page-relative offsets are not)
  const from = posH?.getAttribute('relativeFrom') ?? '';
  const off = n(byName(posH, 'posOffset')?.textContent) / EMU_PX;
  const offset = ['column', 'margin', 'character', 'insideMargin', 'leftMargin'].includes(from) && from !== 'leftMargin' && off > 0 ? Math.min(off, 600) : 0;
  return { block: true, align: 'left', offset };
}

/**
 * A w:drawing that is not a plain picture: a shape, a group, a canvas, a
 * chart or a SmartArt, as SVG. null: a picture (shown as an image by the
 * reader) or something not drawable.
 */
export function drawingSvg(drawing: Element, ctx: DrawCtx): Drawn | null {
  const holder = kids(drawing).find((k) => k.localName === 'inline' || k.localName === 'anchor');
  if (!holder) return null;
  const extent = byName(holder, 'extent');
  const cx = n(extent?.getAttribute('cx')) / EMU_PX;
  const cy = n(extent?.getAttribute('cy')) / EMU_PX;
  // a straight line has no height (or no width): still drawn
  if (!(cx > 0 || cy > 0) || cx < 0 || cy < 0 || cx > 20000 || cy > 20000) return null;
  const W = Math.max(cx, 1);
  const H = Math.max(cy, 1);
  const graphicData = firstDesc(holder, A, 'graphicData');
  const uri = graphicData?.getAttribute('uri') ?? '';
  const body = graphicData ? kids(graphicData)[0] : null;
  if (!body) return null;
  const { block, align, offset } = placement(drawing);
  const whole: Map2 = (x, y, w, h) => ({ x: x / EMU_PX, y: y / EMU_PX, w: w / EMU_PX, h: h / EMU_PX });
  let inner = '';
  let label = 'Hình vẽ';
  if (/\/picture$/.test(uri)) return null;
  if (/wordprocessingShape$/.test(uri)) {
    // a single shape: its own offset is the drawing's origin
    const xf = xfrmOf(byName(body, 'spPr'));
    const map: Map2 = (x, y, w, h) => ({ x: (x - (xf?.x ?? 0)) / EMU_PX, y: (y - (xf?.y ?? 0)) / EMU_PX, w: w / EMU_PX, h: h / EMU_PX });
    inner = shapeSvg(body, map, ctx, { x: 0, y: 0, w: cx, h: cy });
  } else if (/wordprocessingGroup$/.test(uri)) {
    const xf = xfrmOf(byName(body, 'grpSpPr'));
    const sx = xf?.chW ? W / xf.chW : 1 / EMU_PX;
    const sy = xf?.chH ? H / xf.chH : 1 / EMU_PX;
    // the group mirrored as a whole: its children placed mirrored, their outlines mirrored, their text not
    const flip: Flip = { h: !!xf?.flipH, v: !!xf?.flipV };
    const map: Map2 = (x, y, w, h) => {
      const bx = (x - (xf?.chX ?? 0)) * sx, by = (y - (xf?.chY ?? 0)) * sy, bw = w * sx, bh = h * sy;
      return { x: flip.h ? W - bx - bw : bx, y: flip.v ? H - by - bh : by, w: bw, h: bh };
    };
    inner = childrenSvg(body, map, ctx, flip);
  } else if (/lockedCanvas$/.test(uri)) {
    // a locked canvas (older Word, and other programs): a group scaled to the drawing's size
    inner = lockedCanvasSvg(body, W, H, ctx);
  } else if (/wordprocessingCanvas$/.test(uri)) {
    const bg = byName(body, 'bg');
    const fill = bg ? paint(bg, null, ctx, false).fill : 'none';
    inner = `<rect x="0" y="0" width="${num(W)}" height="${num(H)}" fill="${fill}"/>${childrenSvg(body, whole, ctx)}`;
  } else if (/\/chart$/.test(uri)) {
    const rid = body.getAttributeNS(NS.r, 'id');
    const svg = rid ? ctx.chart(rid, W, H) : null;
    if (!svg) return null;
    inner = svg;
    label = 'Biểu đồ';
  } else if (/\/diagram$/.test(uri)) {
    const dm = body.getAttributeNS(NS.r, 'dm');
    const dsp = dm ? ctx.diagram(dm) : null;
    const tree = dsp ? kids(dsp.root).find((k) => k.localName === 'spTree') : null;
    if (!tree) return null;
    inner = childrenSvg(tree, whole, dsp!.ctx);
    label = 'SmartArt';
  } else return null;
  if (!inner) return null;
  return { html: svgWrap(W, H, inner, label, `ezc${ctx.uid()}`), w: W, h: H, block, align, offset, label };
}

// ---- VML ------------------------------------------------------------------------------

const V = NS.v;
const O = 'urn:schemas-microsoft-com:office:office';

/** "12pt", "1.5in", "30" → px; a bare number is taken as it is (px, or units of the group) */
function vmlLen(v: string | null | undefined): number {
  if (!v) return 0;
  const m = /^\s*(-?[\d.]+)\s*(pt|px|in|cm|mm|pc|em)?\s*$/.exec(v);
  if (!m) return 0;
  const x = Number(m[1]);
  if (!Number.isFinite(x)) return 0;
  const k: Record<string, number> = { pt: 4 / 3, px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pc: 16, em: 16 };
  return x * (m[2] ? k[m[2]] : 1);
}

function vmlStyle(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (el.getAttribute('style') ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return out;
}

const VML_NAMED: Record<string, string> = Object.fromEntries(
  Object.entries({ ...PRESET, windowText: '000000', window: 'FFFFFF', buttonFace: 'F0F0F0', windowFrame: '646464' }).map(([k, v]) => [k.toLowerCase(), v]),
);

/** "#4472c4", "red", "black [3213]" → #rrggbb; anything else → the default */
function vmlColor(v: string | null, d: string | null): string | null {
  if (!v) return d;
  const s = v.trim().split(/\s+/)[0].toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return VML_NAMED[s] ? `#${VML_NAMED[s]}` : d;
}

const isFalse = (v: string | null | undefined) => v != null && ['f', 'false', '0', 'off'].includes(v.trim().toLowerCase());

/** a VML fraction: "0.5", "50%", or "32768f" (1/65536) */
function vmlFraction(v: string | null, d: number): number {
  if (!v) return d;
  const s = v.trim();
  const x = /f$/.test(s) ? Number(s.slice(0, -1)) / 65536 : /%$/.test(s) ? Number(s.slice(0, -1)) / 100 : Number(s);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : d;
}

/** legacy shape types (o:spt, or the number in type="#_x0000_tN") → DrawingML preset */
const SPT: Record<number, string> = {
  1: 'rect', 2: 'roundRect', 3: 'ellipse', 4: 'diamond', 5: 'triangle', 6: 'rtTriangle', 7: 'parallelogram', 8: 'trapezoid',
  9: 'hexagon', 10: 'octagon', 11: 'plus', 12: 'star5', 13: 'rightArrow', 15: 'homePlate', 16: 'cube', 20: 'line',
  22: 'can', 23: 'donut', 32: 'straightConnector1', 33: 'bentConnector2', 34: 'bentConnector3', 37: 'curvedConnector2',
  38: 'curvedConnector3', 55: 'chevron', 56: 'pentagon', 61: 'wedgeRectCallout', 62: 'wedgeRoundRectCallout',
  63: 'wedgeEllipseCallout', 66: 'leftArrow', 67: 'downArrow', 68: 'upArrow', 69: 'leftRightArrow', 70: 'upDownArrow',
  74: 'heart', 75: 'rect', 84: 'bevel', 85: 'leftBracket', 86: 'rightBracket', 87: 'leftBrace', 88: 'rightBrace',
  106: 'wedgeEllipseCallout', 109: 'rect', 110: 'flowChartDecision', 111: 'flowChartInputOutput',
  112: 'flowChartPredefinedProcess', 113: 'flowChartInternalStorage', 114: 'flowChartDocument',
  115: 'flowChartMultidocument', 116: 'flowChartTerminator', 117: 'flowChartPreparation', 118: 'flowChartManualInput',
  119: 'flowChartManualOperation', 120: 'flowChartConnector', 121: 'flowChartPunchedCard', 122: 'flowChartPunchedTape',
  123: 'flowChartSummingJunction', 124: 'flowChartOr', 125: 'flowChartCollate', 126: 'flowChartSort', 127: 'flowChartExtract',
  128: 'flowChartMerge', 129: 'flowChartOfflineStorage', 130: 'flowChartOnlineStorage', 132: 'flowChartMagneticDisk',
  133: 'flowChartMagneticDrum', 134: 'flowChartDisplay', 135: 'flowChartDelay', 176: 'flowChartAlternateProcess',
  177: 'flowChartOffpageConnector', 183: 'star4', 184: 'star8', 185: 'bracketPair', 187: 'star6', 202: 'rect',
};

/** a VML path (m l c x e, and the relative t r v) in the shape's coordsize → SVG path */
function vmlPath(path: string, sx: number, sy: number): string {
  const tokens = path.match(/[a-z]+|-?[\d.]+/gi) ?? [];
  let d = '';
  let cmd = '';
  let cx = 0, cy = 0;
  const nums: number[] = [];
  const flush = () => {
    const take = (k: number) => nums.splice(0, k);
    switch (cmd) {
      case 'm':
      case 't':
        while (nums.length >= 2) {
          const [x, y] = take(2);
          [cx, cy] = cmd === 't' ? [cx + x, cy + y] : [x, y];
          d += `M${num(cx * sx)},${num(cy * sy)} `;
        }
        break;
      case 'l':
      case 'r':
        while (nums.length >= 2) {
          const [x, y] = take(2);
          [cx, cy] = cmd === 'r' ? [cx + x, cy + y] : [x, y];
          d += `L${num(cx * sx)},${num(cy * sy)} `;
        }
        break;
      case 'c':
      case 'v':
        while (nums.length >= 6) {
          const p = take(6);
          const q = cmd === 'v' ? p.map((v, i) => v + (i % 2 ? cy : cx)) : p;
          d += `C${num(q[0] * sx)},${num(q[1] * sy)} ${num(q[2] * sx)},${num(q[3] * sy)} ${num(q[4] * sx)},${num(q[5] * sy)} `;
          [cx, cy] = [q[4], q[5]];
        }
        break;
    }
    nums.length = 0;
  };
  for (const t of tokens) {
    if (/^[a-z]+$/i.test(t)) {
      flush();
      cmd = t.toLowerCase();
      if (cmd === 'x') d += 'Z ';
      if (!['m', 't', 'l', 'r', 'c', 'v'].includes(cmd)) cmd = '';
    } else nums.push(Number(t));
  }
  flush();
  return d.trim();
}

/** the v:shapetype a shape refers to (Word writes each type once per document) */
const shapetypes = new WeakMap<Document, Map<string, Element>>();
function shapetype(el: Element): Element | null {
  const ref = (el.getAttribute('type') ?? '').replace(/^#/, '');
  const doc = el.ownerDocument;
  if (!ref || !doc) return null;
  let map = shapetypes.get(doc);
  if (!map) {
    map = new Map();
    const all = doc.getElementsByTagNameNS(V, 'shapetype');
    for (let i = 0; i < all.length; i++) map.set(all[i].getAttribute('id') ?? '', all[i]);
    shapetypes.set(doc, map);
  }
  return map.get(ref) ?? null;
}

/** where the elements of one VML level go: their boxes and points in px */
interface VLevel {
  ctx: DrawCtx;
  box(el: Element): Box;
  pt(x: number, y: number): [number, number];
}

const pair = (v: string | null, d = '0,0') => {
  const [a, b] = (v ?? d).split(',');
  return [vmlLen(a), vmlLen(b)] as const;
};

function vmlPaint(el: Element) {
  const fillEl = kids(el).find((k) => k.localName === 'fill');
  const strokeEl = kids(el).find((k) => k.localName === 'stroke');
  const filled = !isFalse(el.getAttribute('filled')) && !isFalse(fillEl?.getAttribute('on'));
  const fill = filled ? (vmlColor(fillEl?.getAttribute('color') ?? el.getAttribute('fillcolor'), '#ffffff') ?? 'none') : 'none';
  const fillOpacity = vmlFraction(fillEl?.getAttribute('opacity') ?? null, 1);
  const stroked = !isFalse(el.getAttribute('stroked')) && !isFalse(strokeEl?.getAttribute('on'));
  const stroke = stroked ? vmlColor(strokeEl?.getAttribute('color') ?? el.getAttribute('strokecolor'), '#000000') : null;
  const width = Math.max(0.5, vmlLen(strokeEl?.getAttribute('weight') ?? el.getAttribute('strokeweight') ?? '0.75pt') || 1);
  const ds = (strokeEl?.getAttribute('dashstyle') ?? '').toLowerCase();
  const w = Math.max(width, 1);
  const dash = ds && ds !== 'solid' ? (/dot/.test(ds) && !/dash/.test(ds) ? `${w} ${w}` : /longdash/.test(ds) ? `${8 * w} ${3 * w}` : `${4 * w} ${3 * w}`) : null;
  const end = (which: 'start' | 'end'): End | null => {
    const t = strokeEl?.getAttribute(`${which}arrow`);
    if (!t || t === 'none') return null;
    const type = t === 'block' ? 'triangle' : t === 'open' ? 'arrow' : t === 'classic' ? 'stealth' : t === 'oval' ? 'oval' : t === 'diamond' ? 'diamond' : 'triangle';
    const size = (v: string | null | undefined) => (v === 'narrow' || v === 'short' ? 'sm' : v === 'wide' || v === 'long' ? 'lg' : 'med');
    return { type, size: arrowSize(width, size(strokeEl?.getAttribute(`${which}arrowwidth`)), size(strokeEl?.getAttribute(`${which}arrowlength`))) };
  };
  return { fill, fillOpacity, stroke, width, dash, head: end('start'), tail: end('end') };
}

/** `area`: where the text goes in the shape's own box (its text rectangle) */
function vmlText(el: Element, box: Box, ctx: DrawCtx, area: Box = { x: 0, y: 0, w: box.w, h: box.h }): string {
  const tb = kids(el).find((k) => k.localName === 'textbox');
  const content = tb ? kids(tb).find((k) => k.localName === 'txbxContent') : null;
  const textpath = kids(el).find((k) => k.localName === 'textpath');
  const fo = (style: string, inner: string) =>
    `<foreignObject x="${num(area.x)}" y="${num(area.y)}" width="${num(Math.max(1, area.w))}" height="${num(Math.max(1, area.h))}" style="overflow:visible"><div xmlns="${XHTML}" class="ez-wtxbx" style="${style}">${inner}</div></foreignObject>`;
  if (content) {
    const inset = (tb!.getAttribute('inset') ?? '').split(',');
    const pad = (i: number, d: number) => (inset[i] && inset[i].trim() ? vmlLen(inset[i]) : d);
    const vertical = /vertical/.test(vmlStyle(tb!)['layout-flow'] ?? '');
    return fo(
      `width:100%;height:100%;box-sizing:border-box;padding:${num(pad(1, 4.8))}px ${num(pad(2, 9.6))}px ${num(pad(3, 4.8))}px ${num(pad(0, 9.6))}px;overflow:visible${vertical ? ';writing-mode:vertical-rl' : ''}`,
      ctx.text(content),
    );
  }
  if (textpath && !isFalse(textpath.getAttribute('on'))) {
    // WordArt: its text, as large as the shape allows
    const text = textpath.getAttribute('string') ?? '';
    const color = vmlColor(el.getAttribute('fillcolor'), '#000000');
    return fo(
      `width:100%;height:100%;display:flex;align-items:center;justify-content:center;white-space:nowrap;font-weight:bold;font-size:${num(Math.max(6, box.h * 0.8))}px;line-height:1;color:${color}`,
      escapeHtml(text),
    );
  }
  return '';
}

function vmlImage(el: Element, box: Box, ctx: DrawCtx): string {
  const img = kids(el).find((k) => k.localName === 'imagedata');
  const rid = img ? (img.getAttributeNS(NS.r, 'id') || img.getAttributeNS(O, 'relid')) : null;
  const url = rid ? ctx.image(rid) : null;
  return url ? `<image href="${escapeHtml(url)}" x="0" y="0" width="${num(box.w)}" height="${num(box.h)}" preserveAspectRatio="none"/>` : '';
}

/** one VML element of a level → SVG */
function vmlElement(el: Element, lv: VLevel): string {
  const ctx = lv.ctx;
  const name = el.localName;
  if (name === 'group') return vmlGroup(el, lv);
  const p = vmlPaint(el);
  const { defs, attrs: marks } = arrows(ctx, p.stroke, p.head, p.tail);
  const strokeAttr = p.stroke ? ` stroke="${p.stroke}" stroke-width="${num(p.width)}"${p.dash ? ` stroke-dasharray="${p.dash}"` : ''} stroke-linejoin="round"` : ' stroke="none"';
  const fillAttr = (open: boolean) => (open ? ' fill="none"' : ` fill="${p.fill}"${p.fillOpacity < 1 && p.fill !== 'none' ? ` fill-opacity="${num(p.fillOpacity)}"` : ''}`);
  const defsSvg = defs ? `<defs>${defs}</defs>` : '';

  // lines: points in the level's coordinates
  if (name === 'line' || name === 'polyline' || name === 'curve') {
    let d = '';
    if (name === 'line') {
      const a = lv.pt(...pair(el.getAttribute('from'))), b = lv.pt(...pair(el.getAttribute('to')));
      d = `M${num(a[0])},${num(a[1])} L${num(b[0])},${num(b[1])}`;
    } else if (name === 'curve') {
      const [a, c1, c2, b] = ['from', 'control1', 'control2', 'to'].map((k) => lv.pt(...pair(el.getAttribute(k))));
      d = `M${num(a[0])},${num(a[1])} C${num(c1[0])},${num(c1[1])} ${num(c2[0])},${num(c2[1])} ${num(b[0])},${num(b[1])}`;
    } else {
      const v = (el.getAttribute('points') ?? '').split(/[\s,]+/).filter(Boolean).map(vmlLen);
      for (let i = 0; i + 1 < v.length; i += 2) {
        const q = lv.pt(v[i], v[i + 1]);
        d += `${i ? 'L' : 'M'}${num(q[0])},${num(q[1])} `;
      }
    }
    return d ? `${defsSvg}<path d="${d.trim()}" fill="none"${strokeAttr}${marks}/>` : '';
  }

  // shapes: a box
  const box = lv.box(el);
  const style = vmlStyle(el);
  const rot = Number(style.rotation) || 0;
  const flip = (style.flip ?? '').toLowerCase();
  let geom: { d: string; open: boolean; extra?: string };
  let preset = 'rect';
  if (name === 'oval') {
    geom = { d: ellipse(0, 0, box.w, box.h), open: false };
    preset = 'ellipse';
  } else if (name === 'roundrect') geom = presetPath('roundRect', box.w, box.h, { adj: vmlFraction(el.getAttribute('arcsize'), 0.2) * 50000 });
  else if (name === 'rect' || name === 'image') geom = presetPath('rect', box.w, box.h);
  else {
    const st = shapetype(el);
    const spt = Number(el.getAttributeNS(O, 'spt') || st?.getAttributeNS(O, 'spt') || /_x0000_t(\d+)$/.exec(el.getAttribute('type') ?? '')?.[1] || 0);
    const path = el.getAttribute('path') ?? (SPT[spt] ? null : st?.getAttribute('path')) ?? null;
    if (path && !/@/.test(path)) {
      const cs = (el.getAttribute('coordsize') ?? st?.getAttribute('coordsize') ?? '21600,21600').split(',').map(Number);
      const closed = /x/i.test(path);
      geom = { d: vmlPath(path, box.w / (cs[0] || 21600), box.h / (cs[1] || 21600)), open: !closed };
    } else {
      preset = SPT[spt] ?? 'rect';
      geom = presetPath(preset, box.w, box.h);
    }
  }
  const lineLike = geom.open;
  const image = vmlImage(el, box, ctx);
  // a picture's frame: its outline only, the picture shows through
  const geo =
    image +
    (name === 'image' || (image && !p.stroke)
      ? ''
      : `<path d="${geom.d}"${fillAttr(lineLike || !!image)} fill-rule="evenodd"${strokeAttr}${lineLike ? marks : ''}/>`) +
    (geom.extra && p.stroke ? `<path d="${geom.extra}" fill="none"${strokeAttr}/>` : '');
  const fl = flipAttr(box, /x/.test(flip), /y/.test(flip));
  return `<g transform="${placeAttr(box, rot)}">${defsSvg}${fl ? `<g transform="${fl}">${geo}</g>` : geo}${vmlText(el, box, ctx, textRect(preset, box.w, box.h))}</g>`;
}

/** a v:group: its children in its own coordinate space (coordorigin, coordsize) */
function vmlGroup(g: Element, parent: VLevel): string {
  const box = parent.box(g);
  const size = (g.getAttribute('coordsize') ?? '1000,1000').split(',').map(Number);
  const origin = (g.getAttribute('coordorigin') ?? '0,0').split(',').map(Number);
  const cw = size[0] || 1000, ch = size[1] || 1000;
  const ox = origin[0] || 0, oy = origin[1] || 0;
  const kx = box.w / cw, ky = box.h / ch;
  const lv: VLevel = {
    ctx: parent.ctx,
    box(el) {
      const s = vmlStyle(el);
      return { x: (vmlLen(s.left ?? s['margin-left']) - ox) * kx, y: (vmlLen(s.top ?? s['margin-top']) - oy) * ky, w: vmlLen(s.width) * kx, h: vmlLen(s.height) * ky };
    },
    pt: (x, y) => [(x - ox) * kx, (y - oy) * ky],
  };
  let out = '';
  for (const c of kids(g)) if (c.namespaceURI === V && c.localName !== 'shapetype' && c.localName !== 'formulas' && c.localName !== 'path') out += vmlElement(c, lv);
  const rot = Number(vmlStyle(g).rotation) || 0;
  return `<g transform="${placeAttr(box, rot)}">${out}</g>`;
}

/**
 * A w:pict (or the VML of a w:object) with shapes, as SVG. null when it only
 * holds a picture (the reader shows that as an image) or nothing drawable.
 */
export function vmlSvg(pict: Element, ctx: DrawCtx): Drawn | null {
  const top = kids(pict).filter((k) => k.namespaceURI === V && k.localName !== 'shapetype' && k.localName !== 'formulas');
  if (!top.length) return null;
  // a lone picture: an image, not a drawing
  const lone = top.length === 1 ? top[0] : null;
  if (lone && (lone.localName === 'shape' || lone.localName === 'rect' || lone.localName === 'image') && kids(lone).some((k) => k.localName === 'imagedata') && !kids(lone).some((k) => k.localName === 'textbox' || k.localName === 'textpath')) return null;
  // the top level: each element at the anchor, sized by its own style
  const lv: VLevel = {
    ctx,
    box(el) {
      const s = vmlStyle(el);
      return { x: 0, y: 0, w: vmlLen(s.width), h: vmlLen(s.height) };
    },
    pt: (x, y) => [x, y],
  };
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  let inner = '';
  let block = false;
  let align: Drawn['align'] = null;
  let offset = 0;
  for (const el of top) {
    const s = vmlStyle(el);
    if (s.position === 'absolute') {
      block = true;
      const h = s['mso-position-horizontal'];
      align = h === 'center' ? 'center' : h === 'right' || h === 'outside' ? 'right' : 'left';
      const rel = s['mso-position-horizontal-relative'] ?? 'text';
      const ml = vmlLen(s['margin-left']);
      if (align === 'left' && ['text', 'margin', 'char'].includes(rel) && ml > 0) offset = Math.min(ml, 600);
    }
    if (el.localName === 'line') {
      grow(...pair(el.getAttribute('from')));
      grow(...pair(el.getAttribute('to')));
    } else if (el.localName === 'polyline') {
      const v = (el.getAttribute('points') ?? '').split(/[\s,]+/).filter(Boolean).map(vmlLen);
      for (let i = 0; i + 1 < v.length; i += 2) grow(v[i], v[i + 1]);
    } else {
      const b = lv.box(el);
      grow(b.w, b.h);
    }
    inner += vmlElement(el, lv);
  }
  const W = Math.max(1, maxX - minX), H = Math.max(1, maxY - minY);
  if (!inner || W > 20000 || H > 20000) return null;
  if (minX || minY) inner = `<g transform="translate(${num(-minX)} ${num(-minY)})">${inner}</g>`;
  return { html: svgWrap(W, H, inner, 'Hình vẽ', `ezc${ctx.uid()}`), w: W, h: H, block, align, offset, label: 'Hình vẽ' };
}
