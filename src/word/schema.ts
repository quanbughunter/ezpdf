/**
 * The editor's model of a Word body (ProseMirror). Every node read from the
 * file keeps `ref`: the index of its original XML element in the model's
 * store, so saving can write an untouched paragraph or table back exactly
 * as it was and rebuild only what changed, from the original formatting.
 *
 *  - paragraph: text with marks; `ppr` the original w:pPr (style, list,
 *    spacing, section break), `css` how it looks, `list` its list level,
 *    `sect` it ends a section (shown, so deleting it is not a surprise),
 *    `before` stray body-level items that came before it. Bookmarks, field
 *    codes and other invisible items are inline items in its text, so
 *    Enter, Backspace and Delete carry them like any character.
 *  - locked: a paragraph or block ezPDF shows but does not edit (tracked
 *    changes, content controls), kept byte for byte
 *  - table/table_row/table_cell: the table's shape is fixed (no rows or
 *    columns added or removed); the text in its cells is edited like any
 *    paragraph
 *  - br: a line break in a paragraph (Shift+Enter); inl: something inline
 *    that is shown but not typed into (picture, shape or drawing, equation,
 *    field result, footnote mark, page break, or an invisible bookmark),
 *    kept as its original XML
 *  - marks: b, i, u as the user sees them (after styles), rp the run's own
 *    w:rPr (font, size, colour) and how it looks, link a hyperlink; font and
 *    size a font or size the user chose (they win over rp)
 */
import { Schema, type DOMOutputSpec, type Mark, type Node as PMNode } from 'prosemirror-model';
import { fontStack, safeFont } from './styles';

const refAttrs = { ref: { default: null as number | null } };

/**
 * Copy and paste inside one document keeps paragraph and run formatting:
 * the copied HTML carries the store indices, tagged with the open
 * document's tag. Pasted into another document (another tag) or from
 * elsewhere, only bold, italic and underline come along.
 */
let pasteTag = '';
/** a drawn item (shape, equation) of the open document by its ref: how it looks */
export interface Visual {
  html: string;
  block: boolean;
  css: string;
}
let pasteVisual: (ref: number) => Visual | null = () => null;
export function setPasteTag(tag: string, visual: (ref: number) => Visual | null = () => null) {
  pasteTag = tag;
  pasteVisual = visual;
}

function pastedParagraph(dom: HTMLElement) {
  const raw = dom.getAttribute('data-ezp');
  if (!raw || !pasteTag) return {};
  try {
    const d = JSON.parse(raw) as { t: string; ppr: number | null; list: unknown; heading: number | null };
    if (d.t !== pasteTag) return {};
    return { ppr: d.ppr, list: d.list ?? null, heading: d.heading ?? null, css: dom.getAttribute('style') ?? '' };
  } catch {
    return {};
  }
}

export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: {
        ...refAttrs,
        ppr: { default: null as number | null },
        css: { default: '' },
        list: { default: null as { numId: string; ilvl: number } | null },
        before: { default: null as number[] | null },
        sect: { default: false },
        heading: { default: null as number | null },
        /** set when Enter on an empty list item took it out of the list */
        nolist: { default: false },
      },
      parseDOM: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'].map((tag) => ({ tag, getAttrs: (dom: HTMLElement) => pastedParagraph(dom) })),
      toDOM(node): DOMOutputSpec {
        const a = node.attrs;
        const tag = pasteTag ? { 'data-ezp': JSON.stringify({ t: pasteTag, ppr: a.ppr, list: a.list, heading: a.heading }) } : {};
        return ['p', { class: a.sect ? 'ez-wp ez-wsect' : 'ez-wp', style: a.css, ...tag }, 0];
      },
    },
    locked: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { ...refAttrs, html: { default: '' }, reason: { default: '' }, before: { default: null as number[] | null } },
      toDOM(node) {
        const el = document.createElement('div');
        el.className = 'ez-wlocked';
        el.contentEditable = 'false';
        el.title = node.attrs.reason;
        el.innerHTML = node.attrs.html;
        return el;
      },
    },
    table: {
      group: 'block',
      content: 'table_row+',
      isolating: true,
      attrs: { ...refAttrs, css: { default: '' }, before: { default: null as number[] | null } },
      toDOM(node): DOMOutputSpec {
        return ['div', { class: 'ez-wtable' }, ['table', { style: node.attrs.css }, ['tbody', 0]]];
      },
    },
    table_row: {
      content: 'table_cell+',
      attrs: { css: { default: '' } },
      toDOM(node): DOMOutputSpec {
        return ['tr', { style: node.attrs.css }, 0];
      },
    },
    table_cell: {
      content: 'block+',
      isolating: true,
      /** tail: invisible items after the cell's last block (a bookmark's end) */
      attrs: { colspan: { default: 1 }, css: { default: '' }, tail: { default: null as number[] | null } },
      toDOM(node): DOMOutputSpec {
        return ['td', { ...(node.attrs.colspan > 1 ? { colspan: node.attrs.colspan } : {}), style: node.attrs.css }, 0];
      },
    },
    text: { group: 'inline' },
    br: {
      inline: true,
      group: 'inline',
      selectable: false,
      attrs: { ...refAttrs },
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
    inl: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: {
        ...refAttrs,
        kind: { default: 'hidden' as 'image' | 'text' | 'note' | 'mark' | 'hidden' | 'shape' | 'math' },
        label: { default: '' },
        src: { default: null as string | null },
        w: { default: 0 },
        h: { default: 0 },
        /** shape, math: the markup ezPDF made from the file (SVG, MathML), shown as is */
        html: { default: '' },
        /** on its own line (a floating drawing, a display equation) */
        block: { default: false },
        /** shape, math: style of the holder (alignment, offset) */
        css: { default: '' },
      },
      parseDOM: [
        // copied inside this document: the same item (its XML) again
        {
          tag: '[data-ezi]',
          getAttrs: (dom: HTMLElement) => {
            const [t, ref, kind] = (dom.getAttribute('data-ezi') ?? '').split(':');
            if (!pasteTag || t !== pasteTag || ref === '') return false;
            const img = dom.tagName === 'IMG' ? (dom as HTMLImageElement) : null;
            if (kind === 'shape' || kind === 'math') {
              // the markup is never taken from the clipboard: the open document's own copy is used
              const v = pasteVisual(Number(ref));
              return v ? { ref: Number(ref), kind, label: dom.getAttribute('aria-label') ?? '', ...v } : false;
            }
            // a picture's address must be one ezPDF made (a blob: or data: URL), never one the clipboard brings
            const src = img?.getAttribute('src') ?? null;
            if (img && !(src && /^(blob:|data:image\/)/.test(src))) return false;
            if (!['image', 'text', 'note', 'mark', 'hidden'].includes(kind)) return false;
            return {
              ref: Number(ref),
              kind,
              label: img ? img.alt : (dom.textContent ?? ''),
              src,
              w: Number(dom.getAttribute('data-w') ?? 0),
              h: Number(dom.getAttribute('data-h') ?? 0),
              ...(img ? pasteVisual(Number(ref)) ?? {} : {}),
            };
          },
        },
        // from another document: dropped (its label is not text of the document)
        { tag: '[data-ezi]', ignore: true },
      ],
      toDOM(node): DOMOutputSpec {
        const a = node.attrs;
        const tag = { 'data-ezi': `${pasteTag}:${a.ref ?? ''}:${a.kind}`, 'data-w': String(a.w), 'data-h': String(a.h) };
        if ((a.kind === 'shape' || a.kind === 'math') && a.html) {
          const el = document.createElement('span');
          const base = a.kind === 'math' ? 'ez-wmath' : 'ez-wshape';
          el.className = a.block ? `${base} ${base}-block` : base;
          el.contentEditable = 'false';
          for (const [k, v] of Object.entries(tag)) el.setAttribute(k, v);
          if (a.label) el.setAttribute('aria-label', a.label);
          if (a.css) el.setAttribute('style', a.css);
          el.innerHTML = a.html;
          return el;
        }
        switch (a.kind) {
          case 'image':
            return a.src
              ? ['img', { class: 'ez-wimg', src: a.src, alt: a.label, style: (a.w && a.h ? `width:${a.w}pt;aspect-ratio:${a.w}/${a.h};` : '') + a.css, ...tag }]
              : ['span', { class: 'ez-wmark', contenteditable: 'false', ...tag }, a.label || 'Hình'];
          case 'text':
            return ['span', { class: 'ez-wfield', contenteditable: 'false', ...tag }, a.label];
          case 'note':
            return ['sup', { class: 'ez-wnote', contenteditable: 'false', ...tag }, a.label];
          case 'mark':
            return ['span', { class: 'ez-wmark', contenteditable: 'false', ...tag }, a.label];
          default:
            return ['span', { class: 'ez-whidden', ...tag }];
        }
      },
    },
  },
  marks: {
    link: {
      attrs: { ...refAttrs, href: { default: '' } },
      inclusive: false,
      toDOM(mark): DOMOutputSpec {
        return ['span', { class: 'ez-wlink', title: mark.attrs.href }, 0];
      },
    },
    rp: {
      attrs: { ...refAttrs, css: { default: '' } },
      parseDOM: [
        {
          tag: 'span[data-ezr]',
          getAttrs: (dom: HTMLElement) => {
            const [t, ref] = (dom.getAttribute('data-ezr') ?? '').split(':');
            return pasteTag && t === pasteTag && ref !== '' ? { ref: Number(ref), css: dom.getAttribute('style') ?? '' } : false;
          },
        },
      ],
      toDOM(mark): DOMOutputSpec {
        const tag = pasteTag && mark.attrs.ref !== null ? { 'data-ezr': `${pasteTag}:${mark.attrs.ref}` } : {};
        return ['span', { style: mark.attrs.css, ...tag }, 0];
      },
    },
    /** a font the user chose (w:rFonts when saved); inside rp, so it wins over the run's own font */
    font: {
      attrs: { name: { default: '' } },
      parseDOM: [
        {
          tag: 'span[data-ezf]',
          getAttrs: (dom: HTMLElement) => {
            const raw = dom.getAttribute('data-ezf') ?? '';
            const i = raw.indexOf(':');
            const name = safeFont(raw.slice(i + 1));
            return pasteTag && i > 0 && raw.slice(0, i) === pasteTag && name ? { name } : false;
          },
        },
      ],
      toDOM(mark): DOMOutputSpec {
        const name = safeFont(mark.attrs.name) ?? '';
        return ['span', { style: `font-family:${fontStack(name) ?? 'inherit'}`, ...(pasteTag ? { 'data-ezf': `${pasteTag}:${name}` } : {}) }, 0];
      },
    },
    /** a size the user chose, in half-points as Word stores it (w:sz when saved) */
    size: {
      attrs: { hp: { default: 22 } },
      parseDOM: [
        {
          tag: 'span[data-ezs]',
          getAttrs: (dom: HTMLElement) => {
            const [t, v] = (dom.getAttribute('data-ezs') ?? '').split(':');
            const hp = Number(v);
            return pasteTag && t === pasteTag && Number.isInteger(hp) && hp >= 2 && hp <= 3276 ? { hp } : false;
          },
        },
      ],
      toDOM(mark): DOMOutputSpec {
        const hp = Math.max(2, Math.min(3276, Math.round(Number(mark.attrs.hp) || 22)));
        return ['span', { style: `font-size:calc(var(--ezsub, 1) * ${hp / 2}pt)`, ...(pasteTag ? { 'data-ezs': `${pasteTag}:${hp}` } : {}) }, 0];
      },
    },
    b: {
      parseDOM: [
        { tag: 'strong' },
        { tag: 'b', getAttrs: (n) => (n as HTMLElement).style.fontWeight !== 'normal' && null },
        { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[6-9]\d\d)$/.test(v as string) && null },
      ],
      toDOM: () => ['strong', 0],
    },
    i: {
      parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
      toDOM: () => ['em', 0],
    },
    u: {
      attrs: { val: { default: 'single' } },
      parseDOM: [{ tag: 'u' }, { style: 'text-decoration-line=underline' }, { style: 'text-decoration=underline' }],
      toDOM(mark): DOMOutputSpec {
        const v = mark.attrs.val as string;
        const style = v === 'double' ? 'double' : /dot/.test(v) ? 'dotted' : /dash/.test(v) ? 'dashed' : /wav/.test(v) ? 'wavy' : 'solid';
        return ['span', { style: `text-decoration-line:underline;text-decoration-style:${style}` }, 0];
      },
    },
  },
});

export type { PMNode, Mark };
