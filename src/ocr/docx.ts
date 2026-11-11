/**
 * The pages OCR read, as a Word file laid out like the paper (pure):
 *  - each page is its own section, with the page's size, its margins taken
 *    from where the text sits, its frame as Word's page border, and the
 *    running header and footer as Word's header and footer
 *  - paragraphs keep their indents, alignment, size, bold and italic, and
 *    the space around them; centred titles keep their line breaks
 *  - tables are Word tables: the same columns and row heights, merged cells
 *    (gridSpan, vMerge), the borders that are drawn; text side by side
 *    without lines is a borderless table
 *  - pictures are cut from the page in colour: in the text where they stood
 *    on their own, behind the text where they lay over it (a stamp)
 */
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { Block, Cell, PageLayout, Para, Picture, RuleBlock, TableBlock, Word } from './model';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

const FONT = 'Times New Roman';

interface Ctx {
  dpi: number;
  /** relationships of the part being written */
  rels: string[];
  media: Map<string, Uint8Array>;
  nextPic: { n: number };
}

const tw = (px: number, dpi: number) => Math.round((px * 1440) / dpi);
const emu = (px: number, dpi: number) => Math.round((px * 914400) / dpi);

function runProps(size: number, w?: Word) {
  return `<w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>${w?.bold ? '<w:b/><w:bCs/>' : ''}${w?.italic ? '<w:i/><w:iCs/>' : ''}<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/><w:lang w:val="vi-VN"/></w:rPr>`;
}

/** words as runs: one run per stretch in the same style */
function runs(p: Para): string {
  const pieces: { w: Word | null; text: string; tab?: boolean; br?: boolean }[] = [];
  p.lines.forEach((l, li) => {
    if (li > 0) pieces.push(p.tabs ? { w: null, text: '', tab: true } : p.breaks ? { w: null, text: '', br: true } : { w: null, text: ' ' });
    l.words.forEach((w, wi) => pieces.push({ w, text: (wi > 0 ? ' ' : '') + w.text }));
  });
  let out = '';
  let cur: { bold: boolean; italic: boolean; text: string } | null = null;
  const flush = () => {
    if (cur && cur.text) out += `<w:r>${runProps(p.size, { text: '', conf: 0, box: { x0: 0, y0: 0, x1: 0, y1: 0 }, bold: cur.bold, italic: cur.italic })}<w:t xml:space="preserve">${esc(cur.text)}</w:t></w:r>`;
    cur = null;
  };
  for (const piece of pieces) {
    if (piece.tab || piece.br) {
      flush();
      out += `<w:r>${runProps(p.size)}${piece.tab ? '<w:tab/>' : '<w:br/>'}</w:r>`;
      continue;
    }
    const prev = cur as { bold: boolean; italic: boolean } | null;
    const bold: boolean = piece.w ? !!piece.w.bold : (prev?.bold ?? false);
    const italic: boolean = piece.w ? !!piece.w.italic : (prev?.italic ?? false);
    if (!cur || cur.bold !== bold || cur.italic !== italic) {
      flush();
      cur = { bold, italic, text: '' };
    }
    cur.text += piece.text;
  }
  flush();
  return out;
}

function spacing(p: Para, dpi: number, first: boolean) {
  const before = first ? 0 : tw(p.before, dpi);
  const pitch = tw(p.pitch, dpi);
  const natural = p.size * 20 * 1.15;
  let line = '';
  if (p.lines.length > 1 && pitch > 0) {
    if (pitch >= natural) line = `w:line="${Math.min(720, Math.round((240 * pitch) / natural))}" w:lineRule="auto"`;
    else line = `w:line="${Math.round(Math.max(pitch, p.size * 20 * 1.08))}" w:lineRule="exact"`;
  } else line = 'w:line="240" w:lineRule="auto"';
  return `<w:spacing w:before="${before}" w:after="0" ${line}/>`;
}

function paraXml(p: Para, ctx: Ctx, first: boolean, anchors = ''): string {
  const { dpi } = ctx;
  const jc = { left: 'left', center: 'center', right: 'right', justify: 'both' }[p.align];
  const ind: string[] = [];
  if (p.indent) ind.push(`w:left="${tw(p.indent, dpi)}"`);
  if (p.indentRight) ind.push(`w:right="${tw(p.indentRight, dpi)}"`);
  if (p.firstLine > 0) ind.push(`w:firstLine="${tw(p.firstLine, dpi)}"`);
  else if (p.firstLine < 0) ind.push(`w:hanging="${tw(-p.firstLine, dpi)}"`);
  const tabs = p.tabs?.length ? `<w:tabs>${p.tabs.map((t) => `<w:tab w:val="${t.kind}" w:pos="${tw(t.at, dpi)}"/>`).join('')}</w:tabs>` : '';
  return `<w:p><w:pPr>${tabs}${spacing(p, dpi, first)}${ind.length ? `<w:ind ${ind.join(' ')}/>` : ''}<w:jc w:val="${jc}"/>${runProps(p.size)}</w:pPr>${anchors}${runs(p)}</w:p>`;
}

/** an empty paragraph as small as Word allows (after a table, at a section's end, holding a floating picture) */
function tinyPara(inner = '', pPr = '') {
  return `<w:p><w:pPr>${pPr}<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr>${inner}</w:p>`;
}

function ruleXml(r: RuleBlock, left: number, right: number, ctx: Ctx, first: boolean) {
  const sz = Math.max(4, Math.min(24, Math.round((r.thick / ctx.dpi) * 72 * 8)));
  const ind = `<w:ind w:left="${Math.max(0, tw(r.box.x0 - left, ctx.dpi))}" w:right="${Math.max(0, tw(right - r.box.x1, ctx.dpi))}"/>`;
  const before = first ? 0 : tw(r.before, ctx.dpi);
  return `<w:p><w:pPr><w:pBdr><w:bottom w:val="${r.double ? 'double' : 'single'}" w:sz="${sz}" w:space="1" w:color="000000"/></w:pBdr><w:spacing w:before="${before}" w:after="0" w:line="20" w:lineRule="exact"/>${ind}<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>`;
}

function picture(p: Picture, ctx: Ctx, floating: boolean): string {
  const n = ctx.nextPic.n++;
  const name = `image${n}.png`;
  ctx.media.set(name, p.png);
  const rid = `rIdImg${n}`;
  ctx.rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
  const cx = emu(p.box.x1 - p.box.x0, ctx.dpi);
  const cy = emu(p.box.y1 - p.box.y0, ctx.dpi);
  const graphic = `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
  if (!floating) return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Hình ${n}"/><wp:cNvGraphicFramePr/>${graphic}</wp:inline></w:drawing></w:r>`;
  return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${n}" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${emu(p.box.x0, ctx.dpi)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${emu(p.box.y0, ctx.dpi)}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${n}" name="Hình ${n}"/><wp:cNvGraphicFramePr/>${graphic}</wp:anchor></w:drawing></w:r>`;
}

function pictureXml(p: Picture, left: number, right: number, ctx: Ctx, first: boolean) {
  const mid = (p.box.x0 + p.box.x1) / 2;
  const centred = Math.abs(mid - (left + right) / 2) < (right - left) * 0.04;
  const before = first ? 0 : tw(p.before, ctx.dpi);
  const ind = centred ? '' : `<w:ind w:left="${Math.max(0, tw(p.box.x0 - left, ctx.dpi))}"/>`;
  return `<w:p><w:pPr><w:spacing w:before="${before}" w:after="0" w:line="240" w:lineRule="auto"/>${ind}<w:jc w:val="${centred ? 'center' : 'left'}"/></w:pPr>${picture(p, ctx, false)}</w:p>`;
}

const border = (on: boolean, side: string) => (on ? `<w:${side} w:val="single" w:sz="6" w:space="0" w:color="000000"/>` : `<w:${side} w:val="nil"/>`);

function cellXml(c: Cell, t: TableBlock, r: number, ctx: Ctx): string {
  const width = tw(t.xs[c.c1] - t.xs[c.c0], ctx.dpi);
  const span = c.c1 - c.c0 > 1 ? `<w:gridSpan w:val="${c.c1 - c.c0}"/>` : '';
  const merged = c.r1 - c.r0 > 1 ? (r === c.r0 ? '<w:vMerge w:val="restart"/>' : '<w:vMerge/>') : '';
  const b = t.borderless ? { top: false, bottom: false, left: false, right: false } : c;
  const borders = `<w:tcBorders>${border(b.top && r === c.r0, 'top')}${border(b.left, 'left')}${border(b.bottom && r === c.r1 - 1, 'bottom')}${border(b.right, 'right')}</w:tcBorders>`;
  const valign = `<w:vAlign w:val="${c.valign}"/>`;
  const pr = `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span}${merged}${borders}${valign}</w:tcPr>`;
  let body = '';
  if (r === c.r0 && c.paras.length) body = c.paras.map((p, i) => paraXml(p, ctx, i === 0)).join('');
  else body = '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:rPr><w:sz w:val="16"/></w:rPr></w:pPr></w:p>';
  return `<w:tc>${pr}${body}</w:tc>`;
}

function tableXml(t: TableBlock, left: number, ctx: Ctx, first: boolean): string {
  const { dpi } = ctx;
  const cols = t.xs.slice(1).map((x, i) => tw(x - t.xs[i], dpi));
  const total = cols.reduce((a, b) => a + b, 0);
  const R = t.ys.length - 1;
  let rows = '';
  for (let r = 0; r < R; r++) {
    const hgt = tw(t.ys[r + 1] - t.ys[r], dpi);
    let tcs = '';
    for (let c = 0; c < cols.length; ) {
      const cell = t.cells.find((k) => r >= k.r0 && r < k.r1 && c >= k.c0 && c < k.c1);
      if (!cell) {
        tcs += `<w:tc><w:tcPr><w:tcW w:w="${cols[c]}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`;
        c++;
        continue;
      }
      tcs += cellXml(cell, t, r, ctx);
      c = cell.c1;
    }
    rows += `<w:tr><w:trPr><w:trHeight w:val="${t.borderless ? 0 : Math.max(0, hgt - 10)}" w:hRule="atLeast"/><w:cantSplit/></w:trPr>${tcs}</w:tr>`;
  }
  // the space above a table is an empty paragraph that high (tables have none of their own)
  const spaceAbove = first || t.before < dpi * 0.04 ? '' : `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.max(20, tw(t.before, dpi))}" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>`;
  const pr = `<w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblInd w:w="${tw(t.xs[0] - left, dpi)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="40" w:type="dxa"/><w:right w:w="40" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr>`;
  return `${spaceAbove}<w:tbl>${pr}<w:tblGrid>${cols.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
}

/** blocks in order; pictures that float are anchored to the first paragraph */
function blocksXml(blocks: Block[], left: number, right: number, ctx: Ctx): string {
  const floating = blocks.filter((b): b is Picture => b.kind === 'picture' && b.behind);
  const flow = blocks.filter((b) => !(b.kind === 'picture' && b.behind));
  let anchors = floating.map((p) => picture(p, ctx, true)).join('');
  let out = '';
  flow.forEach((b, i) => {
    const first = i === 0;
    if (b.kind === 'para') {
      out += paraXml(b, ctx, first, anchors);
      anchors = '';
    } else if (b.kind === 'table') {
      out += tableXml(b, left, ctx, first);
      // two tables in a row would become one
      if (flow[i + 1]?.kind === 'table') out += tinyPara();
    } else if (b.kind === 'rule') out += ruleXml(b, left, right, ctx, first);
    else out += pictureXml(b, left, right, ctx, first);
  });
  if (anchors) out = tinyPara(anchors) + out;
  return out;
}

function sectPr(page: PageLayout, refs: string): string {
  const { dpi } = page;
  const pxW = (page.widthPt / 72) * dpi;
  const pxH = (page.heightPt / 72) * dpi;
  const sx = pxW / page.w;
  const sy = pxH / page.h;
  // the layout is in pixels of the image; the page may be a hair different
  const left = page.body.x0 * sx;
  const right = Math.max(dpi * 0.2, pxW - page.body.x1 * sx);
  const headBottom = page.header.length ? Math.max(...page.header.map((b) => b.box.y1)) * sy : 0;
  const footTop = page.footer.length ? Math.min(...page.footer.map((b) => b.box.y0)) * sy : pxH;
  let top = Math.max(dpi * 0.2, page.body.y0 * sy - dpi * 0.05);
  if (page.header.length) top = Math.max(top, headBottom + dpi * 0.03);
  // a little room under the text (Word's letters are not the scan's), down to the footer
  let bottom = Math.max(dpi * 0.2, Math.min(pxH - page.body.y1 * sy, dpi * 0.8) * 0.6);
  if (page.footer.length) bottom = Math.max(dpi * 0.2, pxH - footTop + dpi * 0.03);
  const header = page.header.length ? Math.max(dpi * 0.1, Math.min(...page.header.map((b) => b.box.y0)) * sy) : dpi * 0.4;
  const footer = page.footer.length ? Math.max(dpi * 0.1, pxH - Math.max(...page.footer.map((b) => b.box.y1)) * sy) : dpi * 0.4;
  const wTw = Math.round(page.widthPt * 20);
  const hTw = Math.round(page.heightPt * 20);
  let borders = '';
  if (page.frame) {
    const f = page.frame;
    const pt = (px: number) => Math.max(0, Math.min(31, Math.round((px / dpi) * 72)));
    const val = f.double ? 'thickThinSmallGap' : 'single';
    const sz = Math.max(4, Math.min(48, Math.round((f.thick / dpi) * 72 * 8)));
    const side = (name: string, space: number) => `<w:${name} w:val="${val}" w:sz="${sz}" w:space="${pt(space)}" w:color="000000"/>`;
    borders = `<w:pgBorders w:offsetFrom="text">${side('top', top - f.y0 * sy)}${side('left', left - f.x0 * sx)}${side('bottom', f.y1 * sy - (pxH - bottom))}${side('right', f.x1 * sx - (pxW - right))}</w:pgBorders>`;
  }
  return `<w:sectPr>${refs}<w:type w:val="nextPage"/><w:pgSz w:w="${wTw}" w:h="${hTw}"${wTw > hTw ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${tw(top, dpi)}" w:right="${tw(right, dpi)}" w:bottom="${tw(bottom, dpi)}" w:left="${tw(left, dpi)}" w:header="${tw(header, dpi)}" w:footer="${tw(footer, dpi)}" w:gutter="0"/>${borders}</w:sectPr>`;
}

export interface DocxInfo {
  title?: string;
}

/** the Word file for these pages */
export function writeDocx(pages: PageLayout[], info: DocxInfo = {}): Uint8Array {
  const media = new Map<string, Uint8Array>();
  const nextPic = { n: 1 };
  const docRels: string[] = [
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>',
  ];
  const parts: Zippable = {};
  const overrides: string[] = [];
  let body = '';
  pages.forEach((page, k) => {
    const ctx: Ctx = { dpi: page.dpi, rels: docRels, media, nextPic };
    const { x0: left, x1: right } = page.body;
    let refs = '';
    const part = (kind: 'header' | 'footer', blocks: Block[]) => {
      if (!blocks.length) return;
      const name = `${kind}${k + 1}.xml`;
      const rels: string[] = [];
      const xml = blocksXml(blocks, left, right, { ...ctx, rels }) || tinyPara();
      const tag = kind === 'header' ? 'hdr' : 'ftr';
      parts[`word/${name}`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${tag} ${NS}>${xml}</w:${tag}>`);
      if (rels.length) parts[`word/_rels/${name}.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
      const rid = `rId${kind}${k + 1}`;
      docRels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${name}"/>`);
      overrides.push(`<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`);
      refs += `<w:${kind}Reference w:type="default" r:id="${rid}"/>`;
    };
    part('header', page.header);
    part('footer', page.footer);
    body += blocksXml(page.blocks, left, right, ctx);
    const last = k === pages.length - 1;
    // a page with no header or footer must not inherit the previous page's
    if (!page.header.length) refs = emptyRef('header', k, parts, docRels, overrides) + refs;
    if (!page.footer.length) refs += emptyRef('footer', k, parts, docRels, overrides);
    const sp = sectPr(page, refs);
    if (last) body += sp;
    else body += tinyPara('', sp);
  });
  for (const [name, bytes] of media) parts[`word/media/${name}`] = [bytes, { level: 0 }];
  const title = info.title ? esc(info.title) : '';
  parts['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${overrides.join('')}</Types>`,
  );
  parts['_rels/.rels'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
  );
  parts['docProps/core.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:creator>ezPDF (OCR)</dc:creator></cp:coreProperties>`,
  );
  parts['word/_rels/document.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${docRels.join('')}</Relationships>`);
  parts['word/styles.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:eastAsia="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/><w:sz w:val="26"/><w:szCs w:val="26"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="57" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="57" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`,
  );
  parts['word/settings.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>',
  );
  parts['word/document.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}</w:body></w:document>`);
  return zipSync(parts, { level: 6 });
}

/** an empty header or footer, so a page without one does not show the previous page's */
function emptyRef(kind: 'header' | 'footer', k: number, parts: Zippable, rels: string[], overrides: string[]): string {
  const name = `${kind}${k + 1}e.xml`;
  const tag = kind === 'header' ? 'hdr' : 'ftr';
  parts[`word/${name}`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${tag} ${NS}>${tinyPara()}</w:${tag}>`);
  const rid = `rId${kind}${k + 1}e`;
  rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${name}"/>`);
  overrides.push(`<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`);
  return `<w:${kind}Reference w:type="default" r:id="${rid}"/>`;
}
