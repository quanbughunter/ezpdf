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
 * Usage: npm run test:word
 */
import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
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
import { backspace, del, deleteParagraphs, lineBreak, lockedGuard, splitParagraph, tableGuard, toggleBold, toggleItalic, toggleUnderline } from '../src/word/commands';
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
    'read-only: tracked change, equation, content control (3 blocks, each with its reason)',
    a.locked.count === 3 && ta[18] === '[locked]' && ta[19] === '[locked]' && ta[20] === '[locked]' && /theo dõi thay đổi/.test(a.doc.child(18).attrs.reason) && /<ins class="ez-wins">/.test(a.doc.child(18).attrs.html) && /<del class="ez-wdel">/.test(a.doc.child(18).attrs.html),
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
