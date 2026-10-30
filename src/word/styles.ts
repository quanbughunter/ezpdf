/**
 * Word formatting as ezPDF needs it: enough of styles.xml (defaults, style
 * chains, character styles), the theme's fonts and direct formatting to show
 * a document close to Word and to know what bold, italic and underline a run
 * inherits. Units in the XML: twips (1/20 pt), half-points for font sizes,
 * EMU for drawings (12 700 per pt).
 */
import { attrNS, elements, isW, num, NS, onOff, wAttr, wChild, wVal } from './xml';

export interface RunProps {
  b?: boolean;
  i?: boolean;
  /** w:u w:val, 'none' when switched off */
  u?: string;
  strike?: boolean;
  dstrike?: boolean;
  caps?: boolean;
  smallCaps?: boolean;
  vanish?: boolean;
  color?: string;
  /** half-points */
  sz?: number;
  font?: string;
  highlight?: string;
  shd?: string;
  vertAlign?: string;
  /** letter spacing, twips */
  spacing?: number;
}

export interface Border {
  style: string;
  /** eighths of a point */
  sz?: number;
  color?: string;
}

export interface ParaProps {
  styleId?: string;
  jc?: string;
  left?: number;
  right?: number;
  firstLine?: number;
  hanging?: number;
  before?: number;
  after?: number;
  beforeAuto?: boolean;
  afterAuto?: boolean;
  line?: number;
  lineRule?: string;
  numId?: string;
  ilvl?: number;
  outline?: number;
  shd?: string;
  pageBreakBefore?: boolean;
  borders?: Partial<Record<'top' | 'bottom' | 'left' | 'right', Border>>;
}

const merge = <T extends object>(...layers: (T | undefined)[]): T => Object.assign({}, ...layers.filter(Boolean)) as T;

/**
 * Values from the file go into style attributes, so only what CSS is meant
 * to receive gets through: a colour is six hex digits, a number a number, a
 * font name letters, digits, spaces and a few signs (a crafted file cannot
 * end the declaration and add its own, e.g. a background url()).
 */
export const hexColor = (v: string | null | undefined) => (v && /^[0-9a-f]{6}$/i.test(v) ? `#${v}` : undefined);
const safeFont = (v: string | null | undefined) => {
  const f = (v ?? '').replace(/[^\p{L}\p{N} ._\-+&()]/gu, '').trim().slice(0, 64);
  return f || undefined;
};

export function readBorder(el: Element | null): Border | undefined {
  if (!el) return undefined;
  const style = wAttr(el, 'val') ?? 'none';
  const color = wAttr(el, 'color');
  return { style: /^[a-zA-Z]+$/.test(style) ? style : 'single', sz: num(wAttr(el, 'sz')), color: hexColor(color) };
}

function shading(el: Element | null): string | undefined {
  const fill = wAttr(el, 'fill');
  return fill && fill !== 'auto' && /^[0-9a-f]{6}$/i.test(fill) ? `#${fill}` : undefined;
}

export class Theme {
  major?: string;
  minor?: string;
  constructor(doc: Document | null) {
    if (!doc) return;
    const font = (scheme: string) => {
      const els = doc.getElementsByTagNameNS(NS.a, scheme);
      const latin = els[0] && elements(els[0]).find((e) => e.localName === 'latin');
      return latin?.getAttribute('typeface') || undefined;
    };
    this.major = font('majorFont');
    this.minor = font('minorFont');
  }
}

export function readRunProps(rPr: Element | null, theme?: Theme): RunProps {
  const p: RunProps = {};
  if (!rPr) return p;
  for (const el of elements(rPr)) {
    if (el.namespaceURI !== NS.w) continue;
    switch (el.localName) {
      case 'b':
        p.b = onOff(el);
        break;
      case 'i':
        p.i = onOff(el);
        break;
      case 'u':
        p.u = wAttr(el, 'val') ?? 'single';
        break;
      case 'strike':
        p.strike = onOff(el);
        break;
      case 'dstrike':
        p.dstrike = onOff(el);
        break;
      case 'caps':
        p.caps = onOff(el);
        break;
      case 'smallCaps':
        p.smallCaps = onOff(el);
        break;
      case 'vanish':
        p.vanish = onOff(el);
        break;
      case 'color': {
        const v = wAttr(el, 'val');
        if (v && v !== 'auto') p.color = hexColor(v) ?? p.color;
        else if (v === 'auto') p.color = undefined;
        break;
      }
      case 'sz':
        p.sz = num(wAttr(el, 'val')) ?? p.sz;
        break;
      case 'rFonts': {
        const theme1 = wAttr(el, 'hAnsiTheme') ?? wAttr(el, 'asciiTheme');
        const named = wAttr(el, 'hAnsi') ?? wAttr(el, 'ascii');
        const fromTheme = theme1 ? (/^major/.test(theme1) ? theme?.major : theme?.minor) : undefined;
        p.font = safeFont(fromTheme ?? named) ?? p.font;
        break;
      }
      case 'highlight': {
        const v = wAttr(el, 'val');
        p.highlight = v && v !== 'none' ? v : undefined;
        break;
      }
      case 'shd':
        p.shd = shading(el);
        break;
      case 'vertAlign':
        p.vertAlign = /^(superscript|subscript|baseline)$/.test(wAttr(el, 'val') ?? '') ? wAttr(el, 'val')! : undefined;
        break;
      case 'spacing':
        p.spacing = num(wAttr(el, 'val'));
        break;
    }
  }
  return p;
}

export function readParaProps(pPr: Element | null): ParaProps {
  const p: ParaProps = {};
  if (!pPr) return p;
  const style = wVal(pPr, 'pStyle');
  if (style) p.styleId = style;
  const jc = wVal(pPr, 'jc');
  if (jc) p.jc = jc;
  const ind = wChild(pPr, 'ind');
  if (ind) {
    const l = num(wAttr(ind, 'left') ?? wAttr(ind, 'start'));
    const r = num(wAttr(ind, 'right') ?? wAttr(ind, 'end'));
    const f = num(wAttr(ind, 'firstLine'));
    const h = num(wAttr(ind, 'hanging'));
    if (l !== undefined) p.left = l;
    if (r !== undefined) p.right = r;
    if (h !== undefined) {
      p.hanging = h;
      p.firstLine = undefined;
    } else if (f !== undefined) {
      p.firstLine = f;
      p.hanging = undefined;
    }
  }
  const sp = wChild(pPr, 'spacing');
  if (sp) {
    const before = num(wAttr(sp, 'before'));
    const after = num(wAttr(sp, 'after'));
    const line = num(wAttr(sp, 'line'));
    if (before !== undefined) p.before = before;
    if (after !== undefined) p.after = after;
    const ba = wAttr(sp, 'beforeAutospacing');
    const aa = wAttr(sp, 'afterAutospacing');
    if (ba !== null) p.beforeAuto = isOn(ba);
    if (aa !== null) p.afterAuto = isOn(aa);
    if (line !== undefined) {
      p.line = line;
      p.lineRule = wAttr(sp, 'lineRule') ?? 'auto';
    }
  }
  const numPr = wChild(pPr, 'numPr');
  if (numPr) {
    const id = wVal(numPr, 'numId');
    if (id !== null) p.numId = id;
    const lvl = num(wVal(numPr, 'ilvl'));
    if (lvl !== undefined) p.ilvl = lvl;
  }
  const outline = num(wVal(pPr, 'outlineLvl'));
  if (outline !== undefined) p.outline = outline;
  const shd = shading(wChild(pPr, 'shd'));
  if (shd) p.shd = shd;
  if (onOff(wChild(pPr, 'pageBreakBefore'))) p.pageBreakBefore = true;
  const bdr = wChild(pPr, 'pBdr');
  if (bdr) {
    p.borders = {};
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      const b = readBorder(wChild(bdr, side));
      if (b && b.style !== 'none' && b.style !== 'nil') p.borders[side] = b;
    }
  }
  return p;
}

interface StyleDef {
  id: string;
  type: string;
  name: string;
  basedOn?: string;
  p: ParaProps;
  r: RunProps;
  /** tables: borders and cell spacing defaults */
  tblBorders?: Partial<Record<'top' | 'bottom' | 'left' | 'right' | 'insideH' | 'insideV', Border>>;
}

export class Styles {
  readonly theme: Theme;
  private defs = new Map<string, StyleDef>();
  private defaults: { p: ParaProps; r: RunProps } = { p: {}, r: {} };
  defaultParagraph?: string;
  defaultCharacter?: string;
  defaultTable?: string;
  private cacheP = new Map<string, { p: ParaProps; r: RunProps }>();

  constructor(doc: Document | null, theme: Theme) {
    this.theme = theme;
    if (!doc) return;
    const root = doc.documentElement;
    const dd = elements(root).find((e) => isW(e, 'docDefaults'));
    if (dd) {
      this.defaults = {
        p: readParaProps(wChild(wChild(dd, 'pPrDefault'), 'pPr')),
        r: readRunProps(wChild(wChild(dd, 'rPrDefault'), 'rPr'), theme),
      };
    }
    for (const s of elements(root)) {
      if (!isW(s, 'style')) continue;
      const id = wAttr(s, 'styleId');
      if (!id) continue;
      const type = wAttr(s, 'type') ?? 'paragraph';
      const def: StyleDef = {
        id,
        type,
        name: wVal(s, 'name') ?? id,
        basedOn: wVal(s, 'basedOn') ?? undefined,
        p: readParaProps(wChild(s, 'pPr')),
        r: readRunProps(wChild(s, 'rPr'), theme),
      };
      if (type === 'table') {
        const borders = wChild(wChild(s, 'tblPr'), 'tblBorders');
        if (borders) {
          def.tblBorders = {};
          for (const side of ['top', 'bottom', 'left', 'right', 'insideH', 'insideV'] as const) {
            const b = readBorder(wChild(borders, side) ?? wChild(borders, side === 'left' ? 'start' : side === 'right' ? 'end' : side));
            if (b) def.tblBorders[side] = b;
          }
        }
      }
      this.defs.set(id, def);
      if (isOn(wAttr(s, 'default'))) {
        if (type === 'paragraph') this.defaultParagraph = id;
        else if (type === 'character') this.defaultCharacter = id;
        else if (type === 'table') this.defaultTable = id;
      }
    }
  }

  private chain(id: string | undefined, type: string): StyleDef[] {
    const out: StyleDef[] = [];
    const seen = new Set<string>();
    let cur = id ? this.defs.get(id) : undefined;
    if (!cur && type === 'paragraph' && this.defaultParagraph) cur = this.defs.get(this.defaultParagraph);
    while (cur && !seen.has(cur.id) && cur.type === type) {
      seen.add(cur.id);
      out.unshift(cur);
      cur = cur.basedOn ? this.defs.get(cur.basedOn) : undefined;
    }
    return out;
  }

  /** document defaults + the paragraph style (its whole basedOn chain) */
  paragraph(styleId: string | undefined): { p: ParaProps; r: RunProps } {
    const key = styleId ?? '';
    let hit = this.cacheP.get(key);
    if (!hit) {
      const chain = this.chain(styleId, 'paragraph');
      hit = { p: merge<ParaProps>(this.defaults.p, ...chain.map((c) => c.p)), r: merge<RunProps>(this.defaults.r, ...chain.map((c) => c.r)) };
      delete hit.p.styleId;
      this.cacheP.set(key, hit);
    }
    return hit;
  }

  character(styleId: string | undefined): RunProps {
    if (!styleId) return {};
    return merge<RunProps>(...this.chain(styleId, 'character').map((c) => c.r));
  }

  tableBorders(styleId: string | undefined) {
    const chain = this.chain(styleId ?? this.defaultTable, 'table');
    return Object.assign({}, ...chain.map((c) => c.tblBorders ?? {})) as NonNullable<StyleDef['tblBorders']>;
  }

  /** the numId a style's own w:numPr points to (numbering styles, list paragraph styles) */
  numIdOf(styleId: string): string | undefined {
    return this.defs.get(styleId)?.p.numId;
  }

  name(styleId: string | undefined) {
    return (styleId && this.defs.get(styleId)?.name) || '';
  }

  /** A heading style: an outline level, or Word's "heading N" / "Title" names. */
  headingLevel(styleId: string | undefined): number | undefined {
    const p = this.paragraph(styleId).p;
    if (p.outline !== undefined && p.outline < 9) return p.outline + 1;
    const m = /^heading\s*(\d)$/i.exec(this.name(styleId));
    if (m) return Number(m[1]);
    if (/^title$/i.test(this.name(styleId))) return 0;
    return undefined;
  }
}

/** "1", "true", "on" (the ST_OnOff values); absent is off */
const isOn = (v: string | null) => v !== null && ['1', 'true', 'on'].includes(v.toLowerCase());

// ---- CSS for display -------------------------------------------------------

const HIGHLIGHT: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkBlue: '#00008b',
  darkCyan: '#008b8b',
  darkGreen: '#006400',
  darkMagenta: '#800080',
  darkRed: '#8b0000',
  darkYellow: '#808000',
  darkGray: '#a9a9a9',
  lightGray: '#d3d3d3',
  black: '#000000',
  white: '#ffffff',
};

const pt = (twips: number) => `${+(twips / 20).toFixed(2)}pt`;

/** CSS font-family for a Word font name, with fallbacks that have Vietnamese letters. */
export function fontStack(font: string | undefined): string | undefined {
  if (!font) return undefined;
  const generic = /times|cambria|georgia|garamond|book|minion|palatino|serif|tinos|liberation serif|noto serif/i.test(font)
    ? 'serif'
    : /courier|consolas|mono|menlo/i.test(font)
      ? 'monospace'
      : 'sans-serif';
  const quoted = `"${safeFont(font) ?? 'sans-serif'}"`;
  return generic === 'sans-serif' ? `${quoted}, "ezPDF Sans VN", sans-serif` : `${quoted}, ${generic}`;
}

/** Run CSS without bold, italic and underline (those are marks in the editor). */
export function runCss(r: RunProps): string {
  const css: string[] = [];
  const family = fontStack(r.font);
  if (family) css.push(`font-family:${family}`);
  if (r.sz) css.push(`font-size:${r.sz / 2}pt`);
  if (r.color) css.push(`color:${r.color}`);
  const bg = (r.highlight && HIGHLIGHT[r.highlight]) || r.shd;
  if (bg) css.push(`background-color:${bg}`);
  if (r.strike || r.dstrike) css.push('text-decoration-line:line-through');
  if (r.dstrike) css.push('text-decoration-style:double');
  if (r.caps) css.push('text-transform:uppercase');
  if (r.smallCaps) css.push('font-variant:small-caps');
  if (r.vanish) css.push('display:none');
  if (r.vertAlign === 'superscript') css.push('vertical-align:super;font-size:smaller');
  if (r.vertAlign === 'subscript') css.push('vertical-align:sub;font-size:smaller');
  if (r.spacing) css.push(`letter-spacing:${pt(r.spacing)}`);
  return css.join(';');
}

function borderCss(b: Border | undefined): string | undefined {
  if (!b || b.style === 'none' || b.style === 'nil') return undefined;
  const width = Math.max(0.5, (b.sz ?? 4) / 8);
  const style = b.style === 'double' ? 'double' : /dot/.test(b.style) ? 'dotted' : /dash/.test(b.style) ? 'dashed' : 'solid';
  return `${width}pt ${style} ${b.color ?? '#000'}`;
}

export { borderCss };

/** Paragraph CSS; `r` is the paragraph mark's run formatting (an empty line's height). */
export function paraCss(p: ParaProps, r: RunProps): string {
  const css: string[] = [];
  const jc = p.jc === 'center' ? 'center' : p.jc === 'right' || p.jc === 'end' ? 'right' : p.jc === 'both' || p.jc === 'distribute' ? 'justify' : undefined;
  if (jc) css.push(`text-align:${jc}`);
  if (p.left) css.push(`padding-left:${pt(p.left)}`);
  if (p.right) css.push(`padding-right:${pt(p.right)}`);
  if (p.hanging) css.push(`text-indent:-${pt(p.hanging)}`);
  else if (p.firstLine) css.push(`text-indent:${pt(p.firstLine)}`);
  const before = p.beforeAuto ? 280 : p.before;
  const after = p.afterAuto ? 280 : p.after;
  css.push(`margin-top:${before ? pt(before) : '0'}`);
  css.push(`margin-bottom:${after ? pt(after) : '0'}`);
  if (p.line) {
    if (p.lineRule === 'exact' || p.lineRule === 'atLeast') css.push(`line-height:${pt(p.line)}`);
    else css.push(`line-height:${Math.max(0.8, +(p.line / 240 * 1.15).toFixed(3))}`);
  } else css.push('line-height:1.15');
  if (p.shd) css.push(`background-color:${p.shd}`);
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const b = borderCss(p.borders?.[side]);
    if (b) css.push(`border-${side}:${b}`);
  }
  const font = runCss({ font: r.font, sz: r.sz, color: r.color });
  if (font) css.push(font);
  return css.join(';');
}

export const emuToPt = (emu: number) => emu / 12700;
export const twipsToPt = (t: number) => t / 20;
export { attrNS };
