/**
 * XML helpers for WordprocessingML (the XML inside a .docx). Works with the
 * browser's DOMParser and with @xmldom/xmldom in tests: only DOM Level 2
 * Core is used (childNodes, getAttributeNS, createElementNS, importNode).
 */

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  v: 'urn:schemas-microsoft-com:vml',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  pr: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  xml: 'http://www.w3.org/XML/1998/namespace',
  /** ISO 29500 Strict: same vocabulary, other namespaces (not supported) */
  strictW: 'http://purl.oclc.org/ooxml/wordprocessingml/main',
} as const;

const W = NS.w;

export interface DomImpl {
  DOMParser: { new (): DOMParser };
  XMLSerializer: { new (): XMLSerializer };
}

export function defaultDom(): DomImpl {
  const g = globalThis as unknown as Partial<DomImpl>;
  if (!g.DOMParser || !g.XMLSerializer) throw new Error('Không có bộ đọc XML.');
  return { DOMParser: g.DOMParser, XMLSerializer: g.XMLSerializer };
}

export function parseXml(dom: DomImpl, text: string, what: string): Document {
  const doc = new dom.DOMParser().parseFromString(text, 'application/xml');
  const root = doc.documentElement;
  if (!root || root.localName === 'parsererror' || doc.getElementsByTagName('parsererror').length) {
    throw new Error(`Phần ${what} của tệp Word bị hỏng (XML không đọc được).`);
  }
  return doc;
}

export const elements = (n: Node | null | undefined): Element[] => {
  const out: Element[] = [];
  if (!n) return out;
  for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c as Element);
  return out;
};

/** a WordprocessingML element named `name` (w:name) */
export const isW = (el: Node | null | undefined, name: string): boolean =>
  !!el && el.nodeType === 1 && (el as Element).namespaceURI === W && (el as Element).localName === name;

export const wChild = (el: Element | null | undefined, name: string): Element | null =>
  (el && elements(el).find((k) => isW(k, name))) || null;

export const wChildren = (el: Element | null | undefined, name: string): Element[] => (el ? elements(el).filter((k) => isW(k, name)) : []);

/** an attribute in a namespace, null when absent (browsers and xmldom differ on '' vs null) */
export function attrNS(el: Element | null | undefined, ns: string, name: string): string | null {
  if (!el || !el.hasAttributeNS(ns, name)) return null;
  return el.getAttributeNS(ns, name);
}

export const wAttr = (el: Element | null | undefined, name: string) => attrNS(el, W, name);

/** w:val of a child element (w:jc w:val="center" → "center") */
export const wVal = (parent: Element | null | undefined, name: string) => wAttr(wChild(parent, name), 'val');

/** On/off property (w:b, w:i…): present without w:val, or with a true value, means on. */
export function onOff(el: Element | null): boolean | undefined {
  if (!el) return undefined;
  const v = wAttr(el, 'val');
  return v === null || !['0', 'false', 'off', 'none'].includes(v.toLowerCase());
}

export const num = (v: string | null | undefined): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Every descendant element named w:name, in document order. */
export function wDescendants(el: Element, name: string): Element[] {
  const out: Element[] = [];
  const all = el.getElementsByTagNameNS(W, name);
  for (let i = 0; i < all.length; i++) out.push(all[i]);
  return out;
}

export function textOf(el: Element): string {
  let s = '';
  for (const t of wDescendants(el, 't')) s += t.textContent ?? '';
  return s;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Characters XML 1.0 does not allow (control characters typed or pasted). */
export const stripInvalidXml = (s: string) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');

/** "word/document.xml" + "media/a.png" → "word/media/a.png"; handles ../ and leading / */
export function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}
