#!/usr/bin/env node
/**
 * The web app's update (0.8.9): "Có bản mới · Cập nhật" at the foot of the
 * start screen, and nothing to close.
 *
 * It serves the production build (dist/, `npm run build` first) itself, so
 * it can hand the browser a newer service worker partway through, as GitHub
 * Pages does after a release:
 *  - first visit: the worker takes the page over, and that is no update
 *  - a newer version (the worker as built, with another version number and a
 *    shorter file list): it takes over at once, the page that is open offers
 *    "Có bản mới 9.9.9 · Cập nhật", keeps working on its own version (a file
 *    the new version no longer lists still comes from the old cache), and
 *    "Cập nhật" reloads it into the new one
 *  - a worker that waits for every tab to close (as before 0.8.9): the page
 *    offers it too, and "Cập nhật" tells it to take over and reloads
 *  - the cache of the version before the one replaced is dropped
 *
 * Usage: npm run build && node scripts/e2e-update.cjs
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'out', 'e2e-update');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const VERSION = require('../package.json').version;
const FIX = (f) => path.join(ROOT, 'tests/fixtures', f);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const tid = (id) => `[data-testid="${id}"]`;

// ── the build's worker, and the newer ones handed out later ──────────────
const built = fs.readFileSync(path.join(DIST, 'sw.js'), 'utf8');
if (!built.includes(`const APP_VERSION = '${VERSION}';`)) throw new Error('dist/sw.js is not this version: npm run build first');
const wordChunk = fs.readdirSync(path.join(DIST, 'assets')).find((f) => /^WordScreen-.*\.js$/.test(f));
const variant = (app, cacheVersion, { waits = false, drop = null } = {}) => {
  let s = built.replace(/const VERSION = '[^']*';/, `const VERSION = '${cacheVersion}';`).replace(`const APP_VERSION = '${VERSION}';`, `const APP_VERSION = '${app}';`);
  if (drop) s = s.replace(`  "assets/${drop}",\n`, '');
  if (waits) s = s.replace('      await self.skipWaiting();\n', '');
  return s;
};
const workers = {
  built,
  // takes over at once; no longer lists the Word screen's code (the open page still needs it)
  next: variant('9.9.9', 'next-version-0001', { drop: wordChunk }),
  // waits for every tab to close, like the workers before 0.8.9
  waiting: variant('9.9.8', 'waiting-version-02', { waits: true }),
};
let serving = 'built';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain', '.md': 'text/plain' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
  if (rel === 'sw.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-cache' });
    return res.end(workers[serving]);
  }
  const file = path.join(DIST, rel);
  // once a newer version is out, the site no longer has the file it dropped (as on GitHub Pages)
  const gone = serving === 'next' && rel === `assets/${wordChunk}`;
  if (gone || !file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  try {
    // the S24 Ultra's width: the notice and its button fit beside the version
    const ctx = await browser.newContext({ viewport: { width: 384, height: 832 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
    page.on('requestfailed', (r) => errors.push(`failed: ${r.url()}`));
    page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()}: ${r.url()}`));
    const foot = () =>
      page.evaluate(() => ({
        version: document.querySelector('[data-testid="state-empty"] [data-testid="app-version"]')?.innerText.trim() ?? null,
        update: document.querySelector('[data-testid="update-ready"]')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
      }));
    const caches = () => page.evaluate(async () => (await self.caches.keys()).filter((k) => k.startsWith('ezpdf-')));
    const workerVersion = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            const c = new MessageChannel();
            c.port1.onmessage = (e) => resolve(e.data);
            navigator.serviceWorker.controller.postMessage({ type: 'version' }, [c.port2]);
            setTimeout(() => resolve(null), 3000);
          }),
      );

    // ── first visit ──
    await page.goto(base);
    await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    });
    await page.waitForTimeout(1500);
    const first = await foot();
    const firstCaches = await caches();
    check(
      `first visit: the worker takes the page over and keeps the build (that is no update): “ezPDF phiên bản ${VERSION}” and nothing to update`,
      first.version === `ezPDF phiên bản ${VERSION}` && first.update === null && firstCaches.length === 1 && (await workerVersion()) === VERSION,
      `${JSON.stringify(first)} · ${firstCaches}`,
    );

    // ── a newer version is published ──
    serving = 'next';
    await page.evaluate(() => (window.__samePage = true));
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForSelector(tid('btn-update'), { timeout: 60000 });
    const offered = await foot();
    const twoCaches = await caches();
    await page.screenshot({ path: path.join(OUT, 'update-offered.png') });
    check(
      'a newer version: it takes over at once, and the open page offers “Có bản mới 9.9.9” with “Cập nhật”, nothing closed',
      offered.update === 'Có bản mới 9.9.9 Cập nhật' && offered.version === `ezPDF phiên bản ${VERSION}` && (await workerVersion()) === '9.9.9' && (await page.evaluate(() => window.__samePage)),
      JSON.stringify(offered),
    );
    check('the files of the version it replaced stay cached for the page still open on it', twoCaches.length === 2 && twoCaches.includes(firstCaches[0]), twoCaches.join(', '));

    // the open page keeps working on its own version: the Word screen's code, which the new version
    // no longer lists, still loads (from the old cache)
    await page.setInputFiles(tid('file-input'), FIX('word-a.docx'));
    const wordOk = await page.waitForSelector(tid('word-page'), { timeout: 60000 }).then(() => true, () => false);
    check(`the page still open runs its own version: a Word file opens (${wordChunk}, gone from the site and from the new version, comes from the old cache)`, wordOk);
    await page.click(tid('word-close'));
    await page.waitForSelector(tid('state-empty'), { timeout: 30000 });

    // ── Cập nhật ──
    const navigated = page.waitForEvent('framenavigated', { timeout: 30000 });
    await page.click(tid('btn-update'));
    await navigated;
    await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
    await page.waitForTimeout(1500);
    const after = await foot();
    check(
      '“Cập nhật” reloads the page into the new version (no tab closed), and the notice is gone',
      !(await page.evaluate(() => window.__samePage)) && after.update === null && after.version === `ezPDF phiên bản ${VERSION}`,
      JSON.stringify(after),
    );

    // ── a worker that waits (before 0.8.9) ──
    serving = 'waiting';
    await page.evaluate(() => (window.__samePage = true));
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForSelector(tid('btn-update'), { timeout: 60000 });
    const waitingOffered = await foot();
    const isWaiting = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    check(
      'a worker that waits for every tab to close is offered too: “Có bản mới 9.9.8”',
      isWaiting && waitingOffered.update === 'Có bản mới 9.9.8 Cập nhật',
      `waiting ${isWaiting} · ${JSON.stringify(waitingOffered)}`,
    );
    const navigated2 = page.waitForEvent('framenavigated', { timeout: 30000 });
    await page.click(tid('btn-update'));
    await navigated2;
    await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
    await page.waitForTimeout(1500);
    const finalCaches = await caches();
    const stillWaiting = await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
    check(
      '“Cập nhật” tells it to take over and reloads; the cache from two versions back is dropped',
      !(await page.evaluate(() => window.__samePage)) && !stillWaiting && (await workerVersion()) === '9.9.8' && finalCaches.length === 2 && !finalCaches.includes(firstCaches[0]) && (await foot()).update === null,
      finalCaches.join(', '),
    );
    check('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  } catch (e) {
    check(`run: ${e.message.split('\n')[0]}`, false, errors.join(' | '));
    for (const p of browser.contexts().flatMap((c) => c.pages())) await p.screenshot({ path: path.join(OUT, 'failed.png') }).catch(() => {});
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed ? `${failed} of ${results.length} checks failed` : `${results.length}/${results.length} checks passed`}`);
  process.exit(failed ? 1 : 0);
})();
