/**
 * The editor's model → a .docx. Only word/document.xml is rebuilt; every
 * other part of the package is copied byte for byte.
 *
 * In the body, a paragraph, table or read-only block the user did not touch
 * is written as its original XML. A changed paragraph keeps its original
 * w:pPr (style, list, spacing, section break) and its runs' original w:rPr
 * (font, size, colour…); only bold, italic and underline are set where the
 * user changed them, and the text is the new text. A changed table keeps its
 * table, row and cell properties, and its untouched cells as they were; only
 * the content of changed cells is rebuilt.
 *
 * Copies made by copy and paste inside the document stay valid: a second
 * picture gets its own drawing id, a second bookmark, comment anchor or
 * footnote reference is not written twice. Pairs the editing broke up (a
 * bookmark's start without its end, a field's begin without its end) are
 * removed, so Word never meets a half of one.
 */
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { schema } from './schema';
import { writePackage } from './package';
import { readRunProps, type RunProps, safeFont } from './styles';
import type { WordModel } from './read';
import { elements, isW, NS, parseXml, stripInvalidXml, wAttr, wChild, wChildren, wVal } from './xml';

const W = NS.w;

/** CT_RPr: the order Word requires for run properties */
const RPR_ORDER = [
  'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss',
  'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs',
  'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout',
  'specVanish', 'oMath', 'rPrChange',
];

/** CT_PPr: the order Word requires for paragraph properties */
const PPR_ORDER = [
  'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers',
  'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE',
  'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents',
  'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle',
  'rPr', 'sectPr', 'pPrChange',
];

/** Insert in schema order; extension elements (w14:…, which come last in Word's output) stay after it. */
function insertOrdered(parent: Element, el: Element, order: string[]) {
  const rank = order.indexOf(el.localName);
  for (const k of elements(parent)) {
    if (k.namespaceURI !== W || order.indexOf(k.localName) > rank) {
      parent.insertBefore(el, k);
      return;
    }
  }
  parent.appendChild(el);
}

const merge = <T extends object>(...layers: (T | undefined)[]): T => Object.assign({}, ...layers.filter(Boolean)) as T;

/** inline items that anchor something by id: one copy only */
const ANCHORS = [
  'bookmarkStart', 'bookmarkEnd', 'commentRangeStart', 'commentRangeEnd', 'commentReference', 'footnoteReference',
  'endnoteReference', 'permStart', 'permEnd',
];

interface Out {
  model: WordModel;
  doc: Document;
  used: Set<number>;
  /** ppr index → the paragraph that writes that w:pPr's section break */
  sectHolder: Map<number, PMNode>;
  /** inline item ref → document position of its first occurrence (later ones are copies) */
  firstAt: Map<number, number>;
  /** the highest drawing id (wp:docPr) in use */
  maxDocPr: number;
}

const el = (o: Out, name: string) => o.doc.createElementNS(W, `w:${name}`);
const imp = (o: Out, ref: number, deep = true) => o.doc.importNode(o.model.store[ref], deep) as Element;

export function writeDocx(model: WordModel, doc: PMNode): Uint8Array {
  const xmlText = buildDocumentXml(model, doc);
  return writePackage(model.pkg, { [model.pkg.main]: xmlText });
}

export function buildDocumentXml(model: WordModel, doc: PMNode): string {
  const out = parseXml(model.dom, model.pkg.text(model.pkg.main)!, model.pkg.main);
  const body = wChild(out.documentElement, 'body')!;
  const kids = elements(body);
  const sectPr = kids.length && isW(kids[kids.length - 1], 'sectPr') ? kids[kids.length - 1] : null;
  let maxDocPr = 0;
  const docPrs = out.getElementsByTagNameNS(NS.wp, 'docPr');
  for (let i = 0; i < docPrs.length; i++) maxDocPr = Math.max(maxDocPr, Number(docPrs[i].getAttribute('id')) || 0);
  for (const k of [...Array.from(body.childNodes)]) if (k !== sectPr) body.removeChild(k);

  const o: Out = { model, doc: out, used: new Set(), sectHolder: new Map(), firstAt: new Map(), maxDocPr };
  // A section break (w:sectPr in w:pPr) is written once: by the original paragraph if it is still
  // there, else by the last paragraph that carries that w:pPr (the second half of a split).
  const original = new Map<number, PMNode>();
  doc.descendants((n, pos) => {
    if (n.type === schema.nodes.paragraph && n.attrs.ppr !== null) {
      o.sectHolder.set(n.attrs.ppr, n);
      if (n.attrs.ref !== null && !original.has(n.attrs.ppr)) original.set(n.attrs.ppr, n);
    }
    if (n.type === schema.nodes.inl && n.attrs.ref !== null && !o.firstAt.has(n.attrs.ref)) o.firstAt.set(n.attrs.ref, pos);
    return true;
  });
  for (const [ppr, n] of original) o.sectHolder.set(ppr, n);

  const add = (e: Node) => (sectPr ? body.insertBefore(e, sectPr) : body.appendChild(e));
  doc.forEach((block, offset) => writeBlock(o, block, offset).forEach(add));
  for (const t of model.tail) add(imp(o, t));
  keepPairsWhole(model, body);

  let text = new model.dom.XMLSerializer().serializeToString(out);
  text = text.replace(/^<\?xml[^>]*\?>\s*/, '');
  // the original declaration, as it was (quotes, standalone)
  const decl = /^﻿?(<\?xml[^>]*\?>)(\s*)/.exec(model.pkg.text(model.pkg.main)!);
  return decl ? `${decl[1]}${decl[2]}${text}` : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${text}`;
}

/** Does this block hold a later copy of an inline item (its original XML would repeat ids)? */
function holdsCopy(o: Out, node: PMNode, pos: number) {
  let copy = false;
  node.descendants((n, p) => {
    if (copy) return false;
    if (n.type === schema.nodes.inl && n.attrs.ref !== null && o.firstAt.get(n.attrs.ref) !== pos + 1 + p) copy = true;
    return !copy;
  });
  return copy;
}

/** `pos`: the block's position in the document */
function writeBlock(o: Out, node: PMNode, pos: number): Element[] {
  const els: Element[] = [];
  for (const b of node.attrs.before ?? []) els.push(imp(o, b));
  const ref: number | null = node.attrs.ref ?? null;
  const untouched = ref !== null && !o.used.has(ref) && !!o.model.origin.get(ref)?.eq(node) && !holdsCopy(o, node, pos);
  if (untouched) {
    o.used.add(ref!);
    els.push(imp(o, ref!));
    return els;
  }
  if (node.type === schema.nodes.locked) {
    // a read-only block: its XML as it is
    els.push(imp(o, ref!));
  } else if (node.type === schema.nodes.table) els.push(writeTable(o, node, pos));
  else if (node.type === schema.nodes.paragraph) els.push(writeParagraph(o, node, pos));
  return els;
}

function writeTable(o: Out, node: PMNode, pos: number): Element {
  const ref = node.attrs.ref as number;
  o.used.add(ref);
  const tbl = imp(o, ref);
  const cells = wChildren(tbl, 'tr').flatMap((tr) => wChildren(tr, 'tc'));
  const nodes: { cell: PMNode; pos: number }[] = [];
  node.forEach((row, rowOff) => row.forEach((cell, cellOff) => nodes.push({ cell, pos: pos + 1 + rowOff + 1 + cellOff })));
  const before: PMNode[] = [];
  o.model.origin.get(ref)?.forEach((row) => row.forEach((cell) => before.push(cell)));
  if (cells.length !== nodes.length) throw new Error('Bảng bị đổi cấu trúc: không lưu được.');
  nodes.forEach(({ cell, pos: cellPos }, i) => {
    // a cell nobody touched keeps its XML (blank lines, stray marks and all)
    if (before.length === nodes.length && before[i].eq(cell) && !holdsCopy(o, cell, cellPos)) return;
    const tc = cells[i];
    for (const k of [...Array.from(tc.childNodes)]) if (!isW(k, 'tcPr')) tc.removeChild(k);
    cell.forEach((b, off) => writeBlock(o, b, cellPos + 1 + off).forEach((e) => tc.appendChild(e)));
    for (const t of cell.attrs.tail ?? []) tc.appendChild(imp(o, t));
    // Word requires a cell's last block to be a paragraph (marks such as a bookmark's end may follow it)
    const blocks = elements(tc).filter((e) => isW(e, 'p') || isW(e, 'tbl') || isW(e, 'sdt') || isW(e, 'customXml'));
    const last = blocks[blocks.length - 1];
    if (!last || !isW(last, 'p')) tc.appendChild(el(o, 'p'));
  });
  return tbl;
}

function writeParagraph(o: Out, node: PMNode, pos: number): Element {
  const { model } = o;
  const p = el(o, 'p');
  const ref: number | null = node.attrs.ref;
  if (ref !== null && !o.used.has(ref)) {
    o.used.add(ref);
    const src = model.store[ref] as Element;
    for (let i = 0; i < src.attributes.length; i++) {
      const a = src.attributes[i];
      // paragraph ids must stay unique; Word makes new ones
      if (a.namespaceURI === NS.w14 && (a.localName === 'paraId' || a.localName === 'textId')) continue;
      p.setAttributeNS(a.namespaceURI, a.name, a.value);
    }
  }
  let pPr: Element | null = null;
  if (node.attrs.ppr !== null) {
    pPr = imp(o, node.attrs.ppr);
    if (o.sectHolder.get(node.attrs.ppr) !== node) {
      const sect = wChild(pPr, 'sectPr');
      if (sect) pPr.removeChild(sect);
    }
  }
  if (node.attrs.nolist) {
    // out of the list: numbering 0 also cancels a list that comes from the style
    pPr ??= el(o, 'pPr');
    const old = wChild(pPr, 'numPr');
    if (old) pPr.removeChild(old);
    const numPr = el(o, 'numPr');
    const numId = el(o, 'numId');
    numId.setAttributeNS(W, 'w:val', '0');
    numPr.appendChild(numId);
    insertOrdered(pPr, numPr, PPR_ORDER);
  }
  if (pPr) p.appendChild(pPr);
  const pStyle = pPr ? (wVal(pPr, 'pStyle') ?? undefined) : undefined;

  let linkKey: number | null = null;
  let linkEl: Element | null = null;
  node.forEach((child, off) => {
    const link = child.marks.find((m) => m.type === schema.marks.link);
    const key = link && link.attrs.ref !== null ? (link.attrs.ref as number) : null;
    if (key !== linkKey) {
      linkKey = key;
      linkEl = key !== null ? imp(o, key, false) : null;
      if (linkEl) p.appendChild(linkEl);
    }
    const target = linkEl ?? p;
    if (child.isText) target.appendChild(makeRun(o, child.text!, child.marks, pStyle));
    else if (child.type === schema.nodes.br) {
      if (child.attrs.ref !== null) target.appendChild(imp(o, child.attrs.ref));
      else {
        const r = makeRun(o, '', child.marks, pStyle);
        r.appendChild(el(o, 'br'));
        target.appendChild(r);
      }
    } else if (child.type === schema.nodes.inl && child.attrs.ref !== null) {
      const first = o.firstAt.get(child.attrs.ref) === pos + 1 + off;
      const e = first ? imp(o, child.attrs.ref) : copyOf(o, child.attrs.ref);
      if (e) target.appendChild(e);
    }
  });
  return p;
}

/** A pasted copy of an inline item: a new drawing id; no second anchor (bookmark, comment, note). */
function copyOf(o: Out, ref: number): Element | null {
  const e = imp(o, ref);
  const is = (name: string) => isW(e, name) || e.getElementsByTagNameNS(W, name).length > 0;
  if (ANCHORS.some(is)) return null;
  const ids = e.getElementsByTagNameNS(NS.wp, 'docPr');
  for (let i = 0; i < ids.length; i++) ids[i].setAttribute('id', String(++o.maxDocPr));
  return e;
}

/** A run for `text` with the formatting its marks describe. */
function makeRun(o: Out, text: string, marks: readonly Mark[], pStyle: string | undefined): Element {
  const { model } = o;
  const r = el(o, 'r');
  const rp = marks.find((m) => m.type === schema.marks.rp);
  const srcRef: number | null = rp ? rp.attrs.ref : null;
  const src = srcRef !== null ? (model.store[srcRef] as Element) : null;
  let rPr = srcRef !== null ? imp(o, srcRef) : null;
  const inherited = merge<RunProps>(model.styles.paragraph(pStyle).r, model.styles.character(src ? (wVal(src, 'rStyle') ?? undefined) : undefined));
  const current = merge<RunProps>(inherited, readRunProps(src, model.styles.theme));
  const ensure = () => (rPr ??= el(o, 'rPr'));

  const toggle = (name: 'b' | 'i', want: boolean) => {
    if (!!current[name] === want) return;
    const pr = ensure();
    for (const k of elements(pr)) if (isW(k, name) || isW(k, `${name}Cs`)) pr.removeChild(k);
    if (!!inherited[name] === want) return; // the style gives it now
    for (const n of [name, `${name}Cs`]) {
      const e = el(o, n);
      if (!want) e.setAttributeNS(W, 'w:val', '0');
      insertOrdered(pr, e, RPR_ORDER);
    }
  };
  toggle('b', marks.some((m) => m.type === schema.marks.b));
  toggle('i', marks.some((m) => m.type === schema.marks.i));

  const u = marks.find((m) => m.type === schema.marks.u);
  const wantU = u ? (u.attrs.val as string) : undefined;
  const curU = current.u && current.u !== 'none' ? current.u : undefined;
  if (wantU !== curU) {
    const pr = ensure();
    const old = wChild(pr, 'u');
    if (old) pr.removeChild(old);
    const inhU = inherited.u && inherited.u !== 'none' ? inherited.u : undefined;
    if (wantU !== inhU) {
      const e = el(o, 'u');
      e.setAttributeNS(W, 'w:val', wantU ?? 'none');
      insertOrdered(pr, e, RPR_ORDER);
    }
  }
  // a font the user chose: for every kind of character in the run; theme fonts and the hint would win over it
  const font = marks.find((m) => m.type === schema.marks.font);
  const name = font ? safeFont(font.attrs.name as string) : undefined;
  if (name) {
    const pr = ensure();
    const old = wChild(pr, 'rFonts');
    if (old) pr.removeChild(old);
    const e = el(o, 'rFonts');
    for (const a of ['ascii', 'hAnsi', 'eastAsia', 'cs']) e.setAttributeNS(W, `w:${a}`, name);
    insertOrdered(pr, e, RPR_ORDER);
  }
  // a size the user chose (half-points), for Latin and complex-script text alike
  const size = marks.find((m) => m.type === schema.marks.size);
  const hp = size ? Math.max(2, Math.min(3276, Math.round(Number(size.attrs.hp)))) : 0;
  if (hp) {
    const pr = ensure();
    for (const n of ['sz', 'szCs']) {
      const old = wChild(pr, n);
      if (old) pr.removeChild(old);
      const e = el(o, n);
      e.setAttributeNS(W, 'w:val', String(hp));
      insertOrdered(pr, e, RPR_ORDER);
    }
  }
  if (rPr && elements(rPr).length) r.appendChild(rPr);
  appendText(o, r, stripInvalidXml(text));
  return r;
}

function appendText(o: Out, r: Element, text: string) {
  for (const part of text.split(/(\t|­|‑)/)) {
    if (!part) continue;
    if (part === '\t') r.appendChild(el(o, 'tab'));
    else if (part === '­') r.appendChild(el(o, 'softHyphen'));
    else if (part === '‑') r.appendChild(el(o, 'noBreakHyphen'));
    else {
      const t = el(o, 't');
      t.setAttributeNS(NS.xml, 'xml:space', 'preserve');
      t.appendChild(o.doc.createTextNode(part));
      r.appendChild(t);
    }
  }
}

// ---- pairs ----------------------------------------------------------------

const PAIRS: [string, string][] = [
  ['bookmarkStart', 'bookmarkEnd'],
  ['commentRangeStart', 'commentRangeEnd'],
  ['permStart', 'permEnd'],
];

const all = (root: Element, name: string) => Array.from(root.getElementsByTagNameNS(W, name));

/** Remove `e`; a run left with nothing but its properties goes too. */
function drop(e: Element) {
  const parent = e.parentNode as Element | null;
  if (!parent) return;
  parent.removeChild(e);
  if (isW(parent, 'r') && elements(parent).every((k) => isW(k, 'rPr'))) parent.parentNode?.removeChild(parent);
}

/**
 * Editing can delete one half of a pair: a bookmark's start but not its end,
 * a field's begin but not its end. Word reports such a file as damaged, so
 * the leftover half goes too (pairs that were already broken in the original
 * file are left as they were).
 */
function keepPairsWhole(model: WordModel, body: Element) {
  const origBody = wChild(model.xml.documentElement, 'body');
  if (!origBody) return;
  for (const [start, end] of PAIRS) {
    const ids = (root: Element, name: string) => new Set(all(root, name).map((e) => wAttr(e, 'id')));
    const os = ids(origBody, start);
    const oe = ids(origBody, end);
    const ns = ids(body, start);
    const ne = ids(body, end);
    for (const e of all(body, start)) {
      const id = wAttr(e, 'id');
      if (os.has(id) && oe.has(id) && !ne.has(id)) drop(e);
    }
    for (const e of all(body, end)) {
      const id = wAttr(e, 'id');
      if (os.has(id) && oe.has(id) && !ns.has(id)) drop(e);
    }
  }
  // fields: begin … separate … end, possibly nested
  const count = (root: Element) => all(root, 'fldChar').length;
  if (count(body) === count(origBody)) return;
  const chars = all(body, 'fldChar');
  const stack: Element[][] = [];
  const unmatched: Element[] = [];
  for (const c of chars) {
    const t = wAttr(c, 'fldCharType');
    if (t === 'begin') stack.push([c]);
    else if (t === 'separate') {
      if (stack.length) stack[stack.length - 1].push(c);
      else unmatched.push(c);
    } else if (t === 'end') {
      if (stack.length) stack.pop();
      else unmatched.push(c);
    }
  }
  for (const open of stack) unmatched.push(...open);
  if (!unmatched.length) return;
  for (const c of unmatched) drop(c);
  // field code left outside any field would show as text: remove it
  let depth = 0;
  const walk = (n: Element) => {
    for (const k of elements(n)) {
      if (isW(k, 'fldChar')) {
        const t = wAttr(k, 'fldCharType');
        if (t === 'begin') depth++;
        else if (t === 'end') depth = Math.max(0, depth - 1);
      } else if (isW(k, 'instrText') && depth === 0) drop(k);
      else walk(k);
    }
  };
  walk(body);
}
