#!/usr/bin/env node
/**
 * Acceptance run for "Quét tài liệu" (photo → flat, brightened PDF), in real
 * Chromium, on the synthetic phone photos of tests/fixtures/scan
 * (scripts/make_scan_fixtures.py: a known document photographed through a
 * pinhole camera on various tables, with uneven light and a colour cast).
 *
 * Engine (dev server only: tests/scan.html runs the app's own worker):
 *  - the sheet is found, corners within 1.5 % of the photo's diagonal
 *  - A4 proportions recovered from the perspective (snapped to A4)
 *  - the flat page matches the original document (correlation)
 *  - brightening: paper white and even, ink not lighter, the red stamp red
 *  - the PDF: qpdf clean, one JPEG per page (DCT, not re-encoded), A4 pages,
 *    MuPDF and Poppler draw it
 * App:
 *  - empty state → scan → one photo → corner editor with the corners on the
 *    sheet; a dragged corner shows the loupe and moves
 *  - several photos → review; brightening off / on, turn, delete
 *  - "Tạo PDF" opens a new document, already in a draft; export writes it
 *  - closing with pages asks first
 *  - phone: "Chụp ảnh" opens the camera (capture=environment)
 *  - nothing leaves the device
 *
 * Usage: node scripts/e2e-scan.cjs
 *        BASE=http://localhost:4173 node scripts/e2e-scan.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out', 'e2e-scan');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const SCAN = (f) => path.join(ROOT, 'tests/fixtures/scan', f);
const PROD = !!process.env.BASE;
const truth = JSON.parse(fs.readFileSync(SCAN('truth.json'), 'utf8'));

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
const py = (code, ...args) => execFileSync('python3', ['-c', code, ...args], { encoding: 'utf8' }).trim();

async function startServer() {
  if (PROD) return { base: process.env.BASE, stop() {} };
  const port = 5187;
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

  // ── engine, through the app's worker ──
  if (!PROD) {
    const ep = await browser.newPage();
    track(ep);
    await ep.goto(server.base + '/tests/scan.html');
    await ep.waitForFunction(() => window.__scan, null, { timeout: 300000 });
    const r = await ep.evaluate(() => window.__scan);
    if (r.error) throw new Error(r.error);
    for (const x of r.results) {
      const shadow = x.file === 'photo-shadow.jpg';
      const ok =
        x.found &&
        x.cornerError <= 1.5 &&
        x.a4 &&
        Math.abs(x.aspect - 1.4142) < 0.01 &&
        x.ncc >= 0.85 &&
        x.enhanced.paper >= 235 &&
        x.enhanced.paperSpread <= (shadow ? 35 : 8) &&
        x.enhanced.paperSpread * 2.5 <= x.photo.paperSpread &&
        x.inkEnhanced <= x.inkPlain + 2 &&
        x.enhanced.redMinusGreen >= 60;
      check(
        `scan engine: ${x.file} (${x.note})`,
        ok,
        `corners off by ${x.cornerError}% · ${x.size.join('×')} px, h/w ${x.aspect}${x.a4 ? ' (A4)' : ''} · matches the original ${x.ncc} · paper ${x.photo.paper}±${x.photo.paperSpread} → ${x.enhanced.paper}±${x.enhanced.paperSpread} · ink ${x.inkPlain} → ${x.inkEnhanced} · stamp R−G ${x.enhanced.redMinusGreen} · ${x.msDetect}+${x.msProcess} ms`,
      );
    }
    const pdf = path.join(OUT, 'engine.pdf');
    fs.writeFileSync(pdf, Buffer.from(r.pdf, 'base64'));
    const q = execFileSync('qpdf', ['--check', pdf], { encoding: 'utf8' });
    const imgs = execFileSync('pdfimages', ['-list', pdf], { encoding: 'utf8' }).split('\n').slice(2).filter(Boolean);
    const sizes = py('import sys,pymupdf; d=pymupdf.open(sys.argv[1]); print(",".join(f"{round(p.rect.width)}x{round(p.rect.height)}" for p in d))', pdf);
    const ink = py(
      'import sys,pymupdf; d=pymupdf.open(sys.argv[1]); p=d[0].get_pixmap(dpi=40); s=p.samples; print(min(s[i] for i in range(0,len(s),3)))',
      pdf,
    );
    execFileSync('pdftoppm', ['-r', '30', '-f', '1', '-l', '1', '-png', pdf, path.join(OUT, 'engine-poppler')]);
    check(
      'scan PDF: qpdf clean, one JPEG per page embedded as is, A4 pages, MuPDF and Poppler draw it',
      q.includes('No syntax or stream encoding errors') &&
        imgs.length === r.results.length &&
        imgs.every((l) => /\bjpeg\b/.test(l)) &&
        sizes.split(',').every((s) => s === '595x842') &&
        Number(ink) < 120 &&
        fs.readdirSync(OUT).some((f) => f.startsWith('engine-poppler')),
      `${imgs.length} images (${[...new Set(imgs.map((l) => l.split(/\s+/)[9]))].join(',')}) · pages ${sizes} · darkest pixel ${ink}`,
    );
    await ep.close();
  }

  // ── the app ──
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  track(page);
  onCrash = async () => {
    console.error('page errors so far:', JSON.stringify(errors.slice(-10), null, 1));
    await page.screenshot({ path: path.join(OUT, 'crash.png') });
  };
  await page.goto(server.base + '/?e2e');
  await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
  await page.click(tid('btn-scan-empty'));
  await page.waitForSelector(tid('scan-empty'));
  check('desktop: the scan screen offers photos from the computer (no camera button)', (await page.locator(tid('scan-camera')).count()) === 0 && (await page.isVisible(tid('scan-gallery'))));

  // one photo → corner editor
  const wood = truth.photos.find((p) => p.file === 'photo-wood.jpg');
  await page.setInputFiles(tid('scan-file-input'), SCAN('photo-wood.jpg'));
  await page.waitForSelector(tid('scan-corner-0'), { timeout: 30000 });
  await sleep(300);
  const rect = JSON.parse(await page.getAttribute(tid('scan-editor'), 'data-rect'));
  const editorBox = await page.locator(tid('scan-editor')).boundingBox();
  const corners = [];
  for (let i = 0; i < 4; i++) {
    const b = await page.locator(tid(`scan-corner-${i}`)).boundingBox();
    corners.push({ x: (b.x + b.width / 2 - editorBox.x - rect.x) / rect.w, y: (b.y + b.height / 2 - editorBox.y - rect.y) / rect.h });
  }
  const off = Math.max(...corners.map((c, i) => Math.hypot((c.x - wood.quad[i][0]) * wood.width, (c.y - wood.quad[i][1]) * wood.height))) / Math.hypot(wood.width, wood.height);
  check('one photo opens the corner editor with the corners already on the sheet', off < 0.015, `largest offset ${(off * 100).toFixed(2)}% of the diagonal`);
  const c1 = await page.locator(tid('scan-corner-1')).boundingBox();
  await page.mouse.move(c1.x + c1.width / 2, c1.y + c1.height / 2);
  await page.mouse.down();
  await page.mouse.move(c1.x + c1.width / 2 + 30, c1.y + c1.height / 2 + 20, { steps: 6 });
  const loupe = await page.isVisible(tid('scan-loupe'));
  await page.mouse.up();
  const c1b = await page.locator(tid('scan-corner-1')).boundingBox();
  check('dragging a corner moves it and shows the loupe', loupe && Math.abs(c1b.x - c1.x - 30) < 3 && Math.abs(c1b.y - c1.y - 20) < 3);
  // put it back with the keyboard: arrows move a focused corner
  await page.focus(tid('scan-corner-1'));
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
  for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowUp');
  const c1c = await page.locator(tid('scan-corner-1')).boundingBox();
  check('arrow keys move a focused corner', Math.abs(c1c.x - c1.x) < 4 && Math.abs(c1c.y - c1.y) < 4, `back to ${Math.round(c1c.x - c1.x)}, ${Math.round(c1c.y - c1.y)} px`);
  await page.click(tid('scan-adjust-done'));
  await page.waitForSelector(tid('scan-result'), { timeout: 30000 });
  const w1 = Number(await page.getAttribute(tid('scan-result'), 'data-width'));
  const h1 = Number(await page.getAttribute(tid('scan-result'), 'data-height'));
  check('“Xong” gives a flat page in A4 proportions', Math.abs(h1 / w1 - Math.SQRT2) < 0.01, `${w1}×${h1} px`);

  // more photos at once → processed straight to the review
  await page.setInputFiles(tid('scan-file-input'), [SCAN('photo-desk.jpg'), SCAN('photo-cloth.jpg')]);
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="scan-thumb-"]').length === 3 && !document.querySelector('[data-testid="scan-strip"] .animate-spin'), null, { timeout: 60000 });
  check('several photos are processed at once and listed', (await page.textContent(tid('scan-count'))).includes('3 trang'));

  const meanOfResult = () =>
    page.evaluate(async () => {
      const img = document.querySelector('[data-testid="scan-result"]');
      const b = await createImageBitmap(await (await fetch(img.src)).blob(), { resizeWidth: 120, resizeHeight: 170 });
      const c = new OffscreenCanvas(120, 170);
      const g = c.getContext('2d');
      g.drawImage(b, 0, 0);
      const d = g.getImageData(0, 0, 120, 170).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return s / (d.length / 4) / 3;
    });
  await page.click(tid('scan-thumb-1'));
  await sleep(200);
  const bright = await meanOfResult();
  await page.click(tid('scan-enhance-toggle'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="scan-result"].opacity-60'), null, { timeout: 30000 });
  await sleep(300);
  const natural = await meanOfResult();
  await page.click(tid('scan-enhance-toggle'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="scan-result"].opacity-60'), null, { timeout: 30000 });
  await sleep(300);
  check('“Làm sáng” on by default; off shows the photo’s own light, on again brightens', (await page.isChecked(tid('scan-enhance'))) && bright > natural + 12 && Math.abs((await meanOfResult()) - bright) < 2, `mean ${Math.round(natural)} off, ${Math.round(bright)} on`);

  await page.click(tid('scan-thumb-2'));
  await page.click(tid('scan-rotate'));
  await page.waitForFunction(() => {
    const i = document.querySelector('[data-testid="scan-result"]');
    return i && Number(i.dataset.width) > Number(i.dataset.height) && !i.classList.contains('opacity-60');
  }, null, { timeout: 30000 });
  check('“Xoay” turns the page', true);
  await page.click(tid('scan-thumb-1'));
  await page.click(tid('scan-delete'));
  await sleep(200);
  check('“Xóa trang” removes it', (await page.locator('[data-testid^="scan-thumb-"]').count()) === 2);

  // closing asks first
  await page.keyboard.press('Escape');
  const asked = await page.isVisible(tid('scan-discard'));
  await page.click(tid('scan-stay'));
  check('closing with scanned pages asks first, and “Ở lại” keeps them', asked && (await page.locator('[data-testid^="scan-thumb-"]').count()) === 2);
  await page.screenshot({ path: path.join(OUT, 'review.png') });

  // create → a new document, already in a draft
  await page.click(tid('scan-create'));
  await page.waitForFunction(() => document.querySelector('[data-testid="page-total"]')?.textContent?.includes('/ 2'), null, { timeout: 60000 });
  await page.waitForSelector(tid('state-draft-saved'), { timeout: 30000 });
  const title = await page.textContent('header');
  const pages = await page.evaluate(() => window.__ezpdf.pages());
  check(
    '“Tạo PDF” opens the scan as a new document, saved as a draft at once',
    /Bản quét \d\d-\d\d-\d{4} \d\d\.\d\d\.pdf/.test(title) && pages.length === 2 && pages[0].h > pages[0].w && pages[1].w > pages[1].h,
    `${(title.match(/Bản quét[^\n]*?\.pdf/) || [''])[0]} · ${pages.map((p) => `${Math.round(p.w)}×${Math.round(p.h)}`).join(', ')}`,
  );
  const dl = page.waitForEvent('download');
  await page.click(tid('btn-export'));
  const d = await dl;
  const exported = path.join(OUT, 'exported.pdf');
  await d.saveAs(exported);
  const info = py('import sys,pymupdf; d=pymupdf.open(sys.argv[1]); print(len(d), ",".join(f"{round(p.rect.width)}x{round(p.rect.height)}" for p in d), len(d.get_page_images(0)))', exported);
  const q2 = execFileSync('qpdf', ['--check', exported], { encoding: 'utf8' });
  check('the exported scan: 2 pages (the turned one landscape), images kept, qpdf clean', info.startsWith('2 595x842,842x595 1') && q2.includes('No syntax or stream encoding errors'), info);
  await page.screenshot({ path: path.join(OUT, 'opened.png') });
  // with a document open, the top bar's scan button starts another scan; closing an empty one asks nothing
  await page.click(tid('btn-scan'));
  const reopened = await page.isVisible(tid('scan-empty'));
  await page.click(tid('scan-close'));
  await sleep(200);
  check('the top bar’s scan button starts a new scan over the open document; an empty one closes at once', reopened && (await page.locator(tid('scan-dialog')).count()) === 0 && (await page.textContent(tid('page-total'))).includes('/ 2'));
  await ctx.close();

  // ── phone: the camera ──
  {
    const pctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    const ph = await pctx.newPage();
    track(ph);
    await ph.goto(server.base + '/?e2e');
    await ph.waitForSelector(tid('state-empty'), { timeout: 60000 });
    await ph.tap(tid('btn-scan-empty'));
    await ph.waitForSelector(tid('scan-camera'));
    const chooser = ph.waitForEvent('filechooser');
    await ph.tap(tid('scan-camera'));
    const fc = await chooser;
    const capture = await fc.element().getAttribute('capture');
    const accept = await fc.element().getAttribute('accept');
    await fc.setFiles(SCAN('photo-exif.jpg'));
    await ph.waitForSelector(tid('scan-corner-0'), { timeout: 30000 });
    check('phone: “Chụp ảnh” asks for the back camera, and a sideways-stored photo shows upright', capture === 'environment' && accept === 'image/*' && (await ph.isVisible(tid('scan-adjust-done'))), `capture=${capture} accept=${accept}`);
    await ph.screenshot({ path: path.join(OUT, 'phone-adjust.png') });
    await pctx.close();
  }

  const foreign = [...new Set(requests.filter((u) => !u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')))];
  check('photos and pages never left the device (every request went to the app itself)', foreign.length === 0, foreign.join(' ') || 'none');
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
