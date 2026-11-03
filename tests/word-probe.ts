/**
 * The .docx reader/writer (src/word) on Node, with @xmldom/xmldom for XML.
 *  - the three fixtures (python-docx, LibreOffice, pandoc) read: blocks,
 *    marks, lists, tables, pictures, read-only blocks
 *  - saved without changes: word/document.xml identical, every other part
 *    byte for byte
 *  - edits through the editor's own commands (commands.ts): delete a
 *    paragraph, bold/italic, type, split, Enter in a list and after a
 *    heading, a table cell, a hyperlink, a bookmarked paragraph, a field;
 *    tables keep their shape
 *  - the saved file read back by python-docx (scripts/verify_word.py) and
 *    opened by LibreOffice, and read again by ezPDF
 *  - drawn content (word-draw.docx): shapes, groups, canvas, VML, Office
 *    Math, MathType WMF, EMF, chart, SmartArt, footnotes; kept byte for
 *    byte when the text around them is edited; crafted values cannot add
 *    markup or script
 *  - pictures in every format (word-images.docx, 0.8.2): TIFF (raw, LZW,
 *    PackBits, G4, JPEG, Deflate, palette, CMYK, two pages), EPS previews,
 *    PICT, WMZ, misnamed files; the pixels compared with the originals
 *    (Pillow); crafted TIFFs (pages in a loop, billions of pixels, cut short)
 *    refused quickly
 *  - font and size (0.8.2): w:rFonts for every script and w:sz/w:szCs in
 *    Word's order, theme fonts replaced, read back by python-docx
 *  - pages and tabs (word-pages.docx, 0.8.3): tab stops merged from style
 *    and paragraph (a clear one removes), default stop; page break before,
 *    section breaks that start a page or not; page-number fields in the
 *    footer; an equation in a field's instruction kept and not shown;
 *    MathType's fonts as MathType asks for them (Symbol with the default
 *    character set, MT Extra: ℝ and the arrows of two vectors)
 * Usage: npm run test:word
 */
import { execFileSync } from 'child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { unzipSync, strFromU8 } from 'fflate';
import { EditorState, NodeSelection, TextSelection, type Command } from 'prosemirror-state';
import { history, undo } from 'prosemirror-history';
import { zipSync, strToU8 } from 'fflate';
import type { Node as PMNode } from 'prosemirror-model';
import { readDocx, type WordModel } from '../src/word/read';
import { buildDocumentXml, writeDocx } from '../src/word/write';
import { backspace, del, deleteParagraphs, lineBreak, lockedGuard, setFont, setSize, splitParagraph, tableGuard, toggleBold, toggleItalic, toggleUnderline } from '../src/word/commands';
import { decodeTiff } from '../src/word/tiff';
import { encodePng } from '../src/word/images';
import { markers } from '../src/word/numbering';
import { PAGE_BREAK, schema } from '../src/word/schema';
import { fontStack, paraCss } from '../src/word/styles';
import { metafileToSvg } from '../src/word/metafile';
import { androidLocation } from '../src/platform/android-location';
import { cleanSource } from '../src/platform/types';

const dom = { DOMParser: DOMParser as never, XMLSerializer: XMLSerializer as never };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out', 'word');
mkdirSync(OUT, { recursive: true });
const FIX = (f: string) => path.join(ROOT, 'tests', 'fixtures', f);

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const open = (f: string) => readDocx(new Uint8Array(readFileSync(FIX(f))), f, { dom, imageUrl: (b, mime) => `data:${mime};n=${b.length}` });
const canon = (s: string) => new XMLSerializer().serializeToString(new DOMParser().parseFromString(s, 'application/xml'));
const texts = (doc: PMNode) => {
  const out: string[] = [];
  doc.forEach((b) => out.push(b.type === schema.nodes.locked ? '[locked]' : b.textContent));
  return out;
};

/** position range of `needle` in the first textblock that contains it */
function find(doc: PMNode, needle: string, nth = 0): { from: number; to: number } {
  let res: { from: number; to: number } | null = null;
  let seen = 0;
  doc.descendants((node, pos) => {
    if (res) return false;
    if (!node.isTextblock) return true;
    let text = '';
    const map: number[] = [];
    node.forEach((child, off) => {
      if (child.isText) {
        for (let k = 0; k < child.text!.length; k++) map.push(pos + 1 + off + k);
        text += child.text;
      } else {
        map.push(pos + 1 + off);
        text += '￼';
      }
    });
    let i = text.indexOf(needle);
    while (i >= 0 && seen < nth) {
      seen++;
      i = text.indexOf(needle, i + 1);
    }
    if (i >= 0) res = { from: map[i], to: map[i + needle.length - 1] + 1 };
    return false;
  });
  if (!res) throw new Error(`không thấy “${needle}”`);
  return res;
}

class Ed {
  state: EditorState;
  constructor(public model: WordModel) {
    this.state = EditorState.create({ doc: model.doc, plugins: [history(), tableGuard(model), lockedGuard] });
  }
  run(cmd: Command) {
    return cmd(this.state, (tr) => (this.state = this.state.apply(tr)));
  }
  select(from: number, to = from) {
    this.state = this.state.apply(this.state.tr.setSelection(TextSelection.create(this.state.doc, from, to)));
  }
  sel(needle: string) {
    const r = find(this.state.doc, needle);
    this.select(r.from, r.to);
  }
  caretAfter(needle: string) {
    this.select(find(this.state.doc, needle).to);
  }
  caretBefore(needle: string) {
    this.select(find(this.state.doc, needle).from);
  }
  type(text: string) {
    const { from, to } = this.state.selection;
    const marks = this.state.storedMarks ?? this.state.selection.$from.marks();
    this.state = this.state.apply(this.state.tr.insertText(text, from, to).setStoredMarks(marks));
  }
}

async function main() {
  // ── 1. reading ─────────────────────────────────────────────────────────
  const a = await open('word-a.docx');
  const ta = texts(a.doc);
  check('word-a: 23 blocks in order, Vietnamese intact', a.doc.childCount === 23 && ta[0] === 'Hợp đồng dịch vụ' && ta[1].includes('ắ ằ ẳ ẵ ặ ơ ư đ') && ta[22] === 'Đoạn cuối của tài liệu.', `${a.doc.childCount}`);
  const p1 = a.doc.child(1);
  const markOf = (node: PMNode, s: string) => {
    let m: string[] = [];
    node.forEach((c) => {
      if (c.isText && c.text!.includes(s)) m = c.marks.map((x) => x.type.name);
    });
    return m.sort().join(',');
  };
  check(
    'runs: bold, italic, underline, red 14 pt kept as marks',
    markOf(p1, 'chữ đậm') === 'b,rp' && markOf(p1, 'chữ nghiêng') === 'i,rp' && markOf(p1, 'gạch chân') === 'rp,u' && /font-size:14pt/.test(p1.child(7).marks.find((m) => m.type.name === 'rp')?.attrs.css ?? ''),
    `${markOf(p1, 'chữ đậm')} | ${markOf(p1, 'chữ nghiêng')} | ${markOf(p1, 'gạch chân')}`,
  );
  check('heading level 1 and 2 recognised; centred paragraph', a.doc.child(0).attrs.heading === 1 && a.doc.child(4).attrs.heading === 2 && /text-align:center/.test(a.doc.child(2).attrs.css));
  const listItems: ({ numId: string; ilvl: number } | null)[] = [];
  a.doc.forEach((b) => listItems.push(b.attrs?.list ?? null));
  const labels = markers(a.numbering, listItems).filter(Boolean);
  check('lists: bullets • • and numbers 1. 2. 3.', labels.join(' ') === '• • 1. 2. 3.', labels.join(' '));
  const tbl = a.doc.child(11);
  check(
    'table 3 rows, merged cells (colspan 2, a vertical merge), borders from “Table Grid”',
    tbl.type === schema.nodes.table && tbl.childCount === 3 && tbl.child(0).child(0).attrs.colspan === 2 && /border-bottom:none/.test(tbl.child(1).child(2).attrs.css) && /border-top:0\.5pt solid/.test(tbl.child(0).child(0).attrs.css),
    tbl.child(0).child(0).attrs.css,
  );
  const img = a.doc.child(12).lastChild!;
  check('picture shown at its size (4 cm wide)', img.type === schema.nodes.inl && img.attrs.kind === 'image' && Math.abs(img.attrs.w - 113.4) < 1 && /^data:image\/png/.test(img.attrs.src), JSON.stringify(img.attrs));
  check('hyperlink kept as a link mark with its address', markOf(a.doc.child(13), 'trang ví dụ').includes('link') && find(a.doc, 'trang ví dụ').from > 0);
  const bm = a.doc.child(14);
  check(
    'bookmark at the ends of a paragraph: invisible items in its text (Enter, Backspace carry them)',
    bm.firstChild?.type === schema.nodes.inl && bm.firstChild.attrs.kind === 'hidden' && bm.lastChild?.type === schema.nodes.inl && bm.lastChild.attrs.kind === 'hidden',
  );
  check('tab and line break', ta[15] === 'Cột\tsau tab' && a.doc.child(16).childCount === 3 && a.doc.child(16).child(1).type === schema.nodes.br);
  check(
    'read-only: tracked change, content control (2 blocks, each with its reason)',
    a.locked.count === 2 && ta[18] === '[locked]' && ta[20] === '[locked]' && /theo dõi thay đổi/.test(a.doc.child(18).attrs.reason) && /<ins class="ez-wins">/.test(a.doc.child(18).attrs.html) && /<del class="ez-wdel">/.test(a.doc.child(18).attrs.html),
  );
  const eqPara = a.doc.child(19);
  const eq = eqPara.lastChild!;
  check(
    'equation: an item in an editable paragraph, drawn as MathML (E = m c²)',
    eqPara.type === schema.nodes.paragraph && eqPara.textContent === 'Công thức: ' && eq.attrs.kind === 'math' && /^<math[^>]*><mrow><mi>E<\/mi><mo>=<\/mo><mi>m<\/mi><mi>c<\/mi><mo>²<\/mo><\/mrow><\/math>$/.test(eq.attrs.html),
    eq.attrs.html,
  );
  check('page A4, margins 2 / 2.5 cm; header and footer text', Math.abs(a.page.width - 595.3) < 1 && Math.abs(a.page.left - 70.9) < 0.2 && /Đầu trang/.test(a.headerHtml) && /Trang /.test(a.footerHtml));

  const lo = await open('word-lo.docx');
  check('LibreOffice file: same text, lists and table', texts(lo.doc).includes('Bước ba') && lo.doc.child(11).type === schema.nodes.table && markers(lo.numbering, (() => { const l: ({ numId: string; ilvl: number } | null)[] = []; lo.doc.forEach((b) => l.push(b.attrs?.list ?? null)); return l; })()).filter(Boolean).join(' ') === '• • 1. 2. 3.');
  const pd = await open('word-pandoc.docx');
  const pdLabels = (() => { const l: ({ numId: string; ilvl: number } | null)[] = []; pd.doc.forEach((b) => l.push(b.attrs?.list ?? null)); return markers(pd.numbering, l).filter(Boolean).join(' '); })();
  check('pandoc file: heading, nested list, numbers, table', pd.doc.child(0).attrs.heading === 1 && pd.doc.child(7).type === schema.nodes.table && pd.doc.child(4).attrs.list?.ilvl === 1 && /1\. 2\./.test(pdLabels), pdLabels);

  // ── 2. saved without changes ───────────────────────────────────────────
  for (const m of [a, lo, pd]) {
    const xml = buildDocumentXml(m, m.doc);
    const same = xml === m.pkg.text(m.pkg.main) || canon(xml) === canon(m.pkg.text(m.pkg.main)!);
    const bytes = writeDocx(m, m.doc);
    const files = unzipSync(bytes);
    const names = Object.keys(files);
    const others = m.pkg.names.filter((n) => n !== m.pkg.main).every((n) => Buffer.compare(Buffer.from(files[n]), Buffer.from(m.pkg.files[n])) === 0);
    check(`${m.name}: saved unchanged → same document XML, every other part byte for byte, same order`, same && others && names.join() === m.pkg.names.join());
  }

  // ── 3. edits ───────────────────────────────────────────────────────────
  const ed = new Ed(await open('word-a.docx'));
  const model = ed.model;
  ed.caretAfter('Đoạn để xóa');
  ed.run(deleteParagraphs(model));
  ed.sel('Đoạn mở đầu');
  ed.run(toggleBold);
  ed.sel('chữ nghiêng');
  ed.run(toggleItalic);
  ed.sel('gạch chân');
  ed.run(toggleUnderline); // off
  ed.caretAfter('ơ ư đ.');
  ed.type(' Câu thêm mới.');
  ed.caretAfter('căn giữa,');
  ed.run(splitParagraph(model));
  ed.caretAfter('Hợp đồng dịch vụ');
  ed.run(splitParagraph(model));
  ed.type('Phụ đề thường');
  ed.sel('Ô 2.1');
  ed.type('Ô đã sửa');
  ed.caretAfter('Bước ba');
  ed.run(splitParagraph(model));
  ed.type('Bước bốn');
  ed.run(splitParagraph(model));
  ed.run(splitParagraph(model)); // empty item: out of the list
  ed.type('Sau danh sách');
  ed.caretAfter('trang ');
  ed.type('web ');
  ed.caretAfter('(bookmark)');
  ed.type(' đã sửa');
  ed.sel('Trang hiện tại');
  ed.type('Trang đang xem');
  ed.caretAfter('Đoạn cuối');
  ed.run(lineBreak);
  ed.type('dòng mới');
  // backspace at the start of the paragraph after the table: nothing pulled into the table
  const afterTable = find(ed.state.doc, 'Hình: ').from;
  ed.select(afterTable);
  ed.run(backspace);
  const tableAfter = (() => {
    let t: PMNode | null = null;
    ed.state.doc.forEach((b) => (t ??= b.type === schema.nodes.table ? b : null));
    return t as PMNode | null;
  })();
  check('Backspace after a table does not pull text into it', !!tableAfter && !tableAfter.textContent.includes('Hình'));
  // a row deleted outright: refused
  const before = ed.state.doc;
  let tpos = -1;
  ed.state.doc.forEach((b, off) => (tpos = tpos < 0 && b.type === schema.nodes.table ? off : tpos));
  const row0 = ed.state.doc.nodeAt(tpos)!.child(0);
  const tr = ed.state.tr.delete(tpos + 1, tpos + 1 + row0.nodeSize);
  check('a change that removes a table row is refused (tables keep their shape)', ed.state.applyTransaction(tr).state.doc.eq(before));

  const edited = writeDocx(model, ed.state.doc);
  const file = path.join(OUT, 'edited.docx');
  writeFileSync(file, edited);

  // read again by ezPDF
  const again = await readDocx(edited, 'edited.docx', { dom });
  const t2 = texts(again.doc);
  const expect = [
    'Hợp đồng dịch vụ',
    'Phụ đề thường',
    null,
    'Đoạn thứ hai căn giữa,',
    ' phông Times New Roman.',
  ];
  check(
    're-read by ezPDF: edits are there, the deleted paragraph is gone',
    expect.every((e, i) => e === null || t2[i] === e) &&
      t2[2].endsWith('ơ ư đ. Câu thêm mới.') &&
      !t2.some((t) => t.includes('Đoạn để xóa')) &&
      t2.includes('Bước bốn') &&
      t2.includes('Sau danh sách') &&
      t2.includes('Liên kết: trang web ví dụ ở giữa câu.') &&
      t2.includes('Đoạn có dấu trang (bookmark) đã sửa.') &&
      t2.includes('Trang đang xem: 1') &&
      t2.some((t) => t.startsWith('Đoạn cuốidòng mới')),
    JSON.stringify(t2.slice(0, 6)),
  );
  const lbl = (() => {
    const l: ({ numId: string; ilvl: number } | null)[] = [];
    again.doc.forEach((b) => l.push(b.attrs?.list ?? null));
    return markers(again.numbering, l).filter(Boolean).join(' ');
  })();
  check('the new list item is number 4; the paragraph after it is out of the list', lbl === '• • 1. 2. 3. 4.', lbl);
  const files = unzipSync(edited);
  const xml = strFromU8(files['word/document.xml']);
  const ids = [...xml.matchAll(/w14:paraId="([0-9A-F]+)"/g)].map((m) => m[1]);
  check('no paragraph id twice; section break kept once', new Set(ids).size === ids.length && (xml.match(/<w:sectPr/g) ?? []).length === 1, `${ids.length} ids`);
  // rPr children in the order Word requires
  const ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
  const xdoc = new DOMParser().parseFromString(xml, 'application/xml');
  const rPrs = xdoc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'rPr');
  let ordered = true;
  for (let i = 0; i < rPrs.length; i++) {
    const ks = Array.from(rPrs[i].childNodes).filter((n) => n.nodeType === 1).map((n) => (n as unknown as Element).localName);
    const ranks = ks.map((k) => ORDER.indexOf(k)).filter((r) => r >= 0);
    if (ranks.some((r, j) => j && r < ranks[j - 1])) ordered = false;
  }
  check('run properties written in the order Word requires', ordered);
  const unchangedParts = model.pkg.names.filter((n) => n !== 'word/document.xml').every((n) => Buffer.compare(Buffer.from(files[n]), Buffer.from(model.pkg.files[n])) === 0);
  check('only word/document.xml changed in the package', unchangedParts);
  // untouched paragraphs are their original XML
  const origXml = model.pkg.text('word/document.xml')!;
  const untouched = ['Mục gạch đầu dòng một', 'Dòng một', 'Trước ngắt trang.'].every((s) => {
    const grab = (x: string) => {
      const i = x.indexOf(s);
      const start = Math.max(x.lastIndexOf('<w:p>', i), x.lastIndexOf('<w:p ', i));
      return x.slice(start, x.indexOf('</w:p>', i));
    };
    return canon(`<x xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${grab(xml)}</w:p></x>`) === canon(`<x xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${grab(origXml)}</w:p></x>`);
  });
  check('paragraphs not touched are written exactly as they were', untouched);

  // python-docx: what Word-compatible software reads back
  const expectFile = path.join(OUT, 'edited.expect.json');
  writeFileSync(
    expectFile,
    JSON.stringify({
      bold: ['Đoạn mở đầu', 'chữ đậm'],
      notItalic: ['chữ nghiêng'],
      notUnderlined: ['gạch chân'],
      italicOff: true,
      texts: ['Phụ đề thường', 'Câu thêm mới.', 'Bước bốn', 'Sau danh sách', 'trang web ví dụ', '(bookmark) đã sửa', 'Trang đang xem'],
      absent: ['Đoạn để xóa'],
      cell: [1, 0, 'Ô đã sửa'],
      centered: ['Đoạn thứ hai căn giữa,', ' phông Times New Roman.'],
      times: [' phông Times New Roman.'],
      style: { 'Bước bốn': 'List Number', 'Phụ đề thường': 'Normal' },
      noNumbering: ['Sau danh sách'],
      tracked: true,
    }),
  );
  try {
    const out = execFileSync('python3', [path.join(ROOT, 'scripts', 'verify_word.py'), file, expectFile], { encoding: 'utf8' });
    const r = JSON.parse(out);
    for (const c of r.checks) check(`python-docx: ${c.name}`, c.ok, c.detail ?? '');
  } catch (e) {
    check('python-docx reads the saved file', false, String((e as { stdout?: string }).stdout ?? e));
  }
  // LibreOffice opens it (as Word would): converted to text, the edits are in it
  const soffice = ['/usr/bin/soffice', '/usr/lib/libreoffice/program/soffice'].find((p) => existsSync(p));
  if (soffice && !process.env.SKIP_LIBREOFFICE) {
    execFileSync(soffice, ['--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', OUT, file], { stdio: 'ignore', timeout: 180_000 });
    const txt = readFileSync(path.join(OUT, 'edited.txt'), 'utf8');
    check('LibreOffice opens the saved file; the edits are in its text', /Phụ đề thường/.test(txt) && /Câu thêm mới/.test(txt) && /Ô đã sửa/.test(txt) && /Bước bốn/.test(txt) && !/Đoạn để xóa/.test(txt));
  } else console.log('skip  LibreOffice not installed');

  await hardCases();
  await drawingCases();
  await imageCases();
  await fontCases();
  await pageCases();
  await fileInfoCases();
  console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} word checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/** The cases an independent review found (word-b.docx and crafted files). */
async function hardCases() {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const xmlOf = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']);
  const count = (x: string, re: RegExp) => (x.match(re) ?? []).length;
  const b = await open('word-b.docx');
  const tb = texts(b.doc);
  check('word-b: a paragraph whose mark is a tracked insertion is read-only', tb.includes('[locked]') && b.locked.count === 1, tb.join(' | '));

  // Enter at the end of a bookmarked heading, inside and after a commented word, then Backspace back
  const ed = new Ed(b);
  ed.caretAfter('Chương một');
  ed.run(splitParagraph(b));
  ed.type('Đoạn mới sau tiêu đề');
  ed.caretAfter('lời');
  ed.run(splitParagraph(b));
  ed.caretAfter('ở giữa.');
  ed.run(splitParagraph(b));
  ed.type('x');
  ed.caretBefore('x');
  ed.run(backspace); // joins back: the comment's end comes along
  ed.caretBefore(' bình');
  ed.run(backspace); // joins "Câu có lời" + " bình…"
  let x = xmlOf(writeDocx(b, ed.state.doc));
  check(
    'a bookmarked heading split by Enter, a commented paragraph split and joined: bookmark and comment anchors stay whole',
    count(x, /<w:bookmarkStart[^>]*w:id="11"/g) === 1 && count(x, /<w:bookmarkEnd[^>]*w:id="11"/g) === 1 && count(x, /<w:commentRangeStart/g) === 1 && count(x, /<w:commentRangeEnd/g) === 1 && count(x, /<w:commentReference/g) === 1,
    `bookmark ${count(x, /bookmarkStart[^>]*w:id="11"/g)}/${count(x, /bookmarkEnd[^>]*w:id="11"/g)}, comment ${count(x, /<w:commentRangeStart/g)}/${count(x, /<w:commentRangeEnd/g)}/${count(x, /<w:commentReference/g)}`,
  );
  check('…and the heading keeps its bookmark around “Chương một”', /<w:bookmarkStart[^>]*w:id="11"[^>]*\/>(?:(?!<\/w:p>).)*Chương một(?:(?!<\/w:p>).)*<w:bookmarkEnd[^>]*w:id="11"/s.test(x));

  // section break: Enter at the end of the paragraph that ends the portrait section
  const ed2 = new Ed(await open('word-b.docx'));
  ed2.caretAfter('Cuối phần dọc.');
  ed2.run(splitParagraph(ed2.model));
  ed2.type('Thêm trong phần dọc');
  x = xmlOf(writeDocx(ed2.model, ed2.state.doc));
  const secs = x.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) ?? [];
  check('Enter at a section break: still 2 sections (the break written once, the landscape page kept)', secs.length === 2 && /w:orient="landscape"/.test(secs[1]), `${secs.length} sections`);

  // a field half deleted; a w14 text effect underlined; one table cell edited
  const ed3 = new Ed(await open('word-b.docx'));
  const f = find(ed3.state.doc, 'trang: ');
  const res = find(ed3.state.doc, ' là trường');
  ed3.select(f.from, res.from - 1); // "trang: " + field begin, code, separate, result; not the end
  ed3.type('');
  ed3.run((st, d) => (d && d(st.tr.deleteSelection()), true));
  ed3.sel('Chữ có viền');
  ed3.run(toggleUnderline);
  ed3.sel('Ô sẽ sửa');
  ed3.type('Ô đã sửa');
  const bytes3 = writeDocx(ed3.model, ed3.state.doc);
  x = xmlOf(bytes3);
  const begins = count(x, /w:fldCharType="begin"/g);
  const ends = count(x, /w:fldCharType="end"/g);
  check('a field half deleted: the leftover half removed, no field code left as text', begins === ends && !/<w:instrText/.test(x.split('là trường')[0].split('Số')[1] ?? '') && begins === 0, `begin ${begins}, end ${ends}`);
  const outline = /<w:rPr>(?:(?!<\/w:rPr>).)*textOutline(?:(?!<\/w:rPr>).)*<\/w:rPr>/s.exec(x)?.[0] ?? '';
  check('underline added to a run with a Word 2010 effect: w:u before w14:textOutline', outline.indexOf('<w:u ') >= 0 && outline.indexOf('<w:u ') < outline.indexOf('w14:textOutline'), outline.replace(/\s+/g, ' ').slice(0, 160));
  const cellXml = (xml: string) => /<w:tc>(?:(?!<\/w:tc>).)*O_dau_trang(?:(?!<\/w:tc>).)*<\/w:tc>/s.exec(xml)?.[0] ?? 'missing';
  check('a table edited in one cell: the other cell (ending in a bookmark end) is written exactly as it was', canon(`<x xmlns:w="${W}">${cellXml(x)}</x>`) === canon(`<x xmlns:w="${W}">${cellXml(b.pkg.text('word/document.xml')!)}</x>`) && x.includes('Ô đã sửa'));

  // a table deleted, then undone; Backspace next to a read-only block
  const ed4 = new Ed(await open('word-b.docx'));
  const tStart = find(ed4.state.doc, 'viền').to;
  const tEnd = find(ed4.state.doc, 'Ô 2.2').to + 4;
  ed4.select(tStart, Math.min(tEnd + 2, ed4.state.doc.content.size));
  ed4.run((st, d) => (d && d(st.tr.deleteSelection()), true));
  const gone = !texts(ed4.state.doc).some((t) => t.includes('Ô 2.1'));
  ed4.run(undo);
  let tables = 0;
  ed4.state.doc.forEach((n) => (tables += n.type === schema.nodes.table ? 1 : 0));
  check('a table deleted can be brought back with Undo (the guard lets the file’s own table return)', gone && tables === 1, `deleted ${gone}, tables after undo ${tables}`);
  ed4.caretBefore('Cuối phần dọc.');
  ed4.run(backspace);
  const sel1 = ed4.state.selection instanceof NodeSelection && ed4.state.selection.node.type === schema.nodes.locked;
  ed4.run(backspace);
  check('Backspace after a read-only block selects it first, a second Backspace deletes it', sel1 && !texts(ed4.state.doc).includes('[locked]'));

  // copies inside the document: a second picture gets its own id, a second bookmark is not written
  const a = await open('word-a.docx');
  let img: PMNode | null = null;
  let mark: PMNode | null = null;
  a.doc.descendants((n) => {
    if (n.type === schema.nodes.inl && n.attrs.kind === 'image') img = n;
    if (n.type === schema.nodes.inl && n.attrs.kind === 'hidden' && !mark) mark = n;
    return true;
  });
  const ed5 = new Ed(a);
  ed5.caretAfter('Đoạn cuối của tài liệu.');
  ed5.state = ed5.state.apply(ed5.state.tr.insert(ed5.state.selection.from, [img!, mark!]));
  x = xmlOf(writeDocx(a, ed5.state.doc));
  const ids = [...x.matchAll(/<wp:docPr[^>]*\bid="(\d+)"/g)].map((m) => m[1]);
  const bmIds = [...x.matchAll(/<w:bookmarkStart[^>]*w:id="(\d+)"/g)].map((m) => m[1]);
  check('a picture pasted twice: two drawings with different ids; a bookmark pasted twice: written once', ids.length === 2 && ids[0] !== ids[1] && new Set(bmIds).size === bmIds.length, `docPr ${ids.join(',')} · bookmarks ${bmIds.join(',')}`);

  // a crafted file: colours and a font name that try to add CSS
  const files = unzipSync(new Uint8Array(readFileSync(FIX('word-a.docx'))));
  let doc = strFromU8(files['word/document.xml']);
  doc = doc.replace('<w:color w:val="B42318"/>', '<w:color w:val="000;position:fixed;inset:0;background:url(https://evil.example/x.png)"/>');
  doc = doc.replace('w:ascii="Times New Roman"', 'w:ascii="X&quot;;background:url(https://evil.example/y.png);&quot;"');
  files['word/document.xml'] = strToU8(doc);
  const evil = await readDocx(zipSync(files), 'evil.docx', { dom });
  const css: string[] = [];
  evil.doc.descendants((n) => {
    if (n.type === schema.nodes.paragraph) css.push(n.attrs.css);
    n.marks.forEach((m) => m.attrs.css && css.push(m.attrs.css));
    return true;
  });
  check('a crafted file cannot add CSS (no position, no url())', css.length > 10 && !css.some((c) => /position|url\(|inset/.test(c)), css.find((c) => /position|url\(/.test(c)) ?? 'clean');

  // a macro-enabled file under a .docx name: refused with the reason
  const m = unzipSync(new Uint8Array(readFileSync(FIX('word-a.docx'))));
  m['[Content_Types].xml'] = strToU8(strFromU8(m['[Content_Types].xml']).replace('wordprocessingml.document.main+xml', 'XX').replace('XX', 'wordprocessingml.document.main+xml').replace('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml', 'application/vnd.ms-word.document.macroEnabled.main+xml'));
  let refused = '';
  try {
    await readDocx(zipSync(m), 'macro.docx', { dom });
  } catch (e) {
    refused = String((e as Error).message);
  }
  check('a file with macros (.docm content) is refused, with the reason', /macro/.test(refused), refused);
}

/** Shapes, equations, metafiles, charts, SmartArt, notes (word-draw.docx). */
async function drawingCases() {
  const svgs: string[] = [];
  const openDraw = (bytes: Uint8Array) =>
    readDocx(bytes, 'word-draw.docx', {
      dom,
      imageUrl: (b, mime) => {
        if (mime === 'image/svg+xml') svgs.push(new TextDecoder().decode(b));
        return `data:${mime};n=${b.length}`;
      },
    });
  const raw = new Uint8Array(readFileSync(FIX('word-draw.docx')));
  const d = await openDraw(raw);
  const items: PMNode[] = [];
  d.doc.descendants((n) => {
    if (n.type === schema.nodes.inl && n.attrs.kind !== 'hidden') items.push(n);
    return true;
  });
  const kinds = items.map((n) => `${n.attrs.kind}:${n.attrs.label}`);
  check(
    'word-draw: every drawn thing recognised, nothing read-only',
    kinds.join(' | ') ===
      'note:1 | shape:Hình vẽ | shape:Hình vẽ | shape:Hình vẽ | shape:Hình vẽ | math:a+b2 | note:i | math:i=1nxi2=y+1001 | image:Hình | image:Hình | shape:Biểu đồ | shape:SmartArt' && d.locked.count === 0,
    kinds.join(' | '),
  );
  const [flow, inlineShape, canvas, vml, mathIn, mathBlock, , , chart, smart] = items.filter((n) => n.attrs.kind !== 'note');
  const svgText = (h: string) => [...h.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter(Boolean).join(' ');
  check(
    'flowchart (group): floating, centred, 4 shapes with their text, 3 arrow heads, theme colour accent1 (4F81BD in this theme)',
    flow.attrs.block && flow.attrs.css === 'text-align:center' && svgText(flow.attrs.html) === 'Bắt đầu Đọc tệp Hợp lệ? Kết thúc' && (flow.attrs.html.match(/marker-end=/g) ?? []).length === 3 && /fill="rgb\(79,129,189\)"/.test(flow.attrs.html) && /viewBox="0 0 240 333\.33"/.test(flow.attrs.html),
    svgText(flow.attrs.html),
  );
  check('inline shape: rounded rectangle, its own fill (ED7D31), text, in the sentence', !inlineShape.attrs.block && /fill="rgb\(237,125,49\)"/.test(inlineShape.attrs.html) && svgText(inlineShape.attrs.html) === 'Hộp chữ inline' && /<path d="M[\d.]+,0 H/.test(inlineShape.attrs.html));
  check('canvas: background, ellipse, line with arrow, the picture', /fill="rgb\(242,242,242\)"/.test(canvas.attrs.html) && /A[\d.]+,[\d.]+ 0 1 0/.test(canvas.attrs.html) && /marker-end/.test(canvas.attrs.html) && /<image href="data:image\/png;n=\d+"/.test(canvas.attrs.html));
  check('VML group: rectangle with text box, oval, line with arrow, in the group coordinates', svgText(vml.attrs.html) === 'VML hộp chữ' && /fill="#ffc000"/.test(vml.attrs.html) && /fill="#5b9bd5"/.test(vml.attrs.html) && /marker-end/.test(vml.attrs.html) && /viewBox="0 0 266\.67 106\.67"/.test(vml.attrs.html));
  check('inline equation: a fraction (a+b)/2 in MathML', /<mfrac><mrow><mi>a<\/mi><mo>\+<\/mo><mi>b<\/mi><\/mrow><mrow><mn>2<\/mn><\/mrow><\/mfrac>/.test(mathIn.attrs.html) && !mathIn.attrs.block);
  check(
    'equation paragraph: on its own line, centred; ∑ with limits under and over, √, a matrix in brackets',
    mathBlock.attrs.block && mathBlock.attrs.css === 'text-align:center' && /display="block"/.test(mathBlock.attrs.html) && /<munderover><mo[^>]*>∑<\/mo>/.test(mathBlock.attrs.html) && /<msqrt>/.test(mathBlock.attrs.html) && /<mtable>(<mtr>(<mtd>.*?<\/mtd>){2}<\/mtr>){2}<\/mtable>/.test(mathBlock.attrs.html),
  );
  const wmf = svgs.find((x) => /π/.test(x)) ?? '';
  check(
    'MathType equation (OLE, WMF): x italic over π (Symbol font → Unicode), the fraction bar, “= 1” placed by its advances',
    /font-style="italic"[^>]*>x</.test(wmf) && />π</.test(wmf) && /<path d="M5\.33,22 L22\.67,22"/.test(wmf) && /x="31\.33 44\.67 50\.67"[^>]*>= 1</.test(wmf) && /viewBox="0 0 80\.00 40\.00"/.test(wmf),
    wmf.slice(0, 160),
  );
  const emf = svgs.find((x) => /EMF/.test(x)) ?? '';
  check('EMF picture: filled rectangle, polyline, bold Arial text with Vietnamese (UTF-16)', /fill="#fff2e1"/.test(emf) && /stroke="#c00000"/.test(emf) && /font-weight="bold"[^>]*>EMF chữ</.test(emf));
  check('chart: title, 6 bars, categories, legend from the cached values', svgText(chart.attrs.html).startsWith('Doanh thu theo quý') && (chart.attrs.html.match(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" fill="rgb/g) ?? []).length >= 6 && /Quý 2/.test(chart.attrs.html) && />2026</.test(chart.attrs.html));
  check('SmartArt: drawn from its saved drawing (two boxes, an arrow, their text)', svgText(smart.attrs.html) === 'Ý tưởng Thực hiện' && /<path d="M0,/.test(smart.attrs.html));
  check('footnote 1 and endnote i shown after the text with their own text', /<sup>1<\/sup>[^]*Chú thích cuối trang về lưu đồ\./.test(d.notesHtml) && /<sup>i<\/sup>[^]*Chú thích cuối tài liệu\./.test(d.notesHtml));

  // unchanged: the document XML as it was
  const xml0 = d.pkg.text(d.pkg.main)!;
  check('word-draw saved unchanged: same document XML', canon(buildDocumentXml(d, d.doc)) === canon(xml0));

  // edit the text next to the equations and shapes: every drawn element written back exactly
  const ed = new Ed(d);
  ed.caretAfter('là trung bình cộng');
  ed.type(' (đã sửa)');
  ed.caretAfter('ở giữa câu');
  ed.type(' — thêm chữ');
  ed.caretAfter('Lưu đồ dưới đây');
  ed.run(splitParagraph(d));
  const out = writeDocx(d, ed.state.doc);
  const outXml = strFromU8(unzipSync(out)['word/document.xml']);
  const pick = (x: string, tag: string) => {
    const doc = new DOMParser().parseFromString(x, 'application/xml');
    const [prefix, local] = tag.split(':');
    const els = Array.from(doc.getElementsByTagName(tag));
    return els.map((e) => canon(new XMLSerializer().serializeToString(e)).replace(/ xmlns(:\w+)?="[^"]*"/g, '')).join('\n') + `#${prefix}${local}${els.length}`;
  };
  const tags = ['m:oMath', 'm:oMathPara', 'wpg:wgp', 'wpc:wpc', 'w:pict', 'w:object', 'c:chart', 'dgm:relIds', 'w:footnoteReference', 'w:endnoteReference'];
  const differ = tags.filter((t) => pick(outXml, t) !== pick(xml0, t));
  check('text edited around them: equations, group, canvas, VML, OLE, chart, SmartArt, note marks written back exactly', differ.length === 0, differ.join(', ') || tags.length + ' kinds');
  const again = await openDraw(out);
  check('…and the saved file reads back with the edit and every drawn item', /trung bình cộng \(đã sửa\)/.test(texts(again.doc).join('\n')) && (() => { let k = 0; again.doc.descendants((n) => { if (n.type === schema.nodes.inl && (n.attrs.kind === 'shape' || n.attrs.kind === 'math')) k++; return true; }); return k === 8; })());

  // crafted values in drawings: no markup, script, event handler or outside URL can come through
  const files = unzipSync(raw);
  let x = strFromU8(files['word/document.xml']);
  x = x.replace('<a:srgbClr val="ED7D31"/>', '<a:srgbClr val="ED7D31&quot; onload=&quot;alert(1)"/>');
  x = x.replace('prst="flowChartDecision"', 'prst="x&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
  x = x.replace('Bắt đầu', '&lt;img src=x onerror=alert(1)&gt;');
  x = x.replace('fillcolor="#ffc000"', 'fillcolor="url(javascript:alert(1))"');
  x = x.replace('<m:t>a+b</m:t>', '<m:t>&lt;/math&gt;&lt;img src=x onerror=alert(1)&gt;</m:t>');
  x = x.replace('<v:stroke endarrow="block"/>', '<v:stroke endarrow="block&quot; onclick=&quot;x" dashstyle="&quot;/&gt;&lt;script&gt;"/>');
  x = x.replace('<a:tailEnd type="triangle"/>', '<a:tailEnd type="triangle&quot;/&gt;&lt;script&gt;x&lt;/script&gt;"/>');
  files['word/document.xml'] = strToU8(x);
  let chartXml = strFromU8(files['word/charts/chart1.xml']);
  chartXml = chartXml.replace('Doanh thu theo quý', '&lt;script&gt;alert(1)&lt;/script&gt;').replace('<c:v>Quý 1</c:v>', '<c:v>&lt;b onmouseover=alert(1)&gt;</c:v>');
  files['word/charts/chart1.xml'] = strToU8(chartXml);
  // a WMF font name with markup in it
  const wmfBytes = files['word/media/eq1.wmf'];
  const at = Buffer.from(wmfBytes).indexOf('Times New Roman');
  Buffer.from('"><x onload=y>').copy(Buffer.from(wmfBytes.buffer, wmfBytes.byteOffset + at, 15));
  svgs.length = 0;
  const evil = await openDraw(zipSync(files));
  const html: string[] = [...svgs, evil.notesHtml];
  evil.doc.descendants((n) => {
    if (n.type === schema.nodes.inl && n.attrs.html) html.push(n.attrs.html);
    return true;
  });
  // the crafted text must arrive as text: no element or attribute of its own
  const tagsOf = (h: string) => h.match(/<[^>]*>/g) ?? [];
  const bad = html.flatMap(tagsOf).find((t) => /^<\/?(script|img|b|iframe|object)\b/i.test(t) || /\son\w+=|javascript:|url\((?!#ez[mc]\d+\))/i.test(t));
  const shown = html.join('').includes('&lt;img src=x onerror=alert(1)&gt;') && html.join('').includes('&lt;script&gt;alert(1)&lt;/script&gt;');
  check('crafted shapes, equation, chart, WMF: no tag, script, event handler or outside URL in what is drawn (the text shows as text)', html.length >= 10 && !bad && shown, bad ?? `${html.length} pieces clean`);
  check('every drawing is clipped a little outside its box (a shape cannot paint over the page)', [flow, inlineShape, canvas, vml, chart, smart].every((n) => /<clipPath id="ezc\d+"><rect x="-[\d.]+"/.test(n.attrs.html) && /<g clip-path="url\(#ezc\d+\)">/.test(n.attrs.html)));

  await reviewCases(raw);
}

/** The cases the independent review of 0.8.1 found: hostile files that must stay fast and small. */
async function reviewCases(raw: Uint8Array) {
  const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const timed = async <T,>(f: () => Promise<T> | T) => {
    const t0 = Date.now();
    const v = await f();
    return { v, ms: Date.now() - t0 };
  };
  const withDoc = (edit: (x: string) => string, more: (files: Record<string, Uint8Array>) => void = () => {}) => {
    const files = unzipSync(raw);
    files['word/document.xml'] = strToU8(edit(strFromU8(files['word/document.xml'])));
    more(files);
    return zipSync(files);
  };
  const read = (bytes: Uint8Array) => readDocx(bytes, 'evil.docx', { dom, imageUrl: (b, mime) => `data:${mime};n=${b.length}` });

  // 1. radicals nested in their degree: converted once each (it was 2^depth)
  let rad = '<m:r><m:t>x</m:t></m:r>';
  for (let i = 0; i < 40; i++) rad = `<m:rad><m:deg>${rad}</m:deg><m:e><m:r><m:t>y</m:t></m:r></m:e></m:rad>`;
  const r1 = await timed(() => read(withDoc((x) => x.replace('<m:oMath><m:f>', `<m:oMath>${rad}<m:f>`))));
  check('40 radicals nested in each other’s degree: drawn in well under a second', r1.ms < 1500, `${r1.ms} ms`);
  // 6. an equation nested deeper than any real one: a chip, the document still opens
  let deep = '<m:r><m:t>x</m:t></m:r>';
  for (let i = 0; i < 400; i++) deep = `<m:sSup><m:e>${deep}</m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>`;
  const r6 = await read(withDoc((x) => x.replace('<m:oMath><m:f>', `<m:oMath>${deep}<m:f>`)));
  let chip = false;
  r6.doc.descendants((n) => {
    if (n.attrs?.kind === 'math' && /Công thức/.test(n.attrs.html)) chip = true;
    return true;
  });
  check('an equation nested 400 deep shows as a chip; the document opens', chip);

  // 2. a SmartArt whose drawing holds a text box pointing back at the same SmartArt: drawn once, no loop
  const selfRef = await timed(() =>
    read(
      withDoc(
        (x) => x,
        (files) => {
          const back =
            '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="2921000" cy="635000"/><wp:docPr id="99" name="x"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds r:dm="rIdD1" r:lo="rIdD2" r:qs="rIdD3" r:cs="rIdD4"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
          const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
          let d = strFromU8(files['word/diagrams/drawing1.xml']);
          // twenty shapes, each with a text box holding the SmartArt again
          const sp = d.match(/<dsp:sp modelId="\{1\}">[^]*?<\/dsp:sp>/)![0].replace('<dsp:txBody>', `<dsp:txbx><w:txbxContent ${ns}>${back}${back}</w:txbxContent></dsp:txbx><dsp:txBody>`);
          d = d.replace('</dsp:spTree>', sp.repeat(20) + '</dsp:spTree>');
          files['word/diagrams/drawing1.xml'] = strToU8(d);
          // the drawing's own relationships, so the SmartArt can be found from it too
          files['word/diagrams/_rels/drawing1.xml.rels'] = strToU8(
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
              '<Relationship Id="rIdD1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="data1.xml"/>' +
              '<Relationship Id="rIdD5" Type="http://schemas.microsoft.com/office/2007/relationships/diagramDrawing" Target="drawing1.xml"/></Relationships>',
          );
        },
      ),
    ),
  );
  let copies = 0;
  selfRef.v.doc.descendants((n) => {
    if (n.attrs?.label === 'SmartArt') copies = Math.max(copies, (n.attrs.html.match(/aria-label="SmartArt"/g) ?? []).length);
    return true;
  });
  check('a SmartArt that contains itself (twenty times, twice each) is drawn once, quickly', copies === 1 && selfRef.ms < 3000, `${copies} cop${copies === 1 ? 'y' : 'ies'} drawn, ${selfRef.ms} ms`);

  // 3. an EMF whose polylines claim a million points each, inside a path
  const emf = (() => {
    const recs: Buffer[] = [];
    const rec = (type: number, payload: Buffer) => {
      const b = Buffer.alloc(8);
      b.writeUInt32LE(type, 0);
      b.writeUInt32LE(8 + payload.length, 4);
      recs.push(b, payload);
    };
    rec(59, Buffer.alloc(0));
    const pl = Buffer.alloc(20);
    pl.writeUInt32LE(1000000, 16);
    for (let i = 0; i < 3000; i++) rec(87, pl);
    rec(60, Buffer.alloc(0));
    rec(64, Buffer.alloc(0));
    rec(14, Buffer.alloc(12));
    const hdr = Buffer.alloc(108);
    hdr.writeUInt32LE(1, 0);
    hdr.writeUInt32LE(108, 4);
    hdr.writeInt32LE(2646, 32);
    hdr.writeInt32LE(2646, 36);
    hdr.writeUInt32LE(0x464d4520, 40);
    hdr.writeInt32LE(1920, 72);
    hdr.writeInt32LE(1080, 76);
    hdr.writeInt32LE(508, 80);
    hdr.writeInt32LE(286, 84);
    return Buffer.concat([hdr, ...recs, Buffer.alloc(4000000)]);
  })();
  const r3 = await timed(() => read(withDoc((x) => x, (files) => (files['word/media/pic1.emf'] = new Uint8Array(emf)))));
  check('an EMF whose records claim a million points each: nothing read past a record, done quickly', r3.ms < 3000, `${r3.ms} ms`);

  // 4. a stacked line chart of 100 series × 10,000 empty points
  const r4 = await timed(() =>
    read(
      withDoc(
        (x) => x,
        (files) => {
          let c = strFromU8(files['word/charts/chart1.xml']);
          const ser = '<c:ser><c:idx val="0"/><c:order val="0"/><c:val><c:numRef><c:numCache><c:ptCount val="10000"/></c:numCache></c:numRef></c:val></c:ser>';
          c = c.replace(/<c:barChart>[^]*<\/c:barChart>/, `<c:lineChart><c:grouping val="stacked"/>${ser.repeat(100)}<c:axId val="1"/><c:axId val="2"/></c:lineChart>`);
          files['word/charts/chart1.xml'] = strToU8(c);
        },
      ),
    ),
  );
  let chartHtml = 0;
  r4.v.doc.descendants((n) => {
    if (n.attrs?.label === 'Biểu đồ') chartHtml = Math.max(chartHtml, (n.attrs.html ?? '').length);
    return true;
  });
  check('a stacked chart of 100 series × 10,000 empty points: no flood of markup', r4.ms < 3000 && chartHtml < 200000, `${r4.ms} ms, ${chartHtml} chars`);

  // 7. footnotes: one in a text box, one in a paragraph that turns read-only part-way; numbers unique and in order
  const r7 = await read(
    withDoc(
      (x) =>
        x
          .replace('Hộp chữ inline</w:t></w:r>', 'Hộp chữ inline</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r>')
          .replace('<w:t xml:space="preserve">Hết.</w:t></w:r>', '<w:t xml:space="preserve">Hết.</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r><w:customXml w:element="x"><w:r><w:t>y</w:t></w:r></w:customXml>')
          .replace('<w:t xml:space="preserve">MathType: </w:t></w:r>', '<w:t xml:space="preserve">MathType: </w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r>'),
    ),
  );
  const labels = [...r7.notesHtml.matchAll(/<sup>(\d+)<\/sup>/g)].map((m) => m[1]);
  check('footnotes in a text box and in a paragraph that turns read-only part-way: numbered 1–4 once each', labels.join(',') === '1,2,3,4' && r7.locked.count === 1, labels.join(','));

  // 10. a mirrored group: its shapes mirror, their text stays readable (no mirror above any text box)
  const r10 = await read(withDoc((x) => x.replace('<a:xfrm><a:off x="0" y="0"/><a:ext cx="2286000" cy="3175000"/><a:chOff', '<a:xfrm flipH="1"><a:off x="0" y="0"/><a:ext cx="2286000" cy="3175000"/><a:chOff')));
  let flipped = '';
  r10.doc.descendants((n) => {
    if (!flipped && n.attrs?.kind === 'shape') flipped = n.attrs.html;
    return true;
  });
  const fo = [...flipped.matchAll(/<foreignObject/g)].length;
  const mirroredText = /scale\(-1[^)]*\)"[^>]*>(?:(?!<\/g>).)*<foreignObject/.test(flipped);
  check('a mirrored group: its outlines mirror, the text of its 4 boxes does not', fo === 4 && /scale\(-1 1\)/.test(flipped) && !mirroredText);
}

/** Pictures in every format a Word file may hold (0.8.2). */
async function imageCases() {
  const raw = new Uint8Array(readFileSync(FIX('word-images.docx')));
  const store = new Map<string, { mime: string; b: Uint8Array }>();
  const readImages = (canShow?: (b: Uint8Array, mime: string) => Promise<boolean>) =>
    readDocx(raw, 'word-images.docx', {
      dom,
      canShow,
      imageUrl: (b, mime) => {
        const u = `img:${store.size}`;
        store.set(u, { mime, b });
        return u;
      },
    });
  const pics = (m: WordModel) => {
    const out: { label: string; kind: string; src: string; chip: string; name: string }[] = [];
    m.doc.forEach((p) =>
      p.forEach((c) => {
        if (c.type !== schema.nodes.inl) return;
        const el = m.store[c.attrs.ref] as Element | undefined;
        const name = el?.getElementsByTagNameNS?.('http://schemas.openxmlformats.org/drawingml/2006/picture', 'cNvPr')?.[0]?.getAttribute('name') ?? '';
        out.push({ label: p.textContent.replace(/:\s*$/, ''), kind: c.attrs.kind, src: c.attrs.src ?? '', chip: c.attrs.label ?? '', name });
      }),
    );
    return out;
  };
  const t0 = Date.now();
  const plain = pics(await readImages());
  const ms = Date.now() - t0;
  const shown = plain.filter((p) => p.kind === 'image');
  const chips = plain.filter((p) => p.kind !== 'image').map((p) => p.chip);
  check(
    'word-images: 26 pictures; without a browser to ask, 23 shown and AVIF, HEIC, JPEG XR named',
    plain.length === 26 && shown.length === 23 && chips.join('|') === 'Hình (AVIF)|Hình (HEIC)|Hình (JPEG XR)',
    `${shown.length} shown, ${chips.join('|')}, ${ms} ms`,
  );
  const tiffs = shown.filter((p) => /\.(tif|eps|pict)$|^v\.png$/.test(p.name));
  check(
    'TIFF, EPS and PICT become PNG or JPEG the browser shows; a PNG named .jpg and a TIFF named .png are read by their content',
    tiffs.length === 14 && tiffs.every((p) => /^image\/(png|jpeg)$/.test(store.get(p.src)!.mime)) && store.get(shown.find((p) => p.name === 'u.jpg')!.src)!.mime === 'image/png',
    tiffs.map((p) => `${p.name}:${store.get(p.src)!.mime}`).join(' '),
  );
  const wmz = shown.find((p) => p.name === 'w.wmz');
  check('a WMZ (gzipped WMF) is unpacked and drawn as SVG', !!wmz && store.get(wmz.src)!.mime === 'image/svg+xml' && /<svg/.test(strFromU8(store.get(wmz.src)!.b)));
  const asked: string[] = [];
  const withBrowser = pics(
    await readImages(async (b, mime) => {
      asked.push(mime);
      return mime === 'image/avif';
    }),
  );
  check(
    'with a browser that shows AVIF: AVIF shown as itself, HEIC and JPEG XR named; only those three formats asked about',
    withBrowser.filter((p) => p.kind === 'image').length === 24 && asked.sort().join(' ') === 'image/avif image/heic image/vnd.ms-photo',
    asked.join(' '),
  );

  // the pixels against the originals the fixture script saved (Pillow)
  const dir = path.join(OUT, 'images');
  mkdirSync(dir, { recursive: true });
  const pairs: string[] = [];
  for (const p of shown) {
    const ref = FIX(`word-images/${p.name.replace(/\.[^.]+$/, '')}.png`);
    if (!existsSync(ref)) continue;
    const s = store.get(p.src)!;
    const got = path.join(dir, `${p.name}.${s.mime.split('/')[1].replace('svg+xml', 'svg').replace('x-icon', 'ico')}`);
    writeFileSync(got, s.b);
    pairs.push(`${got}\t${ref}`);
  }
  let diffs: Record<string, number> = {};
  try {
    diffs = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          [
            'import sys,json',
            'from PIL import Image, ImageChops, ImageStat',
            'out={}',
            'for line in sys.stdin.read().splitlines():',
            '  a,b=line.split("\\t")',
            '  x=Image.open(a).convert("RGBA");y=Image.open(b).convert("RGBA")',
            '  bg=Image.new("RGBA",x.size,(255,255,255,255));x=Image.alpha_composite(bg,x).convert("RGB")',
            '  bg=Image.new("RGBA",y.size,(255,255,255,255));y=Image.alpha_composite(bg,y).convert("RGB")',
            '  out[a.rsplit("/",1)[1]]=-1 if x.size!=y.size else round(sum(ImageStat.Stat(ImageChops.difference(x,y)).mean)/3,2)',
            'print(json.dumps(out))',
          ].join('\n'),
        ],
        { input: pairs.join('\n'), encoding: 'utf8' },
      ),
    );
  } catch (e) {
    diffs = { error: -1, detail: String(e).length };
  }
  const worst = Object.entries(diffs).sort((a, b) => b[1] - a[1]);
  const exact = Object.entries(diffs).filter(([k]) => /^[abcdfghijkmopuv]\./.test(k));
  check(
    `pixels match the originals: ${Object.keys(diffs).length} pictures, lossless ones exactly (CMYK within rounding), JPEG-based within 3/255`,
    Object.keys(diffs).length >= 20 && worst.every(([, d]) => d >= 0 && d <= 3) && exact.every(([, d]) => d <= 0.05),
    worst.slice(0, 4).map(([k, d]) => `${k} ${d}`).join(', '),
  );

  // crafted TIFFs: refused, quickly
  const tiff = (entries: [number, number, number, number][], next = 0, extra = 0) => {
    const n = entries.length;
    const b = new Uint8Array(8 + 2 + n * 12 + 4 + extra);
    const v = new DataView(b.buffer);
    b.set([0x49, 0x49, 42, 0]);
    v.setUint32(4, 8, true);
    v.setUint16(8, n, true);
    entries.forEach(([tag, type, count, value], i) => {
      const o = 10 + i * 12;
      v.setUint16(o, tag, true);
      v.setUint16(o + 2, type, true);
      v.setUint32(o + 4, count, true);
      if (type === 3) v.setUint16(o + 8, value, true);
      else v.setUint32(o + 8, value, true);
    });
    v.setUint32(10 + n * 12, next, true);
    return b;
  };
  const timed = (f: () => unknown) => {
    const t = Date.now();
    const v = f();
    return { v, ms: Date.now() - t };
  };
  const base: [number, number, number, number][] = [
    [256, 4, 1, 4],
    [257, 4, 1, 4],
    [258, 3, 1, 8],
    [259, 3, 1, 1],
    [262, 3, 1, 1],
    [273, 4, 1, 8],
    [277, 3, 1, 1],
    [279, 4, 1, 16],
  ];
  const loop = timed(() => decodeTiff(tiff(base, 8, 16)));
  const hugeTiff = tiff([
    [256, 4, 1, 200000],
    [257, 4, 1, 200000],
    ...base.slice(2),
  ]);
  const huge = timed(() => decodeTiff(hugeTiff));
  // a strip count of a billion, a strip claiming to be 4 GB, a 2 GB ASCII tag, an EXIF pointer back at the page itself
  const many = timed(() => decodeTiff(tiff([...base.slice(0, 5), [273, 4, 1e9, 8], [277, 3, 1, 1], [279, 4, 1, 16]])));
  const bigStrip = timed(() => decodeTiff(tiff([...base.slice(0, 7), [279, 4, 1, 0xfffffff0]])));
  const ascii = timed(() => decodeTiff(tiff([...base, [270, 2, 0x7ffffff0, 8]].sort((x, y) => x[0] - y[0]) as [number, number, number, number][])));
  const exif = timed(() => decodeTiff(tiff([...base, [34665, 4, 1, 8]], 0, 16)));
  // LZW without its end code (UTIF's own decoder runs on for ever)
  const lzwOpen = (() => {
    const f = tiff([...base.slice(0, 3), [259, 3, 1, 5], ...base.slice(4, 7), [279, 4, 1, 3]], 0, 16);
    f.set([0x80, 0x00, 0x20], 8 + 2 + 8 * 12 + 4); // clear, 0, 1 … and no end
    return timed(() => decodeTiff(f));
  })();
  const cut = timed(() => decodeTiff(tiff(base).slice(0, 20)));
  const rubbish = timed(() => decodeTiff(new Uint8Array([0x49, 0x49, 42, 0, 0xff, 0xff, 0xff, 0x7f, 1, 2, 3])));
  check(
    'crafted TIFFs: 40 billion pixels, a file cut short, rubbish, a billion strips, a 4 GB strip: each refused in well under a second',
    [huge, cut, rubbish, many, bigStrip].every((r) => r.v === null && r.ms < 1000),
    [huge, cut, rubbish, many, bigStrip].map((r) => `${r.v === null ? 'null' : 'decoded'} ${r.ms} ms`).join(', '),
  );
  check(
    'crafted TIFFs that stay readable: pages in a loop (cut there), a 2 GB text tag (emptied), EXIF pointing at itself (not followed), LZW with no end code (stops at the strip’s size): each done in well under a second',
    [loop, ascii, exif, lzwOpen].every((r) => r.ms < 1000),
    [loop, ascii, exif, lzwOpen].map((r) => `${r.v === null ? 'null' : 'decoded'} ${r.ms} ms`).join(', '),
  );
  // layouts Pillow does not write (tifffile, scripts/make_tiff_cases.py): tiles with the predictor, 16-bit big-endian, small palettes, alpha, CMYK 16-bit
  const tdir = FIX('tiff');
  const tpairs: string[] = [];
  const tnull: string[] = [];
  for (const f of readdirSync(tdir).filter((n) => n.endsWith('.tif')).sort()) {
    const bm = decodeTiff(new Uint8Array(readFileSync(path.join(tdir, f))));
    const ref = path.join(tdir, f.replace(/\.tif$/, '.png'));
    if (!existsSync(ref)) {
      if (bm) tnull.push(`${f} decoded`);
      continue;
    }
    if (!bm) {
      tnull.push(`${f} not decoded`);
      continue;
    }
    const got = path.join(dir, `${f}.png`);
    writeFileSync(got, encodePng(bm));
    tpairs.push(`${got}\t${ref}`);
  }
  let tdiff: Record<string, number> = {};
  try {
    tdiff = JSON.parse(
      execFileSync(
        'python3',
        [
          '-c',
          [
            'import sys,json',
            'from PIL import Image, ImageChops',
            'out={}',
            'for line in sys.stdin.read().splitlines():',
            '  a,b=line.split("\\t")',
            '  x=Image.open(a).convert("RGBA");y=Image.open(b).convert("RGBA")',
            '  out[a.rsplit("/",1)[1]]=-1 if x.size!=y.size else max(e[1] for e in ImageChops.difference(x,y).getextrema())',
            'print(json.dumps(out))',
          ].join('\n'),
        ],
        { input: tpairs.join('\n'), encoding: 'utf8' },
      ),
    );
  } catch (e) {
    tdiff = { error: -1 };
  }
  const tbad = Object.entries(tdiff).filter(([, d]) => d !== 0);
  check(
    `TIFF layouts from tifffile: ${Object.keys(tdiff).length} decode to exactly the original pixels (tiles with the predictor, 16-bit big-endian, 1- and 4-bit palettes, 4-bit grey, alpha, CMYK 16-bit); samples in separate planes refused`,
    Object.keys(tdiff).length >= 11 && tbad.length === 0 && tnull.length === 0,
    [...tbad.map(([k, d]) => `${k}: ${d}`), ...tnull].join(', ') || 'all exact',
  );
  // a large tiled picture with the predictor: the work is per tile, not per tile × picture (it took seconds to minutes)
  const bigTiled = (() => {
    const W2 = 2400, T = 256, n = Math.ceil(W2 / T) ** 2, tileBytes = T * T * 3;
    const entries: [number, number, number, number][] = [
      [256, 4, 1, W2],
      [257, 4, 1, W2],
      [258, 3, 3, 0],
      [259, 3, 1, 1],
      [262, 3, 1, 2],
      [277, 3, 1, 3],
      [317, 3, 1, 2],
      [322, 3, 1, T],
      [323, 3, 1, T],
      [324, 4, n, 0],
      [325, 4, n, 0],
    ];
    const ifdEnd = 8 + 2 + entries.length * 12 + 4;
    const bpsAt = ifdEnd, offsAt = bpsAt + 6, cntAt = offsAt + 4 * n, dataAt = cntAt + 4 * n;
    entries[2][3] = bpsAt;
    entries[9][3] = offsAt;
    entries[10][3] = cntAt;
    const f = tiff(entries, 0, dataAt - ifdEnd + n * tileBytes);
    const v = new DataView(f.buffer);
    for (let k = 0; k < 3; k++) v.setUint16(bpsAt + 2 * k, 8, true);
    for (let k = 0; k < n; k++) {
      v.setUint32(offsAt + 4 * k, dataAt + k * tileBytes, true);
      v.setUint32(cntAt + 4 * k, tileBytes, true);
      f[dataAt + k * tileBytes] = 200; // the first pixel of each tile red, the predictor carries it along the row
    }
    return f;
  })();
  const big = timed(() => decodeTiff(bigTiled));
  const bigBm = big.v as { rgba: Uint8Array; w: number } | null;
  check(
    'a 2400×2400 tiled TIFF with the predictor decodes in well under the worker’s limit, each tile’s rows right',
    !!bigBm && bigBm.w === 2400 && big.ms < 3000 && bigBm.rgba[(10 * 2400 + 300) * 4] === 0 && bigBm.rgba[255 * 4] === 200 && bigBm.rgba[256 * 4] === 200 && bigBm.rgba[2400 * 4] === 0,
    `${big.ms} ms`,
  );
  // …and a document holding one opens, with the picture named
  const files = unzipSync(raw);
  const target = Object.keys(files).find((n) => n.endsWith('/a.tif'))!;
  files[target] = hugeTiff;
  const evil = pics(await readDocx(zipSync(files), 'evil.docx', { dom, imageUrl: (b, mime) => `data:${mime};n=${b.length}` }));
  check('a document with such a TIFF opens; that picture is named “Hình (TIFF)”, the others show', evil[0]?.chip === 'Hình (TIFF)' && evil.filter((p) => p.kind === 'image').length === 22, evil[0]?.chip);
}

/** Font and size picked in the editor, written as Word writes them (0.8.2). */
async function fontCases() {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const ed = new Ed(await open('word-a.docx'));
  const fontsListed = ed.model.fonts;
  ed.sel('Đoạn mở đầu');
  ed.run(setFont('Arial'));
  ed.run(setSize(18));
  ed.sel('chữ đỏ cỡ 14');
  ed.run(setSize(10.5));
  ed.caretAfter('Đoạn cuối của tài liệu.');
  ed.run(setFont('Times New Roman'));
  ed.type(' Chữ Times.');
  // a font name that tries to break out of the attribute or the CSS
  ed.sel('Bước ba');
  const evilOk = ed.run(setFont('x"/><w:b/>;}body{color:red'));
  const xml = buildDocumentXml(ed.model, ed.state.doc);
  const x = new DOMParser().parseFromString(xml, 'application/xml');
  const runOf = (needle: string) => {
    const rs = x.getElementsByTagNameNS(W, 'r');
    for (let i = 0; i < rs.length; i++) if ((rs[i].textContent ?? '').includes(needle)) return rs[i];
    return null;
  };
  const props = (needle: string) => {
    const r = runOf(needle);
    const pr = r ? (Array.from(r.childNodes).find((n) => (n as unknown as Element).localName === 'rPr') as unknown as Element | undefined) : undefined;
    if (!pr) return null;
    const kids = Array.from(pr.childNodes).filter((n) => n.nodeType === 1) as Element[];
    const f = kids.find((k) => k.localName === 'rFonts');
    return {
      order: kids.map((k) => k.localName).join(','),
      fonts: f ? Array.from(f.attributes).map((a) => `${a.localName}=${a.value}`).sort().join(' ') : '',
      sz: kids.filter((k) => k.localName === 'sz' || k.localName === 'szCs').map((k) => k.getAttributeNS(W, 'val')).join(','),
    };
  };
  const a = props('Đoạn mở đầu');
  const red = props('chữ đỏ cỡ 14');
  const times = props('Chữ Times.');
  check(
    'a font picked: w:rFonts with ascii, hAnsi, East Asian and complex-script all that font (no theme font left); a size: w:sz and w:szCs in half-points',
    a?.fonts === 'ascii=Arial cs=Arial eastAsia=Arial hAnsi=Arial' && a.sz === '36,36' && times?.fonts === 'ascii=Times New Roman cs=Times New Roman eastAsia=Times New Roman hAnsi=Times New Roman',
    JSON.stringify({ a, times }),
  );
  check('a run that had 14 pt: one w:sz (21 half-points), its colour kept, the order Word requires', red?.sz === '21,21' && /color/.test(red.order) && red.order.indexOf('color') < red.order.indexOf('sz'), JSON.stringify(red));
  const evil = props('Bước ba');
  check('a crafted font name is refused: the command does nothing, the run keeps its own properties', !evilOk && !/rFonts/.test(evil?.order ?? ''), JSON.stringify({ evilOk, evil }));
  check('the document’s fonts are offered (theme fonts first), not symbol or East Asian ones', fontsListed.length > 0 && !fontsListed.some((f) => /symbol|wingdings|[　-鿿＀-￯]/i.test(f)), fontsListed.join(', '));
  // a theme font replaced
  const raw = new Uint8Array(readFileSync(FIX('word-a.docx')));
  const files = unzipSync(raw);
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']).replace(/(<w:r>)(<w:t[^>]*>Đoạn mở đầu)/, '$1<w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" w:hint="eastAsia"/><w:sz w:val="22"/></w:rPr>$2'),
  );
  const ed2 = new Ed(await readDocx(zipSync(files), 'theme.docx', { dom, imageUrl: (b, mime) => `data:${mime};n=${b.length}` }));
  ed2.sel('Đoạn mở đầu');
  ed2.run(setFont('Cambria'));
  const x2 = buildDocumentXml(ed2.model, ed2.state.doc);
  const r2 = x2.slice(x2.lastIndexOf('<w:r>', x2.indexOf('Đoạn mở đầu')), x2.indexOf('Đoạn mở đầu'));
  check('a run in a theme font, given Cambria: the theme attributes and hint go, its size stays', /w:ascii="Cambria"/.test(r2) && !/Theme=|w:hint/.test(r2) && /<w:sz w:val="22"\/>/.test(r2), r2.replace(/\s+/g, ' ').slice(0, 200));
  // python-docx reads them
  const out = path.join(OUT, 'fonts.docx');
  writeFileSync(out, writeDocx(ed.model, ed.state.doc));
  const py = execFileSync(
    'python3',
    ['-c', 'import sys,docx;d=docx.Document(sys.argv[1]);rs=[r for p in d.paragraphs for r in p.runs];a=[r for r in rs if "Đoạn mở đầu" in r.text][0];t=[r for r in rs if "Chữ Times" in r.text][0];print(a.font.name,a.font.size.pt,t.font.name)', out],
    { encoding: 'utf8' },
  ).trim();
  check('python-docx reads the font and size back', py === 'Arial 18.0 Times New Roman', py);
}

/** Pages, tab stops, fields and MathType's fonts (0.8.3). */
async function pageCases() {
  const store = new Map<string, { mime: string; b: Uint8Array }>();
  const m = await readDocx(new Uint8Array(readFileSync(FIX('word-pages.docx'))), 'word-pages.docx', {
    dom,
    imageUrl: (b, mime) => {
      const u = `img:${store.size}`;
      store.set(u, { mime, b });
      return u;
    },
  });
  const para = (needle: string) => {
    let hit: PMNode | null = null;
    m.doc.descendants((n) => {
      if (hit) return false;
      if (n.type === schema.nodes.paragraph && n.textContent.includes(needle)) hit = n;
      return !hit;
    });
    return hit as PMNode | null;
  };
  const tabsOf = (needle: string) => para(needle)?.attrs.tabs;
  check(
    'tab stops: a paragraph’s own (four left stops), a right stop with dots, centre and right, and a style’s stops with one added and one cleared',
    tabsOf('A. 19.') === 'l14.15 l141.75 l269.3 l396.85' && tabsOf('Họ và tên') === 'r450.' && tabsOf('Giữa trang') === 'c240.95 r481.9' && tabsOf('Kiểu') === 'l141.75 l396.85' && m.defaultTab === 36,
    JSON.stringify({ a: tabsOf('A. 19.'), r: tabsOf('Họ và tên'), c: tabsOf('Giữa trang'), s: tabsOf('Kiểu'), d: m.defaultTab }),
  );
  check(
    'page starts: “page break before”; a section break starts a new page when the next section says so (not when it is continuous); the page break is a mark of its own',
    para('ngắt trang trước đoạn')?.attrs.breakBefore === true &&
      para('Cuối section một')?.attrs.newPage === true &&
      para('Cuối section hai')?.attrs.newPage === false &&
      (() => {
        let found = false;
        para('HẾT')?.forEach((c) => (found ||= c.type === schema.nodes.inl && c.attrs.label === PAGE_BREAK));
        return found;
      })(),
  );
  check(
    'page margins for the header and footer read; the footer’s PAGE and NUMPAGES fields are marked for each page’s number',
    Math.abs(m.page.header - 28.35) < 0.01 && Math.abs(m.page.footer - 28.35) < 0.01 && /<span data-ezpage="">1<\/span>/.test(m.footerHtml) && /<span data-ezpages="">1<\/span>/.test(m.footerHtml) && /đầu trang/.test(m.headerHtml),
    m.footerHtml.replace(/<[^>]*style="[^"]*"/g, '<').slice(0, 200),
  );
  const q = para('Trước trường');
  let mathShown = false, hiddenKept = 0;
  q?.forEach((c) => {
    if (c.type === schema.nodes.inl && c.attrs.kind === 'math') mathShown = true;
    if (c.type === schema.nodes.inl && c.attrs.kind === 'hidden') hiddenKept++;
  });
  check('an equation inside a QUOTE field’s instruction is not shown (Word does not show it), and is kept', q?.textContent === 'Trước trường sau trường.' && !mathShown && hiddenKept >= 5, `${q?.textContent} · hidden ${hiddenKept}`);
  // edited, the paragraph keeps the field and its equation
  const ed = new Ed(m);
  ed.caretAfter('sau trường.');
  ed.type(' Thêm.');
  const x = buildDocumentXml(ed.model, ed.state.doc);
  const pq = x.slice(x.lastIndexOf('<w:p', x.indexOf('Trước trường')), x.indexOf('</w:p>', x.indexOf('Trước trường')));
  check('…and an edited paragraph writes the field back whole, equation included', /QUOTE/.test(pq) && /<m:oMath>/.test(pq) && /fldCharType="separate"/.test(pq) && /Thêm\./.test(pq));
  // the MathType picture: Symbol with the default character set and MT Extra become Unicode; the two arrows are drawn apart
  const svg = [...store.values()].filter((v) => v.mime === 'image/svg+xml').map((v) => strFromU8(v.b)).find((t) => t.includes('<text')) ?? '';
  const arrows = /<path d="([^"]+)" fill="none" stroke="[^"]+" stroke-width="[^"]+" stroke-linecap="round"/.exec(svg)?.[1] ?? '';
  check(
    'MathType’s fonts as MathType asks for them: Symbol (default character set) gives ≥ and ∈, MT Extra gives ℝ; no Latin-1 stand-ins (³ Î ¡)',
    svg.includes('≥') && svg.includes('∈') && svg.includes('ℝ') && !/[³Î¡]/.test(svg),
    svg.slice(0, 160),
  );
  check('the arrows of two vectors in one MT Extra string are drawn as two arrows, each over its letter', (arrows.match(/H/g) ?? []).length === 2, arrows.slice(0, 160));

  // fields in odd places (the review of 0.8.3): nothing after them must disappear
  const raw = new Uint8Array(readFileSync(FIX('word-pages.docx')));
  const crafted = (body: string, footer?: string) => {
    const files = unzipSync(raw);
    const x = strFromU8(files['word/document.xml']);
    files['word/document.xml'] = strToU8(x.replace(/(<w:body>)[^]*(<w:sectPr>(?:(?!<w:sectPr>)[^])*<\/w:body>)/, `$1${body}$2`));
    if (footer) files['word/footer1.xml'] = strToU8(strFromU8(files['word/footer1.xml']).replace(/<w:p>[^]*<\/w:p>/, footer));
    return readDocx(zipSync(files), 'fields.docx', { dom, imageUrl: (b, mime) => `data:${mime};n=${b.length}` });
  };
  const fc = (t: string) => `<w:r><w:fldChar w:fldCharType="${t}"/></w:r>`;
  const it = (t: string) => `<w:r><w:instrText xml:space="preserve">${t}</w:instrText></w:r>`;
  const tx = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
  const nested = await crafted(`<w:p>${fc('begin')}${it(' IF ')}${fc('begin')}${it(' MERGEFIELD x ')}${fc('separate')}${tx('INNER')}${fc('end')}${it(' = "1" "yes" "no" ')}${fc('separate')}${tx('yes')}${fc('end')}</w:p><w:p>${tx('Sau.')}</w:p>`);
  const smart = await crafted(`<w:p>${fc('begin')}${it(' REF x ')}<w:smartTag w:uri="u" w:element="e">${fc('separate')}${tx('kết quả')}${fc('end')}</w:smartTag>${tx(' đuôi')}</w:p><w:p>${tx('Đoạn sau.')}</w:p>`);
  const unended = await crafted(`<w:p>${fc('begin')}${it(' PAGE ')}${tx('một')}</w:p><w:p>${tx('Hai')}</w:p><w:p>${tx('Ba')}</w:p>`);
  const ifPage = await crafted(`<w:p>${tx('Thân')}</w:p>`, `<w:p>${fc('begin')}${it(' IF ')}${fc('begin')}${it(' PAGE ')}${fc('separate')}${tx('1')}${fc('end')}${it(' = 1 "" "Tiếp" ')}${fc('separate')}${tx('')}${fc('end')}${tx('Chân')}</w:p>`);
  const tn = (m: WordModel) => texts(m.doc).join('|');
  check(
    'fields in odd places: a field in another field’s instruction shows nothing of its own; a separator inside a smart tag still ends the instruction; a begin never ended does not hide what follows; a PAGE inside an IF’s instruction is no page number',
    tn(nested) === 'yes|Sau.' && tn(smart) === 'kết quả đuôi|Đoạn sau.' && tn(unended) === 'một|Hai|Ba' && !/data-ezpage/.test(ifPage.footerHtml) && /Chân/.test(ifPage.footerHtml),
    JSON.stringify({ nested: tn(nested), smart: tn(smart), unended: tn(unended), foot: ifPage.footerHtml.replace(/<[^>]+>/g, '') }),
  );
  // a crafted page size stays within what Word accepts
  const files = unzipSync(raw);
  files['word/document.xml'] = strToU8(strFromU8(files['word/document.xml']).replace(/<w:pgSz [^>]*\/>(<w:pgMar [^>]*\/>)(?=(?:(?!<w:sectPr>)[^])*<\/w:body>)/, '<w:pgSz w:w="99999999" w:h="1"/><w:pgMar w:top="90000" w:right="0" w:bottom="90000" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>'));
  const tiny = await readDocx(zipSync(files), 'tiny.docx', { dom, imageUrl: () => null });
  // fonts a phone lacks: the same widths under another name; Calibri's own single line
  const stacks = { pal: fontStack('Palatino Linotype'), times: fontStack('Times'), helv: fontStack('Helvetica'), cal: fontStack('Calibri') };
  const lh = (font: string, line?: number) => /line-height:([\d.]+)/.exec(paraCss({ line, lineRule: line ? 'auto' : undefined }, { font }))?.[1];
  check(
    'font stacks: Palatino Linotype falls back to Palatino (iPhone) and Book Antiqua, Times to Times New Roman, Helvetica to Arial; Calibri’s single line is 1.2207 em as in Word, Times New Roman’s 1.15, a 1.5 line Calibri paragraph 1.831',
    stacks.pal === '"Palatino Linotype", "Palatino", "Book Antiqua", serif' && stacks.times === '"Times", "Times New Roman", serif' && !!stacks.helv?.startsWith('"Helvetica", "Arial", "ezPDF Sans VN"') &&
      stacks.cal === '"Calibri", "ezPDF Sans VN", sans-serif' && lh('Calibri') === '1.2207' && lh('Times New Roman') === '1.15' && lh('Calibri', 360) === '1.831',
    JSON.stringify({ stacks, cal: lh('Calibri'), tnr: lh('Times New Roman'), cal15: lh('Calibri', 360) }),
  );
  // the sample exam of 0.8.5 (ĐỀ KHẢO SÁT): Word's text font from the Normal style, MathType's wide hats, a picture with a mask, floating pictures
  {
    const files = unzipSync(raw);
    files['word/styles.xml'] = strToU8(
      strFromU8(files['word/styles.xml']).replace(
        /(<w:style w:type="paragraph" w:default="1" w:styleId="Normal">[^]*?)(<\/w:style>)/,
        '$1<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/></w:rPr>$2',
      ),
    );
    const rp = '<w:rPr><w:rFonts w:cs="Times New Roman"/><w:b/></w:rPr>';
    const x = strFromU8(files['word/document.xml']);
    files['word/document.xml'] = strToU8(x.replace(/(<w:body>)[^]*(<w:sectPr>(?:(?!<w:sectPr>)[^])*<\/w:body>)/, `$1<w:p><w:pPr>${rp}</w:pPr><w:r>${rp}<w:t>Chỉ có w:cs</w:t></w:r></w:p>$2`));
    const m = await readDocx(zipSync(files), 'cs.docx', { dom, imageUrl: () => null });
    const css = String(m.doc.firstChild?.attrs.css ?? '');
    check('a run’s w:rFonts that names only w:cs (as Word writes for Vietnamese) leaves the Normal style’s Times New Roman in place', /font-family:"Times New Roman"/.test(css), css);
  }
  {
    // a WMF as MathType writes it: B̂ (hat b5 over B), and B̂AC (hat b7 over three letters)
    const recs: number[][] = [];
    const rec = (fn: number, ...words: number[]) => recs.push([3 + words.length, fn, ...words]);
    const str = (t: number[]) => { const w: number[] = []; for (let i = 0; i < t.length; i += 2) w.push(t[i] | ((t[i + 1] ?? 0) << 8)); return w; };
    const font = (h: number, italic: number, charset: number, face: string) => {
      const name = [...face].map((c) => c.charCodeAt(0)).concat(Array(32 - face.length).fill(0));
      rec(0x02fb, h & 0xffff, 0, 0, 0, 400, italic | (0 << 8), 0 | (charset << 8), 0 | (0 << 8), 0 | (0x12 << 8), ...str(name));
      rec(0x012d, recs.filter((r) => r[1] === 0x02fb).length - 1);
    };
    const text = (x: number, y: number, codes: number[], dx: number[]) => {
      rec(0x0214, y, x);
      rec(0x0a32, 0, 0, codes.length, 0, ...str(codes), ...dx);
    };
    rec(0x020b, 0, 0);
    rec(0x020c, 640, 2816);
    rec(0x012e, 25);
    font(-384, 0, 1, 'MT Extra');
    text(82, 348, [0xb7], [0]);
    text(1114, 348, [0xb5], [0]);
    font(-384, 1, 0, 'Times New Roman');
    text(70, 480, [0x42, 0x41, 0x43], [234, 234, 768]);
    text(1110, 480, [0x42], [768]);
    rec(0x0000);
    const body = recs.flatMap((r) => [r[0] & 0xffff, r[0] >> 16, ...r.slice(1)]);
    const words = [0x0001, 0x0009, 0x0300, (9 + body.length) & 0xffff, (9 + body.length) >> 16, 2, 40, 0, 0, ...body];
    const place = [0xcdd7, 0x9ac6, 0, 0, 0, 2816, 640, 2305, 0, 0];
    place.push(place.reduce((a, b) => a ^ b, 0));
    const bytes = new Uint8Array((place.length + words.length) * 2);
    const dv = new DataView(bytes.buffer);
    [...place, ...words].forEach((w, i) => dv.setUint16(i * 2, w & 0xffff, true));
    const svg = metafileToSvg(bytes)?.inner ?? '';
    const hats = [...svg.matchAll(/<path d="([^"]+)" fill="none"[^>]*stroke-linejoin="miter"/g)].map((mm) => mm[1]);
    // the wide one spans three letters (about 1.9 em), the narrow one one letter
    const span = (d: string) => {
      const xs = [...d.matchAll(/[ML](-?[\d.]+),/g)].map((mm) => Number(mm[1]));
      return Math.max(...xs) - Math.min(...xs);
    };
    check(
      'MathType’s wide hats (MT Extra b5, b7: B̂, B̂AC) are drawn as strokes over the letters (the wide one about three times the narrow one), not as “\uFFFD”',
      !svg.includes('\uFFFD') && hats.length === 2 && span(hats[0]) > 2.5 * span(hats[1]) && /BAC/.test(svg),
      hats.join(' | ') || svg.slice(0, 200),
    );
  }
  {
    // 0.8.6: MathType's tall brackets, built from Symbol's pieces, and a bracket made taller with a narrower font (lfWidth)
    const recs: number[][] = [];
    const rec = (fn: number, ...words: number[]) => recs.push([3 + words.length, fn, ...words]);
    const str = (t: number[]) => { const w: number[] = []; for (let i = 0; i < t.length; i += 2) w.push(t[i] | ((t[i + 1] ?? 0) << 8)); return w; };
    const font = (h: number, width: number, face: string) => {
      const name = [...face].map((c) => c.charCodeAt(0)).concat(Array(32 - face.length).fill(0));
      rec(0x02fb, h & 0xffff, width, 0, 0, 400, 0, 1 << 8, 0, 0x12 << 8, ...str(name));
      rec(0x012d, recs.filter((r) => r[1] === 0x02fb).length - 1);
    };
    const text = (x: number, y: number, codes: number[], dx: number[]) => {
      rec(0x0214, y, x);
      rec(0x0a32, 0, 0, codes.length, 0, ...str(codes), ...dx);
    };
    rec(0x020b, 0, 0);
    rec(0x020c, 1344, 3296);
    rec(0x012e, 25);
    // (AB/AC) as MathType writes it: top, extender and bottom of both parentheses
    font(-384, 0, 'Symbol');
    text(100, 524, [0xe6, 0xf6], [844, 768]);
    text(100, 839, [0xe7, 0xf7], [844, 768]);
    text(100, 1080, [0xe8, 0xf8], [844, 768]);
    // a brace of two lines: top, extenders, middle, bottom
    for (const [y, k] of [[352, 0xec], [420, 0xef], [624, 0xef], [813, 0xed], [1025, 0xef], [1271, 0xef], [1280, 0xee]]) text(1400, y, [k], [768]);
    // a piece in a string with other characters, as MathType also writes them ("+⎟=")
    text(2000, 1200, [0x2b, 0xf7, 0x3d], [400, 400, 768]);
    // a parenthesis 1.42 times the text's height, as narrow as at the text's size
    font(-545, 246, 'Symbol');
    text(2400, 900, [0x28], [0]);
    rec(0x0000);
    const body = recs.flatMap((r) => [r[0] & 0xffff, r[0] >> 16, ...r.slice(1)]);
    const words = [0x0001, 0x0009, 0x0300, (9 + body.length) & 0xffff, (9 + body.length) >> 16, 2, 40, 0, 0, ...body];
    const place = [0xcdd7, 0x9ac6, 0, 0, 0, 3296, 1344, 2304, 0, 0];
    place.push(place.reduce((a, b) => a ^ b, 0));
    const bytes = new Uint8Array((place.length + words.length) * 2);
    const dv = new DataView(bytes.buffer);
    [...place, ...words].forEach((w, i) => dv.setUint16(i * 2, w & 0xffff, true));
    const svg = metafileToSvg(bytes)?.inner ?? '';
    // every piece is a shape: its vertical extent, and its left edge
    const shapes = [...svg.matchAll(/<path d="([^"]+)" fill="#000000"\/>/g)].flatMap((mm) => mm[1].split(/ (?=M)/));
    const extent = (d: string) => {
      const pts = [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((q) => [Number(q[1]), Number(q[2])]);
      return { x: Math.min(...pts.map((q) => q[0])), y0: Math.min(...pts.map((q) => q[1])), y1: Math.max(...pts.map((q) => q[1])) };
    };
    const ext = shapes.map(extent);
    const unbroken = (list: { y0: number; y1: number }[]) => {
      const sorted = [...list].sort((a, b) => a.y0 - b.y0);
      return sorted.length > 1 && sorted.every((e, i) => i === 0 || e.y0 <= sorted[i - 1].y1 + 0.01);
    };
    const r = metafileToSvg(bytes)!;
    const unitY = r.h / 1344;
    const unitX = r.w / 3296;
    const leftParen = ext.filter((e) => e.x < 500 * unitX);
    const rightParen = ext.filter((e) => e.x >= 500 * unitX && e.x < 1300 * unitX);
    const brace = ext.filter((e) => e.x > 1300 * unitX && e.x < 2000 * unitX);
    check(
      'MathType’s tall parentheses and braces (Symbol e6–f8, ec–ef) are drawn as shapes that join with no gap, the same on every device, also a piece in a string with other characters (+⎟=); no bracket-piece character is left to the device’s fonts',
      !/[\u239b-\u23ad]/.test(svg) && shapes.length === 14 && />\+=<\/text>/.test(svg) && leftParen.length === 3 && unbroken(leftParen) && rightParen.length === 3 && unbroken(rightParen) && brace.length === 7 && unbroken(brace),
      `${shapes.length} shapes; parenthesis ${leftParen.map((e) => `${(e.y0 / unitY) | 0}–${(e.y1 / unitY) | 0}`).join(' ')}; brace ${brace.map((e) => `${(e.y0 / unitY) | 0}–${(e.y1 / unitY) | 0}`).join(' ')}`,
    );
    const squeezed = svg.match(/<text x="[\d.]+" [^>]*transform="matrix\(([\d.]+) 0 0 1 [-\d.]+ 0\)"[^>]*>\(<\/text>/);
    check(
      'a parenthesis MathType makes taller with a font width (lfWidth 246 at 545) is drawn about as narrow as at the text’s size (×0.76), not 1.4 times as wide',
      !!squeezed && Math.abs(Number(squeezed[1]) - 0.764) < 0.02,
      squeezed?.[0] ?? svg.slice(-300),
    );
  }
  {
    // an EMF picture with a mask (OR), then the picture (AND), then a BitBlt that does nothing (NOP)
    const parts: Uint8Array[] = [];
    const u32 = (...v: number[]) => { const b = new Uint8Array(v.length * 4); const d = new DataView(b.buffer); v.forEach((x, i) => d.setInt32(i * 4, x | 0, true)); return b; };
    const join = (...a: Uint8Array[]) => { const out = new Uint8Array(a.reduce((n, b) => n + b.length, 0)); let o = 0; for (const b of a) { out.set(b, o); o += b.length; } return out; };
    const bih = (w: number, h: number, bpp: number, colors: number) => u32(40, w, h, 1 | (bpp << 16), 0, 0, 0, 0, colors, 0);
    const dib = (rop: number, bmi: Uint8Array, bits: Uint8Array) => {
      const head = 80;
      return join(u32(81, head + bmi.length + bits.length, 0, 0, 20, 20, 0, 0, 0, 0, 2, 2, head, bmi.length, head + bmi.length, bits.length, 0, rop, 20, 20), bmi, bits);
    };
    // the mask: black (keep the page) on the left, white on the right; the picture: white (keep the page) on the left, red on the right
    const mask = dib(0x00ee0086, join(bih(2, 2, 1, 2), u32(0x000000, 0xffffff)), u32(0x40000000 >>> 0, 0x40000000 >>> 0).map((b, i, a) => a[i ^ 3]));
    const pic = dib(0x008800c6, bih(2, 2, 24, 0), new Uint8Array([255, 255, 255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0]));
    const nop = join(u32(76, 100, 0, 0, 20, 20, 0, 0, 20, 20, 0x00aa0029), new Uint8Array(100 - 44));
    const eof = u32(14, 20, 0, 0, 20);
    const header = join(u32(1, 108, 0, 0, 20, 20, 0, 0, 529, 529, 0x464d4520, 0x10000, 0, 5, 1, 0, 0, 0, 0, 1000, 1000, 264, 264), new Uint8Array(108 - 92));
    parts.push(header, mask, pic, nop, eof);
    const emf = join(...parts);
    new DataView(emf.buffer).setUint32(48, emf.length, true);
    const svg = metafileToSvg(emf)?.inner ?? '';
    const pngs = [...svg.matchAll(/href="data:image\/png;base64,([^"]+)"/g)].map((mm) => Buffer.from(mm[1], 'base64'));
    check(
      'an EMF picture drawn with a mask (OR, then AND) comes out transparent where it leaves the page as it was (two PNGs with alpha), and a BitBlt that does nothing (NOP) does not paint a white box over the drawing',
      pngs.length === 2 && pngs.every((b) => b[25] === 6) && !/fill="#ffffff"/.test(svg),
      `${pngs.length} PNG, colour types ${pngs.map((b) => b[25]).join(',')}, white fill ${/fill="#ffffff"/.test(svg)}`,
    );
  }
  {
    // floating pictures text runs round: a float on their side, kept at their size, reaching past a narrow table cell
    const anchor = (off: number, cx: number) =>
      `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>${off}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="1240790"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="5" name="P"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="p"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdW1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="1240790"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`;
    const cell = (w: number, inner: string) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr><w:p>${inner}</w:p></w:tc>`;
    const fl = await crafted(
      `<w:p>${anchor(4600909, 2047875)}${tx('Chữ chạy quanh hình bên phải.')}</w:p><w:p>${anchor(0, 1000000)}${tx('Hình bên trái.')}</w:p>` +
        `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="6487"/><w:gridCol w:w="3089"/></w:tblGrid><w:tr>${cell(6487, tx('Đề bài'))}${cell(3089, anchor(68580, 2457450))}</w:tr></w:tbl>`,
    );
    const floats: string[] = [];
    fl.doc.descendants((n) => {
      if (n.type.name === 'inl' && n.attrs.kind === 'image') floats.push(String(n.attrs.css));
      return true;
    });
    const mr = Number(/float:left;margin:\S+ (-?\d+)px/.exec(floats[2] ?? '')?.[1]);
    check(
      'floating pictures text runs round (wrap square): a float on the right when placed past the middle, on the left at the column’s start, their own size; in a narrow table cell a wider picture reaches past it (negative margin) instead of widening the column',
      floats.length === 3 && /^float:right/.test(floats[0]) && /^float:left/.test(floats[1]) && floats.every((c) => /max-width:none/.test(c)) && /^float:left/.test(floats[2]) && mr < 0,
      floats.join(' | '),
    );
  }
  check(
    'a crafted page size (one twip high, ten metres wide, margins larger than the page) is held within Word’s limits',
    tiny.page.height >= 7.2 && tiny.page.width <= 1584 && tiny.page.top + tiny.page.bottom < tiny.page.height,
    JSON.stringify(tiny.page),
  );
}

/** 0.8.6: what the information panel says about a file: where it is (Android's addresses), and a Word file's own properties */
async function fileInfoCases() {
  const ext = 'content://com.android.externalstorage.documents';
  const cases: [string, string | undefined, { path?: string; from?: string; browsable: boolean }][] = [
    [`${ext}/document/primary%3ADownload%2FDe%20thi%20to%C3%A1n.docx`, undefined, { path: '/storage/emulated/0/Download/De thi toán.docx', browsable: true }],
    [`${ext}/tree/1A2B-3C4D%3ATai%20lieu/document/1A2B-3C4D%3ATai%20lieu%2Fa.pdf`, undefined, { path: '/storage/1A2B-3C4D/Tai lieu/a.pdf', browsable: true }],
    [`${ext}/document/home%3Abao%20cao.pdf`, undefined, { path: '/storage/emulated/0/Documents/bao cao.pdf', browsable: true }],
    ['content://com.android.providers.downloads.documents/document/raw%3A%2Fstorage%2Femulated%2F0%2FDownload%2Fa.pdf', undefined, { path: '/storage/emulated/0/Download/a.pdf', browsable: true }],
    ['content://com.android.providers.downloads.documents/document/msf%3A1000012345', 'Downloads', { from: 'Tải xuống (Download)', browsable: true }],
    ['content://com.google.android.apps.docs.storage/document/acc%3D1%3Bdoc%3Dencoded%3Dabc', undefined, { from: 'Google Drive', browsable: true }],
    ['content://com.zing.zalo.provider/external/Zalo/a.pdf', 'Zalo', { from: 'Zalo', browsable: false }],
    // crafted: a path that climbs out, a volume that is not one, not a content address
    [`${ext}/document/primary%3A..%2F..%2Fdata%2Fdata`, undefined, { from: 'Bộ nhớ máy', browsable: true }],
    [`${ext}/document/%3Cimg%3E%3Ax.pdf`, undefined, { from: 'Bộ nhớ máy', browsable: true }],
    ['file:///sdcard/a.pdf', 'X', { browsable: false }],
  ];
  const same = (a: object, b: object) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  const wrong = cases.filter(([uri, label, want]) => !same(androidLocation(uri, label), want));
  check(
    'Android: the full path from the system storage’s addresses (phone, SD card, Documents, Downloads raw:); where it came from otherwise (Tải xuống, Google Drive, Zalo); a climbing or made-up path gives none',
    wrong.length === 0,
    wrong.map(([u, l]) => `${u} → ${JSON.stringify(androidLocation(u, l))}`).join(' | ') || `${cases.length} addresses`,
  );
  const cleaned = cleanSource({ path: '/storage/emulated/0/a.pdf', from: 5, uri: 'javascript:alert(1)', modified: 'soon', evil: '<b>' });
  check(
    'a stored file location is read back with its own fields only (no foreign address, no wrong types)',
    JSON.stringify(cleaned) === JSON.stringify({ path: '/storage/emulated/0/a.pdf' }) && cleanSource('x') === undefined && cleanSource({}) === undefined,
    JSON.stringify(cleaned),
  );

  // a Word file's own properties: docProps/core.xml and app.xml, one date broken, a title that looks like markup
  const files = unzipSync(new Uint8Array(readFileSync(FIX('word-a.docx'))));
  files['docProps/core.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>&lt;img src=x onerror=alert(1)&gt; Đề   khảo sát</dc:title><dc:creator>Phượng</dc:creator><cp:lastModifiedBy>Phuong</cp:lastModifiedBy><cp:revision>5</cp:revision>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">2025-07-29T01:41:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">0001-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>',
  );
  files['docProps/app.xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application><Pages>8</Pages><Words>1667</Words></Properties>',
  );
  const m = await readDocx(zipSync(files), 'props.docx', { dom, imageUrl: () => null });
  const p = m.props;
  check(
    'a Word file’s properties are read as plain text and numbers (title, author, last saved by, revision, created, program, pages, words); a broken date is left out',
    p.title === '<img src=x onerror=alert(1)> Đề khảo sát' && p.creator === 'Phượng' && p.lastModifiedBy === 'Phuong' && p.revision === 5 &&
      p.created === Date.UTC(2025, 6, 29, 1, 41) && p.modified === undefined && p.application === 'Microsoft Office Word' && p.pages === 8 && p.words === 1667,
    JSON.stringify(p),
  );
  delete files['docProps/core.xml'];
  delete files['docProps/app.xml'];
  const bare = await readDocx(zipSync(files), 'bare.docx', { dom, imageUrl: () => null });
  check('a Word file without its property parts opens; it simply has no properties', Object.keys(bare.props).length === 0, JSON.stringify(bare.props));
}
