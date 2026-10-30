/**
 * Word equations (Office Math, OMML: m:oMath) → MathML, which the browsers
 * ezPDF runs in draw natively (Chromium and WebView2, Safari, WebKitGTK).
 * Only for display: the equation's XML is kept and written back as it was.
 *
 * Covers what Word's equation editor writes: runs, fractions, scripts,
 * radicals, n-ary operators (∑ ∫ ∏…), delimiters, functions, limits,
 * accents, bars, group characters, boxes, matrices, equation arrays,
 * phantoms. Anything else shows its text.
 */
import { elements, escapeHtml, NS } from './xml';

const M = NS.m;

const isM = (el: Element | null | undefined, name: string) => !!el && el.namespaceURI === M && el.localName === name;
const mChild = (el: Element | null | undefined, name: string) => (el ? elements(el).find((k) => isM(k, name)) ?? null : null);
const mChildren = (el: Element | null | undefined, name: string) => (el ? elements(el).filter((k) => isM(k, name)) : []);
/** m:val of a property element (OMML puts its values in the m: namespace) */
const mVal = (el: Element | null | undefined): string | null => {
  if (!el) return null;
  if (el.hasAttributeNS(M, 'val')) return el.getAttributeNS(M, 'val');
  if (el.hasAttributeNS(NS.w, 'val')) return el.getAttributeNS(NS.w, 'val');
  return null;
};
const prop = (el: Element | null, pr: string, name: string) => mVal(mChild(mChild(el, pr), name));
const off = (v: string | null) => v !== null && ['0', 'off', 'false'].includes(v);
const on = (el: Element | null) => !!el && !off(mVal(el));

const mo = (c: string, attrs = '') => `<mo${attrs}>${escapeHtml(c)}</mo>`;
const row = (inner: string) => `<mrow>${inner}</mrow>`;

/** the argument elements (m:e, m:num…): a row of their content */
function arg(el: Element | null): string {
  return el ? row(content(el)) : '<mrow></mrow>';
}

function content(el: Element): string {
  return elements(el).map(node).join('');
}

/** how deep the equation being converted is nested; a crafted file cannot exhaust the stack */
let depth = 0;
const MAX_DEPTH = 80;

/** text of a run → tokens: numbers (mn), letters (mi, italic by default), the rest operators (mo) */
function runTokens(text: string, style: string | null, normal: boolean): string {
  if (normal) return `<mtext>${escapeHtml(text)}</mtext>`;
  const plain = style === 'p' || style === 'b';
  const bold = style === 'b' || style === 'bi';
  const variant = (italic: boolean) => {
    if (bold) return italic ? ' mathvariant="bold-italic"' : ' mathvariant="bold"';
    return italic ? '' : ' mathvariant="normal"';
  };
  let out = '';
  const re = /(\d+(?:[.,]\d+)*)|(\p{L}\p{M}*)|(\s+)|([^\p{L}\d\s])/gu;
  let m: RegExpExecArray | null;
  // several letters in an upright run (a function name such as "sin") stay one token
  if (plain && /^\p{L}[\p{L}\p{M}]*$/u.test(text)) return `<mi${variant(false)}>${escapeHtml(text)}</mi>`;
  while ((m = re.exec(text))) {
    if (m[1]) out += `<mn${bold ? ' mathvariant="bold"' : ''}>${escapeHtml(m[1])}</mn>`;
    else if (m[2]) out += `<mi${variant(!plain)}>${escapeHtml(m[2])}</mi>`;
    else if (m[3]) out += '<mspace width="0.25em"></mspace>';
    // a hyphen in an equation is a minus sign, as Word shows it
    else if (m[4]) out += mo(m[4] === '-' ? '−' : m[4]);
  }
  return out;
}

function run(el: Element): string {
  const rPr = mChild(el, 'rPr');
  const style = mVal(mChild(rPr, 'sty'));
  const normal = !!mChild(rPr, 'nor') && on(mChild(rPr, 'nor'));
  let text = '';
  for (const k of elements(el)) {
    if (isM(k, 't') || (k.namespaceURI === NS.w && k.localName === 't')) text += k.textContent ?? '';
  }
  return text ? runTokens(text, style, normal) : '';
}

function node(el: Element): string {
  if (++depth > MAX_DEPTH) {
    depth--;
    throw new Error('Công thức lồng nhau quá sâu.');
  }
  try {
    return convert(el);
  } finally {
    depth--;
  }
}

function convert(el: Element): string {
  if (el.namespaceURI !== M) {
    // Word runs inside an equation (w:r, rare), bookmarks, w:ins… : their text, as normal text
    const t = el.textContent ?? '';
    return t.trim() ? `<mtext>${escapeHtml(t)}</mtext>` : '';
  }
  switch (el.localName) {
    case 'r':
      return run(el);
    case 'e':
    case 'num':
    case 'den':
    case 'sub':
    case 'sup':
    case 'deg':
    case 'lim':
    case 'fName':
    case 'oMath':
    case 'box':
      return arg(el.localName === 'box' ? mChild(el, 'e') : el);
    case 'f': {
      const type = prop(el, 'fPr', 'type');
      const num = arg(mChild(el, 'num'));
      const den = arg(mChild(el, 'den'));
      if (type === 'lin') return row(`${num}${mo('/')}${den}`);
      if (type === 'skw') return `<mfrac bevelled="true">${num}${den}</mfrac>`;
      return `<mfrac${type === 'noBar' ? ' linethickness="0"' : ''}>${num}${den}</mfrac>`;
    }
    case 'sSup':
      return `<msup>${arg(mChild(el, 'e'))}${arg(mChild(el, 'sup'))}</msup>`;
    case 'sSub':
      return `<msub>${arg(mChild(el, 'e'))}${arg(mChild(el, 'sub'))}</msub>`;
    case 'sSubSup':
      return `<msubsup>${arg(mChild(el, 'e'))}${arg(mChild(el, 'sub'))}${arg(mChild(el, 'sup'))}</msubsup>`;
    case 'sPre':
      return `<mmultiscripts>${arg(mChild(el, 'e'))}<mprescripts></mprescripts>${arg(mChild(el, 'sub'))}${arg(mChild(el, 'sup'))}</mmultiscripts>`;
    case 'rad': {
      const hide = on(mChild(mChild(el, 'radPr'), 'degHide'));
      const deg = mChild(el, 'deg');
      // the degree is converted once (testing it, then converting it again, doubles the work at each level)
      const degree = !hide && deg ? content(deg) : '';
      return degree ? `<mroot>${arg(mChild(el, 'e'))}${row(degree)}</mroot>` : `<msqrt>${content(mChild(el, 'e') ?? el)}</msqrt>`;
    }
    case 'nary': {
      const pr = mChild(el, 'naryPr');
      const chr = mVal(mChild(pr, 'chr')) ?? '∫';
      const under = mVal(mChild(pr, 'limLoc')) === 'undOvr' || (mVal(mChild(pr, 'limLoc')) === null && chr !== '∫' && !/[∫∬∭∮∯∰]/.test(chr));
      const subHide = on(mChild(pr, 'subHide'));
      const supHide = on(mChild(pr, 'supHide'));
      const op = mo(chr, ' largeop="true" movablelimits="false"');
      const sub = arg(mChild(el, 'sub'));
      const sup = arg(mChild(el, 'sup'));
      let head = op;
      if (!subHide && !supHide) head = under ? `<munderover>${op}${sub}${sup}</munderover>` : `<msubsup>${op}${sub}${sup}</msubsup>`;
      else if (!subHide) head = under ? `<munder>${op}${sub}</munder>` : `<msub>${op}${sub}</msub>`;
      else if (!supHide) head = under ? `<mover>${op}${sup}</mover>` : `<msup>${op}${sup}</msup>`;
      return row(`${head}${arg(mChild(el, 'e'))}`);
    }
    case 'd': {
      const pr = mChild(el, 'dPr');
      const beg = mVal(mChild(pr, 'begChr')) ?? '(';
      const end = mVal(mChild(pr, 'endChr')) ?? ')';
      const sep = mVal(mChild(pr, 'sepChr')) ?? '|';
      const parts = mChildren(el, 'e').map(arg);
      const fence = (c: string) => (c ? mo(c, ' fence="true" stretchy="true"') : '');
      return row(`${fence(beg)}${parts.join(mo(sep, ' separator="true"'))}${fence(end)}`);
    }
    case 'func':
      // sin x: a thin space after the function's name
      return row(`${arg(mChild(el, 'fName'))}${mo('⁡', ' rspace="0.17em"')}${arg(mChild(el, 'e'))}`);
    case 'limLow':
      return `<munder>${arg(mChild(el, 'e'))}${arg(mChild(el, 'lim'))}</munder>`;
    case 'limUpp':
      return `<mover>${arg(mChild(el, 'e'))}${arg(mChild(el, 'lim'))}</mover>`;
    case 'acc': {
      const chr = mVal(mChild(mChild(el, 'accPr'), 'chr')) ?? '̂';
      // combining marks are drawn as the spacing accents MathML expects
      const shown = { '̂': '^', '̃': '~', '̇': '˙', '̈': '¨', '̄': '¯', '⃗': '→', '́': '´', '̀': '`', '̆': '˘', '̌': 'ˇ' }[chr] ?? chr;
      return `<mover accent="true">${arg(mChild(el, 'e'))}${mo(shown, ' stretchy="true"')}</mover>`;
    }
    case 'bar': {
      const pos = mVal(mChild(mChild(el, 'barPr'), 'pos'));
      return pos === 'bot'
        ? `<munder>${arg(mChild(el, 'e'))}${mo('_', ' stretchy="true"')}</munder>`
        : `<mover accent="true">${arg(mChild(el, 'e'))}${mo('‾', ' stretchy="true"')}</mover>`;
    }
    case 'groupChr': {
      const pr = mChild(el, 'groupChrPr');
      const chr = mVal(mChild(pr, 'chr')) ?? '⏟';
      const top = mVal(mChild(pr, 'pos')) === 'top';
      return top ? `<mover>${arg(mChild(el, 'e'))}${mo(chr, ' stretchy="true"')}</mover>` : `<munder>${arg(mChild(el, 'e'))}${mo(chr, ' stretchy="true"')}</munder>`;
    }
    case 'borderBox':
      return `<menclose notation="box">${arg(mChild(el, 'e'))}</menclose>`;
    case 'm': {
      const rows = mChildren(el, 'mr').map((r) => `<mtr>${mChildren(r, 'e').map((c) => `<mtd>${arg(c)}</mtd>`).join('')}</mtr>`);
      return `<mtable>${rows.join('')}</mtable>`;
    }
    case 'eqArr':
      return `<mtable columnalign="left">${mChildren(el, 'e').map((c) => `<mtr><mtd>${arg(c)}</mtd></mtr>`).join('')}</mtable>`;
    case 'phant': {
      const show = mVal(mChild(mChild(el, 'phantPr'), 'show'));
      return off(show) ? `<mphantom>${arg(mChild(el, 'e'))}</mphantom>` : arg(mChild(el, 'e'));
    }
    case 'sGroup':
      return content(el);
    default:
      // property elements (…Pr, ctrlPr) draw nothing; anything unknown shows its parts
      if (/Pr$/.test(el.localName)) return '';
      return content(el);
  }
}

/** One equation (m:oMath) as a MathML element; `display`: on its own line (m:oMathPara). */
export function ommlToMathml(oMath: Element, display: boolean): string {
  const inner = isM(oMath, 'oMath') ? content(oMath) : node(oMath);
  return `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ''}>${row(inner)}</math>`;
}

/** An equation paragraph (m:oMathPara): each equation on its own line. */
export function ommlParaToMathml(para: Element): string {
  return mChildren(para, 'oMath')
    .map((m) => ommlToMathml(m, true))
    .join('');
}

/** The equation's text, for an accessible label and for search. */
export function ommlText(el: Element): string {
  const ts = el.getElementsByTagNameNS(M, 't');
  let s = '';
  for (let i = 0; i < ts.length && s.length < 2000; i++) s += ts[i].textContent ?? '';
  return s.slice(0, 2000);
}
