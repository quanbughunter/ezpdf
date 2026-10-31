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
import { schema } from '../src/word/schema';

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
