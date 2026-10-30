#!/usr/bin/env node
/**
 * Acceptance run (milestones 1 + 2, kept current through M3) in real Chromium.
 * Milestone 3 additions (pictures, signatures, drafts, page rotation saved
 * to the file) have their own run: scripts/e2e-m3.cjs.
 *
 *  - open, panels, FreeText (drag + click), auto-grow, properties, highlight,
 *    sticky note, delete, undo/redo
 *  - FreeText lines on screen identical at 10 zoom levels and identical to the
 *    lines an independent renderer (MuPDF) reads from the exported file,
 *    baselines within 0.6 pt
 *  - page rotation (M3: saved to the file), FreeText on a /Rotate 90 page
 *    (also growing while rotated)
 *  - export → Poppler / MuPDF / pdf.js → reopen → edit → export again
 *  - opening another file keeps unexported changes as a draft (M3)
 *  - 300-page document: page count, thumbnails (virtualised), navigation, search
 *  - phone viewport: no horizontal overflow, export reachable, bottom tools
 *  - every button that appears on screen is exercised by some step
 *  - no request to another origin, nothing uploaded, no page errors
 *
 * Usage: node scripts/e2e.cjs   (starts its own Vite dev server)
 *        BASE=http://localhost:4173 SKIP_PDFJS=1 node scripts/e2e.cjs   (against `npm run preview`)
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out', 'e2e');
fs.mkdirSync(OUT, { recursive: true });
const FIX = (f) => path.join(ROOT, 'tests/fixtures', f);
const A4 = { w: 595.2756, h: 841.8898 };
const TEXT1 = 'Xin chào! Tiếng Việt có dấu: ắ ằ ẳ ẵ ặ, ơ ư đ — Nguyễn Văn Ấn ký tên';
const LONG =
  'Ô chữ nhỏ tự cao thêm khi gõ dài. Dòng này đủ dài để phải xuống dòng nhiều lần: ' +
  'Cộng hòa xã hội chủ nghĩa Việt Nam, Độc lập Tự do Hạnh phúc. Kính gửi phòng hành chính.';
const TEXT_ROT = 'Trang xoay 90°: chữ vẫn đứng thẳng, ô vẫn tự giãn khi gõ thêm nhiều chữ nữa ở đây.';
const COMMENT = 'Lời nhắn: đoạn này cần kiểm tra lại số liệu.';
const NOTE = 'Ghi chú dán: nhớ ký nháy từng trang.';

const results = [];
let lastCheck = 'start';
function check(name, ok, detail = '') {
  lastCheck = name;
  results.push({ name, ok: !!ok, detail: String(detail ?? '') });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const near = (a, b, tol) => a.length === b.length && a.every((v, k) => Math.abs(v - b[k]) <= tol);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inspect = (file) => {
  let raw;
  try {
    raw = execFileSync('python3', [path.join(ROOT, 'scripts/inspect_export.py'), file], { encoding: 'utf8' });
  } catch (e) {
    raw = e.stdout || '{}';
  }
  return JSON.parse(raw);
};
const squash = (s) => (s || '').replace(/\s+/g, ' ').trim();

async function startServer() {
  if (process.env.BASE) return { base: process.env.BASE, stop() {} };
  const port = 5181;
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
        // A fresh dev server may re-bundle dependencies on the first page load
        // and reload that page; load the app once before testing.
        const b = await chromium.launch();
        const p = await b.newPage();
        await p.goto(base + '/?e2e');
        await p.waitForSelector('[data-testid="state-empty"]', { timeout: 60000 }).catch(() => {});
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

/** filled in once the browser is up: what to save when the run crashes */
let onCrash = async () => {};

(async () => {
  const server = await startServer();
  const origin = new URL(server.base).origin;
  const browser = await chromium.launch();
  const requests = [];
  const errors = [];
  const covered = new Set();
  const seenButtons = new Set();
  const unnamedButtons = new Set();

  function track(p) {
    p.on('request', (r) => requests.push({ method: r.method(), url: r.url() }));
    p.on('pageerror', (e) => errors.push(`${e.message} (after “${lastCheck}”)`));
    p.on('console', (m) => m.type() === 'error' && !benignRenderRace(m) && errors.push(`${m.text()} ${m.location()?.url ?? ''} (after “${lastCheck}”)`));
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  // CPU_SLOWDOWN=4: a machine as slow as a CI runner or a phone
  if (process.env.CPU_SLOWDOWN) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_SLOWDOWN) });

  onCrash = async () => {
    // for CI: the screen and the page errors at the moment of the crash
    console.error('page errors so far:', JSON.stringify(errors.slice(-10), null, 1));
    await page.screenshot({ path: path.join(OUT, 'crash.png') });
    console.error('screenshot:', path.join(OUT, 'crash.png'));
  };
  track(page);

  const tid = (id) => `[data-testid="${id}"]`;
/**
 * EmbedPDF's render, tile and thumbnail layers revoke a page image's blob:
 * URL when a newer render replaces it; if the <img> had not finished loading,
 * Chromium logs "Failed to load resource: net::ERR_FILE_NOT_FOUND" for that
 * blob: URL. The newer image is shown, nothing is lost: not a page error.
 * (Timing-dependent, so it appears on slow machines such as CI.)
 */
const benignRenderRace = (m) => m.type() === 'error' && /ERR_FILE_NOT_FOUND/.test(m.text()) && /^blob:/.test(m.location()?.url ?? '');
  async function click(id, opts) {
    covered.add(id);
    await page.click(tid(id), opts);
  }
  async function collectButtons(p = page) {
    const found = await p.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter((b) => b.offsetParent !== null || b.getClientRects().length)
        .map((b) => b.getAttribute('data-testid') || `?${b.getAttribute('aria-label') || b.textContent.trim().slice(0, 30)}`),
    );
    for (const f of found) (f.startsWith('?') ? unnamedButtons : seenButtons).add(f);
  }
  const annots = () => page.evaluate(() => window.__ezpdf.annotations());
  const pageBox = (i) => page.locator(tid(`page-${i}`)).boundingBox();
  async function toScreen(i, x, y, r = 0) {
    const b = await pageBox(i);
    let u, v;
    if (r === 0) [u, v] = [x / A4.w, y / A4.h];
    else if (r === 1) [u, v] = [1 - y / A4.h, x / A4.w];
    return [b.x + u * b.width, b.y + v * b.height];
  }
  async function drag(from, to) {
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 5 });
    await page.mouse.move(...to, { steps: 5 });
    await page.mouse.up();
  }
  async function pickFile(triggerId, file, p = page) {
    const chooser = p.waitForEvent('filechooser');
    covered.add(triggerId);
    await p.click(tid(triggerId));
    await (await chooser).setFiles(file);
  }
  async function waitDoc(pages, p = page) {
    await p.waitForFunction((n) => document.querySelector('[data-testid="page-total"]')?.textContent?.includes(`/ ${n}`), pages, { timeout: 30000 });
    await p.waitForSelector(tid('page-0'), { state: 'attached', timeout: 30000 });
    await p.waitForTimeout(800);
  }
  // Lines of a committed FreeText as drawn on screen, normalised to the displayed page box.
  async function ftLines(pageIndex, id) {
    return page.evaluate(
      ([pi, id]) => {
        const pg = document.querySelector(`[data-testid="page-${pi}"]`).parentElement.getBoundingClientRect();
        const box = document.querySelector(`[data-testid="freetext"][data-annotation-id="${id}"]`);
        if (!box) return null;
        return [...box.querySelectorAll('[data-ez-line]')].map((s) => {
          const r = s.getBoundingClientRect();
          return { text: s.textContent, l: (r.left - pg.left) / pg.width, t: (r.top - pg.top) / pg.height };
        });
      },
      [pageIndex, id],
    );
  }
  async function ftBoxNorm(pageIndex, id) {
    return page.evaluate(
      ([pi, id]) => {
        const pg = document.querySelector(`[data-testid="page-${pi}"]`).parentElement.getBoundingClientRect();
        const b = document.querySelector(`[data-testid="freetext"][data-annotation-id="${id}"]`).getBoundingClientRect();
        return [(b.left - pg.left) / pg.width, (b.top - pg.top) / pg.height, b.width / pg.width, b.height / pg.height];
      },
      [pageIndex, id],
    );
  }
  async function setZoom(item) {
    covered.add('zoom-menu');
    await page.click(tid('zoom-menu'));
    await page.waitForSelector(tid(item));
    covered.add(item);
    await page.click(tid(item));
    await page.waitForTimeout(500);
  }
  async function exportTo(file) {
    const dl = page.waitForEvent('download');
    await click('btn-export');
    const d = await dl;
    await d.saveAs(file);
    await page.waitForSelector(tid('state-exported'), { timeout: 30000 });
    return d.suggestedFilename();
  }
  const byType = async (type, pageIndex) => (await annots()).filter((a) => a.type === type && (pageIndex === undefined || a.pageIndex === pageIndex));
  const newest = (list, before) => list.find((a) => !before.some((b) => b.id === a.id));

  // ── 1. empty state, open through the button ─────────────────────────────
  await page.goto(server.base + '/?e2e');
  await page.waitForSelector(tid('state-empty'), { timeout: 30000 });
  check('empty state before a file is opened', true);
  await collectButtons();
  await pickFile('btn-open-empty', FIX('sample.pdf'));
  await waitDoc(4);
  check('PDF opens; toolbar shows 4 pages', true);
  check('left panel shows page thumbnails', await page.isVisible(tid('thumb-0')));
  check('right panel shows document info (4 pages)', (await page.textContent(tid('info-pages'))) === '4');
  await collectButtons();
  await click('btn-toggle-left');
  await click('btn-toggle-right');
  const hidden = !(await page.isVisible(tid('left-panel'))) && !(await page.isVisible(tid('right-panel')));
  await click('btn-toggle-left');
  await click('btn-toggle-right');
  check('panels can be hidden and shown', hidden && (await page.isVisible(tid('left-panel'))) && (await page.isVisible(tid('right-panel'))));

  // ── 2. FreeText by drag ─────────────────────────────────────────────────
  await click('tool-text');
  check('active tool explained in the hint strip', /ô chữ/i.test((await page.textContent(tid('tool-hint'))) || ''));
  await drag(await toScreen(0, 72, 230), await toScreen(0, 372, 290));
  await page.waitForSelector(tid('freetext-editor'));
  check('editing hint while typing', /Đang sửa chữ/.test((await page.textContent(tid('tool-hint'))) || ''));
  await page.keyboard.press('Control+A');
  await page.keyboard.type(TEXT1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  let ft1 = (await byType(3, 0))[0];
  check('FreeText created with Vietnamese contents', ft1 && ft1.contents === TEXT1, ft1 && JSON.stringify(ft1.contents));
  check(
    'FreeText rect = dragged rect (page space)',
    ft1 && near([ft1.rect.origin.x, ft1.rect.origin.y, ft1.rect.size.width, ft1.rect.size.height], [72, 230, 300, 60], 1.5),
    ft1 && JSON.stringify(ft1.rect),
  );
  // a mouse device rests on the hand (drag to scroll), see e2e-share-print.cjs
  check('tool returns to the resting tool (hand) after placing text', (await page.getAttribute(tid('tool-text'), 'aria-pressed')) === 'false' && (await page.getAttribute(tid('tool-hand'), 'aria-pressed')) === 'true');
  check('dirty indicator after editing', await page.isVisible(tid('state-dirty')));

  // ── 3. Auto-grow: small click-placed box, long text ─────────────────────
  let before = await annots();
  await page.keyboard.press('t');
  await page.mouse.click(...(await toScreen(0, 200, 480)));
  await page.waitForSelector(tid('freetext-editor'));
  await page.keyboard.type(LONG); // placeholder is pre-selected, typing replaces it
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  let ft2 = newest(await byType(3, 0), before);
  const ft2Lines = ft2 && (await ftLines(0, ft2.id));
  check('click-placed box starts at default size and grows to fit the text', ft2 && ft2.rect.size.height > 60 && ft2.rect.size.width < 185, ft2 && JSON.stringify(ft2.rect.size));
  check('grown box shows every line (none clipped)', ft2Lines && ft2Lines.length >= 4 && squash(ft2Lines.map((l) => l.text).join(' ')) === squash(LONG), ft2Lines && ft2Lines.length + ' lines');

  // ── 4. Properties of FreeText 1 ─────────────────────────────────────────
  await page.mouse.click(...(await toScreen(0, 200, 245)));
  await page.waitForSelector(tid('ft-size'));
  check('properties panel follows the selection (Ô chữ)', (await page.textContent(tid('properties-title'))) === 'Ô chữ');
  await click('ft-size-up');
  await click('ft-size-up');
  await click('ft-size-down');
  await page.fill(tid('ft-size'), '16');
  await page.press(tid('ft-size'), 'Enter');
  await click('ft-color-1');
  await click('ft-align-center');
  await click('ft-align-right');
  await click('ft-align-left');
  await click('ft-align-center');
  await click('ft-bg-1');
  await click('ft-bg-2');
  await page.waitForTimeout(300);
  ft1 = (await annots()).find((a) => a.id === ft1.id);
  check(
    'size 16, red, centred, light-yellow background applied',
    ft1.fontSize === 16 && ft1.fontColor.toLowerCase() === '#b42318' && ft1.textAlign === 1 && (ft1.color || '').toLowerCase() === '#fff3bf',
    JSON.stringify({ s: ft1.fontSize, c: ft1.fontColor, a: ft1.textAlign, bg: ft1.color }),
  );
  // CI 0.7.0: the box's text was selected after "−" had rendered but before a
  // later task copied the new size into the box; that copy dropped the
  // selection and "16" was added to the old number (→ 96). Same order here,
  // on purpose: click, React's synchronous work, select, no task in between.
  const sizeRace = [];
  for (let round = 0; round < 3; round++) {
    await page.evaluate(async () => {
      document.querySelector('[data-testid="ft-size-down"]').click();
      for (let i = 0; i < 5; i++) await new Promise((r) => queueMicrotask(r));
      const input = document.querySelector('[data-testid="ft-size"]');
      input.select();
      input.focus();
    });
    await page.keyboard.insertText('16');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    sizeRace.push((await annots()).find((a) => a.id === ft1.id).fontSize);
  }
  check('typing a size right after “−” replaces the number (no 15+16 → 96)', sizeRace.every((s) => s === 16), sizeRace.join(' '));
  await click('ft-color-0');
  await click('ft-color-1');
  await collectButtons();

  // ── 5. Highlight + colour + comment ─────────────────────────────────────
  await click('tool-highlight');
  before = await annots();
  await drag(await toScreen(0, 73, 147), await toScreen(0, 288, 147));
  await page.waitForTimeout(500);
  const hl = newest(await byType(9, 0), before);
  check('highlight created from text selection on the target line', hl && hl.rect.origin.y > 133 && hl.rect.origin.y + hl.rect.size.height < 161, hl && JSON.stringify(hl.rect));
  await click('tool-select');
  await page.evaluate(([pi, id]) => window.__ezpdf.select(pi, id), [0, hl.id]);
  await page.waitForSelector(tid('hl-color-1'));
  await click('hl-color-2');
  await click('hl-color-3');
  await click('hl-color-0');
  await click('hl-color-1');
  await page.click(tid('contents-input'));
  await page.keyboard.type(COMMENT);
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  const hl2 = (await annots()).find((a) => a.id === hl.id);
  check('highlight colour + comment', (hl2.strokeColor || '').toLowerCase() === '#8ce99a' && hl2.contents === COMMENT, JSON.stringify({ c: hl2.strokeColor, t: hl2.contents }));
  await collectButtons();

  // ── 6. Sticky note ──────────────────────────────────────────────────────
  before = await annots();
  await click('tool-note');
  await page.mouse.click(...(await toScreen(0, 500, 110)));
  await page.waitForSelector(tid('contents-input'));
  await page.waitForTimeout(200);
  await page.keyboard.type(NOTE);
  await page.keyboard.press('Control+Enter');
  await click('note-color-1');
  await click('note-color-3');
  await click('note-color-0');
  await click('note-color-2');
  await page.waitForTimeout(300);
  const note = newest(await byType(1, 0), before);
  check('sticky note with Vietnamese text and colour', note && note.contents === NOTE && (note.strokeColor || '').toLowerCase() === '#4dabf7', note && JSON.stringify({ c: note.contents, col: note.strokeColor }));
  await collectButtons();

  // ── 7. Delete (key + panel), undo/redo ──────────────────────────────────
  await page.mouse.click(...(await toScreen(0, 450, 760)));
  await page.evaluate(([pi, id]) => window.__ezpdf.select(pi, id), [0, ft2.id]);
  await page.waitForTimeout(150);
  const n0 = (await annots()).length;
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  const n1 = (await annots()).length;
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  const n2 = (await annots()).length;
  await click('btn-redo');
  await page.waitForTimeout(250);
  const n3 = (await annots()).length;
  await click('btn-undo');
  await page.waitForTimeout(250);
  const n4 = (await annots()).length;
  check('Delete key removes; Ctrl+Z / redo / undo buttons', n1 === n0 - 1 && n2 === n0 && n3 === n0 - 1 && n4 === n0, `${n0}→${n1}→${n2}→${n3}→${n4}`);
  before = await annots();
  await page.keyboard.press('t');
  await page.mouse.click(...(await toScreen(0, 300, 640)));
  await page.waitForSelector(tid('freetext-editor'));
  await page.keyboard.type('Ô tạm để xóa');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const tmp = newest(await byType(3, 0), before);
  await page.evaluate(([pi, id]) => window.__ezpdf.select(pi, id), [0, tmp.id]);
  await page.waitForSelector(tid('btn-delete'));
  await click('btn-delete');
  await page.waitForTimeout(250);
  check('Xóa button in the panel removes the selected object', !(await annots()).some((a) => a.id === tmp.id));
  await page.keyboard.press('Escape');

  // ── 8. Screen lines identical at every zoom ─────────────────────────────
  await setZoom('zoom-100');
  await page.locator(tid('page-0')).scrollIntoViewIfNeeded();
  const ref1 = await ftLines(0, ft1.id);
  const ref2 = await ftLines(0, ft2.id);
  const zoomLog = [];
  let zoomOk = !!(ref1 && ref1.length && ref2 && ref2.length);
  for (const z of ['zoom-50', 'zoom-75', 'zoom-125', 'zoom-150', 'zoom-200', 'zoom-300', 'zoom-fit-page', 'zoom-fit-width', 'btn-zoom-in', 'btn-zoom-out']) {
    if (z.startsWith('zoom-')) await setZoom(z);
    else {
      await click(z);
      await page.waitForTimeout(500);
    }
    await page.locator(tid('page-0')).scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const [a, b] = [await ftLines(0, ft1.id), await ftLines(0, ft2.id)];
    const lvl = await page.textContent(tid('zoom-level'));
    const same = (got, ref) =>
      got && got.length === ref.length && got.every((l, k) => l.text === ref[k].text && Math.abs(l.l - ref[k].l) < 0.0015 && Math.abs(l.t - ref[k].t) < 0.0015);
    const ok = same(a, ref1) && same(b, ref2);
    zoomLog.push(`${lvl}${ok ? '' : ' ✗'}`);
    zoomOk = zoomOk && ok;
  }
  check('FreeText lines and positions identical at 11 zoom levels', zoomOk, zoomLog.join(' '));
  await setZoom('zoom-100');

  // ── 9. Page rotation (saved to the file since M3) ──────────────────────
  await page.locator(tid('page-0')).scrollIntoViewIfNeeded();
  await page.fill(tid('page-input'), '1');
  await page.press(tid('page-input'), 'Enter');
  await page.waitForTimeout(300);
  const box0 = await ftBoxNorm(0, ft1.id);
  await click('btn-rotate-page');
  await page.waitForTimeout(500);
  await page.locator(tid('page-0')).scrollIntoViewIfNeeded();
  const boxR = await ftBoxNorm(0, ft1.id);
  const [u, v, w, h] = box0;
  check('FreeText follows the page when the page rotates 90°', near(boxR, [1 - v - h, u, h, w], 0.004), JSON.stringify(boxR.map((x) => x.toFixed(3))));
  await click('rotate-menu');
  await click('rotate-page-left');
  await page.waitForTimeout(400);

  // ── 10. FreeText on the /Rotate 90 page, growing while rotated ──────────
  await page.locator(tid('page-1')).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const b1 = await pageBox(1);
  before = await annots();
  await click('tool-text');
  // 0.4 × 0.04 of the displayed (landscape) page ≈ 337 × 24 pt: two lines needed → must grow
  await drag([b1.x + b1.width * 0.45, b1.y + b1.height * 0.2], [b1.x + b1.width * 0.85, b1.y + b1.height * 0.24]);
  await page.waitForSelector(tid('freetext-editor'));
  await page.keyboard.press('Control+A');
  await page.keyboard.type(TEXT_ROT);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const ftR = newest(await byType(3, 1), before);
  check('FreeText on /Rotate 90 page reads upright (rotation 270)', ftR && ftR.rotation === 270, ftR && `rotation=${ftR.rotation}`);
  check(
    'rotated box grew in its own frame (unrotated height up, page-space width up)',
    ftR && ftR.unrotatedRect && Math.abs(ftR.rect.size.width - ftR.unrotatedRect.size.height) < 0.01 && ftR.unrotatedRect.size.height > 0.04 * A4.w + 5,
    ftR && JSON.stringify({ rect: ftR.rect.size, local: ftR.unrotatedRect?.size }),
  );
  await page.screenshot({ path: path.join(OUT, 'rotated-page-text.png') });

  // ── 11. Export + independent readers ────────────────────────────────────
  await page.mouse.click(...(await toScreen(0, 450, 760)));
  await page.locator(tid('page-0')).scrollIntoViewIfNeeded();
  const screen1 = await ftLines(0, ft1.id);
  const screen2 = await ftLines(0, ft2.id);
  const name1 = await exportTo(path.join(OUT, 'export-1.pdf'));
  check('export downloads a new file, original kept apart', /\(ezPDF\)\.pdf$/.test(name1), name1);
  check('dirty indicator cleared after export', !(await page.isVisible(tid('state-dirty'))));
  await page.screenshot({ path: path.join(OUT, 'desktop-after-export.png') });
  const info1 = inspect(path.join(OUT, 'export-1.pdf'));
  const baked = info1.baked_lines?.['1'] || [];
  const matchBaked = (screen, fontSize) => {
    // screen lines → page points (baseline = line-box top + ascent)
    const asc = 1.069 * fontSize;
    return screen.map((l) => {
      const x = l.l * A4.w;
      const y = l.t * A4.h + asc;
      const hit = baked.find((r) => r.text === l.text);
      return { text: l.text, ok: !!hit && Math.abs(hit.x - x) < 0.6 && Math.abs(hit.y - y) < 0.6, dx: hit ? (hit.x - x).toFixed(2) : 'n/a', dy: hit ? (hit.y - y).toFixed(2) : 'n/a' };
    });
  };
  const m1 = matchBaked(screen1, 16);
  const m2 = matchBaked(screen2, 14);
  check('MuPDF reads the same lines as the screen, baselines within 0.6 pt (box 1)', m1.length && m1.every((r) => r.ok), m1.map((r) => `${r.dx}/${r.dy}`).join(' '));
  check('MuPDF reads the same lines as the screen, baselines within 0.6 pt (auto-grown box)', m2.length && m2.every((r) => r.ok), m2.map((r) => `${r.dx}/${r.dy}`).join(' '));
  check('exported text keeps size 16 and red colour', baked.filter((r) => screen1.some((l) => l.text === r.text)).every((r) => Math.abs(r.size - 16) < 0.05 && r.color === '#b42318'));
  const xa = (pred) => info1.annots.find(pred);
  const xHl = xa((a) => a.type === 'Highlight');
  check('exported highlight: colour + comment', xHl && xHl.stroke === '#8ce99a' && xHl.contents === COMMENT, xHl && JSON.stringify({ s: xHl.stroke, c: xHl.contents }));
  const xNote = xa((a) => a.type === 'Text');
  check('exported sticky note: Vietnamese contents + colour', xNote && xNote.contents === NOTE && xNote.stroke === '#4dabf7', xNote && JSON.stringify({ s: xNote.stroke, c: xNote.contents }));
  const xRot = xa((a) => a.type === 'FreeText' && a.page === 2);
  check('exported rotated-page text: full text, turned upright', xRot && xRot.ap_text === squash(TEXT_ROT) && xRot.matrix && near(xRot.matrix.slice(0, 4), [0, 1, -1, 0], 1e-3), xRot && JSON.stringify({ t: xRot.ap_text, m: xRot.matrix }));
  check('ezPDF font embedded, qpdf clean, Poppler without errors', info1.vn_fonts_embedded >= 3 && info1.vn_fonts_not_embedded === 0 && info1.qpdf_ok && info1.poppler_errors.length === 0, `${info1.vn_fonts_embedded} fonts; ${info1.poppler_errors.join('|')}`);

  if (process.env.SKIP_PDFJS) check('pdf.js check skipped (production preview has no test page)', true);
  else {
  const pj = await ctx.newPage();
  track(pj);
  await pj.goto(server.base + '/tests/pdfjs-render.html');
  await pj.setInputFiles('#f', path.join(OUT, 'export-1.pdf'));
  await pj.waitForFunction(() => window.__pdfjsResult, null, { timeout: 30000 });
  const pjr = await pj.evaluate(() => window.__pdfjsResult);
  const pjNote = pjr.pages[0].find((a) => a.subtype === 'Text');
  const pjFt = pjr.pages[0].filter((a) => a.subtype === 'FreeText');
  check('pdf.js: FreeText appearances present, note text readable', pjFt.length === 2 && pjFt.every((a) => a.hasAppearance) && pjNote?.contents === NOTE);
  await pj.locator('canvas[data-page="1"]').screenshot({ path: path.join(OUT, 'pdfjs-p1.png') });
  await pj.close();
  }

  // ── 12. Reopen, edit, export again ──────────────────────────────────────
  const prevDoc = await page.evaluate(() => window.__ezpdf?.documentId);
  await pickFile('btn-open', path.join(OUT, 'export-1.pdf'));
  await page.waitForFunction((p) => window.__ezpdf?.documentId && window.__ezpdf.documentId !== p, prevDoc, { timeout: 30000 });
  await waitDoc(4);
  let list = await annots();
  const re1 = list.find((a) => a.type === 3 && a.pageIndex === 0 && a.contents === TEXT1);
  check('reopened: all annotations back as editable objects', list.length === 5 && re1 && list.some((a) => a.contents === NOTE) && list.some((a) => a.contents === COMMENT), `${list.length} annotations`);
  await page.locator(tid('page-0')).scrollIntoViewIfNeeded();
  const c1 = await toScreen(0, re1.rect.origin.x + re1.rect.size.width / 2, re1.rect.origin.y + 10);
  await page.mouse.click(...c1);
  await page.mouse.dblclick(...c1);
  await page.waitForSelector(tid('freetext-editor'));
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' (sửa lần 2)');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.mouse.click(...(await toScreen(0, 450, 760)));
  await exportTo(path.join(OUT, 'export-2.pdf'));
  const info2 = inspect(path.join(OUT, 'export-2.pdf'));
  const x2 = info2.annots.find((a) => a.type === 'FreeText' && a.id === re1.id);
  check('edit after reopen reaches the file', x2 && x2.ap_text === squash(TEXT1 + ' (sửa lần 2)') && x2.contents === TEXT1 + ' (sửa lần 2)', x2 && x2.ap_text);

  // ── 13. Opening another file keeps unexported changes (draft, M3) ───────
  await page.keyboard.press('n');
  await page.mouse.click(...(await toScreen(0, 520, 700)));
  await page.waitForTimeout(400);
  await page.keyboard.type('x');
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector(tid('state-dirty'));
  await page.waitForSelector(tid('state-draft-saved'), { timeout: 15000 });
  // Ctrl+O opens the same picker
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await (await chooser).setFiles(FIX('long-300.pdf'));
  const t300 = Date.now();
  await waitDoc(300);
  const openMs = Date.now() - t300;
  const drafts = await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('ezpdf');
        r.onsuccess = () => {
          const q = r.result.transaction('drafts').objectStore('drafts').getAll();
          q.onsuccess = () => res(q.result.map((d) => ({ name: d.name, exported: d.exported })));
        };
      }),
  );
  check(
    'opening another file needs no prompt: unexported changes stay as a draft on this device',
    !(await page.isVisible(tid('banner-unsaved'))) && drafts.some((d) => /export-1\.pdf/.test(d.name) && !d.exported),
    JSON.stringify(drafts),
  );

  // ── 14. 300 pages: thumbnails, navigation, search ───────────────────────
  check('300-page document opens', (await page.textContent(tid('info-pages'))) === '300', `${openMs} ms to first page`);
  const thumbsRendered = await page.locator('[data-testid^="thumb-"]').count();
  check('thumbnails are virtualised', thumbsRendered > 0 && thumbsRendered < 40, `${thumbsRendered} in DOM`);
  await page.evaluate(() => {
    const pane = document.querySelector('[data-testid="thumbnails"]');
    pane.scrollTop = pane.scrollHeight;
  });
  await page.waitForSelector(tid('thumb-299'), { timeout: 10000 });
  covered.add('thumb-*');
  await page.click(tid('thumb-299'));
  await page.waitForFunction(() => document.querySelector('[data-testid="page-input"]').value === '300', null, { timeout: 10000 });
  await click('btn-page-prev');
  await page.waitForFunction(() => document.querySelector('[data-testid="page-input"]').value === '299', null, { timeout: 10000 });
  await click('btn-page-next');
  await page.waitForFunction(() => document.querySelector('[data-testid="page-input"]').value === '300', null, { timeout: 10000 });
  await page.fill(tid('page-input'), '150');
  await page.press(tid('page-input'), 'Enter');
  await page.waitForFunction(() => document.querySelector('[data-testid="page-input"]').value === '150', null, { timeout: 10000 });
  check('thumbnail click, prev/next, page number jump', true);
  const followed = await page.waitForSelector(tid('thumb-149'), { timeout: 5000 }).then(() => true, () => false);
  check('page list follows the current page', followed);

  await click('btn-search');
  check('search opens with the box focused', await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'search-input'));
  const ts = Date.now();
  await page.keyboard.type('Hải Phòng');
  await page.waitForFunction(() => /1 \/ 3 kết quả/.test(document.querySelector('[data-testid="search-status"]').textContent), null, { timeout: 20000 });
  const searchMs = Date.now() - ts;
  const groups = await page.$$eval('[data-testid="search-results"] .font-bold', (els) => els.map((e) => e.textContent));
  check('search finds exactly the 3 pages (7, 150, 299)', groups.join(',') === 'Trang 7,Trang 150,Trang 299', `${groups.join(',')} in ${searchMs} ms`);
  covered.add('search-result-*');
  await page.click(tid('search-result-1'));
  await page.waitForFunction(() => document.querySelector('[data-testid="page-input"]').value === '150', null, { timeout: 10000 });
  await click('search-next');
  await page.waitForFunction(() => document.querySelector('[data-testid="page-input"]').value === '299', null, { timeout: 10000 });
  await click('search-prev');
  await page.waitForFunction(() => document.querySelector('[data-testid="page-input"]').value === '150', null, { timeout: 10000 });
  check('result click, next, previous move to the right page', true);
  await page.fill(tid('search-input'), 'hải phòng');
  await page.waitForFunction(() => /3 kết quả/.test(document.querySelector('[data-testid="search-status"]').textContent), null, { timeout: 20000 });
  await click('search-match-case');
  await page.waitForFunction(() => /Không thấy/.test(document.querySelector('[data-testid="search-status"]').textContent), null, { timeout: 20000 });
  await click('search-match-case');
  await page.fill(tid('search-input'), 'Phòn');
  await page.waitForFunction(() => /3 kết quả/.test(document.querySelector('[data-testid="search-status"]').textContent), null, { timeout: 20000 });
  await click('search-whole-word');
  await page.waitForFunction(() => /Không thấy/.test(document.querySelector('[data-testid="search-status"]').textContent), null, { timeout: 20000 });
  check('match case and whole word options change the results', true);
  await click('search-whole-word');
  await collectButtons();
  await click('search-clear');
  const cleared = await page
    .waitForFunction(() => /Gõ từ cần tìm/.test(document.querySelector('[data-testid="search-status"]').textContent) && !document.querySelector('[data-testid^="search-result-"]'), null, { timeout: 10000 })
    .then(() => true, () => false);
  check('clear empties the search and its results', cleared);
  await click('tab-pages');
  await click('tab-search');
  await click('tab-pages');
  const tabOk = await page.evaluate(
    () =>
      document.querySelector('[data-testid="tab-pages"]').getAttribute('data-state') === 'active' &&
      document.querySelector('[data-testid="tab-search"]').getAttribute('data-state') === 'inactive' &&
      !!document.querySelector('[data-testid="thumbnails"]') &&
      !document.querySelector('[data-testid="search-input"]'),
  );
  check('page / search tabs switch the left panel', tabOk);
  await page.screenshot({ path: path.join(OUT, 'desktop-300.png') });

  // ── 15. Phone viewport ──────────────────────────────────────────────────
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const ph = await phoneCtx.newPage();
  track(ph);
  await ph.goto(server.base + '/?e2e');
  await ph.waitForSelector(tid('state-empty'));
  await ph.setInputFiles(tid('file-input'), FIX('sample.pdf'));
  await ph.waitForSelector(tid('page-0'), { state: 'attached', timeout: 30000 });
  await ph.waitForTimeout(1000);
  const overflow = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const exp = await ph.locator(tid('btn-export')).boundingBox();
  check('phone: no horizontal overflow, export button on screen', overflow === 0 && exp && exp.x + exp.width <= 390, `overflow ${overflow}, export right edge ${exp && Math.round(exp.x + exp.width)}`);
  check('phone: page list starts closed, tools at the bottom', !(await ph.isVisible(tid('left-panel'))) && (await ph.locator(tid('tool-text')).boundingBox()).y > 700);
  await ph.tap(tid('btn-toggle-left'));
  await ph.waitForSelector(tid('thumb-1'));
  await ph.tap(tid('thumb-1'));
  await ph.waitForTimeout(600);
  check('phone: choosing a page closes the overlay', !(await ph.isVisible(tid('left-panel'))));
  await ph.tap(tid('tool-text'));
  check('phone: tool hint visible', await ph.isVisible(tid('tool-hint')));
  await ph.screenshot({ path: path.join(OUT, 'phone.png') });
  await collectButtons(ph);
  await phoneCtx.close();

  // ── 16. Every button on screen was exercised ────────────────────────────
  const family = (id) => id.replace(/^(thumb|search-result)-\d+$/, '$1-*');
  const familyCovered = new Set([...covered].map(family));
  // picture and signature tools, closing a document: exercised by scripts/e2e-m3.cjs;
  // editing existing text: scripts/e2e-edit.cjs; scanning: scripts/e2e-scan.cjs
  const M3_COVERED = /^(tool-image|tool-signature|btn-close-doc)$/;
  // covered by e2e-edit, e2e-scan and e2e-share-print
  const LATER_COVERED = /^(tool-edit-text|btn-scan|btn-scan-empty|tool-hand|btn-share|btn-print|btn-more|btn-pages|share-(copy|sheet|reveal))$/;
  const untested = [...seenButtons].filter(
    (id) => !familyCovered.has(family(id)) && !M3_COVERED.test(id) && !LATER_COVERED.test(id) && !/^(ft-color|ft-bg|hl-color|note-color)-\d$/.test(id),
  );
  const swatchFamilies = ['ft-color', 'ft-bg', 'hl-color', 'note-color'].filter((f) => [...seenButtons].some((id) => id.startsWith(f)) && ![...covered].some((id) => id.startsWith(f)));
  check('every visible button is exercised by a step', untested.length === 0 && swatchFamilies.length === 0, untested.concat(swatchFamilies).join(', '));
  check('every visible button has a test id', unnamedButtons.size === 0, [...unnamedButtons].join(', '));

  // ── 17. Privacy and errors ──────────────────────────────────────────────
  const external = requests.filter((r) => !r.url.startsWith(origin) && !/^(blob|data):/.test(r.url));
  const nonGet = requests.filter((r) => r.method !== 'GET' && !/^(blob|data):/.test(r.url));
  check('no request to any other origin', external.length === 0, external.map((r) => r.url).join(', '));
  check('nothing uploaded (no non-GET request)', nonGet.length === 0, nonGet.map((r) => `${r.method} ${r.url}`).join(', '));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  server.stop();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, openMs, searchMs }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await onCrash().catch(() => {});
  process.exit(2);
});
