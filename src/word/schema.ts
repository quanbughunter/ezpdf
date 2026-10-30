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
 *    changes, equations, content controls), kept byte for byte
 *  - table/table_row/table_cell: the table's shape is fixed (no rows or
 *    columns added or removed); the text in its cells is edited like any
 *    paragraph
 *  - br: a line break in a paragraph (Shift+Enter); inl: something inline
 *    that is shown but not typed into (picture, field result, footnote mark,
 *    page break, or an invisible bookmark), kept as its original XML
 *  - marks: b, i, u as the user sees them (after styles), rp the run's own
 *    w:rPr (font, size, colour) and how it looks, link a hyperlink
 */
import { Schema, type DOMOutputSpec, type Mark, type Node as PMNode } from 'prosemirror-model';

const refAttrs = { ref: { default: null as number | null } };

/**
 * Copy and paste inside one document keeps paragraph and run formatting:
 * the copied HTML carries the store indices, tagged with the open
 * document's tag. Pasted into another document (another tag) or from
 * elsewhere, only bold, italic and underline come along.
 */
let pasteTag = '';
export function setPasteTag(tag: string) {
  pasteTag = tag;
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
        kind: { default: 'hidden' as 'image' | 'text' | 'note' | 'mark' | 'hidden' },
        label: { default: '' },
        src: { default: null as string | null },
        w: { default: 0 },
        h: { default: 0 },
      },
      parseDOM: [
        // copied inside this document: the same item (its XML) again
        {
          tag: '[data-ezi]',
          getAttrs: (dom: HTMLElement) => {
            const [t, ref, kind] = (dom.getAttribute('data-ezi') ?? '').split(':');
            if (!pasteTag || t !== pasteTag || ref === '') return false;
            const img = dom.tagName === 'IMG' ? (dom as HTMLImageElement) : null;
            return {
              ref: Number(ref),
              kind,
              label: img ? img.alt : (dom.textContent ?? ''),
              src: img ? img.getAttribute('src') : null,
              w: Number(dom.getAttribute('data-w') ?? 0),
              h: Number(dom.getAttribute('data-h') ?? 0),
            };
          },
        },
        // from another document: dropped (its label is not text of the document)
        { tag: '[data-ezi]', ignore: true },
      ],
      toDOM(node): DOMOutputSpec {
        const a = node.attrs;
        const tag = { 'data-ezi': `${pasteTag}:${a.ref ?? ''}:${a.kind}`, 'data-w': String(a.w), 'data-h': String(a.h) };
        switch (a.kind) {
          case 'image':
            return a.src
              ? ['img', { class: 'ez-wimg', src: a.src, alt: a.label, style: a.w ? `width:${a.w}pt;height:${a.h}pt` : '', ...tag }]
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
