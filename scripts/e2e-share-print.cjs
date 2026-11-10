#!/usr/bin/env node
/**
 * Acceptance run for 0.6.0 in real Chromium: the hand, sharing, printing.
 *
 *  Hand (mouse devices rest on it)
 *  - the toolbar starts on the hand; over the page the cursor is a hand
 *  - dragging the page scrolls it both ways, by exactly the drag; in select
 *    mode (V) the same drag scrolls nothing (it selects text)
 *  - annotations still work under the hand: a click selects, a drag moves
 *    the annotation and not the page, a click on the page deselects
 *  - holding Space drags the page from select and from a drawing tool, which
 *    comes back on release; Esc from a drawing tool goes back to the hand
 *  Share (Web Share mocked: Linux Chromium has none)
 *  - the shared file is the exported file, named after the document
 *  - cancelling the share sheet is silent; a share refused for lack of a
 *    fresh tap offers a button that shares the prepared file
 *  - a browser without Web Share downloads the file and says how to send it
 *  Print (window.print stubbed; Chromium's own print output captured with
 *  page.pdf, i.e. what the print dialog receives)
 *  - one printed page per PDF page, each with its own size and orientation,
 *    at 300 dpi, looking like the exported PDF (scripts/verify_print.py,
 *    MuPDF); the print block goes away after printing; Ctrl P prints the
 *    document; the browser's own print gives a note, not the app's screen
 *  - a long print can be cancelled while its pages are drawn
 *  Pictures (Xuất thành ảnh, 0.8.7): PNG, JPEG (grey), TIFF (one file of
 *  every page, and a single grey page), WebP, each checked against the
 *  exported PDF by scripts/verify_page_images.py (Pillow, libtiff, tifffile,
 *  MuPDF): size at the dpi, dpi in the file, grey, look; a .zip for several
 *  pictures, the share sheet with all of them; a wrong page range; a long
 *  conversion stopped; a browser without Web Share downloads
 *  Phone: no hand (a finger scrolls), share in the top bar, print, pictures
 *  and close in the ⋮ menu, top bar not wider than the screen; the pictures
 *  dialog fits and shares
 *  iPhone (Safari's user agent): In hands the PDF to the share sheet, whose
 *  Print is AirPrint, and says so; nothing goes through window.print
 *  Drafts: the web app asks the browser to keep its storage (persist)
 *
 * Usage: node scripts/e2e-share-print.cjs
 *        BASE=http://localhost:4173 node scripts/e2e-share-print.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out', 'e2e-share-print');
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
  const port = 5188;
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

/** Stubs installed before the app loads: window.print, and (optionally) Web Share with files. */
const mocks = (share) => `
  window.__persistCalls = 0;
  if (navigator.storage) {
    Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => false });
    Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => (window.__persistCalls++, true) });
  }
  window.__printCalls = 0;
  window.print = function () {
    window.__printCalls++;
    window.__printedPages = document.querySelectorAll('#ez-print .ez-print-page').length;
  };
  if (${share}) {
    window.__shared = [];
    window.__shareMode = 'ok';
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d) => !!(d && d.files && d.files.length) });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d) => {
        const mode = window.__shareMode;
        if (mode === 'abort') throw new DOMException('Share canceled', 'AbortError');
        if (mode === 'notallowed-once') {
          window.__shareMode = 'ok';
          throw new DOMException('Must be handling a user gesture', 'NotAllowedError');
        }
        (window.__sharedSets ||= []).push(d.files.map((x) => ({ name: x.name, type: x.type, size: x.size })));
        const f = d.files[0];
        const buf = new Uint8Array(await f.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        window.__shared.push({ name: f.name, type: f.type, size: f.size, title: d.title, b64: btoa(bin) });
      },
    });
  }
`;

let onCrash = async () => {};

(async () => {
  const server = await startServer();
  // a UTF-8 locale, as on any desktop and on CI: without one Chromium drops download names with Vietnamese marks
  const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  const errors = [];
  const track = (p) => {
    p.on('pageerror', (e) => errors.push(`${e.message} @${stepName}`));
    p.on('console', (m) => m.type() === 'error' && !benignRenderRace(m) && errors.push(`${m.text()} ${m.location()?.url ?? ''} @${stepName}`));
  };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  await ctx.addInitScript(mocks(true));
  const page = await ctx.newPage();
  track(page);
  // CPU_SLOWDOWN=4: a machine as slow as a CI runner or a phone
  if (process.env.CPU_SLOWDOWN) await (await ctx.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_SLOWDOWN) });
  onCrash = async () => {
    console.error('page errors so far:', JSON.stringify(errors.slice(-10), null, 1));
    await page.screenshot({ path: path.join(OUT, 'crash.png') });
  };

  const pressed = (id) => page.getAttribute(tid(id), 'aria-pressed');
  const scrollPos = () => page.$eval('[data-ez-viewport]', (v) => ({ top: v.scrollTop, left: v.scrollLeft, canX: v.scrollWidth > v.clientWidth }));
  const pageBox = (i) => page.locator(tid(`page-${i}`)).boundingBox();
  async function drag(from, to) {
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 6 });
    await page.mouse.move(...to, { steps: 6 });
    await page.mouse.up();
    await sleep(250);
  }
  const cursorAt = (x, y) => page.evaluate(([px, py]) => getComputedStyle(document.elementFromPoint(px, py)).cursor, [x, y]);
  const annots = () => page.evaluate(() => window.__ezpdf.annotations());
  const selected = () => page.evaluate(() => window.__ezpdf.selected());
  const viewportBox = () => page.locator('[data-ez-viewport]').boundingBox();
  async function openFile(file, pages, p = page) {
    await p.setInputFiles(tid('file-input'), FIX(file));
    await p.waitForFunction((n) => document.querySelector('[data-testid="page-total"]')?.textContent?.includes(`/ ${n}`), pages, { timeout: 60000 });
    await p.waitForTimeout(900);
  }

  await page.goto(server.base + '/?e2e');
  await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
  // the start screen (0.8.8): both buttons green with white text; the running version (the one in
  // package.json) at the foot of the screen, and nowhere in the top bar
  const VERSION = require('../package.json').version;
  const startScreen = (p = page) =>
    p.evaluate(() => {
      const v = document.querySelector('[data-testid="state-empty"] [data-testid="app-version"]');
      const card = document.querySelector('[data-testid="btn-open-empty"]').closest('div.rounded-lg');
      const look = (id) => {
        const st = getComputedStyle(document.querySelector(`[data-testid="${id}"]`));
        return `${st.backgroundColor} ${st.color}`;
      };
      const r = v?.getBoundingClientRect();
      return {
        text: v?.innerText.trim() ?? null,
        fromBottom: r ? Math.round(innerHeight - r.bottom) : null,
        belowCard: r ? r.top >= card.getBoundingClientRect().bottom : false,
        centred: r ? Math.abs(r.left + r.width / 2 - innerWidth / 2) < 4 : false,
        open: look('btn-open-empty'),
        scan: look('btn-scan-empty'),
        inTopBar: !!document.querySelector('[data-testid="top-bar"] [data-testid="app-version"]'),
      };
    });
  const startOk = (st) => st.text === `ezPDF phiên bản ${VERSION}` && st.fromBottom >= 0 && st.fromBottom <= 48 && st.belowCard && st.centred && st.open === st.scan && /255, 255, 255\)$/.test(st.open) && !st.inTopBar;
  const startDesk = await startScreen();
  check(
    `start screen: Chọn tệp and Quét tài liệu both green with white text; “ezPDF phiên bản ${VERSION}” at the foot of the screen, not in the top bar`,
    startOk(startDesk),
    JSON.stringify(startDesk),
  );
  await openFile('sample.pdf', 4);
  await page.click(tid('zoom-menu'));
  await page.click(tid('zoom-150'));
  await sleep(700);

  check('the web app asks the browser to keep its drafts (persistent storage)', (await page.evaluate(() => window.__persistCalls)) === 1);

  // ── hand ──────────────────────────────────────────────────────────────────
  check('a mouse device starts on the hand, not on select', (await pressed('tool-hand')) === 'true' && (await pressed('tool-select')) === 'false');
  const vb = await viewportBox();
  const mid = [vb.x + vb.width / 2, vb.y + vb.height / 2];
  check('over the page the cursor is a hand', (await cursorAt(...mid)) === 'grab', await cursorAt(...mid));
  let s0 = await scrollPos();
  await drag(mid, [mid[0] - 150, mid[1] - 300]);
  let s1 = await scrollPos();
  check(
    'dragging the page scrolls it by the drag, down and sideways',
    Math.abs(s1.top - s0.top - 300) <= 3 && (!s0.canX || Math.abs(s1.left - s0.left - 150) <= 3),
    `Δtop ${s1.top - s0.top}, Δleft ${s1.left - s0.left} (sideways ${s0.canX ? 'possible' : 'not possible'})`,
  );
  await page.screenshot({ path: path.join(OUT, 'desktop-hand.png'), clip: { x: 0, y: 0, width: 1280, height: 60 } });

  await page.keyboard.press('v');
  check('V switches to select', (await pressed('tool-select')) === 'true' && (await pressed('tool-hand')) === 'false');
  s0 = await scrollPos();
  await drag(mid, [mid[0] - 150, mid[1] - 300]);
  s1 = await scrollPos();
  check('in select mode the same drag does not scroll (it selects text)', Math.abs(s1.top - s0.top) <= 1 && Math.abs(s1.left - s0.left) <= 1, `Δtop ${s1.top - s0.top}`);
  await page.mouse.click(...mid); // clear the text selection
  await page.evaluate(() => document.activeElement?.blur()); // Space presses a focused button

  // hold Space: drag from select, select comes back
  await page.keyboard.down('Space');
  await sleep(100);
  const spaceCursor = await cursorAt(...mid);
  s0 = await scrollPos();
  await drag(mid, [mid[0], mid[1] + 200]);
  s1 = await scrollPos();
  await page.keyboard.up('Space');
  await sleep(150);
  check(
    'holding Space in select mode drags the page; letting go brings select back',
    spaceCursor === 'grab' && Math.abs(s0.top - s1.top - 200) <= 3 && (await pressed('tool-select')) === 'true',
    `cursor ${spaceCursor}, Δtop ${s1.top - s0.top}`,
  );
  await page.keyboard.press('p');
  check('P goes back to the hand', (await pressed('tool-hand')) === 'true');

  // hold Space with the highlight tool: the drag scrolls and highlights nothing
  await page.keyboard.press('h');
  const hlHint = await page.textContent(tid('tool-hint'));
  const nBefore = (await annots()).length;
  await page.keyboard.down('Space');
  s0 = await scrollPos();
  await drag(mid, [mid[0], mid[1] - 120]);
  s1 = await scrollPos();
  await page.keyboard.up('Space');
  await sleep(150);
  check(
    'with a drawing tool, Space-drag scrolls without drawing; the tool is back after',
    Math.abs(s1.top - s0.top - 120) <= 3 && (await annots()).length === nBefore && (await pressed('tool-highlight')) === 'true',
    `Δtop ${s1.top - s0.top}`,
  );
  check('the tool hint says Esc goes back to the hand', hlHint.includes('Esc để quay về kéo trang'), hlHint);
  await page.keyboard.press('Escape');
  check('Esc from a drawing tool goes back to the hand', (await pressed('tool-hand')) === 'true' && (await pressed('tool-highlight')) === 'false');

  // annotations under the hand (whole page in view)
  await page.click(tid('zoom-menu'));
  await page.click(tid('zoom-fit-page'));
  await sleep(600);
  await page.evaluate(() => document.querySelector('[data-ez-viewport]').scrollTo(0, 0));
  await sleep(400);
  let pb = await pageBox(0);
  await page.keyboard.press('t');
  await page.mouse.click(pb.x + pb.width * 0.2, pb.y + pb.height * 0.62);
  await page.waitForSelector(tid('freetext-editor'));
  await page.keyboard.type('Bản in thử ezPDF');
  await page.keyboard.press('Escape');
  await sleep(500);
  const ft = (await annots()).find((a) => a.type === 3 && a.contents === 'Bản in thử ezPDF');
  check('a text box placed with T; the tool rests on the hand again', !!ft && (await pressed('tool-hand')) === 'true', ft && JSON.stringify(ft.rect));
  pb = await pageBox(0);
  const scale = pb.width / 595.276;
  const ftCenter = [pb.x + (ft.rect.origin.x + ft.rect.size.width / 2) * scale, pb.y + (ft.rect.origin.y + ft.rect.size.height / 2) * scale];
  await page.mouse.click(pb.x + pb.width * 0.85, pb.y + pb.height * 0.45);
  await sleep(250);
  const afterEmpty = await selected();
  await page.mouse.click(...ftCenter);
  await sleep(300);
  const afterHit = await selected();
  check('under the hand a click on the page deselects, a click on a text box selects it', afterEmpty.length === 0 && afterHit.length === 1 && afterHit[0] === ft.id, `${JSON.stringify(afterEmpty)} → ${JSON.stringify(afterHit)}`);
  s0 = await scrollPos();
  await drag(ftCenter, [ftCenter[0] + 60, ftCenter[1] + 45]);
  await sleep(300);
  s1 = await scrollPos();
  const moved = (await annots()).find((a) => a.id === ft.id);
  check(
    'dragging a selected text box moves the box, not the page',
    Math.abs(moved.rect.origin.x - ft.rect.origin.x - 60 / scale) < 2 && Math.abs(moved.rect.origin.y - ft.rect.origin.y - 45 / scale) < 2 && s1.top === s0.top,
    `moved by ${(moved.rect.origin.x - ft.rect.origin.x).toFixed(1)}, ${(moved.rect.origin.y - ft.rect.origin.y).toFixed(1)} pt; Δscroll ${s1.top - s0.top}`,
  );
  // a pan with an annotation selected keeps it selected
  s0 = await scrollPos();
  await drag([pb.x + pb.width * 0.85, pb.y + pb.height * 0.45], [pb.x + pb.width * 0.85, pb.y + pb.height * 0.45 - 120]);
  s1 = await scrollPos();
  const stillSelected = await selected();
  check('panning while a text box is selected keeps it selected', Math.abs(s1.top - s0.top - 120) <= 3 && stillSelected[0] === ft.id, `Δtop ${s1.top - s0.top}, selected ${JSON.stringify(stillSelected)}`);
  await page.evaluate(() => document.querySelector('[data-ez-viewport]').scrollTo(0, 0));
  await sleep(300);
  pb = await pageBox(0);
  await page.mouse.click(pb.x + pb.width * 0.85, pb.y + pb.height * 0.45);
  await sleep(250);

  // typing in a new box, then a click on the page under the hand: the box is finished and kept
  await page.keyboard.press('t');
  await page.mouse.click(pb.x + pb.width * 0.2, pb.y + pb.height * 0.75);
  await page.waitForSelector(tid('freetext-editor'));
  await page.keyboard.type('Ô thứ hai');
  await page.mouse.click(pb.x + pb.width * 0.85, pb.y + pb.height * 0.45);
  await sleep(500);
  const second = (await annots()).find((a) => a.type === 3 && a.contents === 'Ô thứ hai');
  check(
    'a click on the page under the hand finishes the box being typed in',
    !!second && !(await page.isVisible(tid('freetext-editor'))) && (await pressed('tool-hand')) === 'true',
    second ? 'kept' : 'missing',
  );

  // a tap of Space still pages down, Shift+Space up
  await page.evaluate(() => document.activeElement?.blur());
  s0 = await scrollPos();
  await page.keyboard.press('Space');
  await sleep(500);
  s1 = await scrollPos();
  await page.keyboard.press('Shift+Space');
  await sleep(500);
  const s2 = await scrollPos();
  const vh = await page.$eval('[data-ez-viewport]', (v) => v.clientHeight);
  check(
    'a tap of Space (no drag) pages down, Shift+Space pages up',
    Math.abs(s1.top - s0.top - vh * 0.9) <= 3 && Math.abs(s2.top - s0.top) <= 3,
    `Δ ${s1.top - s0.top} of ${Math.round(vh * 0.9)}, back to ${s2.top - s0.top}`,
  );
  await page.evaluate(() => document.querySelector('[data-ez-viewport]').scrollTo(0, 0));
  await page.waitForSelector(tid('state-draft-saved'), { timeout: 20000 }).catch(() => {});

  // ── share ─────────────────────────────────────────────────────────────────
  const shared = () => page.evaluate(() => window.__shared.map((f) => ({ ...f, b64: undefined, len: f.b64.length })));
  await page.click(tid('btn-share'));
  await page.waitForFunction(() => window.__shared.length === 1, null, { timeout: 30000 });
  const sh = await page.evaluate(() => window.__shared[0]);
  const sharedBytes = Buffer.from(sh.b64, 'base64');
  fs.writeFileSync(path.join(OUT, 'shared.pdf'), sharedBytes);
  check('Share hands one PDF file, named after the document', sh.name === 'sample.pdf' && sh.type === 'application/pdf' && sharedBytes.subarray(0, 5).toString() === '%PDF-', `${sh.name}, ${sh.type}, ${sh.size} B`);
  const dl = page.waitForEvent('download');
  await page.click(tid('btn-export'));
  const exportedPath = path.join(OUT, 'exported.pdf');
  await (await dl).saveAs(exportedPath);
  const exported = fs.readFileSync(exportedPath);
  const sameFile = Buffer.compare(exported, sharedBytes) === 0;
  const inspect = (f) => {
    const r = spawnSync('python3', ['-c', `
import pikepdf, sys, json
p = pikepdf.open(sys.argv[1])
out = []
for pg in p.pages:
    out.append([str(a.get('/Subtype')) + ':' + str(a.get('/Contents', '')) for a in (pg.get('/Annots') or [])])
print(json.dumps({'pages': len(p.pages), 'annots': out, 'rot': [int(pg.get('/Rotate', 0)) for pg in p.pages]}))
`, f], { encoding: 'utf8' });
    return JSON.parse(r.stdout || '{}');
  };
  const iShared = inspect(path.join(OUT, 'shared.pdf'));
  const iExported = inspect(exportedPath);
  check(
    'the shared file is the exported file (same bytes, or same pages, rotations and annotations)',
    sameFile || JSON.stringify(iShared) === JSON.stringify(iExported),
    sameFile ? 'identical bytes' : `${JSON.stringify(iShared)} vs ${JSON.stringify(iExported)}`,
  );
  check(
    'the shared file carries the text boxes just added',
    JSON.stringify(iShared.annots ?? []).includes('Bản in thử ezPDF') && JSON.stringify(iShared.annots ?? []).includes('Ô thứ hai'),
    JSON.stringify(iShared.annots),
  );

  await page.evaluate(() => (window.__shareMode = 'abort'));
  await page.click(tid('btn-share'));
  await sleep(1500);
  check('closing the share sheet without choosing is silent', !(await page.isVisible(tid('banner-output'))) && (await shared()).length === 1);

  await page.evaluate(() => (window.__shareMode = 'notallowed-once'));
  await page.click(tid('btn-share'));
  await page.waitForSelector(tid('btn-output-action'), { timeout: 30000 });
  const readyText = await page.textContent(tid('banner-output-text'));
  await page.click(tid('btn-output-action'));
  await page.waitForFunction(() => window.__shared.length === 2, null, { timeout: 10000 }).catch(() => {});
  check(
    'if the browser wants a fresh tap, a button shares the file already prepared',
    readyText.includes('sẵn sàng') && (await shared()).length === 2 && !(await page.isVisible(tid('banner-output'))),
    readyText,
  );

  // ── print ─────────────────────────────────────────────────────────────────
  await page.click(tid('btn-print'));
  await page.waitForFunction(() => window.__printCalls === 1, null, { timeout: 60000 });
  const job = await page.evaluate(() => ({
    pages: window.__printedPages,
    printing: document.body.classList.contains('ez-printing'),
    title: document.title,
    sizes: [...document.querySelectorAll('#ez-print .ez-print-page')].map((e) => e.style.width + ' ' + e.style.height),
    style: document.getElementById('ez-print-style')?.textContent ?? '',
  }));
  check('In draws every page and opens the print dialog', job.pages === 4 && job.printing && !(await page.isVisible(tid('print-progress'))), `${job.pages} pages · ${job.sizes.join(' | ')}`);
  check('the print dialog proposes the document’s name', job.title === 'sample', job.title);
  const printedPath = path.join(OUT, 'printed.pdf');
  await page.pdf({ path: printedPath, preferCSSPageSize: true, printBackground: true });
  const v = spawnSync('python3', [path.join(ROOT, 'scripts/verify_print.py'), printedPath, exportedPath, '290', path.join(OUT, 'verify-print.json')], { encoding: 'utf8' });
  process.stdout.write(v.stdout.trimEnd().replace(/^/gm, '    ') + '\n');
  check('the printout matches the exported PDF: pages, sizes, orientation, 300 dpi, look (verify_print.py)', v.status === 0, v.status === 0 ? '' : v.stderr.slice(-300));
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await sleep(200);
  const after = await page.evaluate(() => ({ block: !!document.getElementById('ez-print'), style: !!document.getElementById('ez-print-style'), cls: document.body.classList.contains('ez-printing'), title: document.title }));
  check('after printing the print block is gone and the title is back', !after.block && !after.style && !after.cls && after.title === 'ezPDF', JSON.stringify(after));

  await page.keyboard.press('Control+p');
  await page.waitForFunction(() => window.__printCalls === 2, null, { timeout: 60000 }).catch(() => {});
  check('Ctrl P prints the document (not the app’s screen)', (await page.evaluate(() => window.__printCalls)) === 2 && (await page.evaluate(() => window.__printedPages)) === 4);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await sleep(200);
  const uiPrint = path.join(OUT, 'printed-from-browser-menu.pdf');
  await page.pdf({ path: uiPrint, preferCSSPageSize: true });
  const uiText = spawnSync('pdftotext', [uiPrint, '-'], { encoding: 'utf8' }).stdout.replace(/\s+/g, ' ').trim();
  check('the browser’s own Print gives a note pointing to the In button, not the app’s screen', uiText.includes('Hãy dùng nút In trong ezPDF') && uiText.length < 80, uiText);

  // ── pages as pictures (Xuất thành ảnh, 0.8.7) ─────────────────────────────
  // its button joins the top bar: the bar must still fit the desktop app's 1280 px window
  const bar = await page.evaluate(() => {
    const h = document.querySelector('[data-testid="top-bar"]');
    const x = document.querySelector('[data-testid="btn-export"]').getBoundingClientRect();
    const i = document.querySelector('[data-testid="top-bar"] [data-testid="btn-images"]');
    return { fits: h.scrollWidth <= h.clientWidth, exportRight: Math.round(x.right), width: innerWidth, images: i?.previousElementSibling?.dataset.testid };
  });
  check(
    'pictures: “Xuất thành ảnh” beside In in the top bar, and the bar still fits a 1280 px window (Xuất PDF fully on screen)',
    bar.fits && bar.exportRight <= bar.width && bar.images === 'btn-print',
    JSON.stringify(bar),
  );
  // the same state as the export above: the two text boxes on page 1
  const { unzipSync } = require('fflate');
  const setSelect = (sel, v) =>
    page.$eval(sel, (el, value) => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, v);
  const verifyPictures = (fmt, dpi, pages, gray, files, tag) => {
    const r = spawnSync('python3', [path.join(ROOT, 'scripts/verify_page_images.py'), exportedPath, fmt, String(dpi), pages.join(','), gray ? '1' : '0', ...files, '--report', path.join(OUT, `verify-images-${tag}.json`)], { encoding: 'utf8' });
    process.stdout.write(r.stdout.trimEnd().replace(/^/gm, '    ') + '\n');
    return r;
  };
  /** the dialog, set up; returns the download its "Tải về" gives */
  async function pictures({ format, pagesText, current, dpi, quality, gray, oneTiff }) {
    await page.click(tid('btn-images'));
    await page.waitForSelector(tid('images-dialog'));
    await page.click(tid(`images-format-${format}`));
    if (current) await page.click(tid('images-pages-current'));
    else if (pagesText) await page.fill(tid('images-pages-text'), pagesText);
    else await page.click(tid('images-pages-all'));
    await setSelect(tid('images-dpi'), String(dpi));
    if (quality) await page.$eval(tid('images-quality'), (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, String(quality));
    if ((await page.isChecked(tid('images-gray'))) !== !!gray) await page.click(tid('images-gray'));
    if (oneTiff !== undefined && (await page.$(tid('images-one-tiff'))) && (await page.isChecked(tid('images-one-tiff'))) !== oneTiff) await page.click(tid('images-one-tiff'));
    const label = await page.textContent(tid('images-go'));
    await page.click(tid('images-go'));
    await page.waitForSelector(tid('images-done'), { timeout: 90000 });
    const done = await page.textContent(tid('images-done-text'));
    const dl = page.waitForEvent('download');
    await page.click(tid('images-download'));
    const d = await dl;
    const saved = path.join(OUT, d.suggestedFilename());
    await d.saveAs(saved);
    return { label, done, saved, name: d.suggestedFilename() };
  }
  const unzip = (zipPath, dir) => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const entries = unzipSync(fs.readFileSync(zipPath));
    return Object.keys(entries).sort().map((n) => (fs.writeFileSync(path.join(dir, n), entries[n]), path.join(dir, n)));
  };

  {
    const r = await pictures({ format: 'png', pagesText: '1-2', dpi: 96 });
    const files = unzip(r.saved, path.join(OUT, 'png'));
    const names = files.map((f) => path.basename(f));
    const v = verifyPictures('png', 96, [1, 2], false, files, 'png');
    check(
      'pictures: PNG of pages 1–2 at 96 dpi, one .zip of “sample - trang 1.png”, “… 2.png”, each the size of its page, 96 dpi in the file, looking like the exported page (text boxes included)',
      r.label.includes('Xuất 2 ảnh PNG') && r.name === 'sample (ảnh PNG).zip' && names.join('|') === 'sample - trang 1.png|sample - trang 2.png' && v.status === 0,
      `${r.label} · ${r.name} · ${names.join(', ')}${v.status ? ' · ' + v.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ') : ''}`,
    );
    // with Web Share (phones, Chrome on Windows): the same pictures to the share sheet, all of them in one go
    await page.click(tid('images-share'));
    await page.waitForFunction(() => (window.__sharedSets || []).some((s) => s.length === 2 && s[0].type === 'image/png'), null, { timeout: 10000 }).catch(() => {});
    const set = await page.evaluate(() => (window.__sharedSets || []).at(-1));
    check('pictures: “Lưu hoặc chia sẻ” hands both pictures to the share sheet at once (on iPhone: Lưu hình ảnh)', set && set.length === 2 && set.map((f) => f.name).join('|') === 'sample - trang 1.png|sample - trang 2.png', JSON.stringify(set));
    await page.click(tid('images-finish'));
  }
  {
    const r = await pictures({ format: 'jpeg', current: true, dpi: 150, quality: 70, gray: true });
    const v = verifyPictures('jpeg', 150, [1], true, [r.saved], 'jpeg');
    check(
      'pictures: JPEG of the page in view, grey, quality 70, 150 dpi: one .jpg, 150 dpi in its JFIF header, grey, like the page',
      r.name === 'sample - trang 1.jpg' && v.status === 0,
      `${r.name}${v.status ? ' · ' + v.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ') : ''}`,
    );
    await page.click(tid('images-finish'));
  }
  {
    const r = await pictures({ format: 'tiff', dpi: 72, gray: false, oneTiff: true });
    const v = verifyPictures('tiff', 72, [1, 2, 3, 4], false, [r.saved], 'tiff');
    check(
      'pictures: TIFF of every page in one file “sample.tif”: 4 pages, LZW with predictor (ezPDF’s own writer, read by libtiff and tifffile), each page the size of its page (page 2 turned), like the page',
      r.label.includes('Xuất 1 ảnh TIFF') && r.name === 'sample.tif' && v.status === 0,
      `${r.label} · ${r.name}${v.status ? ' · ' + v.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ') : ''}`,
    );
    await page.click(tid('images-finish'));
  }
  {
    const r = await pictures({ format: 'tiff', pagesText: '3', dpi: 96, gray: true });
    const v = verifyPictures('tiff', 96, [3], true, [r.saved], 'tiff-gray');
    check('pictures: TIFF of page 3 alone, grey (one sample per pixel): “sample - trang 3.tif”', r.name === 'sample - trang 3.tif' && v.status === 0, `${r.name}${v.status ? ' · ' + v.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ') : ''}`);
    await page.click(tid('images-finish'));
  }
  {
    const r = await pictures({ format: 'webp', pagesText: '4', dpi: 72, gray: false });
    const v = verifyPictures('webp', 72, [4], false, [r.saved], 'webp');
    check('pictures: WebP where the browser writes it (Chromium): page 4, like the page', r.name === 'sample - trang 4.webp' && v.status === 0, `${r.name}${v.status ? ' · ' + v.stdout.split('\n').filter((l) => l.startsWith('FAIL')).join(' | ') : ''}`);
    await page.click(tid('images-finish'));
  }
  {
    // a page list that is not one: said at once, nothing to start
    await page.click(tid('btn-images'));
    await page.waitForSelector(tid('images-dialog'));
    await page.fill(tid('images-pages-text'), '2-9');
    const err = await page.textContent(tid('images-pages-error')).catch(() => '');
    const disabled = await page.isDisabled(tid('images-go'));
    check('pictures: a page range outside the document is explained and nothing can start', err.includes('nằm ngoài tài liệu') && disabled, err);
    await page.click(tid('images-cancel'));
    await page.waitForSelector(tid('images-dialog'), { state: 'detached' });
  }

  // cancel a long print while its pages are being drawn
  await openFile('long-300.pdf', 300);
  await page.click(tid('btn-print'));
  await page.waitForSelector(tid('print-progress'), { timeout: 30000 });
  await page.waitForFunction(() => /Trang [1-9]\d*\/300/.test(document.querySelector('[data-testid="print-progress-text"]')?.textContent ?? ''), null, { timeout: 30000 });
  const progressText = await page.textContent(tid('print-progress-text'));
  await page.click(tid('print-cancel'));
  await page.waitForSelector(tid('print-progress'), { state: 'detached', timeout: 30000 });
  await sleep(800);
  const cancelState = await page.evaluate(() => ({ calls: window.__printCalls, block: !!document.getElementById('ez-print') }));
  check(
    'a long print shows its progress and can be cancelled: nothing is printed',
    cancelState.calls === 2 && !cancelState.block && !(await page.isVisible(tid('banner-output'))),
    `${progressText} → ${JSON.stringify(cancelState)}`,
  );
  {
    // a long conversion shows its progress and stops at once: nothing to download
    await page.click(tid('btn-images'));
    await page.waitForSelector(tid('images-dialog'));
    await page.click(tid('images-format-png'));
    await page.click(tid('images-pages-all'));
    await setSelect(tid('images-dpi'), '72');
    await page.click(tid('images-go'));
    await page.waitForFunction(() => /Trang [1-9]\d*\/300/.test(document.querySelector('[data-testid="images-progress"]')?.textContent ?? ''), null, { timeout: 60000 });
    const progress = await page.textContent(tid('images-progress'));
    await page.click(tid('images-stop'));
    await sleep(1500);
    const back = (await page.isVisible(tid('images-go'))) && !(await page.$(tid('images-done')));
    check('pictures: 300 pages show their progress and stop when asked, back to the options, no download', back, `${progress} → options ${back}`);
    await page.click(tid('images-cancel'));
  }
  check('no page errors (desktop)', errors.length === 0, errors.slice(0, 5).join(' | '));

  // ── a browser without Web Share ─────────────────────────────────────────────
  {
    const c2 = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
    await c2.addInitScript(mocks(false));
    const p2 = await c2.newPage();
    track(p2);
    await p2.goto(server.base + '/?e2e');
    await p2.waitForSelector(tid('state-empty'), { timeout: 60000 });
    await openFile('sample.pdf', 4, p2);
    const label = await p2.getAttribute(tid('btn-share'), 'aria-label');
    const d2 = p2.waitForEvent('download');
    await p2.click(tid('btn-share'));
    const got = await d2;
    await p2.waitForSelector(tid('banner-output'));
    const t2 = await p2.textContent(tid('banner-output-text'));
    check(
      'without Web Share the button downloads the file and says how to send it',
      label === 'Tải tệp về để gửi đi' && got.suggestedFilename() === 'sample.pdf' && t2.includes('kéo tệp vào Zalo'),
      `${label} · ${got.suggestedFilename()} · ${t2}`,
    );
    // pictures there: no share button, the download is the way
    await p2.click(tid('btn-images'));
    await p2.waitForSelector(tid('images-dialog'));
    await p2.click(tid('images-pages-current'));
    await p2.click(tid('images-go'));
    await p2.waitForSelector(tid('images-done'), { timeout: 60000 });
    const noShare = !(await p2.$(tid('images-share')));
    const d3 = p2.waitForEvent('download');
    await p2.click(tid('images-download'));
    const pic = await d3;
    check('without Web Share the pictures are downloaded (no share button)', noShare && pic.suggestedFilename() === 'sample - trang 1.png', `${noShare} · ${pic.suggestedFilename()}`);
    await c2.close();
  }

  // ── phone ─────────────────────────────────────────────────────────────────
  {
    const pctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    await pctx.addInitScript(mocks(true));
    const ph = await pctx.newPage();
    track(ph);
    await ph.goto(server.base + '/?e2e');
    await ph.waitForSelector(tid('state-empty'), { timeout: 60000 });
    const startPhone = await startScreen(ph);
    check(`phone: the start screen too, with “ezPDF phiên bản ${VERSION}” at its foot`, startOk(startPhone), JSON.stringify(startPhone));
    await ph.setInputFiles(tid('file-input'), FIX('sample.pdf'));
    await ph.waitForSelector(tid('page-0'), { timeout: 60000 });
    await ph.waitForTimeout(1200);
    const header = await ph.$eval('header', (h) => ({ sw: h.scrollWidth, cw: h.clientWidth }));
    const hasHand = (await ph.$$(tid('tool-hand'))).length;
    const selectOn = await ph.getAttribute(tid('tool-select'), 'aria-pressed');
    await ph.tap(tid('btn-more'));
    await ph.waitForSelector(`[role="menu"] ${tid('btn-print')}`);
    const menu = await ph.$$eval('[role="menu"] [data-testid]', (els) => els.map((e) => e.dataset.testid));
    await ph.screenshot({ path: path.join(OUT, 'phone-more-menu.png') });
    check(
      'phone: no hand (a finger scrolls), select is on; share and Bộ công cụ in the top bar; print, pictures and close in ⋮; the bar fits the screen',
      !hasHand && selectOn === 'true' && (await ph.isVisible(tid('btn-share'))) && (await ph.isVisible(tid('btn-pages'))) && menu.join() === 'btn-print,btn-images,btn-close-doc' && header.sw <= header.cw + 1,
      `hand ${hasHand}, select ${selectOn}, menu ${menu.join(' ')}, header ${header.sw}/${header.cw}`,
    );
    await ph.tap(`[role="menu"] ${tid('btn-print')}`);
    await ph.waitForFunction(() => window.__printCalls === 1, null, { timeout: 60000 }).catch(() => {});
    check('phone browser: In from the menu prints the pages', (await ph.evaluate(() => window.__printedPages)) === 4);
    await ph.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await ph.tap(tid('btn-share'));
    await ph.waitForFunction(() => window.__shared.length === 1, null, { timeout: 30000 }).catch(() => {});
    check('phone browser: Share hands the PDF to the share sheet', (await ph.evaluate(() => window.__shared.length)) === 1);
    // pictures from ⋮: the dialog fits the phone; the page in view goes to the share sheet
    await ph.tap(tid('btn-more'));
    await ph.waitForSelector(`[role="menu"] ${tid('btn-images')}`);
    await ph.tap(`[role="menu"] ${tid('btn-images')}`);
    await ph.waitForSelector(tid('images-dialog'));
    const fit = await ph.$eval(tid('images-dialog'), (d) => { const r = d.getBoundingClientRect(); return { l: r.left, r: r.right, sw: d.scrollWidth, cw: d.clientWidth, vw: innerWidth }; });
    await ph.screenshot({ path: path.join(OUT, 'phone-images.png') });
    await ph.tap(tid('images-pages-current'));
    await ph.tap(tid('images-go'));
    await ph.waitForSelector(tid('images-done'), { timeout: 60000 });
    await ph.tap(tid('images-share'));
    await ph.waitForFunction(() => (window.__sharedSets || []).some((s) => s.length === 1 && s[0].type === 'image/png'), null, { timeout: 10000 }).catch(() => {});
    const phSet = await ph.evaluate(() => (window.__sharedSets || []).at(-1));
    check(
      'phone browser: Xuất thành ảnh from ⋮, the dialog within the screen; the page in view goes to the share sheet as a PNG',
      fit.l >= 0 && fit.r <= fit.vw && fit.sw <= fit.cw + 1 && phSet && phSet.length === 1 && /^sample - trang [1-4]\.png$/.test(phSet[0].name),
      `${JSON.stringify(fit)} · ${JSON.stringify(phSet)}`,
    );
    await pctx.close();
  }

  // ── iPhone ────────────────────────────────────────────────────────────────
  {
    // the iPhone 15 Pro Max's screen
    const ictx = await browser.newContext({
      viewport: { width: 430, height: 932 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    await ictx.addInitScript(mocks(true));
    const ip = await ictx.newPage();
    track(ip);
    await ip.goto(server.base + '/?e2e');
    await ip.waitForSelector(tid('state-empty'), { timeout: 60000 });
    const startIphone = await startScreen(ip);
    check(`iPhone 15 Pro Max: the start screen with “ezPDF phiên bản ${VERSION}” at its foot`, startOk(startIphone), JSON.stringify(startIphone));
    await ip.setInputFiles(tid('file-input'), FIX('sample.pdf'));
    await ip.waitForSelector(tid('page-0'), { timeout: 60000 });
    await ip.waitForTimeout(1200);
    await ip.tap(tid('btn-more'));
    await ip.waitForSelector(`[role="menu"] ${tid('btn-print')}`);
    await ip.tap(`[role="menu"] ${tid('btn-print')}`);
    await ip.waitForFunction(() => window.__shared.length === 1, null, { timeout: 60000 }).catch(() => {});
    const got = await ip.evaluate(() => ({
      shared: window.__shared.map((f) => [f.name, f.type, atob(f.b64.slice(0, 8)).slice(0, 5)]),
      printCalls: window.__printCalls,
      block: !!document.getElementById('ez-print'),
    }));
    const said = await ip.textContent(tid('banner-output-text')).catch(() => '');
    await ip.screenshot({ path: path.join(OUT, 'iphone-print.png') });
    check(
      'iPhone: In hands the PDF to the share sheet (AirPrint) and says to choose Print; no window.print',
      JSON.stringify(got.shared) === JSON.stringify([['sample.pdf', 'application/pdf', '%PDF-']]) && got.printCalls === 0 && !got.block && said.includes('chọn “In”'),
      `${JSON.stringify(got)} · ${said}`,
    );
    await ictx.close();
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
