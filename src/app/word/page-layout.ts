/**
 * The Word screen's layout, done after the browser has laid the text out:
 *
 *  - Tab stops. A tab character becomes a box as wide as the way to its stop:
 *    the paragraph's own stops (left, centre, right, decimal; dots or a line
 *    as leader), the hanging indent's implicit stop, then the document's
 *    default stops. Measured from the text's left edge, as Word does.
 *  - Pages. The text is split into sheets of the document's page size, with a
 *    gap between them: a block that would cross the bottom of a page starts
 *    the next one (a table: the row that would cross it), as do page breaks,
 *    "page break before" and section breaks that start a new page. The space
 *    is added with decorations (margins, a page break's height), so the
 *    document itself never changes; the gaps, headers and footers are drawn by
 *    the screen over the page (WordScreen.tsx) from what this reports.
 *
 * Runs again (debounced) when the text, the width, a font or a picture
 * changes. Every pass measures the text as it is without page spacing, then
 * places it, in one go: the browser never paints the state in between.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { PAGE_BREAK, schema } from '@/word/schema';
import type { PageBox } from '@/word/read';

/** CSS px between two sheets (unscaled) */
export const PAGE_GAP = 24;
const PT = 4 / 3;

export interface PagesInfo {
  /** how many sheets */
  count: number;
  /** a sheet's height and the gap after it, CSS px */
  pageH: number;
  gap: number;
}

interface LayoutState {
  tabs: Decoration[];
  pages: Decoration[];
  set: DecorationSet;
}

const key = new PluginKey<LayoutState>('ez-layout');

type Meta = { tabs?: Decoration[]; pages?: Decoration[] };

export interface LayoutOptions {
  page: PageBox;
  /** points between default tab stops */
  defaultTab: number;
  /** the sheet element (its top is the top of page 1) */
  pageEl: () => HTMLElement | null;
  /** after the footnotes and endnotes (laid out with the text, outside the editor) */
  notesEl: () => HTMLElement | null;
  onPages: (info: PagesInfo) => void;
}

export function pageLayout(opts: LayoutOptions): Plugin<LayoutState> {
  return new Plugin<LayoutState>({
    key,
    state: {
      init: () => ({ tabs: [], pages: [], set: DecorationSet.empty }),
      apply(tr: Transaction, old: LayoutState, _o: EditorState, state: EditorState): LayoutState {
        const meta = tr.getMeta(key) as Meta | undefined;
        if (meta) {
          const tabs = meta.tabs ?? (tr.docChanged ? old.set.find().filter((d) => (d.spec as { ez?: string }).ez === 'tab') : old.tabs);
          const pages = meta.pages ?? (tr.docChanged ? old.set.find().filter((d) => (d.spec as { ez?: string }).ez === 'page') : old.pages);
          return { tabs, pages, set: DecorationSet.create(state.doc, [...tabs, ...pages]) };
        }
        if (!tr.docChanged) return old;
        const set = old.set.map(tr.mapping, tr.doc);
        const all = set.find();
        return { tabs: all.filter((d) => (d.spec as { ez?: string }).ez === 'tab'), pages: all.filter((d) => (d.spec as { ez?: string }).ez === 'page'), set };
      },
    },
    props: {
      decorations: (state) => key.getState(state)?.set,
    },
    view(view) {
      let timer = 0;
      let alive = true;
      /** where the text changed since the last pass (tabs elsewhere keep their widths); 'all' after a resize, a font or a picture */
      let dirty: Dirty = 'all';
      /**
       * Not while the user is typing: a keyboard that composes words (the
       * Samsung keyboard, Gboard, Vietnamese input methods) must not see
       * its paragraph redrawn under it. The pass waits for a short pause, or
       * for the word to be finished (at most two seconds).
       */
      let lastInput = 0;
      let waitingSince = 0;
      const onInput = () => (lastInput = performance.now());
      const inputEvents = ['beforeinput', 'keydown', 'compositionstart', 'compositionupdate', 'compositionend'] as const;
      for (const e of inputEvents) view.dom.addEventListener(e, onInput, true);
      const run = () => {
        timer = 0;
        if (!alive || !view.dom.isConnected) return;
        const now = performance.now();
        const quiet = now - lastInput;
        if (!waitingSince) waitingSince = now;
        if ((quiet < 200 || view.composing) && now - waitingSince < 2000) {
          timer = window.setTimeout(run, view.composing ? 300 : Math.max(40, 200 - quiet));
          return;
        }
        waitingSince = 0;
        const range = dirty;
        dirty = null;
        try {
          layout(view, opts, range);
        } catch {
          // a layout pass is cosmetic: a failure leaves the text as it is
        }
      };
      const schedule = (ms = 120) => {
        if (timer) clearTimeout(timer);
        timer = window.setTimeout(run, ms);
      };
      const all = (ms: number) => {
        dirty = 'all';
        schedule(ms);
      };
      const ro = new ResizeObserver(() => all(60));
      ro.observe(view.dom);
      const onLoad = () => all(60);
      view.dom.addEventListener('load', onLoad, true);
      document.fonts?.addEventListener?.('loadingdone', onLoad);
      schedule(0);
      return {
        update(v, prev) {
          if (v.state.doc === prev.doc) return;
          const start = prev.doc.content.findDiffStart(v.state.doc.content);
          const end = prev.doc.content.findDiffEnd(v.state.doc.content);
          if (start !== null && end && dirty !== 'all') {
            // positions after the change move with it
            const shift = end.b - end.a;
            const map = (p: number) => (p < start ? p : Math.max(start, p + shift));
            dirty = dirty ? { from: Math.min(map(dirty.from), start), to: Math.max(map(dirty.to), end.b) } : { from: start, to: Math.max(start, end.b) };
          }
          schedule();
        },
        destroy() {
          alive = false;
          if (timer) clearTimeout(timer);
          ro.disconnect();
          for (const e of inputEvents) view.dom.removeEventListener(e, onInput, true);
          view.dom.removeEventListener('load', onLoad, true);
          document.fonts?.removeEventListener?.('loadingdone', onLoad);
        },
      };
    },
  });
}

/** the sheet's scale on screen (the page is zoomed with a CSS transform) */
function scaleOf(pageEl: HTMLElement): number {
  const w = pageEl.offsetWidth;
  return w ? pageEl.getBoundingClientRect().width / w : 1;
}

type Dirty = { from: number; to: number } | 'all' | null;

function layout(view: EditorView, opts: LayoutOptions, dirty: Dirty) {
  const pageEl = opts.pageEl();
  if (!pageEl || !pageEl.offsetWidth) return;
  // tabs first (they change line breaks), then pages
  for (let pass = 0; pass < 4; pass++) {
    const tabs = layoutTabs(view, opts, scaleOf(pageEl), dirty ?? { from: 0, to: -1 });
    if (!tabs) break;
    view.dispatch(view.state.tr.setMeta(key, { tabs } satisfies Meta).setMeta('addToHistory', false));
  }
  layoutPages(view, opts, pageEl);
}

// ---- tabs ------------------------------------------------------------------

interface Stop {
  pos: number; // pt
  align: 'l' | 'c' | 'r' | 'd';
  leader: string;
}

const stopsCache = new Map<string, Stop[]>();
function parseStops(s: string): Stop[] {
  let hit = stopsCache.get(s);
  if (hit) return hit;
  hit = [];
  for (const part of s.split(' ')) {
    const m = /^([lcrd])(-?\d+(?:\.\d+)?)([.\-_·]?)$/.exec(part);
    if (m) hit.push({ align: m[1] as Stop['align'], pos: Number(m[2]), leader: m[3] });
  }
  hit.sort((a, b) => a.pos - b.pos);
  stopsCache.set(s, hit);
  return hit;
}

const LEADER_CLASS: Record<string, string> = { '.': ' ez-wtab-dot', '-': ' ez-wtab-dash', _: ' ez-wtab-line', '·': ' ez-wtab-dot' };

/**
 * New tab decorations, or null when every tab already has its width. Only
 * the paragraphs in `range` are measured again; the others keep theirs.
 */
function layoutTabs(view: EditorView, opts: LayoutOptions, z: number, range: { from: number; to: number } | 'all'): Decoration[] | null {
  const state = view.state;
  const old = new Map<number, number>();
  const kept = new Map<number, Decoration>();
  for (const d of key.getState(state)?.tabs ?? []) {
    old.set(d.from, Number((d.spec as { w?: number }).w ?? -1));
    kept.set(d.from, d);
  }
  const decos: Decoration[] = [];
  let changed = false;
  state.doc.descendants((node, pos) => {
    if (node.type !== schema.nodes.paragraph) return node.type !== schema.nodes.locked;
    if (!node.textContent.includes('\t')) return false;
    if (range !== 'all' && (pos + node.nodeSize < range.from || pos > range.to)) {
      // not changed: its tabs keep their boxes
      for (let p = pos + 1; p < pos + node.nodeSize; p++) {
        const d = kept.get(p);
        if (d) decos.push(d);
      }
      return false;
    }
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom || !dom.getBoundingClientRect) return false;
    const cs = getComputedStyle(dom);
    const rect = dom.getBoundingClientRect();
    const originX = rect.left + parseFloat(cs.borderLeftWidth || '0') * z;
    const indent = (parseFloat(cs.paddingLeft || '0') || 0) / PT; // pt
    const hanging = parseFloat(cs.textIndent || '0') < 0;
    const stops = parseStops(node.attrs.tabs as string);
    const lastCustom = stops.length ? stops[stops.length - 1].pos : 0;
    // the paragraph's tabs, in order, with the text that follows each
    const tabs: number[] = [];
    node.forEach((child, off) => {
      if (!child.isText) return;
      const t = child.text!;
      for (let i = t.indexOf('\t'); i >= 0; i = t.indexOf('\t', i + 1)) tabs.push(pos + 1 + off + i);
    });
    const end = pos + node.nodeSize - 1;
    let lineTop = NaN;
    let shift = 0; // pt: how much the tabs before this one on its line grow or shrink
    tabs.forEach((tp, i) => {
      const a = tabBox(view, tp);
      if (!a) return;
      if (Math.abs(a.top - lineTop) > 2) {
        lineTop = a.top;
        shift = 0;
      }
      const oldW = a.width / z / PT;
      const x = (a.left - originX) / z / PT + shift;
      // the next stop: the paragraph's, the hanging indent's, then a default one
      let stop: Stop | undefined = stops.find((s) => s.pos > x + 0.5);
      if (hanging && x < indent - 0.5 && (!stop || stop.pos > indent)) stop = { pos: indent, align: 'l', leader: '' };
      if (!stop) {
        const d = opts.defaultTab;
        stop = { pos: (Math.floor(Math.max(x, lastCustom) / d + 1e-6) + 1) * d, align: 'l', leader: '' };
      }
      let w = stop.pos - x;
      if (stop.align !== 'l') {
        // the text up to the next tab (or the paragraph's end) lines up at the stop
        const segEnd = i + 1 < tabs.length ? tabs[i + 1] : end;
        let seg = 0;
        try {
          const s0 = view.coordsAtPos(tp + 1, 1), s1 = view.coordsAtPos(segEnd, -1);
          if (Math.abs(s1.top - s0.top) <= 2) seg = Math.max(0, (s1.left - s0.left) / z / PT);
        } catch {
          seg = 0;
        }
        w = stop.align === 'c' ? w - seg / 2 : w - seg;
        if (w < 0.75) w = 0.75;
      }
      w = Math.min(w, 2000);
      shift += w - oldW;
      const px = +(w * PT).toFixed(2);
      if (Math.abs((old.get(tp) ?? -100) - px) > 0.5) changed = true;
      decos.push(Decoration.inline(tp, tp + 1, { class: 'ez-wtab' + (LEADER_CLASS[stop.leader] ?? ''), style: `width:${px}px` }, { ez: 'tab', w: px }));
    });
    return false;
  });
  if (!changed && decos.length === old.size) return null;
  return decos;
}

let sharedRange: Range | null = null;

/** where a tab is drawn now: its box (decorated) or the tab character's own (not yet) */
function tabBox(view: EditorView, tp: number): { left: number; top: number; width: number } | null {
  try {
    const { node, offset } = view.domAtPos(tp, 1);
    let el: Node | null = node.nodeType === 3 ? node : (node.childNodes[offset] ?? null);
    let at = node.nodeType === 3 ? offset : 0;
    // down to the text that holds the tab (it may sit in the run's and the mark's spans)
    while (el && el.nodeType === 1) {
      if ((el as Element).classList.contains('ez-wtab')) {
        const r = (el as Element).getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width };
      }
      el = el.firstChild;
      at = 0;
    }
    if (el && el.nodeType === 3) {
      const parent = el.parentElement;
      if (parent?.classList.contains('ez-wtab')) {
        const r = parent.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width };
      }
      if ((el as Text).data[at] === '\t') {
        // one range for every measurement: each live range makes every later DOM change slower
        const range = (sharedRange ??= document.createRange());
        range.setStart(el, at);
        range.setEnd(el, at + 1);
        const r = range.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width };
      }
    }
    const c = view.coordsAtPos(tp, 1);
    return { left: c.left, top: c.top, width: 0 };
  } catch {
    return null;
  }
}

// ---- pages -----------------------------------------------------------------

function spacerRow(h: number, cols: number): HTMLElement {
  const tr = document.createElement('tr');
  tr.className = 'ez-wpagerow';
  tr.setAttribute('aria-hidden', 'true');
  const td = document.createElement('td');
  td.colSpan = Math.max(1, Math.min(1000, cols));
  td.contentEditable = 'false';
  td.style.height = `${h.toFixed(2)}px`;
  tr.appendChild(td);
  return tr;
}

function layoutPages(view: EditorView, opts: LayoutOptions, pageEl: HTMLElement) {
  const p = opts.page;
  const PH = p.height * PT, T = p.top * PT, B = p.bottom * PT, G = PAGE_GAP;
  const H = Math.max(PH * 0.1, PH - T - B);
  const stride = PH + G;
  // measure the text as it is without page spacing
  if (key.getState(view.state)?.pages.length) view.dispatch(view.state.tr.setMeta(key, { pages: [] } satisfies Meta).setMeta('addToHistory', false));
  const notes = opts.notesEl();
  if (notes) notes.style.marginTop = '';
  const z = scaleOf(pageEl);
  const top0 = pageEl.getBoundingClientRect().top;
  const box = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { top: (r.top - top0) / z, bottom: (r.bottom - top0) / z };
  };
  const decos: Decoration[] = [];
  let k = 0; // the page being filled
  let offset = 0; // space added so far above what is being placed
  let first = true; // nothing placed on this page yet
  let prevBottom = T; // the last block's bottom edge, without page spacing
  let prevMargin = 0;
  let newPageNext = false;
  const contentTop = (n: number) => n * stride + T;
  const contentBottom = (n: number) => n * stride + T + H;
  const pageOf = (y: number) => Math.max(0, Math.floor(y / stride));

  view.state.doc.forEach((node: PMNode, pos: number) => {
    const dom = view.nodeDOM(pos) as HTMLElement | null;
    if (!dom || !(dom instanceof HTMLElement)) return;
    const b = box(dom);
    const cs = getComputedStyle(dom);
    const mt = parseFloat(cs.marginTop) || 0, mb = parseFloat(cs.marginBottom) || 0;
    const isPara = node.type === schema.nodes.paragraph;
    const forced = !first && (newPageNext || (isPara && node.attrs.breakBefore));
    let breakAfter = false;
    let fTop = b.top + offset, fBottom = b.bottom + offset;
    const toNext = forced || (!first && fBottom > contentBottom(k) + 0.5 && node.type !== schema.nodes.table);
    // after a block that ran into the next page, the following one would start in that page's top margin: down to its text area
    const inMargin = !toNext && !first && fTop < contentTop(k) - 0.5;
    if (toNext || inMargin) {
      // to the top of the next page (its space before kept after a page break, dropped after a full page, as Word does)
      if (toNext) k += 1;
      const target = contentTop(k) + (forced ? mt : 0);
      const gap = b.top - prevBottom; // the space above it now (margins collapsed)
      const m = Math.max(prevMargin, gap + (target - fTop));
      offset += m - gap;
      // given as --ezpg: the paragraph's own margin-top is var(--ezpg, its space before), so taking this away leaves it whole
      decos.push(Decoration.node(pos, pos + node.nodeSize, { style: `--ezpg:${m.toFixed(2)}px` }, { ez: 'page' }));
      fTop = b.top + offset;
      fBottom = b.bottom + offset;
    }
    if (node.type === schema.nodes.table) {
      // a table goes on as far as it fits; the row that would cross the page's bottom starts the next page
      node.forEach((row, rowOff) => {
        const rowPos = pos + 1 + rowOff;
        const tr = view.nodeDOM(rowPos) as HTMLElement | null;
        if (!tr) return;
        const r = box(tr);
        const rTop = r.top + offset, rBottom = r.bottom + offset;
        if (rBottom > contentBottom(k) + 0.5 && rTop > contentTop(k) + 1) {
          // an empty, borderless row as tall as the way to the next page: the table's lines stop at the page's end and go on on the next
          const extra = contentTop(k + 1) - rTop;
          let cols = 0;
          row.forEach((cell) => (cols += Number(cell.attrs.colspan) || 1));
          decos.push(Decoration.widget(rowPos, () => spacerRow(extra, cols), { ez: 'page', side: -1, key: `pg-${extra.toFixed(1)}-${cols}`, ignoreSelection: true }));
          offset += extra;
          k += 1;
        }
        if (r.bottom + offset > contentBottom(k) + 0.5) k = pageOf(r.bottom + offset);
      });
      fBottom = b.bottom + offset;
    } else if (isPara) {
      // page breaks inside the paragraph: what follows starts the next page. One that ends the paragraph
      // (nothing shown after it) takes its paragraph mark along, as Word does: the next paragraph starts the page
      let last = -1;
      node.forEach((child, off) => {
        if (!(child.type === schema.nodes.inl && child.attrs.kind === 'hidden')) last = off;
      });
      node.descendants((child, off) => {
        if (child.type !== schema.nodes.inl || child.attrs.kind !== 'mark' || child.attrs.label !== PAGE_BREAK) return false;
        if (off === last) {
          breakAfter = true;
          return false;
        }
        const at = pos + 1 + off;
        const el = view.nodeDOM(at) as HTMLElement | null;
        if (!el) return false;
        const y = box(el).top + offset;
        const h = Math.max(0, contentTop(k + 1) - y);
        decos.push(Decoration.node(at, at + child.nodeSize, { style: `height:${h.toFixed(2)}px` }, { ez: 'page' }));
        offset += h;
        k += 1;
        return false;
      });
      fBottom = b.bottom + offset;
    }
    // a block taller than what was left (or than a page) runs on: the next one follows where it ends
    if (fBottom > contentBottom(k) + 0.5) k = pageOf(fBottom);
    first = false;
    prevBottom = b.bottom;
    prevMargin = mb;
    newPageNext = (isPara && !!node.attrs.newPage) || breakAfter;
  });

  // the notes after the text: to the next page when they would cross a page's bottom
  if (notes && notes.offsetHeight) {
    const n = box(notes);
    const nTop = n.top + offset, nBottom = n.bottom + offset;
    if (nBottom > contentBottom(k) + 0.5 && nTop > contentTop(k) + 1) {
      const extra = contentTop(k + 1) - nTop;
      notes.style.marginTop = `${(parseFloat(getComputedStyle(notes).marginTop) || 0) + extra}px`;
      offset += extra;
      k += 1;
    }
    if (n.bottom + offset > contentBottom(k)) k = pageOf(n.bottom + offset);
  }

  if (decos.length) view.dispatch(view.state.tr.setMeta(key, { pages: decos } satisfies Meta).setMeta('addToHistory', false));
  opts.onPages({ count: k + 1, pageH: PH, gap: G });
}
