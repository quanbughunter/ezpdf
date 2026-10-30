#!/usr/bin/env node
/**
 * Acceptance run for "Sửa chữ có sẵn" (editing text already in the PDF), in
 * real Chromium, on tests/fixtures/edit-text.pdf (scripts/make_edit_fixture.cjs).
 *
 *  - the tool lists each page's lines; tapping one opens the edit bar, which
 *    says before saving whether the line keeps its own font
 *  - saving changes the text in the viewer's own engine (not only on screen),
 *    and keeps the page rotation, zoom and edit mode
 *  - a line whose font lacks a character is set in ezSansVN, and the app says so
 *  - hidden (OCR) text and text in a Form XObject are refused with a reason
 *  - undo / redo of an edit; another tool turns editing off
 *  - the draft keeps the edits across a reload
 *  - the exported PDF, checked by scripts/verify_text_edit.py (Poppler, MuPDF,
 *    qpdf): old text gone from the file, new text there and drawn, the rest
 *    of each edited page unchanged pixel for pixel
 *  - phone: touch, the bar never covers the line being edited
 *
 * Usage: node scripts/e2e-edit.cjs
 *        BASE=http://localhost:4173 node scripts/e2e-edit.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out', 'e2e-edit');
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
/**
 * EmbedPDF's render, tile and thumbnail layers revoke a page image's blob:
 * URL when a newer render replaces it; if the <img> had not finished loading,
 * Chromium logs "Failed to load resource: net::ERR_FILE_NOT_FOUND" for that
 * blob: URL. The newer image is shown, nothing is lost: not a page error.
 * (Timing-dependent, so it appears on slow machines such as CI.)
 */
const benignRenderRace = (m) => m.type() === 'error' && /ERR_FILE_NOT_FOUND/.test(m.text()) && /^blob:/.test(m.location()?.url ?? '');
const lineSel = (page, text, exact = true) => `${tid(`textedit-layer-${page}`)} [data-testid="textedit-line"][data-text${exact ? '' : '^'}="${text}"]`;

async function startServer() {
  if (PROD) return { base: process.env.BASE, stop() {} };
  const port = 5186;
  // its own process group: npx leaves vite running if only npx is stopped
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  const kill = () => {
    try {
      process.kill(-proc.pid, 'SIGTERM');
    } catch {}
  };
  process.on('exit', kill); // also when the run ends early
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
  const browser = await chromium.launch();
  const errors = [];
  const track = (p) => {
    p.on('pageerror', (e) => errors.push(`${e.message} @${stepName}`));
    p.on('console', (m) => m.type() === 'error' && !benignRenderRace(m) && errors.push(`${m.text()} ${m.location()?.url ?? ''} @${stepName}`));
  };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  let page = await ctx.newPage();
  track(page);
  // CPU_SLOWDOWN=4 node scripts/e2e-edit.cjs: a machine as slow as a CI runner or a phone
  if (process.env.CPU_SLOWDOWN) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_SLOWDOWN) });
  onCrash = async () => {
    console.error('page errors so far:', JSON.stringify(errors.slice(-10), null, 1));
    await page.screenshot({ path: path.join(OUT, 'crash.png') });
    console.error('screenshot:', path.join(OUT, 'crash.png'));
  };

  /** go to page n and wait until that page is really on screen (the box shows what was typed at once) */
  const goPage = async (n) => {
    await page.fill(tid('page-input'), String(n));
    await page.press(tid('page-input'), 'Enter');
    await page.evaluate(() => document.activeElement?.blur()); // shortcuts are off while typing
    await page.waitForFunction(
      (k) => {
        const el = document.querySelector(`[data-testid="viewer"] [data-testid="page-${k - 1}"]`);
        const vp = document.querySelector('[data-ez-viewport]');
        if (!el || !vp) return false;
        const a = el.getBoundingClientRect();
        const b = vp.getBoundingClientRect();
        return a.top < b.top + b.height / 2 && a.bottom > b.top + b.height / 2;
      },
      n,
      { timeout: 20000 },
    );
    await sleep(500);
  };
  const hint = () => page.textContent(tid('tool-hint')).catch(() => '');
  const pageText = (i) => page.evaluate((k) => window.__ezpdf.pageText(k), i);
  /** the viewer's engine joins its text runs with spaces: compare without them */
  const reads = (text, wanted) => text.replace(/\s+/g, '').includes(wanted.replace(/\s+/g, ''));
  const rotations = () => page.evaluate(() => window.__ezpdf.pages().map((p) => p.rotation));
  const lineBox = (sel) => page.$eval(sel, (e) => JSON.parse(e.dataset.box));
  /** edit one line through the bar; returns the font note shown before saving */
  async function edit(pageIdx, from, to, how = 'enter') {
    await page.waitForSelector(`${tid(`textedit-layer-${pageIdx}`)}[data-ready="true"]`, { timeout: 30000 });
    await page.click(lineSel(pageIdx, from));
    await page.waitForSelector(tid('textedit-input'));
    const before = await page.inputValue(tid('textedit-input'));
    await page.fill(tid('textedit-input'), to);
    const note = {
      text: await page.textContent(tid('textedit-font')),
      keep: await page.getAttribute(tid('textedit-font'), 'data-keep'),
      scope: await page.getAttribute(tid('textedit-font'), 'data-scope'),
    };
    if (how === 'enter') await page.press(tid('textedit-input'), 'Enter');
    else await page.click(tid('textedit-save'));
    await page.waitForSelector(lineSel(pageIdx, to), { timeout: 30000 });
    return { before, note };
  }

  await page.goto(server.base + '/?e2e');
  await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
  {
    const chooser = page.waitForEvent('filechooser');
    await page.click(tid('btn-open-empty'));
    await (await chooser).setFiles(FIX('edit-text.pdf'));
  }
  await page.waitForFunction(() => document.querySelector('[data-testid="page-total"]')?.textContent?.includes('/ 7'), null, { timeout: 60000 });
  await sleep(800);

  // view state that must survive an edit: page 2 turned, zoom 125 %
  await goPage(2);
  await page.keyboard.press('r');
  await page.click(tid('zoom-menu'));
  await page.click(tid('zoom-125'));
  await sleep(600);
  await goPage(1);

  // ── turn the tool on ──
  await page.keyboard.press('e');
  await page.waitForSelector(`${tid('textedit-layer-0')}[data-ready="true"]`, { timeout: 30000 });
  const lines0 = await page.$$eval(`${tid('textedit-layer-0')} [data-testid="textedit-line"]`, (els) => els.map((e) => [e.dataset.text, e.dataset.editable]));
  check(
    'the tool (E) shows every line of the page as an editable box',
    lines0.length === 8 && lines0.every(([, ed]) => ed === 'true') && (await page.getAttribute(tid('tool-edit-text'), 'aria-pressed')) === 'true',
    lines0.map(([t]) => t).join(' | '),
  );
  check('the hint says how to use it', (await hint()).includes('khung nét đứt'), await hint());

  const expectedEdits = [];
  // 1. same font
  const OLD1 = 'Bên nhận: Phòng kỹ thuật, đại diện là bà Lê Thị Hoa.';
  const NEW1 = 'Bên nhận: Phòng kỹ thuật, đại diện là ông Lê Văn Hòa.';
  const box1 = await lineBox(lineSel(0, OLD1));
  const e1 = await edit(0, OLD1, NEW1, 'click');
  check('tapping a line opens the bar with that line’s text', e1.before === OLD1, e1.before);
  check('before saving, the bar says the line keeps its own font', e1.note.keep === 'true' && e1.note.text.includes('giữ phông gốc LiberationSerif'), e1.note.text);
  let t0 = await pageText(0);
  check('after saving, the viewer’s own engine reads the new line, not the old one', t0.includes('ông Lê Văn Hòa') && !t0.includes('bà Lê Thị Hoa'), t0.slice(0, 160));
  check('the app confirms, with the font', (await hint()).includes('Đã sửa dòng, giữ phông gốc LiberationSerif'), await hint());
  await sleep(900); // the zoom comes back once the viewer has its size
  check(
    'page rotation, zoom and the tool are kept across the update',
    (await rotations())[1] === 1 &&
      (await page.textContent(tid('zoom-level'))) === '125%' &&
      (await page.getAttribute(tid('tool-edit-text'), 'aria-pressed')) === 'true',
    `rotations ${JSON.stringify(await rotations())}, zoom ${await page.textContent(tid('zoom-level'))}`,
  );
  expectedEdits.push({ page: 0, from: OLD1, to: NEW1, keep: true, oldBox: box1, fontName: 'LiberationSerif' });

  // 2. the font lacks a character
  const OLD2 = 'Biên bản bàn giao thiết bị';
  const NEW2 = 'Biên bản thu hồi thiết bị';
  const box2 = await lineBox(lineSel(0, OLD2));
  const e2 = await edit(0, OLD2, NEW2);
  check(
    'before saving, the bar says which characters the font lacks and that ezSans will be used',
    e2.note.keep === 'false' && e2.note.text.includes('“u”') && e2.note.text.includes('“ồ”') && e2.note.text.includes('ezSans đậm'),
    e2.note.text,
  );
  const h2 = await hint();
  check('after saving, the app says which font the line now uses and why', h2.includes('ezPDFSansVN-Bold') && h2.includes('thiếu: u ồ'), h2);
  t0 = await pageText(0);
  check('the viewer reads the new heading', t0.includes(NEW2) && !t0.includes(OLD2), t0.slice(0, 80));
  expectedEdits.push({ page: 0, from: OLD2, to: NEW2, keep: false, oldBox: box2, fontName: 'ezPDFSansVN-Bold' });

  // 3. refused lines explain themselves
  await goPage(6);
  await page.waitForSelector(`${tid('textedit-layer-5')}[data-ready="true"]`, { timeout: 30000 });
  await page.click(lineSel(5, 'Chữ ẩn của lớp nhận dạng.'));
  const hHidden = await hint();
  await page.click(lineSel(5, 'Chữ nằm trong khối đồ họa.'));
  const hForm = await hint();
  check(
    'hidden text (OCR layer) and text in a Form XObject are refused with a reason, no bar opens',
    /chữ ẩn/i.test(hHidden) && hForm.includes('Form XObject') && (await page.locator(tid('textedit-bar')).count()) === 0,
    `${hHidden} | ${hForm}`,
  );

  // 3b. Russian form: a bold label and a regular value on one line
  await goPage(7);
  const OLD7a = 'Автор: Иванов Иван Иванович -';
  const NEW7a = 'Автор: Иванов Иван Иванович';
  await page.waitForSelector(lineSel(6, OLD7a), { timeout: 30000 });
  const box7a = await lineBox(lineSel(6, OLD7a));
  const e7a = await edit(6, OLD7a, NEW7a);
  check(
    'a line with a bold label: deleting the end rewrites only that part, in the value’s own font, the label stays',
    e7a.note.keep === 'true' && e7a.note.scope === 'part' && e7a.note.text.includes('giữ phông gốc LiberationSans') && reads(await pageText(6), NEW7a) && !reads(await pageText(6), OLD7a),
    e7a.note.text,
  );
  expectedEdits.push({ page: 6, from: OLD7a, to: NEW7a, keep: true, oldBox: box7a, fontName: 'LiberationSans' });
  const OLD7b = 'Документ: АБ-2026-001';
  const NEW7b = 'Документ: ВГ-2026-002';
  const box7b = await lineBox(lineSel(6, OLD7b));
  const e7b = await edit(6, OLD7b, NEW7b);
  const h7b = await hint();
  check(
    'Cyrillic the value’s font lacks: only the value moves to ezSans (which now has Cyrillic), the bar says so first',
    e7b.note.keep === 'false' && e7b.note.scope === 'part' && e7b.note.text.includes('“В” “Г”') && h7b.includes('ezPDFSansVN-Regular') && reads(await pageText(6), NEW7b),
    `${e7b.note.text} | ${h7b}`,
  );
  expectedEdits.push({ page: 6, from: OLD7b, to: NEW7b, keep: false, oldBox: box7b, fontName: 'ezPDFSansVN-Regular' });

  // 4. TeX page: no space glyph, font kept
  await goPage(4);
  const OLD4 = 'Meetings will be held every second Tuesday.';
  const NEW4 = 'Meetings will be held every second Thursday.';
  const box4 = await lineBox(`${tid('textedit-layer-3')}[data-ready="true"] [data-text="${OLD4}"]`).catch(async () => {
    await page.waitForSelector(lineSel(3, OLD4), { timeout: 30000 });
    return lineBox(lineSel(3, OLD4));
  });
  await page.waitForSelector(`${tid('textedit-layer-3')}[data-ready="true"]`, { timeout: 30000 });
  await sleep(1200); // the jump to page 4 scrolls smoothly
  const scrollBefore = await page.evaluate(() => document.querySelector('[data-testid="textedit-layer-3"]').getBoundingClientRect().top);
  const e4 = await edit(3, OLD4, NEW4);
  check('a pdfLaTeX line keeps its font (CMR12)', e4.note.keep === 'true' && (await hint()).includes('CMR12'), await hint());
  await sleep(900);
  const scrollAfter = await page.evaluate(() => document.querySelector('[data-testid="textedit-layer-3"]').getBoundingClientRect().top);
  check(
    'the reading position is kept: the edited page stays where it was on screen',
    Math.abs(scrollAfter - scrollBefore) < 30 && (await page.inputValue(tid('page-input'))) === '4',
    `page top ${Math.round(scrollBefore)} → ${Math.round(scrollAfter)} px`,
  );
  expectedEdits.push({ page: 3, from: OLD4, to: NEW4, keep: true, oldBox: box4, fontName: 'CMR12' });

  // 5. undo / redo
  await page.click(tid('btn-undo'));
  await page.waitForSelector(lineSel(3, OLD4), { timeout: 30000 });
  const afterUndo = await pageText(3);
  await page.click(tid('btn-redo'));
  await page.waitForSelector(lineSel(3, NEW4), { timeout: 30000 });
  const afterRedo = await pageText(3);
  check('undo brings the old line back, redo the new one', afterUndo.includes('Tuesday') && afterRedo.includes('Thursday') && !afterRedo.includes('Tuesday'));

  // 6. another tool takes over
  await page.click(tid('tool-text'));
  await sleep(300);
  check(
    'choosing another tool turns editing off',
    (await page.locator(tid('textedit-layer-0')).count()) === 0 && (await page.getAttribute(tid('tool-edit-text'), 'aria-pressed')) === 'false',
  );
  await page.keyboard.press('Escape');

  // 7. draft across a reload
  await page.waitForSelector(tid('state-draft-saved'), { timeout: 30000 });
  await page.reload();
  await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
  await page.waitForSelector(tid('draft-list'), { timeout: 15000 });
  await page.click(tid('draft-open-0'));
  await page.waitForFunction(() => document.querySelector('[data-testid="page-total"]')?.textContent?.includes('/ 7'), null, { timeout: 60000 });
  await sleep(1200);
  const td0 = await pageText(0);
  const td3 = await pageText(3);
  check(
    'the draft keeps the edits and the page rotation after a reload',
    td0.includes(NEW1) && td0.includes(NEW2) && td3.includes('Thursday') && (await rotations())[1] === 1,
    `${td0.slice(0, 60)} · rotations ${JSON.stringify(await rotations())}`,
  );

  // 8. export, checked without PDFium
  const dl = page.waitForEvent('download');
  await page.click(tid('btn-export'));
  const d = await dl;
  const exported = path.join(OUT, 'exported.pdf');
  await d.saveAs(exported);
  fs.writeFileSync(path.join(OUT, 'expected.json'), JSON.stringify([{ file: 'exported.pdf', source: 'edit-text.pdf', edits: expectedEdits }], null, 2));
  let verify = '';
  let verified = false;
  try {
    verify = execFileSync('python3', [path.join(ROOT, 'scripts/verify_text_edit.py'), path.join(OUT, 'expected.json')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    verified = true;
  } catch (e) {
    verify = String(e.stdout || e);
  }
  const vlines = verify.split('\n').filter((l) => /^(PASS|FAIL)/.test(l));
  check(
    'exported PDF: old text gone from the file, new text read and drawn by Poppler and MuPDF, the rest of each page unchanged, qpdf clean',
    verified && vlines.length >= 10,
    `${vlines.filter((l) => l.startsWith('PASS')).length}/${vlines.length} independent checks${verified ? '' : ': ' + vlines.filter((l) => l.startsWith('FAIL')).join(' | ')}`,
  );
  const rot = execFileSync('python3', ['-c', 'import sys,pymupdf; d=pymupdf.open(sys.argv[1]); print(d[1].rotation)', exported], { encoding: 'utf8' }).trim();
  check('the exported file keeps page 2 turned', rot === '90', `/Rotate ${rot}`);
  await page.screenshot({ path: path.join(OUT, 'desktop.png') });

  // ── phone ──
  {
    const pctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    const ph = await pctx.newPage();
    track(ph);
    await ph.goto(server.base + '/?e2e');
    await ph.waitForSelector(tid('state-empty'), { timeout: 60000 });
    const chooser = ph.waitForEvent('filechooser');
    await ph.click(tid('btn-open-empty'));
    await (await chooser).setFiles(FIX('edit-text.pdf'));
    await ph.waitForSelector(tid('page-0'), { state: 'attached', timeout: 60000 });
    await ph.waitForTimeout(1200);
    const bottomTools = await ph.$$eval('nav[aria-label="Công cụ"] [data-testid]', (els) => els.map((e) => e.dataset.testid));
    await ph.tap(tid('tool-edit-text'));
    await ph.waitForSelector(`${tid('textedit-layer-0')}[data-ready="true"]`, { timeout: 30000 });
    const phHint = await ph.textContent(tid('tool-hint'));
    // the top line of the page: the bar must not cover it
    const target = lineSel(0, 'Biên bản bàn giao thiết bị');
    const b = await ph.locator(target).boundingBox();
    await ph.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await ph.waitForSelector(tid('textedit-input'));
    await ph.waitForTimeout(400);
    const bar = await ph.locator(tid('textedit-bar')).boundingBox();
    const lineNow = await ph.locator(target).boundingBox();
    check(
      'phone: the tool is in the bottom bar (pinch replaces the zoom buttons), the hint speaks of touch',
      bottomTools.includes('tool-edit-text') && !bottomTools.includes('btn-zoom-in') && phHint.includes('Chạm'),
      `${bottomTools.join(' ')} · ${phHint}`,
    );
    check('phone: the line being edited stays visible below the bar', lineNow.y > bar.y + bar.height, `bar bottom ${Math.round(bar.y + bar.height)}, line top ${Math.round(lineNow.y)}`);
    await ph.fill(tid('textedit-input'), 'Biên bản bàn giao máy');
    await ph.tap(tid('textedit-save'));
    await ph.waitForSelector(lineSel(0, 'Biên bản bàn giao máy'), { timeout: 30000 });
    const pt = await ph.evaluate(() => window.__ezpdf.pageText(0));
    check('phone: a line edited by touch is saved into the document', pt.includes('Biên bản bàn giao máy'), pt.slice(0, 60));
    await ph.screenshot({ path: path.join(OUT, 'phone.png') });
    await pctx.close();
  }

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
  process.exit(2);
});
