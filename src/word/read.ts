/**
 * .docx → the editor's model. Reads the main document part (body, tables,
 * runs), the styles, lists, theme and the pictures it refers to, and, for
 * display, the default header and footer and the footnotes and endnotes.
 * Whatever ezPDF cannot edit safely is kept as it is: a paragraph with
 * tracked changes or a content control becomes a `locked` block; pictures,
 * shapes, charts, equations, fields, footnote marks and bookmarks are inline
 * items holding their original XML, shown as ezPDF draws them (SVG for
 * shapes, charts and Windows metafiles, MathML for equations).
 */
import type { Node as PMNode, Mark } from 'prosemirror-model';
import { Gunzip } from 'fflate';
import { schema, type Visual } from './schema';
import { drawingSvg, placement, vmlSvg, type DrawCtx, type Drawn } from './drawing';
import { chartSvg } from './chart';
import { ommlParaToMathml, ommlText, ommlToMathml } from './omml';
import type { MetaSvg } from './metafile';
import { dosEpsPreview, IMAGE_MIME, KIND_LABEL, MAYBE, NATIVE, pictJpeg, sniffImage, type ImageKind } from './images';
import { openPackage, rId, type DocxPackage } from './package';
import { formatNumber, Numbering } from './numbering';
import {
  borderCss,
  emuToPt,
  paraCss,
  readBorder,
  readParaProps,
  readRunProps,
  runCss,
  safeFont,
  Styles,
  Theme,
  type Border,
  type ParaProps,
  type RunProps,
} from './styles';
import {
  attrNS,
  defaultDom,
  elements,
  escapeHtml,
  isW,
  num,
  NS,
  parseXml,
  textOf,
  wAttr,
  wChild,
  wChildren,
  wVal,
  type DomImpl,
} from './xml';

export interface PageBox {
  /** points */
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface WordModel {
  name: string;
  pkg: DocxPackage;
  dom: DomImpl;
  /** the original word/document.xml, parsed; `store` holds elements of it */
  xml: Document;
  store: Node[];
  /** ref → the node as read, to tell an untouched paragraph or table on save */
  origin: Map<number, PMNode>;
  /** body-level items after the last block (before the final w:sectPr) */
  tail: number[];
  doc: PMNode;
  styles: Styles;
  numbering: Numbering;
  page: PageBox;
  headerHtml: string;
  footerHtml: string;
  /** how many blocks are shown read-only, and why */
  locked: { count: number; reasons: string[] };
  /** blob: URLs made for pictures (revoked when the document closes) */
  urls: string[];
  /** CSS of a plain paragraph in the default style (new paragraphs) */
  defaultCss: string;
  /** the footnotes and endnotes the text refers to, for display after it */
  notesHtml: string;
  /** shapes and equations by ref: how ezPDF draws them (a pasted copy shows the same) */
  visuals: Map<number, Visual>;
  /** the fonts the document uses (its font table and theme), for the font picker; symbol fonts left out */
  fonts: string[];
}

export interface ReadOptions {
  dom?: DomImpl;
  /** a URL to show picture bytes (the browser: blob URLs) */
  imageUrl?: (bytes: Uint8Array, mime: string) => string | null;
  /**
   * Can this device show a picture of a format only some browsers read
   * (AVIF, HEIC, JPEG XR)? Asked before the document is read; without it,
   * those pictures show as chips.
   */
  canShow?: (bytes: Uint8Array, mime: string) => Promise<boolean>;
  /**
   * TIFF and EPS pictures → PNG (word/raster.ts), at most `side` pixels on
   * the long side; null when one cannot be decoded. The app passes a worker
   * it stops when a picture takes too long; without it they are decoded
   * here, on this thread.
   */
  rasterize?: (bytes: Uint8Array, side: number) => Promise<Uint8Array | null>;
}

const merge = <T extends object>(...layers: (T | undefined)[]): T => Object.assign({}, ...layers.filter(Boolean)) as T;

/** Paragraph-level items that only mark a place (kept, never shown). */
const MARKERS = new Set([
  'bookmarkStart',
  'bookmarkEnd',
  'commentRangeStart',
  'commentRangeEnd',
  'permStart',
  'permEnd',
  'moveFromRangeStart',
  'moveFromRangeEnd',
  'moveToRangeStart',
  'moveToRangeEnd',
  'customXmlInsRangeStart',
  'customXmlInsRangeEnd',
  'customXmlDelRangeStart',
  'customXmlDelRangeEnd',
]);

/** Inline containers that make a paragraph read-only, with the reason shown. */
const LOCKING: Record<string, string> = {
  ins: 'có theo dõi thay đổi',
  del: 'có theo dõi thay đổi',
  moveFrom: 'có theo dõi thay đổi',
  moveTo: 'có theo dõi thay đổi',
  customXml: 'có trường dữ liệu đặc biệt',
  sdt: 'có ô điều khiển nội dung',
  subDoc: 'có tài liệu con',
  dir: 'có chữ viết từ phải sang trái',
  bdo: 'có chữ viết từ phải sang trái',
};

class Locked extends Error {
  constructor(public reason: string) {
    super(reason);
  }
}

interface Ctx {
  model: WordModel;
  part: string;
  opts: ReadOptions;
  /** current table style (cell paragraphs) */
  inTable: number;
  /** state every part read shares */
  shared: Shared;
  /** the number of the footnote or endnote being shown (its own mark) */
  noteLabel?: string;
  /** how deep in text boxes (a text box in a shape in a text box…) */
  depth: number;
  /** drawing a SmartArt: a SmartArt cannot hold another one (a crafted file could make one draw itself) */
  inDiagram?: boolean;
}

interface Shared {
  uid: number;
  /** picture URL by part and relationship id, and by picture part (several relationships can point at one picture) */
  images: Map<string, string | null>;
  byTarget: Map<string, string | null>;
  /** the WMF/EMF player, loaded when the file has such pictures */
  meta: { metafileToSvg(bytes: Uint8Array, size?: { w: number; h: number }): MetaSvg | null } | null;
  /** TIFF and EPS pictures decoded before the document is read (PNG, or null), by part */
  rasters: Map<string, Uint8Array | null>;
  /** pictures of a format only some browsers read that this device shows (part paths) */
  showable: Set<string>;
  /** footnote and endnote references, in reading order, and the last numbers given */
  notes: { kind: 'footnote' | 'endnote'; id: string; label: string }[];
  footnote: number;
  endnote: number;
  /** SmartArt drawings already read, by data part */
  diagrams: Map<string, { root: Element; part: string } | null>;
  /** markup drawn so far, and bytes inflated from .wmz/.emz: past a budget the rest shows as chips */
  drawn: number;
  inflated: number;
}

/** what one document may draw (markup) and inflate (compressed metafiles) in all */
const DRAW_BUDGET = 48 * 1024 * 1024;
const INFLATE_BUDGET = 192 * 1024 * 1024;
/** TIFF and EPS pictures decoded for one document: how many, how long in all, how large */
const RASTER_PARTS = 200;
const RASTER_TIME = 45_000;
const RASTER_SIDE = 2400;

const store = (ctx: Ctx, n: Node) => ctx.model.store.push(n) - 1;

export async function readDocx(bytes: Uint8Array, name: string, opts: ReadOptions = {}): Promise<WordModel> {
  const dom = opts.dom ?? defaultDom();
  const pkg = openPackage(bytes, dom);
  const xmlText = pkg.text(pkg.main)!;
  const xml = parseXml(dom, xmlText, pkg.main);
  const root = xml.documentElement;
  if (root.namespaceURI === NS.strictW) {
    throw new Error('Tệp Word lưu theo chuẩn “Strict Open XML” chưa mở được. Hãy lưu lại trong Word dạng “Word Document (.docx)”.');
  }
  const body = wChild(root, 'body');
  if (!body) throw new Error('Tệp Word không có phần thân văn bản.');

  const rels = pkg.rels(pkg.main);
  const partByType = (suffix: string) => [...rels.values()].find((r) => r.type.endsWith(suffix) && !r.external)?.target;
  const partDoc = (path: string | undefined) => {
    const t = path ? pkg.text(path) : null;
    return t ? parseXml(dom, t, path!) : null;
  };
  const theme = new Theme(partDoc(partByType('/theme')));
  const styles = new Styles(partDoc(partByType('/styles')), theme);
  const numbering = new Numbering(partDoc(partByType('/numbering')), theme, (id) => styles.numIdOf(id));

  const model: WordModel = {
    name,
    pkg,
    dom,
    xml,
    store: [],
    origin: new Map(),
    tail: [],
    doc: null as unknown as PMNode,
    styles,
    numbering,
    page: { width: 595.3, height: 841.9, top: 72, bottom: 72, left: 72, right: 72 },
    headerHtml: '',
    footerHtml: '',
    locked: { count: 0, reasons: [] },
    urls: [],
    defaultCss: paraCss(styles.paragraph(undefined).p, styles.paragraph(undefined).r),
    notesHtml: '',
    visuals: new Map(),
    fonts: documentFonts(partDoc(partByType('/fontTable')), theme),
  };
  // what each picture really is (by its bytes): the decoders a file needs are loaded only for it
  const kinds = new Map<string, ImageKind>();
  for (const [path, b] of Object.entries(pkg.files)) if (!/\.(xml|rels)$/i.test(path)) kinds.set(path, sniffImage(b));
  const has = (...k: ImageKind[]) => [...kinds.values()].some((v) => k.includes(v));
  // a picture only some browsers read: this one is asked (in parallel, a few seconds at most)
  const showable = new Set<string>();
  if (opts.canShow) {
    const ask = [...kinds].filter(([, k]) => MAYBE.has(k)).slice(0, 40);
    const answers = await Promise.all(ask.map(([path, k]) => opts.canShow!(pkg.files[path], IMAGE_MIME[k]!).catch(() => false)));
    ask.forEach(([path], i) => answers[i] && showable.add(path));
  }
  // TIFF and EPS (their TIFF or EPSI preview) decoded now, one after another, within a time budget
  const rasters = new Map<string, Uint8Array | null>();
  // only pictures some part points at (a file can carry pictures nothing shows)
  const used = new Set<string>();
  for (const n of pkg.names) {
    const m = /^(.*?)_rels\/([^/]+)\.rels$/.exec(n);
    if (m) for (const r of pkg.rels(m[1] + m[2]).values()) if (!r.external) used.add(r.target);
  }
  const toRaster = [...kinds]
    .filter(([path, k]) => used.has(path) && (k === 'tiff' || (k === 'eps' && dosEpsPreview(pkg.files[path])?.kind !== 'wmf')))
    .slice(0, RASTER_PARTS);
  if (toRaster.length) {
    let rasterize: (b: Uint8Array, side: number) => Promise<Uint8Array | null>;
    if (opts.rasterize) rasterize = opts.rasterize;
    else {
      const local = await import('./raster');
      rasterize = async (b, side) => local.rasterize(b, side);
    }
    const until = Date.now() + RASTER_TIME;
    for (const [path] of toRaster) rasters.set(path, Date.now() < until ? await rasterize(pkg.files[path], RASTER_SIDE).catch(() => null) : null);
  }
  const shared: Shared = {
    uid: 0,
    images: new Map(),
    byTarget: new Map(),
    meta: has('wmf', 'emf', 'gzip', 'eps') ? await import('./metafile') : null,
    rasters,
    showable,
    notes: [],
    footnote: 0,
    endnote: 0,
    diagrams: new Map(),
    drawn: 0,
    inflated: 0,
  };
  const ctx: Ctx = { model, part: pkg.main, opts, inTable: 0, shared, depth: 0 };

  const children = elements(body);
  const sectPr = children.length && isW(children[children.length - 1], 'sectPr') ? children[children.length - 1] : null;
  const blocks = readBlocks(ctx, sectPr ? children.slice(0, -1) : children, (pending) => (model.tail = pending));
  if (!blocks.length) blocks.push(schema.nodes.paragraph.create({ css: model.defaultCss }));
  model.doc = schema.nodes.doc.create(null, blocks);

  if (sectPr) {
    const pg = wChild(sectPr, 'pgSz');
    const mar = wChild(sectPr, 'pgMar');
    const t = (el: Element | null, a: string, d: number) => {
      const v = num(wAttr(el, a));
      return v === undefined ? d : Math.abs(v) / 20;
    };
    model.page = {
      width: t(pg, 'w', 595.3),
      height: t(pg, 'h', 841.9),
      top: t(mar, 'top', 72),
      bottom: t(mar, 'bottom', 72),
      left: t(mar, 'left', 72),
      right: t(mar, 'right', 72),
    };
    const hf = (kind: 'header' | 'footer') => {
      const refs = wChildren(sectPr, `${kind}Reference`);
      const ref = refs.find((r) => wAttr(r, 'type') === 'default') ?? refs[0];
      const target = ref ? rels.get(rId(ref) ?? '')?.target : undefined;
      const doc = partDoc(target);
      if (!doc || !target) return '';
      const sub: Ctx = { ...ctx, part: target };
      return elements(doc.documentElement).map((el) => previewBlock(sub, el)).join('');
    };
    model.headerHtml = hf('header');
    model.footerHtml = hf('footer');
  }

  // footnotes, then endnotes, in the order the text refers to them
  const notes = (kind: 'footnote' | 'endnote') => {
    const refs = shared.notes.filter((n) => n.kind === kind);
    const target = partByType(kind === 'footnote' ? '/footnotes' : '/endnotes');
    const doc = refs.length ? partDoc(target) : null;
    if (!doc || !target) return '';
    const byId = new Map<string, Element>();
    for (const n of elements(doc.documentElement)) if (isW(n, kind)) byId.set(wAttr(n, 'id') ?? '', n);
    const items = refs
      .map((r) => {
        const note = byId.get(r.id);
        if (!note) return '';
        const sub: Ctx = { ...ctx, part: target, noteLabel: r.label };
        return `<div class="ez-wnote-item">${elements(note).map((el) => previewBlock(sub, el)).join('')}</div>`;
      })
      .join('');
    return items ? `<section class="ez-wnotes" aria-label="${kind === 'footnote' ? 'Chú thích cuối trang' : 'Chú thích cuối tài liệu'}">${items}</section>` : '';
  };
  model.notesHtml = notes('footnote') + notes('endnote');
  return model;
}

/** symbol and math fonts: not offered for text */
const SYMBOL_FONT = /^(symbol|wingdings.*|webdings|mt extra|cambria math|marlett|euclid.*|ms reference.*|zapf ?dingbats|stix.*math.*)$/i;

/** the fonts a document names (w:fonts in its font table, its theme fonts), safe for CSS, symbol fonts out */
/** Chinese, Japanese and Korean fonts (by their name or their character set): no Vietnamese letters, so not offered for editing. */
const CJK_NAME = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/;
const CJK_CHARSET = new Set(['80', '81', '82', '86', '88']);

function documentFonts(table: Document | null, theme: Theme): string[] {
  const names = new Set<string>();
  const add = (n: string | null | undefined) => {
    const f = safeFont(n);
    // a name that had to be cleaned is not offered: written back, it would name a font that does not exist
    if (f && f === n?.trim() && !SYMBOL_FONT.test(f) && !CJK_NAME.test(f) && !f.startsWith('+')) names.add(f);
  };
  add(theme.major);
  add(theme.minor);
  if (table)
    for (const f of wChildren(table.documentElement, 'font')) {
      const cs = wChild(f, 'charset');
      if (!CJK_CHARSET.has((cs && wAttr(cs, 'val'))?.toUpperCase() ?? '')) add(wAttr(f, 'name'));
    }
  return [...names].slice(0, 60);
}

/** Body-level (or cell-level) elements → blocks. Stray items go to the next block's `before`. */
function readBlocks(ctx: Ctx, els: Element[], leftover: (pending: number[]) => void): PMNode[] {
  const out: PMNode[] = [];
  let pending: number[] = [];
  const take = () => {
    const b = pending.length ? pending : null;
    pending = [];
    return b;
  };
  for (const el of els) {
    if (isW(el, 'p')) out.push(readParagraph(ctx, el, take()));
    else if (isW(el, 'tbl')) out.push(readTable(ctx, el, take()));
    else if (el.namespaceURI === NS.w && (MARKERS.has(el.localName) || el.localName === 'proofErr')) pending.push(store(ctx, el));
    else out.push(lockedBlock(ctx, el, take(), isW(el, 'sdt') ? 'là ô điều khiển nội dung (ví dụ mục lục)' : 'là nội dung đặc biệt'));
  }
  if (pending.length && leftover) leftover(pending);
  return out;
}

function lockedBlock(ctx: Ctx, el: Element, before: number[] | null, reason: string): PMNode {
  const ref = store(ctx, el);
  ctx.model.locked.count++;
  if (!ctx.model.locked.reasons.includes(reason)) ctx.model.locked.reasons.push(reason);
  const node = schema.nodes.locked.create({ ref, html: previewBlock(ctx, el), reason: `Chỉ xem: đoạn này ${reason}`, before });
  ctx.model.origin.set(ref, node);
  return node;
}

// ---- paragraphs ---------------------------------------------------------

interface ParaInfo {
  props: ParaProps;
  /** run formatting a run inherits: defaults + paragraph style */
  styleRun: RunProps;
  /** the paragraph mark's formatting (an empty line's height) */
  markRun: RunProps;
  list: { numId: string; ilvl: number } | null;
}

export function paraInfo(model: WordModel, pPr: Element | null, noList = false): ParaInfo {
  const direct = readParaProps(pPr);
  const style = model.styles.paragraph(direct.styleId);
  const numId = direct.numId ?? style.p.numId;
  const ilvl = direct.ilvl ?? style.p.ilvl ?? 0;
  const lvl = noList ? null : model.numbering.level(numId, ilvl);
  const directClean = Object.fromEntries(Object.entries(direct).filter(([k]) => k !== 'styleId')) as ParaProps;
  const props = merge<ParaProps>(lvl?.p, style.p, directClean);
  if (noList) {
    // out of the list: no list indent left over
    props.left = direct.left ?? style.p.left;
    props.hanging = direct.hanging ?? style.p.hanging;
  }
  const markRun = merge<RunProps>(style.r, readRunProps(wChild(pPr, 'rPr'), model.styles.theme));
  return { props, styleRun: style.r, markRun, list: lvl && numId ? { numId, ilvl } : null };
}

function lockReason(p: Element): string | null {
  const pPr = wChild(p, 'pPr');
  if (wChild(pPr, 'pPrChange')) return 'có theo dõi thay đổi';
  // the paragraph mark itself inserted, deleted or reformatted with tracking on
  const mark = wChild(pPr, 'rPr');
  if (['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange'].some((n) => wChild(mark, n))) return 'có theo dõi thay đổi';
  return lockIn(p);
}

/** what in this paragraph (or the smart tags in it) cannot be edited safely */
function lockIn(container: Element): string | null {
  for (const el of elements(container)) {
    if (el.namespaceURI !== NS.w) continue;
    if (el.localName === 'smartTag') {
      // a smart tag (Word 2003–2007) only wraps runs; what it wraps decides
      const inner = lockIn(el);
      if (inner) return inner;
      continue;
    }
    if (LOCKING[el.localName]) return LOCKING[el.localName];
    if (el.localName === 'r' && wChild(wChild(el, 'rPr'), 'rPrChange')) return 'có theo dõi thay đổi';
    if (el.localName === 'hyperlink') {
      for (const k of elements(el)) {
        if (isW(k, 'r')) {
          if (wChild(wChild(k, 'rPr'), 'rPrChange')) return 'có theo dõi thay đổi';
        } else if (!(k.namespaceURI === NS.w && (MARKERS.has(k.localName) || k.localName === 'proofErr'))) return 'có liên kết phức tạp';
      }
    }
  }
  return null;
}

function readParagraph(ctx: Ctx, p: Element, before: number[] | null): PMNode {
  const reason = lockReason(p);
  if (reason) return lockedBlock(ctx, p, before, reason);
  const model = ctx.model;
  const pPr = wChild(p, 'pPr');
  const info = paraInfo(model, pPr);
  const ref = store(ctx, p);
  const items: PMNode[] = [];
  // a paragraph found read-only part-way: the note numbers it took are given back (its preview takes them again)
  const notes = { n: ctx.shared.notes.length, f: ctx.shared.footnote, e: ctx.shared.endnote };
  try {
    for (const el of elements(p)) {
      if (isW(el, 'pPr')) continue;
      readInline(ctx, el, info, items, null);
    }
  } catch (e) {
    if (e instanceof Locked) {
      model.store.pop();
      ctx.shared.notes.length = notes.n;
      ctx.shared.footnote = notes.f;
      ctx.shared.endnote = notes.e;
      return lockedBlock(ctx, p, before, e.reason);
    }
    throw e;
  }
  const styleId = readParaProps(pPr).styleId;
  const node = schema.nodes.paragraph.create(
    {
      ref,
      ppr: pPr ? store(ctx, pPr) : null,
      css: paraCss(info.props, info.markRun),
      list: info.list,
      before,
      sect: !!wChild(pPr, 'sectPr'),
      heading: model.styles.headingLevel(styleId) ?? null,
    },
    items,
  );
  model.origin.set(ref, node);
  return node;
}

function readInline(ctx: Ctx, el: Element, info: ParaInfo, items: PMNode[], link: Mark | null) {
  const model = ctx.model;
  const withLink = (marks: readonly Mark[]) => (link ? link.addToSet(marks) : marks);
  if (el.namespaceURI === NS.w) {
    const n = el.localName;
    if (n === 'r') return readRun(ctx, el, info, items, link);
    if (n === 'proofErr') return;
    if (MARKERS.has(n)) {
      items.push(schema.nodes.inl.create({ ref: store(ctx, el), kind: 'hidden' }, null, withLink([])));
      return;
    }
    if (n === 'hyperlink') {
      const rid = rId(el);
      const rel = rid ? model.pkg.rels(ctx.part).get(rid) : undefined;
      const anchor = wAttr(el, 'anchor');
      const mark = schema.marks.link.create({ ref: store(ctx, el), href: rel?.target ?? (anchor ? `#${anchor}` : '') });
      for (const k of elements(el)) readInline(ctx, k, info, items, mark);
      return;
    }
    if (n === 'smartTag') {
      // its runs are read as the paragraph's own (Word 2010 and later drop smart tags too);
      // an untouched paragraph is written back with them
      for (const k of elements(el)) if (!isW(k, 'smartTagPr')) readInline(ctx, k, info, items, link);
      return;
    }
    if (n === 'fldSimple') {
      items.push(schema.nodes.inl.create({ ref: store(ctx, el), kind: 'text', label: textOf(el) || ' ' }, null, withLink([])));
      return;
    }
  }
  if (el.namespaceURI === NS.mc && el.localName === 'AlternateContent') {
    items.push(atomFor(ctx, el, el, withLink([])));
    return;
  }
  if (el.namespaceURI === NS.m && (el.localName === 'oMath' || el.localName === 'oMathPara')) {
    // an equation: drawn from its XML, kept as it is; the text around it stays editable
    const ref = store(ctx, el);
    const v = mathVisual(el);
    model.visuals.set(ref, v);
    items.push(schema.nodes.inl.create({ ref, kind: 'math', label: ommlText(el), ...v }, null, withLink([])));
    return;
  }
  throw new Locked('có nội dung đặc biệt');
}

/**
 * How an equation is drawn: MathML, on its own line for an equation
 * paragraph (m:oMathPara). One too deeply nested to draw shows as a chip.
 */
function mathVisual(el: Element): Visual {
  try {
    return mathMarkup(el);
  } catch {
    return { html: '<span class="ez-wmark">Công thức</span>', block: false, css: '' };
  }
}

function mathMarkup(el: Element): Visual {
  if (el.localName !== 'oMathPara') return { html: ommlToMathml(el, false), block: false, css: '' };
  const jcEl = elements(elements(el).find((k) => k.localName === 'oMathParaPr') ?? el).find((k) => k.localName === 'jc');
  const jc = jcEl?.getAttributeNS(NS.m, 'val') ?? jcEl?.getAttribute('m:val') ?? 'center';
  const align = jc === 'left' ? 'left' : jc === 'right' ? 'right' : 'center';
  return { html: ommlParaToMathml(el), block: true, css: `text-align:${align}` };
}

/** marks for a run: link, its own formatting (rp), and b/i/u as they look after styles */
function runMarks(ctx: Ctx, rPr: Element | null, info: ParaInfo, link: Mark | null): { marks: readonly Mark[]; eff: RunProps } {
  const model = ctx.model;
  const direct = readRunProps(rPr, model.styles.theme);
  const inherited = merge<RunProps>(info.styleRun, model.styles.character(wVal(rPr, 'rStyle') ?? undefined));
  const eff = merge<RunProps>(inherited, direct);
  let marks: readonly Mark[] = [];
  if (link) marks = link.addToSet(marks);
  if (rPr) marks = schema.marks.rp.create({ ref: store(ctx, rPr), css: runCss(eff) }).addToSet(marks);
  if (eff.b) marks = schema.marks.b.create().addToSet(marks);
  if (eff.i) marks = schema.marks.i.create().addToSet(marks);
  if (eff.u && eff.u !== 'none') marks = schema.marks.u.create({ val: eff.u }).addToSet(marks);
  return { marks, eff };
}

function readRun(ctx: Ctx, r: Element, info: ParaInfo, items: PMNode[], link: Mark | null) {
  const rPr = wChild(r, 'rPr');
  const { marks } = runMarks(ctx, rPr, info, link);
  let buf = '';
  const flush = () => {
    if (buf) items.push(schema.text(buf, marks));
    buf = '';
  };
  /** a run holding just this child (and the run's formatting), kept as XML */
  const synth = (child: Element) => {
    const r2 = r.cloneNode(false) as Element;
    if (rPr) r2.appendChild(rPr.cloneNode(true));
    r2.appendChild(child.cloneNode(true));
    return store(ctx, r2);
  };
  const atom = (child: Element, attrs: Record<string, unknown>) => {
    flush();
    items.push(schema.nodes.inl.create({ ref: synth(child), ...attrs }, null, link ? link.addToSet([]) : []));
  };
  for (const c of elements(r)) {
    if (c.namespaceURI !== NS.w) {
      if (c.namespaceURI === NS.mc && c.localName === 'AlternateContent') {
        flush();
        items.push(atomFor(ctx, c, null, link ? link.addToSet([]) : [], synth(c), raised(rPr)));
      } else atom(c, { kind: 'hidden' });
      continue;
    }
    switch (c.localName) {
      case 'rPr':
      case 'lastRenderedPageBreak':
        break;
      case 't':
        buf += c.textContent ?? '';
        break;
      case 'tab':
        buf += '\t';
        break;
      case 'noBreakHyphen':
        buf += '‑';
        break;
      case 'softHyphen':
        buf += '­';
        break;
      case 'cr':
        flush();
        items.push(schema.nodes.br.create({ ref: synth(c) }, null, marks));
        break;
      case 'br': {
        const type = wAttr(c, 'type');
        if (type === 'page' || type === 'column') atom(c, { kind: 'mark', label: type === 'page' ? 'ngắt trang' : 'ngắt cột' });
        else {
          flush();
          items.push(schema.nodes.br.create({ ref: synth(c) }, null, marks));
        }
        break;
      }
      case 'sym': {
        const code = parseInt(wAttr(c, 'char') ?? '', 16);
        atom(c, { kind: 'text', label: Number.isFinite(code) ? symbolText(code) : '□' });
        break;
      }
      case 'drawing':
      case 'pict':
      case 'object':
        flush();
        items.push(atomFor(ctx, c, null, link ? link.addToSet([]) : [], synth(c), raised(rPr)));
        break;
      case 'footnoteReference':
        atom(c, { kind: 'note', label: noteRef(ctx, c, 'footnote') });
        break;
      case 'endnoteReference':
        atom(c, { kind: 'note', label: noteRef(ctx, c, 'endnote') });
        break;
      case 'ruby': {
        // phonetic guide: the base text shows, the guide is kept in the file
        const base = wChild(c, 'rubyBase');
        atom(c, { kind: 'text', label: base ? textOf(base) : '' });
        break;
      }
      case 'ptab':
        atom(c, { kind: 'text', label: '\t' });
        break;
      case 'fldChar':
      case 'instrText':
        atom(c, { kind: 'hidden' });
        break;
      case 'pgNum':
        atom(c, { kind: 'text', label: '#' });
        break;
      default:
        atom(c, { kind: 'hidden' });
    }
  }
  flush();
}

const roman = (n: number) => formatNumber(n, 'lowerRoman');

/** the next footnote or endnote number; the note is listed for display after the text */
function noteRef(ctx: Ctx, el: Element, kind: 'footnote' | 'endnote'): string {
  // a note with its own mark (w:customMarkFollows) shows that mark, not a number
  if (onOffAttr(el, 'customMarkFollows')) return '';
  const label = kind === 'footnote' ? String(++ctx.shared.footnote) : roman(++ctx.shared.endnote);
  ctx.shared.notes.push({ kind, id: wAttr(el, 'id') ?? '', label });
  return label;
}

const onOffAttr = (el: Element, name: string) => {
  const v = wAttr(el, name);
  return v !== null && v !== undefined && !['0', 'false', 'off'].includes(v);
};

function symbolText(code: number) {
  const c = String.fromCharCode(code >= 0xf000 ? code : code + 0xf000);
  const map: Record<string, string> = { '': '•', '': '▪', '': '✓', '': '✗', '': '→', '': '➢', '': '●', '': '■' };
  return map[c] ?? String.fromCharCode(code >= 0xf000 ? code - 0xf000 : code);
}

/** the run's raise or lower (w:position, half-points) as CSS: MathType equations sit on the text's baseline this way */
function raised(rPr: Element | null): string {
  const v = num(wVal(rPr, 'position'));
  return v ? `vertical-align:${v / 2}pt` : '';
}

/**
 * A picture, shape, chart or other drawing as an inline item; `ref` given,
 * or the element stored as is. `lift`: the run's raise or lower (inline items only).
 */
function atomFor(ctx: Ctx, el: Element, whole: Element | null, marks: readonly Mark[], ref?: number, lift = ''): PMNode {
  const r = ref ?? store(ctx, whole ?? el);
  const attrs = visual(ctx, el);
  if (lift && !attrs.block && (attrs.kind === 'image' || attrs.kind === 'shape')) attrs.css = attrs.css ? `${attrs.css};${lift}` : lift;
  if (attrs.kind === 'shape' || attrs.css) ctx.model.visuals.set(r, { html: attrs.html ?? '', block: !!attrs.block, css: attrs.css ?? '' });
  return schema.nodes.inl.create({ ref: r, ...attrs }, null, marks);
}

interface InlAttrs {
  kind: 'image' | 'shape' | 'mark' | 'hidden';
  label: string;
  src?: string;
  html?: string;
  w?: number;
  h?: number;
  block?: boolean;
  css?: string;
}

const O = 'urn:schemas-microsoft-com:office:office';
const pt = (px: number) => +(px * 0.75).toFixed(1);

/** The holder of a floating drawing: on its own line, aligned as in the file */
function blockCss(block: boolean, align: Drawn['align'], offset: number, image: boolean): string {
  if (!block) return '';
  if (image) {
    if (align === 'center') return 'display:block;margin-left:auto;margin-right:auto';
    if (align === 'right') return 'display:block;margin-left:auto';
    return `display:block${offset ? `;margin-left:${Math.round(offset)}px` : ''}`;
  }
  if (align === 'center' || align === 'right') return `text-align:${align}`;
  return offset ? `padding-left:${Math.round(offset)}px` : '';
}

/**
 * How something drawn shows: a picture, a shape as SVG, or a labelled chip
 * when ezPDF cannot draw it. For mc:AlternateContent the modern content
 * comes first and the older fallback (VML) is used when that shows nothing.
 */
function visual(ctx: Ctx, el: Element): InlAttrs {
  if (el.namespaceURI === NS.mc && el.localName === 'AlternateContent') {
    let chip: InlAttrs | null = null;
    for (const option of elements(el).filter((k) => k.localName === 'Choice' || k.localName === 'Fallback')) {
      const v = visualOf(ctx, option);
      if (v.kind !== 'mark') return v;
      chip ??= v;
    }
    return chip ?? { kind: 'mark', label: 'Hình vẽ' };
  }
  return visualOf(ctx, el);
}

function visualOf(ctx: Ctx, el: Element): InlAttrs {
  const dc = drawCtx(ctx);
  const drawing = isW(el, 'drawing') ? el : el.getElementsByTagNameNS(NS.w, 'drawing')[0];
  if (drawing) {
    const pic = drawingPicture(ctx, drawing);
    if (pic) return pic;
    const d = safeDraw(ctx, () => drawingSvg(drawing, dc));
    if (d) return shapeAttrs(d);
  }
  const pict = isW(el, 'pict') || isW(el, 'object') ? el : (el.getElementsByTagNameNS(NS.w, 'pict')[0] ?? el.getElementsByTagNameNS(NS.w, 'object')[0]);
  if (pict) {
    const d = safeDraw(ctx, () => vmlSvg(pict, dc));
    if (d) return shapeAttrs(d);
    const img = pict.getElementsByTagNameNS(NS.v, 'imagedata')[0];
    const rid = img ? attrNS(img, NS.r, 'id') || img.getAttributeNS(O, 'relid') : null;
    if (rid) {
      const shape = img.parentNode as Element | null;
      const size = vmlSizePt(shape);
      const style = shape?.getAttribute('style') ?? '';
      const floating = /position:\s*absolute/.test(style);
      const h = /mso-position-horizontal:\s*(center|right)/.exec(style)?.[1] as Drawn['align'] | undefined;
      return pictureAttrs(ctx, rid, size.w, size.h, blockCss(floating, h ?? 'left', 0, true), floating);
    }
  }
  // an empty w:pict or w:drawing (Word leaves them sometimes): nothing to show
  const holder = drawing ?? pict ?? el;
  // (a w:pict holding only a shape type definition draws nothing either)
  const drawable = (k: Element) => (k.namespaceURI === NS.v && k.localName !== 'shapetype') || k.namespaceURI === O;
  if (!elements(holder).length || (pict && !drawing && !elements(pict).some(drawable))) return { kind: 'hidden', label: '' };
  const data = el.getElementsByTagNameNS(NS.a, 'graphicData')[0]?.getAttribute('uri') ?? '';
  const label = /chart/.test(data) ? 'Biểu đồ' : /diagram/.test(data) ? 'SmartArt' : el.getElementsByTagNameNS(NS.w, 'txbxContent')[0] ? 'Hộp chữ' : 'Hình vẽ';
  return { kind: 'mark', label };
}

/** a drawing that throws on odd input, or one past the document's budget, shows as a chip, never breaks the document */
function safeDraw(ctx: Ctx, f: () => Drawn | null): Drawn | null {
  if (ctx.shared.drawn > DRAW_BUDGET) return null;
  try {
    const d = f();
    if (d) ctx.shared.drawn += d.html.length;
    return d && ctx.shared.drawn <= DRAW_BUDGET ? d : null;
  } catch {
    return null;
  }
}

function shapeAttrs(d: Drawn): InlAttrs {
  return { kind: 'shape', label: d.label, html: d.html, w: pt(d.w), h: pt(d.h), block: d.block, css: blockCss(d.block, d.align, d.offset, false) };
}

/** a plain picture in a w:drawing (graphicData …/picture) */
function drawingPicture(ctx: Ctx, drawing: Element): InlAttrs | null {
  const data = drawing.getElementsByTagNameNS(NS.a, 'graphicData')[0];
  if (!data || !/\/picture$/.test(data.getAttribute('uri') ?? '')) return null;
  const blip = data.getElementsByTagNameNS(NS.a, 'blip')[0];
  const rid = blip ? (attrNS(blip, NS.r, 'embed') ?? attrNS(blip, NS.r, 'link')) : null;
  const extent = drawing.getElementsByTagNameNS(NS.wp, 'extent')[0];
  const w = emuToPt(Number(extent?.getAttribute('cx') ?? 0));
  const h = emuToPt(Number(extent?.getAttribute('cy') ?? 0));
  const place = placement(drawing);
  if (!rid) return { kind: 'mark', label: 'Hình' };
  return pictureAttrs(ctx, rid, w, h, blockCss(place.block, place.align, place.offset, true), place.block);
}

function pictureAttrs(ctx: Ctx, rid: string, w: number, h: number, css: string, block: boolean): InlAttrs {
  const url = imageUrl(ctx, rid, w > 0 && h > 0 ? { w: w / 0.75, h: h / 0.75 } : undefined);
  if (url) return { kind: 'image', src: url, w: +w.toFixed(1), h: +h.toFixed(1), label: 'Hình', css, block };
  const rel = ctx.model.pkg.rels(ctx.part).get(rid);
  if (rel?.external) return { kind: 'mark', label: 'Hình (liên kết ngoài)' };
  const bytes = rel ? ctx.model.pkg.files[rel.target] : undefined;
  if (!bytes) return { kind: 'mark', label: 'Hình (không có trong tệp)' };
  // named by what it really is, else by its file's extension
  const kind = sniffImage(bytes);
  const ext = rel?.target.split('.').pop()?.toLowerCase() ?? '';
  const name = KIND_LABEL[kind] ?? (kind !== 'unknown' ? kind.toUpperCase() : ext.toUpperCase());
  return { kind: 'mark', label: name ? `Hình (${name})` : 'Hình' };
}

/** v:shape style → width and height in pt */
function vmlSizePt(shape: Element | null): { w: number; h: number } {
  const style = shape?.getAttribute('style') ?? '';
  const m = (k: string) => {
    const x = new RegExp(`(?:^|;)\\s*${k}:\\s*([\\d.]+)(pt|in|px|cm|mm)?`).exec(style);
    if (!x) return 0;
    const v = Number(x[1]);
    return x[2] === 'in' ? v * 72 : x[2] === 'px' ? v * 0.75 : x[2] === 'cm' ? (v * 72) / 2.54 : x[2] === 'mm' ? (v * 72) / 25.4 : v;
  };
  return { w: m('width'), h: m('height') };
}

/**
 * A URL that shows the picture of a relationship, whatever its format (see
 * images.ts). External pictures are never fetched. One URL per picture,
 * however often it is used.
 */
function imageUrl(ctx: Ctx, rid: string, size?: { w: number; h: number }): string | null {
  const key = `${ctx.part}#${rid}`;
  const known = ctx.shared.images.get(key);
  if (known !== undefined) return known;
  let url: string | null = null;
  const rel = ctx.model.pkg.rels(ctx.part).get(rid);
  const bytes = rel && !rel.external ? ctx.model.pkg.files[rel.target] : undefined;
  if (bytes && ctx.opts.imageUrl) {
    const same = ctx.shared.byTarget.get(rel!.target);
    if (same !== undefined) url = same;
    else {
      try {
        url = pictureUrl(ctx, rel!.target, bytes, size, 0);
      } catch {
        url = null;
      }
      ctx.shared.byTarget.set(rel!.target, url);
      if (url) ctx.model.urls.push(url);
    }
  }
  ctx.shared.images.set(key, url);
  return url;
}

/** bytes of any picture format → a URL a browser shows, or null (the picture then shows as a chip) */
function pictureUrl(ctx: Ctx, target: string, bytes: Uint8Array, size: { w: number; h: number } | undefined, depth: number): string | null {
  const make = ctx.opts.imageUrl!;
  const kind = sniffImage(bytes);
  if (NATIVE.has(kind)) return make(bytes, IMAGE_MIME[kind]!);
  if (MAYBE.has(kind)) return ctx.shared.showable.has(target) ? make(bytes, IMAGE_MIME[kind]!) : null;
  // decoded before reading (the picture part itself; a TIFF inside a .gz is not)
  const raster = () => {
    const png = depth === 0 || kind === 'tiff' ? ctx.shared.rasters.get(target) : null;
    return png ? make(png, 'image/png') : null;
  };
  switch (kind) {
    case 'tiff':
      return raster();
    case 'wmf':
    case 'emf': {
      const m = ctx.shared.meta?.metafileToSvg(bytes, size);
      if (!m) return null;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.w.toFixed(2)} ${m.h.toFixed(2)}" width="${m.w.toFixed(2)}" height="${m.h.toFixed(2)}" preserveAspectRatio="none">${m.inner}</svg>`;
      return make(new TextEncoder().encode(svg), 'image/svg+xml');
    }
    case 'gzip': {
      // .wmz, .emz, .svgz: what is inside, once
      if (depth) return null;
      const { out, used } = gunzipLimited(bytes, Math.min(64 * 1024 * 1024, INFLATE_BUDGET - ctx.shared.inflated));
      ctx.shared.inflated += used; // what it cost, also when it was refused
      if (!out) return null;
      const inner = sniffImage(out);
      // what may be inside: a metafile or an SVG (never a TIFF or EPS: those are decoded before reading, from the part itself)
      return inner === 'wmf' || inner === 'emf' || inner === 'svg' ? pictureUrl(ctx, target, out, size, depth + 1) : null;
    }
    case 'eps': {
      const dos = dosEpsPreview(bytes);
      if (dos?.kind === 'wmf') return depth < 2 ? pictureUrl(ctx, target, dos.bytes, size, depth + 1) : null;
      return depth === 0 ? raster() : null;
    }
    case 'pict': {
      const jpeg = pictJpeg(bytes);
      return jpeg ? make(jpeg, 'image/jpeg') : null;
    }
    default:
      return null;
  }
}

/** a .wmz/.emz (gzip): its content, refusing anything that inflates past `limit`; `used`: the bytes inflated either way */
function gunzipLimited(bytes: Uint8Array, limit = 64 * 1024 * 1024): { out: Uint8Array | null; used: number } {
  const parts: Uint8Array[] = [];
  let total = 0;
  let over = false;
  const g = new Gunzip((chunk) => {
    total += chunk.length;
    if (total > limit) over = true;
    else parts.push(chunk);
  });
  try {
    for (let i = 0; i < bytes.length && !over; i += 16384) g.push(bytes.subarray(i, i + 16384), i + 16384 >= bytes.length);
  } catch {
    return { out: null, used: total };
  }
  if (over || !total) return { out: null, used: total };
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return { out, used: total };
}

/** what the shape renderer needs from the reader: pictures, text boxes, charts, SmartArt */
function drawCtx(ctx: Ctx): DrawCtx {
  const model = ctx.model;
  return {
    theme: model.styles.theme,
    image: (rid) => imageUrl(ctx, rid),
    text: (txbx) => (ctx.depth > 3 ? '' : elements(txbx).map((e) => previewBlock({ ...ctx, depth: ctx.depth + 1 }, e)).join('')),
    chart: (rid, w, h) => {
      const rel = model.pkg.rels(ctx.part).get(rid);
      const text = rel && !rel.external ? model.pkg.text(rel.target) : null;
      if (!text) return null;
      try {
        return chartSvg(parseXml(model.dom, text, rel!.target).documentElement, w, h, model.styles.theme);
      } catch {
        return null;
      }
    },
    diagram: (dm) => {
      if (ctx.inDiagram) return null;
      // the SmartArt's data part names its saved drawing (dsp:dataModelExt relId, a relationship of this part)
      const rels = model.pkg.rels(ctx.part);
      const dataRel = rels.get(dm);
      if (!dataRel || dataRel.external) return null;
      const key = `${ctx.part}#${dataRel.target}`;
      let found = ctx.shared.diagrams.get(key);
      if (found === undefined) {
        found = null;
        const dataText = model.pkg.text(dataRel.target);
        try {
          const data = dataText ? parseXml(model.dom, dataText, dataRel.target) : null;
          const ext = data ? Array.from(data.getElementsByTagName('*')).find((e) => e.localName === 'dataModelExt') : undefined;
          const drawRel = rels.get(ext?.getAttribute('relId') ?? '');
          const drawText = drawRel && !drawRel.external ? model.pkg.text(drawRel.target) : null;
          if (drawText) found = { root: parseXml(model.dom, drawText, drawRel!.target).documentElement, part: drawRel!.target };
        } catch {
          found = null;
        }
        ctx.shared.diagrams.set(key, found);
      }
      return found ? { root: found.root, ctx: drawCtx({ ...ctx, part: found.part, depth: ctx.depth + 1, inDiagram: true }) } : null;
    },
    uid: () => String(++ctx.shared.uid),
  };
}

/** a drawn item as read-only HTML (locked blocks, header, footer, notes, text boxes) */
function visualHtml(a: InlAttrs): string {
  if (a.kind === 'image' && a.src) return `<img class="ez-wimg" src="${escapeHtml(a.src)}" style="${a.w && a.h ? `width:${a.w}pt;aspect-ratio:${a.w}/${a.h};` : ''}${escapeHtml(a.css ?? '')}" alt="">`;
  if (a.kind === 'shape') return `<span class="ez-wshape${a.block ? ' ez-wshape-block' : ''}" style="${escapeHtml(a.css ?? '')}">${a.html ?? ''}</span>`;
  return `<span class="ez-wmark">${escapeHtml(a.label)}</span>`;
}

// ---- tables -------------------------------------------------------------

type Side = 'top' | 'bottom' | 'left' | 'right' | 'insideH' | 'insideV';

function readTable(ctx: Ctx, tbl: Element, before: number[] | null): PMNode {
  const model = ctx.model;
  const tblPr = wChild(tbl, 'tblPr');
  const rows = elements(tbl).filter((e) => isW(e, 'tr'));
  // rows wrapped in content controls or custom XML: shown, not edited
  if (elements(tbl).some((e) => isW(e, 'sdt') || isW(e, 'customXml')) || rows.some((tr) => elements(tr).some((e) => isW(e, 'sdt') || isW(e, 'customXml')))) {
    return lockedBlock(ctx, tbl, before, 'là bảng có ô điều khiển nội dung');
  }
  const ref = store(ctx, tbl);
  const styleId = wVal(tblPr, 'tblStyle') ?? undefined;
  const borders: Partial<Record<Side, Border>> = { ...model.styles.tableBorders(styleId) };
  const direct = wChild(tblPr, 'tblBorders');
  if (direct) {
    for (const side of ['top', 'bottom', 'left', 'right', 'insideH', 'insideV'] as const) {
      const b = readBorder(wChild(direct, side) ?? wChild(direct, side === 'left' ? 'start' : side === 'right' ? 'end' : side));
      if (b) borders[side] = b;
    }
  }
  const grid = wChildren(wChild(tbl, 'tblGrid'), 'gridCol').map((g) => (num(wAttr(g, 'w')) ?? 0) / 20);
  const tblW = wChild(tblPr, 'tblW');
  const wType = wAttr(tblW, 'type');
  const wVal_ = num(wAttr(tblW, 'w'));
  const css = ['border-collapse:collapse', 'table-layout:auto'];
  if (wType === 'dxa' && wVal_) css.push(`width:${wVal_ / 20}pt`);
  else if (wType === 'pct' && wVal_) css.push(`width:${wVal_ / 50}%`);
  else if (grid.length && grid.every((g) => g > 0)) css.push(`width:${grid.reduce((a, b) => a + b, 0)}pt`);
  const jc = wVal(tblPr, 'jc');
  if (jc === 'center') css.push('margin-left:auto;margin-right:auto');
  const indent = num(wAttr(wChild(tblPr, 'tblInd'), 'w'));
  if (indent && wAttr(wChild(tblPr, 'tblInd'), 'type') !== 'pct') css.push(`margin-left:${indent / 20}pt`);

  // which grid columns continue a vertical merge, row by row
  const shape = rows.map((tr) =>
    wChildren(tr, 'tc').map((tc) => {
      const tcPr = wChild(tc, 'tcPr');
      const vm = wChild(tcPr, 'vMerge');
      return { span: num(wVal(tcPr, 'gridSpan')) ?? 1, vmerge: vm ? (wAttr(vm, 'val') ?? 'continue') : null };
    }),
  );
  const continues = (ri: number, col: number) => {
    const row = shape[ri];
    if (!row) return false;
    let c = 0;
    for (const cell of row) {
      if (c === col) return cell.vmerge === 'continue';
      c += cell.span;
    }
    return false;
  };
  const totalCols = Math.max(grid.length, ...shape.map((r) => r.reduce((a, c) => a + c.span, 0)));

  ctx.inTable++;
  const rowNodes = rows.map((tr, ri) => {
    const trPr = wChild(tr, 'trPr');
    const hEl = wChild(trPr, 'trHeight');
    const height = num(wAttr(hEl, 'val'));
    const rowCss = height ? `height:${height / 20}pt` : '';
    let col = 0;
    const cells = wChildren(tr, 'tc').map((tc, ci) => {
      const { span, vmerge } = shape[ri][ci];
      const tcPr = wChild(tc, 'tcPr');
      const cellCss: string[] = ['padding:0 5.4pt', 'vertical-align:top'];
      const w = wChild(tcPr, 'tcW');
      if (wAttr(w, 'type') === 'dxa' && num(wAttr(w, 'w'))) cellCss.push(`width:${num(wAttr(w, 'w'))! / 20}pt`);
      else if (grid.length) {
        const sum = grid.slice(col, col + span).reduce((a, b) => a + b, 0);
        if (sum) cellCss.push(`width:${sum}pt`);
      }
      const va = wVal(tcPr, 'vAlign');
      if (va === 'center') cellCss[1] = 'vertical-align:middle';
      else if (va === 'bottom') cellCss[1] = 'vertical-align:bottom';
      const fill = wAttr(wChild(tcPr, 'shd'), 'fill');
      if (fill && fill !== 'auto' && /^[0-9a-f]{6}$/i.test(fill)) cellCss.push(`background-color:#${fill}`);
      const own = wChild(tcPr, 'tcBorders');
      const side = (s: 'top' | 'bottom' | 'left' | 'right', fallback: Side) => {
        const b = readBorder(wChild(own, s) ?? wChild(own, s === 'left' ? 'start' : s === 'right' ? 'end' : s)) ?? borders[fallback];
        return borderCss(b) ?? 'none';
      };
      const top = vmerge === 'continue' ? 'none' : side('top', ri === 0 ? 'top' : 'insideH');
      const bottom = continues(ri + 1, col) ? 'none' : side('bottom', ri === rows.length - 1 ? 'bottom' : 'insideH');
      cellCss.push(`border-top:${top}`, `border-bottom:${bottom}`);
      cellCss.push(`border-left:${side('left', col === 0 ? 'left' : 'insideV')}`);
      cellCss.push(`border-right:${side('right', col + span >= totalCols ? 'right' : 'insideV')}`);
      col += span;
      let tail: number[] | null = null;
      const content = readBlocks(
        ctx,
        elements(tc).filter((e) => !isW(e, 'tcPr')),
        (pending) => (tail = pending),
      );
      if (!content.length) content.push(schema.nodes.paragraph.create({ css: model.defaultCss }));
      return schema.nodes.table_cell.create({ colspan: span, css: cellCss.join(';'), tail }, content);
    });
    return schema.nodes.table_row.create({ css: rowCss }, cells);
  });
  ctx.inTable--;
  const node = schema.nodes.table.create({ ref, css: css.join(';'), before }, rowNodes);
  model.origin.set(ref, node);
  return node;
}

// ---- read-only preview (locked blocks, header, footer) -------------------

function previewBlock(ctx: Ctx, el: Element): string {
  const model = ctx.model;
  if (isW(el, 'p')) {
    const info = paraInfo(model, wChild(el, 'pPr'));
    return `<p style="${escapeHtml(paraCss(info.props, info.markRun))}">${previewInline(ctx, el, info) || '<br>'}</p>`;
  }
  if (isW(el, 'tbl')) {
    const rows = elements(el)
      .filter((e) => isW(e, 'tr'))
      .map(
        (tr) =>
          `<tr>${wChildren(tr, 'tc')
            .map((tc) => {
              const span = num(wVal(wChild(tc, 'tcPr'), 'gridSpan')) ?? 1;
              return `<td${span > 1 ? ` colspan="${span}"` : ''} style="border:0.5pt solid #999;padding:0 5.4pt;vertical-align:top">${elements(tc)
                .filter((e) => !isW(e, 'tcPr'))
                .map((e) => previewBlock(ctx, e))
                .join('')}</td>`;
            })
            .join('')}</tr>`,
      )
      .join('');
    return `<table style="border-collapse:collapse">${rows}</table>`;
  }
  if (isW(el, 'sdt')) return elements(wChild(el, 'sdtContent')).map((e) => previewBlock(ctx, e)).join('');
  if (isW(el, 'customXml')) return elements(el).map((e) => previewBlock(ctx, e)).join('');
  return '';
}

function previewInline(ctx: Ctx, container: Element, info: ParaInfo): string {
  let html = '';
  for (const el of elements(container)) {
    if (el.namespaceURI === NS.m && (el.localName === 'oMath' || el.localName === 'oMathPara')) {
      const v = mathVisual(el);
      html += `<span class="ez-wmath${v.block ? ' ez-wmath-block' : ''}" style="${escapeHtml(v.css)}">${v.html}</span>`;
      continue;
    }
    if (el.namespaceURI === NS.mc && el.localName === 'AlternateContent') {
      html += visualHtml(visual(ctx, el));
      continue;
    }
    if (el.namespaceURI !== NS.w) continue;
    switch (el.localName) {
      case 'r': {
        const rPr = wChild(el, 'rPr');
        const direct = readRunProps(rPr, ctx.model.styles.theme);
        const eff = merge<RunProps>(info.styleRun, ctx.model.styles.character(wVal(rPr, 'rStyle') ?? undefined), direct);
        let css = runCss(eff);
        if (eff.b) css += ';font-weight:bold';
        if (eff.i) css += ';font-style:italic';
        if (eff.u && eff.u !== 'none') css += ';text-decoration-line:underline';
        let text = '';
        for (const c of elements(el)) {
          if (isW(c, 't') || isW(c, 'delText') || isW(c, 'instrText')) text += isW(c, 'instrText') ? '' : escapeHtml(c.textContent ?? '');
          else if (isW(c, 'tab')) text += '\t';
          else if (isW(c, 'br') || isW(c, 'cr')) text += '<br>';
          else if (isW(c, 'drawing') || isW(c, 'pict') || isW(c, 'object') || (c.namespaceURI === NS.mc && c.localName === 'AlternateContent')) {
            const v = visual(ctx, c);
            const lift = raised(rPr);
            if (lift && !v.block) v.css = v.css ? `${v.css};${lift}` : lift;
            text += visualHtml(v);
          }
          else if (isW(c, 'footnoteRef') || isW(c, 'endnoteRef')) text += `<sup>${escapeHtml(ctx.noteLabel ?? '')}</sup>`;
          else if (isW(c, 'footnoteReference') || isW(c, 'endnoteReference')) {
            // a note mark in a read-only paragraph: numbered in turn with the others
            const label = ctx.part === ctx.model.pkg.main ? noteRef(ctx, c, isW(c, 'footnoteReference') ? 'footnote' : 'endnote') : '';
            text += `<sup class="ez-wnote">${escapeHtml(label)}</sup>`;
          } else if (isW(c, 'sym')) {
            const code = parseInt(wAttr(c, 'char') ?? '', 16);
            text += escapeHtml(Number.isFinite(code) ? symbolText(code) : '□');
          }
        }
        html += text ? `<span style="${escapeHtml(css)}">${text}</span>` : '';
        break;
      }
      case 'ins':
      case 'moveTo':
        html += `<ins class="ez-wins">${previewInline(ctx, el, info)}</ins>`;
        break;
      case 'del':
      case 'moveFrom':
        html += `<del class="ez-wdel">${previewInline(ctx, el, info)}</del>`;
        break;
      case 'hyperlink':
      case 'smartTag':
      case 'customXml':
      case 'fldSimple':
      case 'dir':
      case 'bdo':
        html += previewInline(ctx, el, info);
        break;
      case 'sdt':
        html += previewInline(ctx, wChild(el, 'sdtContent') ?? el, info);
        break;
    }
  }
  return html;
}
