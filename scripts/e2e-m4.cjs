#!/usr/bin/env node
/**
 * Acceptance run for milestone 4 (web side) in real Chromium.
 *
 * Dev server (default):
 *  - storage interface: the contract on the web adapter (IndexedDB) and on
 *    the Android adapter's code over Capacitor Filesystem's web
 *    implementation; drafts and signatures kept by M3 still open
 *  - "Open with" for an installed web app (launchQueue) opens the document
 *
 * Production build (BASE=http://localhost:4173, `npm run preview`):
 *  - installable: manifest with icons, no installability errors
 *  - service worker caches every file of the build
 *  - offline: the app starts, opens a PDF, takes Vietnamese text, keeps a
 *    draft and exports a PDF that MuPDF reads back
 *  - Content-Security-Policy: no violation in normal use, and a request to
 *    another site is refused by the browser
 *  - "Open with" (launchQueue) as above
 *  - every request went to the app's own origin
 *
 * Usage: node scripts/e2e-m4.cjs
 *        BASE=http://localhost:4173 node scripts/e2e-m4.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out', 'e2e-m4');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const FIX = (f) => path.join(ROOT, 'tests/fixtures', f);
const PROD = !!process.env.BASE;
const TEXT = 'Ký nhận ngoại tuyến: Đã đọc và đồng ý.';

const results = [];
let stepName = 'start';
function check(name, ok, detail = '') {
  stepName = name;
  results.push({ name, ok: !!ok, detail: String(detail ?? '') });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tid = (id) => `[data-testid="${id}"]`;

async function startServer() {
  if (PROD) return { base: process.env.BASE, stop() {} };
  const port = 5184;
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
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
        return { base, stop: () => proc.kill('SIGTERM') };
      }
    } catch {}
    await sleep(200);
  }
  proc.kill();
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
  const cspViolations = [];
  function track(p) {
    p.on('request', (r) => requests.push(r.url()));
    p.on('pageerror', (e) => errors.push(`${e.message} @${stepName}`));
    p.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/Content Security Policy/i.test(t)) cspViolations.push(`${t} @${stepName}`);
      else errors.push(`${t} ${m.location()?.url ?? ''} @${stepName}`);
    });
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  ctx.on('request', (r) => requests.push(r.url()));
  // "Open with ezPDF" for an installed web app arrives through window.launchQueue;
  // Chromium only provides it to installed apps, so the test stands in for it.
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer: (cb) => (window.__launchConsumer = cb) } });
    document.addEventListener('securitypolicyviolation', (e) => (window.__csp = window.__csp || []).push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  let page = await ctx.newPage();

  onCrash = async () => {
    // for CI: the screen and the page errors at the moment of the crash
    console.error('page errors so far:', JSON.stringify(errors.slice(-10), null, 1));
    await page.screenshot({ path: path.join(OUT, 'crash.png') });
    console.error('screenshot:', path.join(OUT, 'crash.png'));
  };
  track(page);

  async function waitDoc(pages, p = page) {
    await p.waitForFunction((n) => document.querySelector('[data-testid="page-total"]')?.textContent?.includes(`/ ${n}`), pages, { timeout: 60000 });
    await p.waitForSelector(tid('page-0'), { state: 'attached', timeout: 30000 });
    await p.waitForTimeout(800);
  }
  async function pick(triggerId, file) {
    const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
    await page.click(tid(triggerId));
    await (await chooser).setFiles(file);
  }
  async function toScreen(i, x, y) {
    const b = await page.locator(tid(`page-${i}`)).boundingBox();
    const pg = (await page.evaluate(() => window.__ezpdf.pages()))[i];
    return [b.x + (x / pg.w) * b.width, b.y + (y / pg.h) * b.height];
  }

  // ── storage interface in the browser (dev only: the test page is not in the build) ──
  if (!PROD) {
    const sp = await ctx.newPage();
    track(sp);
    await sp.goto(server.base + '/tests/storage.html');
    await sp.waitForFunction(() => window.__storage, null, { timeout: 120000 });
    const suites = await sp.evaluate(() => window.__storage);
    for (const s of suites) {
      const bad = s.checks.filter((c) => !c.ok);
      check(`storage: ${s.suite}`, bad.length === 0, `${s.checks.length - bad.length}/${s.checks.length} checks${bad.length ? ': ' + bad.map((c) => `${c.name} (${c.detail || ''})`).join('; ') : ''}`);
    }
    await sp.close();
  }

  // ── installable web app (production build) ──
  if (PROD) {
    await page.goto(server.base + '/?e2e');
    await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      const url = new URL(link.getAttribute('href'), location.href).href;
      const m = await (await fetch(url)).json();
      const icons = [];
      for (const i of m.icons) {
        const r = await fetch(new URL(i.src, url));
        const bmp = await createImageBitmap(await r.blob());
        icons.push({ src: i.src, sizes: i.sizes, purpose: i.purpose, ok: r.ok, real: `${bmp.width}x${bmp.height}` });
      }
      return { m, icons };
    });
    check(
      'manifest: name, standalone, start URL, theme colour, icons of the declared size (any + maskable)',
      manifest.m.name === 'ezPDF' &&
        manifest.m.display === 'standalone' &&
        manifest.m.start_url &&
        manifest.m.theme_color === '#0b6e69' &&
        manifest.icons.every((i) => i.ok && i.real === i.sizes) &&
        manifest.icons.some((i) => i.purpose === 'maskable') &&
        manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any'),
      manifest.icons.map((i) => `${i.src} ${i.real} ${i.purpose}`).join(', '),
    );
    check('manifest: registered as a PDF handler for "Open with"', JSON.stringify(manifest.m.file_handlers).includes('application/pdf'));

    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
      const text = await (await fetch(reg.active.scriptURL)).text();
      const files = JSON.parse(text.slice(text.indexOf('const FILES = ') + 14, text.indexOf(';\nconst CACHE')));
      const names = await caches.keys();
      const cache = await caches.open(names.find((n) => n.startsWith('ezpdf-')));
      const keys = (await cache.keys()).map((r) => new URL(r.url).pathname.replace(/^\//, ''));
      return { state: reg.active.state, controlled: !!navigator.serviceWorker.controller, files, missing: files.filter((f) => !keys.includes(f)), names };
    });
    check(
      'service worker active, controls the page and caches every file of the build',
      sw.state === 'activated' && sw.controlled && sw.missing.length === 0 && sw.files.some((f) => f.endsWith('.wasm')) && sw.files.some((f) => f.endsWith('.ttf')),
      `${sw.files.length} files, missing: ${sw.missing.join(' ') || 'none'}`,
    );

    const cdp = await ctx.newCDPSession(page);
    const inst = await cdp.send('Page.getInstallabilityErrors');
    const app = await cdp.send('Page.getAppManifest');
    check(
      'Chromium finds no installability error and no manifest error',
      inst.installabilityErrors.length === 0 && app.errors.length === 0,
      JSON.stringify([...inst.installabilityErrors, ...app.errors]),
    );

    // ── offline ──
    await ctx.setOffline(true);
    // a same-origin file that is not in the cache must fail: the network is really off
    const offlineProbe = await page.evaluate(() => fetch(`./not-cached-${Date.now()}.txt`).then(() => 'reached', () => 'failed'));
    await page.reload();
    await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
    check('offline: the app starts from the device (network really off)', offlineProbe === 'failed');
    await pick('btn-open-empty', FIX('sample.pdf'));
    await waitDoc(4);
    check('offline: a PDF opens (engine and fonts from the cache)', true);
    await page.click(tid('tool-text'));
    const [x0, y0] = await toScreen(0, 72, 520);
    const [x1, y1] = await toScreen(0, 372, 560);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 8 });
    await page.mouse.up();
    await page.waitForSelector(tid('freetext-editor'));
    await page.keyboard.press('Control+A');
    await page.keyboard.type(TEXT);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const ft = (await page.evaluate(() => window.__ezpdf.annotations())).find((a) => a.type === 3);
    check('offline: Vietnamese text added', ft && ft.contents === TEXT, ft && ft.contents);
    await page.waitForSelector(tid('state-draft-saved'), { timeout: 30000 });
    check('offline: the draft is saved on the device', true, await page.textContent(tid('state-dirty')));
    const dl = page.waitForEvent('download');
    await page.click(tid('btn-export'));
    const d = await dl;
    const file = path.join(OUT, 'offline-export.pdf');
    await d.saveAs(file);
    await page.waitForSelector(tid('state-exported'), { timeout: 30000 });
    let readBack = '';
    try {
      readBack = execFileSync(
        'python3',
        ['-c', 'import sys,pymupdf; d=pymupdf.open(sys.argv[1]); print("|".join(a.info.get("content","") for a in d[0].annots()))', file],
        { encoding: 'utf8' },
      ).trim();
    } catch (e) {
      readBack = String(e.stderr || e);
    }
    check('offline: export downloads a PDF that MuPDF reads, with the text', readBack.includes(TEXT), `${d.suggestedFilename()} · ${readBack}`);
    await page.screenshot({ path: path.join(OUT, 'offline.png') });
    await ctx.setOffline(false);

    // ── Content-Security-Policy ──
    const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || '');
    check('the page declares a Content-Security-Policy limited to its own origin', /connect-src 'self' blob: data:/.test(csp) && /default-src 'self'/.test(csp), csp);
    const before = (await page.evaluate(() => window.__csp || [])).length;
    const blocked = await page.evaluate(() => fetch('https://example.org/upload', { method: 'POST', body: 'x' }).then(() => 'sent', (e) => 'refused'));
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__csp || []);
    check('a request to another site is refused by the browser (CSP), even online', blocked === 'refused' && after.length > before, after.slice(before).join(' | '));
  }

  // ── "Open with" through launchQueue ──
  if (!PROD) {
    await page.goto(server.base + '/?e2e');
    await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
  }
  const b64 = fs.readFileSync(FIX('long-300.pdf')).toString('base64');
  const prevDoc = await page.evaluate(() => window.__ezpdf?.documentId ?? null);
  await page.evaluate((data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const f = new File([bytes], 'mo-tu-explorer.pdf', { type: 'application/pdf' });
    window.__launchConsumer({ files: [{ kind: 'file', getFile: async () => f }] });
  }, b64);
  await page.waitForFunction((p) => window.__ezpdf?.documentId && window.__ezpdf.documentId !== p, prevDoc, { timeout: 60000 }).catch(() => {});
  await waitDoc(300).catch(() => {});
  const shown = await page.textContent('body');
  check('"Open with ezPDF" (launchQueue) opens the file it is given', shown.includes('mo-tu-explorer.pdf') && (await page.textContent(tid('page-total'))).includes('/ 300'));

  // ── phone: touch scrolling, pinch zoom, which page a rotation hits ──
  {
    const pctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    pctx.on('request', (r) => requests.push(r.url()));
    const ph = await pctx.newPage();
    track(ph);
    await ph.goto(server.base + '/?e2e');
    await ph.waitForSelector(tid('state-empty'), { timeout: 60000 });
    const chooser = ph.waitForEvent('filechooser');
    await ph.click(tid('btn-open-empty'));
    await (await chooser).setFiles(FIX('long-300.pdf'));
    await ph.waitForSelector(tid('page-0'), { state: 'attached', timeout: 60000 });
    await ph.waitForTimeout(1500);
    const cdp = await pctx.newCDPSession(ph);
    const tp = (x, y, id = 0) => ({ x, y, id, radiusX: 5, radiusY: 5, force: 1 });
    const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    const scrollTop = () =>
      ph.evaluate(() => {
        const el = [...document.querySelectorAll('[data-testid="viewer"] *')].find((e) => e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY));
        return el ? el.scrollTop : -1;
      });
    const swipeUp = async (x, y, dy) => {
      await touch('touchStart', [tp(x, y)]);
      for (let i = 1; i <= 10; i++) {
        await touch('touchMove', [tp(x, y - (dy * i) / 10)]);
        await ph.waitForTimeout(16);
      }
      await touch('touchEnd', []);
      await ph.waitForTimeout(700);
    };
    const pb = await ph.locator(tid('page-0')).boundingBox();
    const t0 = await scrollTop();
    await swipeUp(pb.x + pb.width / 2, Math.min(pb.y + pb.height * 0.7, 700), 300);
    const t1 = await scrollTop();
    check('phone: one finger on the page scrolls the document (not only on the grey margin)', t1 > t0 + 150, `scrollTop ${t0} → ${t1}`);

    const widthOf = () => ph.evaluate(() => document.querySelector('[data-testid="viewer"] [data-testid^="page-"]').getBoundingClientRect().width);
    const w0 = await widthOf();
    await touch('touchStart', [tp(166, 450, 1), tp(246, 450, 2)]);
    for (let i = 1; i <= 10; i++) {
      await touch('touchMove', [tp(166 - i * 8, 450, 1), tp(246 + i * 8, 450, 2)]);
      await ph.waitForTimeout(16);
    }
    await touch('touchEnd', []);
    await ph.waitForTimeout(1200);
    const w1 = await widthOf();
    const appScale = await ph.evaluate(() => visualViewport.scale);
    check('phone: pinching zooms the document, not the whole app', w1 > w0 * 2 && appScale === 1, `page width ${Math.round(w0)} → ${Math.round(w1)} px, app zoom ${appScale}`);
    await ph.click(tid('btn-zoom-out'));
    await ph.click(tid('btn-zoom-out'));
    await ph.waitForTimeout(800);

    const before = (await ph.evaluate(() => window.__ezpdf.annotations())).length;
    await ph.tap(tid('tool-text'));
    const tScroll = await scrollTop();
    const box2 = await ph.locator(tid(`page-${(await ph.textContent(tid('page-compact'))).split('/')[0] - 1}`)).boundingBox();
    await swipeUp(box2.x + box2.width / 2, Math.min(box2.y + box2.height / 2 + 60, 650), 60);
    const after = (await ph.evaluate(() => window.__ezpdf.annotations())).length;
    check('phone: with the text tool, a drag on the page draws a box instead of scrolling', after === before + 1 && Math.abs((await scrollTop()) - tScroll) < 5, `${before} → ${after} annotations`);
    await ph.keyboard.press('Escape');
    await ph.keyboard.press('Escape');
    await ph.waitForTimeout(300);

    const shown = (await ph.textContent(tid('page-compact'))).trim();
    const n = Number(shown.split('/')[0]);
    const rotBefore = (await ph.evaluate(() => window.__ezpdf.pages()))[n - 1].rotation;
    await ph.tap(tid('btn-rotate-page'));
    await ph.waitForTimeout(300);
    const hint = await ph.textContent(tid('tool-hint')).catch(() => '');
    const rotAfter = (await ph.evaluate(() => window.__ezpdf.pages()))[n - 1].rotation;
    check(
      'phone: the page shown in the top bar is the page the rotate button turns, and the app says so',
      /^\d+\/300$/.test(shown) && rotAfter === (rotBefore + 1) % 4 && hint.includes(`Đã xoay trang ${n} sang phải`),
      `${shown} · ${hint}`,
    );
    await ph.screenshot({ path: path.join(OUT, 'phone.png') });
    await pctx.close();
  }

  // ── what left the page ──
  const foreign = [...new Set(requests.filter((u) => !u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')))];
  const expectedRefused = ['https://example.org/upload'];
  check('every request went to the app itself (apart from the refused probe)', foreign.every((u) => expectedRefused.includes(u)), foreign.join(' ') || 'none');
  const unexpectedCsp = PROD ? (await page.evaluate(() => window.__csp || [])).filter((v) => !v.includes('example.org')) : [];
  const unexpectedConsole = cspViolations.filter((v) => !v.includes('example.org'));
  check('no Content-Security-Policy violation in normal use', unexpectedCsp.length === 0 && unexpectedConsole.length === 0, [...unexpectedCsp, ...unexpectedConsole].join(' | ').slice(0, 400));
  const realErrors = errors.filter((e) => !e.includes('not-cached-')); // the offline probe fails on purpose
  check('no page errors', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));

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
