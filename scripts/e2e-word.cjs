#!/usr/bin/env node
/**
 * Acceptance run for Word files (0.8.0), in real Chromium, on
 * tests/fixtures/word-a.docx (scripts/make_word_fixtures.py):
 *  - opening: file input; the Word screen covers the workspace; header and
 *    footer, list numbers, the table, the picture shown; read-only blocks
 *    marked and explained
 *  - editing with the keyboard and the toolbar: typing at a click, bold,
 *    italic (Ctrl I), underline, “Xóa đoạn”, Enter in a list (the next
 *    number), a table cell, Shift+Enter, Vietnamese typed through an input
 *    method (composition), undo/redo; a read-only block cannot be typed into
 *  - saving: “Lưu tệp Word” downloads “… (ezPDF).docx”; python-docx reads
 *    the edits and keeps the tracked change, equation, picture, link,
 *    bookmark, field (scripts/verify_word.py); LibreOffice opens it
 *  - leaving: unsaved changes are confirmed (stay / discard); a PDF opened
 *    from the Word screen; an old .doc explained
 *  - phone: the bar fits, a tap and typing edit, the table fits the page
 *  - nothing leaves the device; no page errors
 *
 * Usage: node scripts/e2e-word.cjs
 *        BASE=http://localhost:4173 node scripts/e2e-word.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out', 'e2e-word');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const FIX = (f) => path.join(ROOT, 'tests/fixtures', f);
const PROD = !!process.env.BASE;

const results = [];
let stepName = 'start';
function check(name, ok, detail = '') {
  stepName = name;
  results.push({ name, ok: !!ok, detail: String(detail ?? '') });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;
const benignRenderRace = (m) => m.type() === 'error' && /ERR_FILE_NOT_FOUND/.test(m.text()) && /^blob:/.test(m.location()?.url ?? '');

async function startServer() {
  if (PROD) return { base: process.env.BASE, stop() {} };
  const port = 5193;
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  const kill = () => {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {}
  };
  process.on('exit', kill);
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(base)).ok) {
        const b = await chromium.launch();
        const p = await b.newPage();
        await p.goto(base + '/?e2e');
        await p.waitForSelector(tid('state-empty'), { timeout: 60000 }).catch(() => {});
        await p.waitForTimeout(2000);
        await b.close();
        return { base, stop: kill };
      }
    } catch {}
    await sleep(200);
  }
  kill();
  throw new Error('vite did not start');
}

let onCrash = async () => {};

(async () => {
  const server = await startServer();
  const origin = new URL(server.base).origin;
  const browser = await chromium.launch();
  const errors = [];
  const requests = [];
  const track = (p) => {
    p.on('request', (r) => requests.push(r.url()));
    p.on('pageerror', (e) => errors.push(`${e.message} @${stepName}`));
    p.on('console', (m) => m.type() === 'error' && !benignRenderRace(m) && errors.push(`${m.text()} ${m.location()?.url ?? ''} @${stepName}`));
  };

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  track(page);
  onCrash = () => page.screenshot({ path: path.join(OUT, 'crash.png') });
  const texts = () => page.evaluate(() => window.__ezword.texts());
  const find = (s) => page.evaluate((s) => window.__ezword.find(s), s);
  const select = async (needle) => {
    const r = await find(needle);
    await page.evaluate(([a, b]) => window.__ezword.select(a, b), [r.from, r.to]);
  };
  const caretAfter = async (needle) => {
    const r = await find(needle);
    await page.evaluate((a) => window.__ezword.select(a), r.to);
  };
  const marksIn = async (needle) => {
    const r = await find(needle);
    return page.evaluate((p) => window.__ezword.marksAt(p).sort().join(','), r.from + 1);
  };
  const openWord = async (p, file) => {
    await p.setInputFiles(tid('file-input'), FIX(file));
    await p.waitForSelector(tid('word-editor'), { timeout: 30000 });
    await p.waitForFunction(() => !!window.__ezword, null, { timeout: 30000 });
    await sleep(300);
  };

  // ── 1. opening ──────────────────────────────────────────────────────────
  await page.goto(server.base + '/?e2e');
  await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
  const accept = await page.getAttribute(tid('file-input'), 'accept');
  check('the Open button takes PDF and Word files (.docx)', /\.pdf/.test(accept) && /\.docx/.test(accept), accept);
  await openWord(page, 'word-a.docx');
  const shown = await page.evaluate(() => ({
    markers: Array.from(document.querySelectorAll('.ez-wmarker')).map((m) => m.textContent).join(' '),
    rows: document.querySelectorAll('.ez-wtable tr').length,
    img: (() => {
      const i = document.querySelector('.ez-wimg');
      return i ? i.naturalWidth : 0;
    })(),
    header: document.querySelector('[data-testid="word-header"]')?.textContent ?? '',
    footer: document.querySelector('[data-testid="word-footer"]')?.textContent ?? '',
    locked: document.querySelectorAll('.ez-wlocked').length,
    name: document.querySelector('[data-testid="word-name"]')?.textContent,
  }));
  check(
    'the Word screen shows the document: list numbers, table, picture, header, footer',
    shown.markers === '• • 1. 2. 3.' && shown.rows === 3 && shown.img === 240 && /Đầu trang/.test(shown.header) && /Trang 1/.test(shown.footer) && shown.name === 'word-a.docx',
    JSON.stringify(shown),
  );
  const note = await page.textContent(tid('word-locked-note'));
  check('3 read-only blocks marked “Chỉ xem” and explained (tracked change, equation, content control)', shown.locked === 3 && /3 đoạn chỉ xem được/.test(note) && /theo dõi thay đổi/.test(note), note);
  await page.screenshot({ path: path.join(OUT, 'opened.png') });

  // ── 2. editing ──────────────────────────────────────────────────────────
  // a real click at the end of a paragraph, then the keyboard
  const last = page.locator('.ez-wdoc p', { hasText: 'Đoạn cuối của tài liệu.' });
  await last.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Thêm bằng bàn phím.');
  const t1 = await texts();
  check('a click and typing add text where the caret is; “Chưa lưu” shows', t1[t1.length - 1] === 'Đoạn cuối của tài liệu. Thêm bằng bàn phím.' && (await page.isVisible(tid('word-dirty'))), t1[t1.length - 1]);

  await select('Đoạn mở đầu');
  await page.click(tid('word-bold'));
  const boldPressed = await page.getAttribute(tid('word-bold'), 'aria-pressed');
  check('“Chữ đậm” bolds the selection and shows as pressed', (await marksIn('Đoạn mở đầu')).includes('b') && boldPressed === 'true', await marksIn('Đoạn mở đầu'));
  await select('chữ nghiêng');
  await page.keyboard.press('Control+i');
  check('Ctrl I takes italic off', !(await marksIn('chữ nghiêng')).includes('i'), await marksIn('chữ nghiêng'));
  await select('chữ đỏ cỡ 14');
  await page.click(tid('word-underline'));
  check('“Gạch chân” underlines, the red 14 pt formatting stays', (await marksIn('chữ đỏ cỡ 14')) === 'rp,u', await marksIn('chữ đỏ cỡ 14'));

  await caretAfter('Đoạn để xóa');
  await page.click(tid('word-delete-para'));
  check('“Xóa đoạn” removes the paragraph with the caret', !(await texts()).some((t) => t.includes('Đoạn để xóa')));

  await caretAfter('Bước ba');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Bước bốn');
  const markers2 = await page.evaluate(() => Array.from(document.querySelectorAll('.ez-wmarker')).map((m) => m.textContent).join(' '));
  check('Enter at the end of a list item gives the next number (4.)', markers2 === '• • 1. 2. 3. 4.' && (await texts()).includes('Bước bốn'), markers2);

  await select('Ô 2.1');
  await page.keyboard.type('Ô đã sửa');
  const cell = await page.evaluate(() => document.querySelectorAll('.ez-wtable tr')[1].querySelector('td').textContent);
  check('typing in a table cell edits that cell; the table keeps 3 rows', cell === 'Ô đã sửa' && (await page.evaluate(() => document.querySelectorAll('.ez-wtable tr').length)) === 3, cell);

  await caretAfter('Đoạn thứ hai căn giữa,');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('dòng mới trong đoạn');
  const brCount = await page.evaluate(() => document.querySelector('.ez-wdoc p[style*="center"]')?.querySelectorAll('br').length ?? 0);
  check('Shift+Enter breaks the line inside the paragraph', brCount >= 1 && (await texts()).some((t) => t.includes('căn giữa,dòng mới trong đoạn')));

  // Vietnamese through an input method: composition, then the committed text
  await caretAfter('Thêm bằng bàn phím.');
  const cdp = await ctx.newCDPSession(page);
  await page.keyboard.type(' ');
  for (const step of ['V', 'Vi', 'Viê', 'Việ']) {
    await cdp.send('Input.imeSetComposition', { text: step, selectionStart: step.length, selectionEnd: step.length });
    await sleep(30);
  }
  await cdp.send('Input.insertText', { text: 'Việt' });
  await sleep(700); // its own undo step
  const t2 = await texts();
  check('Vietnamese typed through an input method (composition) lands once, in place', t2[t2.length - 1].endsWith('Thêm bằng bàn phím. Việt'), t2[t2.length - 1]);

  // undo / redo
  await caretAfter('Thêm bằng bàn phím. Việt');
  await page.keyboard.type(' xyz');
  await sleep(600); // a new history event
  const withXyz = (await texts()).pop();
  await page.click(tid('word-undo'));
  const undone = (await texts()).pop();
  await page.click(tid('word-redo'));
  const redone = (await texts()).pop();
  await page.click(tid('word-undo'));
  check('↶ and ↷ undo and redo typing, one step at a time', withXyz.endsWith(' Việt xyz') && undone.endsWith(' Việt') && redone.endsWith(' Việt xyz'), `${withXyz} / ${undone} / ${redone}`);

  // a read-only block: selected as a whole, typing does not go into it
  const lockedBefore = await page.evaluate(() => document.querySelectorAll('.ez-wlocked')[0].textContent);
  await page.locator('.ez-wlocked').first().click();
  await page.keyboard.type('zzz');
  const lockedAfter = await page.evaluate(() => document.querySelectorAll('.ez-wlocked')[0]?.textContent);
  const stillThere = (await texts()).filter((t) => t === '[locked]').length;
  const selectedWhole = await page.evaluate(() => !!document.querySelector('.ez-wlocked.ProseMirror-selectednode'));
  check('a read-only block is selected as a whole by a click and is not typed into', selectedWhole && lockedAfter === lockedBefore && stillThere === 3, `${stillThere} read-only blocks`);

  // copy and paste inside the document: a page break and a picture come along as themselves
  const before = await page.evaluate(() => ({ img: document.querySelectorAll('.ez-wdoc img.ez-wimg').length, pb: [...document.querySelectorAll('.ez-wmark')].filter((m) => m.textContent === 'ngắt trang').length }));
  await select('Trước ngắt trang.');
  {
    const r1 = await find('Trước ngắt trang.');
    const r2 = await find('Sau ngắt trang.');
    await page.evaluate(([a, b]) => window.__ezword.select(a, b), [r1.from, r2.to]);
  }
  await page.keyboard.press('Control+c');
  await caretAfter('Thêm bằng bàn phím. Việt');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+v');
  await sleep(200);
  {
    const r1 = await find('Hình: ');
    await page.evaluate(([a, b]) => window.__ezword.select(a, b + 1), [r1.from, r1.to]);
  }
  await page.keyboard.press('Control+c');
  await caretAfter('Sau ngắt trang.');
  await page.keyboard.press('Control+v');
  await sleep(200);
  const after = await page.evaluate(() => ({ img: document.querySelectorAll('.ez-wdoc img.ez-wimg').length, pb: [...document.querySelectorAll('.ez-wmark')].filter((m) => m.textContent === 'ngắt trang').length }));
  const pastedTexts = await texts();
  check(
    'copy and paste inside the document: the page break and the picture are pasted as themselves, not as words',
    after.img === before.img + 1 && after.pb === before.pb + 1 && !pastedTexts.some((t) => /ngắt trangSau|trangngắt/.test(t)),
    `${JSON.stringify(before)} → ${JSON.stringify(after)}`,
  );
  // pasted from elsewhere (a web page): bold comes along, nothing else
  await caretAfter('Đoạn cuối của tài liệu.');
  await page.evaluate(() => window.__ezword.view.pasteHTML('<p>Chữ <b>đậm</b> dán từ web</p>'));
  check('pasted from a web page: the text and its bold', (await texts()).some((t) => t.includes('Chữ đậm dán từ web')) && (await marksIn('đậm dán')).includes('b'), await marksIn('đậm dán'));

  // ── 3. saving ───────────────────────────────────────────────────────────
  const dl = page.waitForEvent('download');
  await page.click(tid('word-save'));
  const d = await dl;
  const saved = path.join(OUT, 'saved.docx');
  await d.saveAs(saved);
  await page.waitForSelector(tid('word-saved'), { timeout: 10000 });
  const noticeText = await page.textContent(tid('word-notice'));
  check('“Lưu tệp Word” gives “word-a (ezPDF).docx”; the state shows “Đã lưu”', d.suggestedFilename() === 'word-a (ezPDF).docx' && /Đã tải về/.test(noticeText), `${d.suggestedFilename()} — ${noticeText}`);
  const expect = path.join(OUT, 'saved.expect.json');
  fs.writeFileSync(
    expect,
    JSON.stringify({
      bold: ['Đoạn mở đầu'],
      notItalic: ['chữ nghiêng'],
      notUnderlined: [],
      texts: ['Thêm bằng bàn phím. Việt', 'Bước bốn', 'dòng mới trong đoạn'],
      absent: ['Đoạn để xóa', 'xyz', 'zzz'],
      cell: [1, 0, 'Ô đã sửa'],
      centered: [],
      times: [],
      style: { 'Bước bốn': 'List Number' },
      noNumbering: [],
      tracked: true,
    }),
  );
  let py = { checks: [] };
  try {
    py = JSON.parse(execFileSync('python3', [path.join(ROOT, 'scripts/verify_word.py'), saved, expect], { encoding: 'utf8' }));
  } catch (e) {
    py = { checks: [{ name: 'reads the file', ok: false, detail: String(e.stdout ?? e) }] };
  }
  const bad = py.checks.filter((c) => !c.ok);
  check(`python-docx reads the saved file: ${py.checks.length} checks (edits, tracked change, equation, picture, link, bookmark, field)`, py.checks.length >= 12 && !bad.length, bad.map((c) => `${c.name}: ${c.detail}`).join(' | '));
  const underlined = execFileSync(
    'python3',
    ['-c', 'import sys,docx;d=docx.Document(sys.argv[1]);print([r.underline for p in d.paragraphs for r in p.runs if "chữ đỏ cỡ 14" in r.text][0], [r.font.size.pt if r.font.size else None for p in d.paragraphs for r in p.runs if "chữ đỏ cỡ 14" in r.text][0])', saved],
    { encoding: 'utf8' },
  ).trim();
  check('the underlined red text keeps its size 14 pt in the file', underlined === 'True 14.0', underlined);
  const drawings = execFileSync('python3', [path.join(ROOT, 'scripts/verify_word.py'), '--drawings', saved], { encoding: 'utf8' }).trim();
  check('the pasted picture is a second drawing with its own id', drawings === '2 2', drawings);
  const soffice = ['/usr/bin/soffice', '/usr/lib/libreoffice/program/soffice'].find((p) => fs.existsSync(p));
  if (soffice && !process.env.SKIP_LIBREOFFICE) {
    execFileSync(soffice, ['--headless', '--convert-to', 'txt:Text (encoded):UTF8', '--outdir', OUT, saved], { stdio: 'ignore', timeout: 180000 });
    const txt = fs.readFileSync(path.join(OUT, 'saved.txt'), 'utf8');
    check('LibreOffice opens the saved file; the edits are in its text', /Bước bốn/.test(txt) && /Ô đã sửa/.test(txt) && /Việt/.test(txt) && !/Đoạn để xóa/.test(txt));
  }

  // ── 4. leaving ──────────────────────────────────────────────────────────
  await caretAfter('Bước bốn');
  await page.keyboard.type(' chưa lưu');
  await page.click(tid('word-close'));
  await page.waitForSelector(tid('word-leave'));
  await page.click(tid('word-leave-stay'));
  const stayed = await page.isVisible(tid('word-editor'));
  await page.click(tid('word-close'));
  await page.click(tid('word-leave-discard'));
  await page.waitForSelector(tid('word-screen'), { state: 'detached' });
  check('closing with unsaved changes asks first: “Ở lại” stays, “Bỏ thay đổi” closes', stayed && (await page.isVisible(tid('state-empty'))));

  // a PDF open, then a Word file over it, then back
  await page.setInputFiles(tid('file-input'), FIX('sample.pdf'));
  await page.waitForSelector(tid('page-0'), { timeout: 60000 });
  await openWord(page, 'word-pandoc.docx');
  const pandocTexts = await texts();
  await page.click(tid('word-close'));
  await page.waitForSelector(tid('word-screen'), { state: 'detached' });
  check('a Word file opens over an open PDF; closing it goes back to the PDF', pandocTexts[0] === 'Báo cáo tuần' && (await page.isVisible(tid('page-0'))), pandocTexts[0]);
  // from the Word screen, a PDF: the Word screen goes, the PDF opens
  await openWord(page, 'word-lo.docx');
  await page.setInputFiles(tid('file-input'), FIX('pages-a.pdf'));
  await page.waitForSelector(tid('word-screen'), { state: 'detached', timeout: 30000 });
  await page.waitForFunction(() => window.__ezpdf?.pages().length === 5, null, { timeout: 60000 });
  check('opening a PDF from the Word screen (no changes) closes it and opens the PDF', true);
  // an old Word 97–2003 file
  const old = path.join(OUT, 'cu.doc');
  fs.writeFileSync(old, Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(2048)]));
  await page.setInputFiles(tid('file-input'), old);
  await page.waitForSelector(tid('word-error'), { timeout: 30000 });
  const oldMsg = await page.textContent(tid('word-error'));
  check('an old .doc file is explained (save it again as .docx in Word)', /kiểu cũ/.test(oldMsg) && /\.docx/.test(oldMsg), oldMsg);
  await page.click(`${tid('word-error')} button`);
  await page.waitForSelector(tid('word-screen'), { state: 'detached' });

  // ── 5. phone ────────────────────────────────────────────────────────────
  {
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const ph = await pctx.newPage();
    track(ph);
    onCrash = () => ph.screenshot({ path: path.join(OUT, 'crash-phone.png') });
    await ph.goto(server.base + '/?e2e');
    await ph.waitForSelector(tid('state-empty'), { timeout: 60000 });
    await openWord(ph, 'word-a.docx');
    const bar = await ph.$eval(tid('word-bar'), (h) => ({ sw: h.scrollWidth, cw: h.clientWidth }));
    const tableFits = await ph.evaluate(() => {
      const t = document.querySelector('.ez-wtable table').getBoundingClientRect();
      const pg = document.querySelector('[data-testid="word-page"]').getBoundingClientRect();
      return t.right <= pg.right + 1 && t.left >= pg.left - 1;
    });
    await ph.tap('.ez-wdoc p:has-text("Đoạn cuối của tài liệu.")');
    await ph.evaluate(() => {
      const r = window.__ezword.find('Đoạn cuối của tài liệu.');
      window.__ezword.select(r.to);
    });
    await ph.keyboard.type(' Gõ trên điện thoại.');
    const pt = await ph.evaluate(() => window.__ezword.texts().pop());
    await ph.evaluate(() => {
      const r = window.__ezword.find('Gõ trên điện thoại');
      window.__ezword.select(r.from, r.to);
    });
    await ph.tap(tid('word-bold'));
    const pm = await ph.evaluate(() => {
      const r = window.__ezword.find('Gõ trên điện thoại');
      return window.__ezword.marksAt(r.from + 1);
    });
    const saveBox = await ph.evaluate(() => {
      const r = document.querySelector('[data-testid="word-save"]').getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), w: innerWidth };
    });
    const saveVisible = saveBox.r <= saveBox.w + 1 && saveBox.l >= 0;
    await ph.screenshot({ path: path.join(OUT, 'phone-word.png') });
    check(
      'phone: the bar fits with “Lưu” on screen; the table fits the page; a tap and typing edit; Bold works',
      bar.sw <= bar.cw + 1 && saveVisible && tableFits && pt.endsWith('Gõ trên điện thoại.') && pm.includes('b'),
      `bar ${bar.sw}/${bar.cw}, save ${JSON.stringify(saveBox)}, table fits ${tableFits}, ${pt}, marks ${pm}`,
    );
    await pctx.close();
  }

  const foreign = [...new Set(requests.filter((u) => !u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')))];
  check('documents never left the device (every request went to the app itself)', foreign.length === 0, foreign.join(' ') || 'none');
  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));

  await browser.close();
  server.stop();
  const passed = results.filter((r) => r.ok).length;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ mode: PROD ? 'production' : 'dev', results }, null, 2));
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (e) => {
  console.error(e);
  await onCrash().catch(() => {});
  console.error('last checks:', JSON.stringify(results.slice(-3)));
  process.exit(1);
});
