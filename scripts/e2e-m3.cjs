#!/usr/bin/env node
/**
 * Acceptance run for milestone 3 in real Chromium:
 *
 *  - pictures: unreadable file refused; PNG with alpha and JPEG placed by
 *    click (ghost preview), upright on a /Rotate 90 page; resize keeps the
 *    aspect ratio; move; undo/redo; delete + undo keeps the picture (G11)
 *  - signature: drawn (pen colours, clear), kept and reused, deleted from
 *    the saved list; from a photo with the paper removed
 *  - page rotation saved to the file: this page / every page, left / right,
 *    R key, undo/redo; pictures and text follow the page
 *  - thumbnails show annotations and follow page rotation
 *  - drafts: autosave, reload, reopen from the list, offer when the same
 *    original is opened again (resume / original / cancel), close, delete
 *  - export from a resumed draft checked in Poppler, MuPDF and pdf.js:
 *    every picture at its place and upright, transparency kept, paper gone,
 *    page /Rotate as on screen
 *  - stamps from other software: one without /Name stays put (G12) but can
 *    be deleted and brought back; a custom-name one can be moved
 *  - drafts that cannot be saved: the app says so and guards the changes
 *  - phone: tools fit, signature dialog fits, tap to place
 *  - every button on screen exercised; no other origin; nothing uploaded
 *
 * Usage: node scripts/e2e-m3.cjs   (starts its own Vite dev server)
 *        BASE=http://localhost:4173 SKIP_PDFJS=1 node scripts/e2e-m3.cjs   (against `npm run preview`)
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out', 'e2e-m3');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'pdfjs'), { recursive: true });
const FIX = (f) => path.join(ROOT, 'tests/fixtures', f);
const TEXT_P3 = 'Ô chữ trên trang lệch khung: Đã duyệt, ký nháy từng trang.';

const results = [];
let stepName = 'start';
function check(name, ok, detail = '') {
  stepName = name;
  results.push({ name, ok: !!ok, detail: String(detail ?? '') });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const py = (script, args) => {
  try {
    return execFileSync('python3', [path.join(ROOT, 'scripts', script), ...args], { encoding: 'utf8' });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
};

async function startServer() {
  if (process.env.BASE) return { base: process.env.BASE, stop() {} };
  const port = 5182;
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

// quadrant model shared with scripts/verify_images.py
const RED = [220, 30, 30], GREEN = [30, 160, 60], BLUE = [30, 70, 200], YELLOW = [240, 200, 20];
const WHITE = [255, 255, 255], HALF_MAGENTA = [255, 128, 255];
function samples(kind) {
  const s = [[[0.25, 0.25], RED], [[0.75, 0.25], GREEN], [[0.25, 0.75], BLUE], [[0.06, 0.08], RED], [[0.94, 0.08], GREEN], [[0.06, 0.92], BLUE]];
  if (kind === 'png') s.push([[0.75, 0.62], WHITE], [[0.75, 0.88], HALF_MAGENTA]);
  else s.push([[0.75, 0.75], YELLOW], [[0.94, 0.92], YELLOW]);
  return s;
}
const toDisplay = (pg, r, x, y) => [[x, y], [pg.h - y, x], [pg.w - x, pg.h - y], [y, pg.w - x]][r % 4];
/** A picture placed by the app: rect in page space, pixels turned by q quarters. */
function pictureModel(a, q) {
  const r = a.rect;
  const [w, h] = q % 2 ? [r.size.height, r.size.width] : [r.size.width, r.size.height];
  const cx = r.origin.x + r.size.width / 2, cy = r.origin.y + r.size.height / 2;
  return { box: { origin: { x: cx - w / 2, y: cy - h / 2 }, size: { width: w, height: h } }, rotation: q * 90 };
}
function modelPoint(m, u, v) {
  const b = m.box, t = (m.rotation * Math.PI) / 180;
  const dx = (u - 0.5) * b.size.width, dy = (v - 0.5) * b.size.height;
  const cx = b.origin.x + b.size.width / 2, cy = b.origin.y + b.size.height / 2;
  return [cx + dx * Math.cos(t) - dy * Math.sin(t), cy + dx * Math.sin(t) + dy * Math.cos(t)];
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
    p.on('pageerror', (e) => errors.push(`${e.message} @${stepName} ${(e.stack || '').split('\n').slice(1, 6).join(' ‹ ')}`));
    p.on('console', (m) => m.type() === 'error' && !benignRenderRace(m) && errors.push(`${m.text()} ${m.location()?.url ?? ''} @${stepName}`));
  }

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  let page = await ctx.newPage();

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
      [...document.querySelectorAll('button, [role="slider"]')]
        .filter((b) => b.offsetParent !== null || b.getClientRects().length)
        .map((b) => b.getAttribute('data-testid') || `?${b.getAttribute('aria-label') || b.textContent.trim().slice(0, 30)}`),
    );
    for (const f of found) (f.startsWith('?') ? unnamedButtons : seenButtons).add(f);
  }
  const annots = () => page.evaluate(() => window.__ezpdf.annotations());
  const pagesInfo = () => page.evaluate(() => window.__ezpdf.pages());
  const pageBox = (i) => page.locator(tid(`page-${i}`)).boundingBox();
  async function toScreen(i, x, y) {
    const b = await pageBox(i);
    const pg = (await pagesInfo())[i];
    const r = pg.rotation % 4;
    const [dx, dy] = toDisplay(pg, r, x, y);
    const [dw, dh] = r % 2 ? [pg.h, pg.w] : [pg.w, pg.h];
    return [b.x + (dx / dw) * b.width, b.y + (dy / dh) * b.height];
  }
  async function waitDoc(pages, p = page) {
    await p.waitForFunction((n) => document.querySelector('[data-testid="page-total"]')?.textContent?.includes(`/ ${n}`), pages, { timeout: 30000 });
    await p.waitForSelector(tid('page-0'), { state: 'attached', timeout: 30000 });
    await p.waitForTimeout(900);
  }
  /** Run `fn`, which opens a document, and wait until the new one is in place. */
  async function reopen(fn, pages) {
    const prev = await page.evaluate(() => window.__ezpdf?.documentId ?? null);
    await fn();
    await page.waitForFunction((p) => window.__ezpdf?.documentId && window.__ezpdf.documentId !== p, prev, { timeout: 30000 });
    await waitDoc(pages);
  }
  async function pick(triggerId, file, viaKey) {
    const chooser = page.waitForEvent('filechooser', { timeout: 10000 });
    if (viaKey) await page.keyboard.press(viaKey);
    else await click(triggerId);
    await (await chooser).setFiles(file);
  }
  async function drag(from, to, steps = 8) {
    await page.mouse.move(...from);
    await page.mouse.down();
    await page.mouse.move(...to, { steps });
    await page.mouse.up();
  }
  /** Bring page n (1-based) on screen through the page box; pages far away are not in the DOM. */
  async function goPage(n) {
    await page.fill(tid('page-input'), String(n));
    await page.press(tid('page-input'), 'Enter');
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForSelector(tid(`page-${n - 1}`), { state: 'attached', timeout: 10000 });
    await page.locator(tid(`page-${n - 1}`)).scrollIntoViewIfNeeded();
    await page.waitForTimeout(350);
  }
  async function deselect() {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  /** Screen colours of a placed picture's quadrants, as the user sees them. */
  async function screenPicture(a, q, kind, label) {
    await goPage(a.pageIndex + 1);
    const m = pictureModel(a, q);
    const pts = [];
    for (const [[u, v]] of samples(kind)) pts.push(await toScreen(a.pageIndex, ...modelPoint(m, u, v)));
    const shot = path.join(OUT, `screen-${label}.png`);
    await page.screenshot({ path: shot });
    const got = JSON.parse(py('sample_pixels.py', [shot, JSON.stringify(pts)]));
    const bad = samples(kind)
      .map(([[u, v], want], k) => ({ u, v, want, got: got[k] }))
      .filter((s) => Math.max(...s.want.map((c, i) => Math.abs(c - s.got[i]))) > 50);
    return { ok: bad.length === 0, detail: bad.map((s) => `(${s.u},${s.v}) ${s.got}≠${s.want}`).join('; ') };
  }
  const stamps = async () => (await annots()).filter((a) => a.type === 13);
  const newest = (list, before) => list.find((a) => !before.some((b) => b.id === a.id));

  // ── 1. open ─────────────────────────────────────────────────────────────
  await page.goto(server.base + '/?e2e');
  await page.waitForSelector(tid('state-empty'), { timeout: 30000 });
  check('empty state has no draft list on a fresh device', !(await page.isVisible(tid('draft-list'))));
  await page.setInputFiles(tid('file-input'), FIX('sample.pdf'));
  await waitDoc(4);
  await collectButtons();

  // ── 2. a file that is not a picture ─────────────────────────────────────
  await pick('tool-image', FIX('not-an-image.png'));
  await page.waitForSelector(tid('banner-picture-error'), { timeout: 10000 });
  const errText = await page.textContent(tid('banner-picture-error'));
  await collectButtons();
  await click('btn-picture-error-close');
  check('a file that is not a picture is refused with a message', /không đọc được ảnh/i.test(errText) && !(await page.isVisible(tid('banner-picture-error'))), errText);

  // ── 3. PNG with alpha on page 1, ghost then click ───────────────────────
  await pick('tool-image', FIX('quadrants.png'));
  await page.waitForSelector(tid('placement-0'), { state: 'attached' });
  const pressed = (await page.getAttribute(tid('tool-image'), 'aria-pressed')) === 'true';
  const hint = await page.textContent(tid('tool-hint'));
  await page.mouse.move(...(await toScreen(0, 240, 430)));
  await page.mouse.move(...(await toScreen(0, 200, 420)), { steps: 3 });
  await page.waitForTimeout(150);
  const ghost = await page.locator(`${tid('placement-0')} img`).count();
  check('placing a picture: tool lit, hint says how, ghost follows the pointer', pressed && /đặt ảnh/.test(hint) && ghost === 1, `${hint} pressed=${pressed} ghost=${ghost}`);
  let before = await annots();
  await page.mouse.click(...(await toScreen(0, 200, 420)));
  await page.waitForTimeout(900);
  let png = newest(await stamps(), before);
  check(
    'PNG placed centred on the click, natural size at 96 dpi, marked as ezPDF picture',
    png && near(png.rect.origin.x + png.rect.size.width / 2, 200, 1) && near(png.rect.origin.y + png.rect.size.height / 2, 420, 1) &&
      near(png.rect.size.width, 150, 0.01) && near(png.rect.size.height, 90, 0.01) && png.name === 37 && png.custom?.kind === 'image' && !png.rotation,
    png && JSON.stringify({ r: png.rect, n: png.name, c: png.custom }),
  );
  check('placement ends after one click; properties show the picture', (await page.getAttribute(tid('tool-image'), 'aria-pressed')) === 'false' && (await page.textContent(tid('properties-title'))) === 'Ảnh' && /150 × 90/.test(await page.textContent(tid('stamp-size'))));
  await deselect();
  let s = await screenPicture(png, 0, 'png', 'png');
  check('screen: PNG drawn upright, transparent part shows the page, soft alpha blends', s.ok, s.detail);
  await page.waitForSelector(`${tid('thumb-annots-0')} img[data-thumb-annot="appearance"]`, { timeout: 10000 }).catch(() => {});
  check('thumbnail of page 1 shows the picture', (await page.locator(`${tid('thumb-annots-0')} img`).count()) === 1);

  // ── 4. JPEG on the /Rotate 90 page ──────────────────────────────────────
  await goPage(2);
  await page.waitForTimeout(400);
  before = await annots();
  // The I shortcut must open the picture picker (the hidden input gets clicked).
  // Headless Chromium does not always report a picker opened from a key
  // press, so the file is then handed to that same input directly.
  await page.evaluate(() => {
    window.__imageInputClicks = 0;
    document.querySelector('[data-testid="image-input"]').addEventListener('click', () => window.__imageInputClicks++, { once: true });
  });
  const chooserI = page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null);
  await page.keyboard.press('i');
  const cI = await chooserI;
  const iOpened = cI !== null || (await page.evaluate(() => window.__imageInputClicks)) > 0;
  if (cI) await cI.setFiles(FIX('photo.jpg'));
  else await page.setInputFiles(tid('image-input'), FIX('photo.jpg'));
  check('the I key opens the picture picker', iOpened);
  await page.waitForSelector(tid('placement-1'), { state: 'attached' });
  const pb1 = await pageBox(1);
  await page.mouse.click(pb1.x + pb1.width * 0.3, pb1.y + pb1.height * 0.5);
  await page.waitForTimeout(900);
  const jpg = newest(await stamps(), before);
  check('JPEG on a /Rotate 90 page: box turned with the page (90 × 150 pt in page space)', jpg && jpg.pageIndex === 1 && near(jpg.rect.size.width, 90, 0.01) && near(jpg.rect.size.height, 150, 0.01) && !jpg.rotation, jpg && JSON.stringify(jpg.rect));
  await deselect();
  s = await screenPicture(jpg, 3, 'jpg', 'jpg-rot90');
  check('screen: JPEG on the rotated page reads upright', s.ok, s.detail);

  // ── 4b. keyboard placement on the /Rotate 270 page ─────────────────────
  await goPage(4);
  before = await annots();
  await pick('tool-image', FIX('quadrants.png'));
  await page.waitForSelector(tid('placement-3'), { state: 'attached' });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const png4 = newest(await stamps(), before);
  const p4 = (await pagesInfo())[3];
  check(
    'Enter puts the picture in the middle of the current page (a /Rotate 270 page)',
    png4 && png4.pageIndex === 3 && near(png4.rect.origin.x + png4.rect.size.width / 2, p4.w / 2, 0.5) && near(png4.rect.origin.y + png4.rect.size.height / 2, p4.h / 2, 0.5) && near(png4.rect.size.width, 90, 0.01),
    png4 && JSON.stringify(png4.rect),
  );
  await deselect();
  s = await screenPicture(png4, 1, 'png', 'png-rot270');
  check('screen: PNG on the /Rotate 270 page reads upright', s.ok, s.detail);

  // ── 5. resize keeps the aspect ratio; undo / redo ───────────────────────
  await goPage(1);
  await page.waitForTimeout(300);
  await page.mouse.click(...(await toScreen(0, 200, 420)));
  await page.waitForTimeout(300);
  const corner = await toScreen(0, png.rect.origin.x + png.rect.size.width, png.rect.origin.y + png.rect.size.height);
  await drag(corner, [corner[0] + 90, corner[1] + 20]);
  await page.waitForTimeout(600);
  let pngR = (await annots()).find((a) => a.id === png.id);
  const ratio = pngR.rect.size.width / pngR.rect.size.height;
  check('corner drag enlarges the picture and keeps its aspect ratio', pngR.rect.size.width > 170 && near(ratio, 150 / 90, 0.02), `${pngR.rect.size.width.toFixed(1)} × ${pngR.rect.size.height.toFixed(1)}`);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const undone = (await annots()).find((a) => a.id === png.id);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(500);
  const redone = (await annots()).find((a) => a.id === png.id);
  check('undo / redo of the resize', near(undone.rect.size.width, 150, 0.01) && near(redone.rect.size.width, pngR.rect.size.width, 0.01));
  // move
  const mid = await toScreen(0, redone.rect.origin.x + redone.rect.size.width / 2, redone.rect.origin.y + redone.rect.size.height / 2);
  await drag(mid, [mid[0] + 40, mid[1] + 30]);
  await page.waitForTimeout(600);
  png = (await annots()).find((a) => a.id === png.id);
  check('drag moves the picture', png.rect.origin.x > redone.rect.origin.x + 20 && png.rect.origin.y > redone.rect.origin.y + 15, JSON.stringify(png.rect.origin));
  const pictureHandles = await page.locator('[data-epdf-rotation-handle]').count();

  // ── 6. delete + undo keeps the picture (G11) ────────────────────────────
  await page.keyboard.press('Delete');
  await page.waitForTimeout(500);
  const gone = !(await annots()).some((a) => a.id === png.id);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1200);
  png = (await annots()).find((a) => a.id === png.id);
  await deselect();
  s = await screenPicture(png, 0, 'png', 'png-after-undo-delete');
  check('delete, then undo: the picture comes back with its pixels (G11)', gone && png && s.ok, s.detail);

  // ── 7. signature drawn ──────────────────────────────────────────────────
  await page.keyboard.press('k');
  await page.waitForSelector(tid('sig-pad'));
  await collectButtons();
  async function scribble(dy = 0) {
    const pad = await page.locator(tid('sig-pad')).boundingBox();
    await page.mouse.move(pad.x + 40, pad.y + 110 + dy);
    await page.mouse.down();
    for (let i = 0; i <= 30; i++) await page.mouse.move(pad.x + 40 + i * 11, pad.y + 110 + dy - Math.sin(i / 3) * 35, { steps: 2 });
    await page.mouse.up();
  }
  await scribble();
  await click('sig-pen-1');
  await scribble(20);
  await click('sig-clear');
  const disabledAfterClear = await page.isDisabled(tid('sig-use'));
  await click('sig-pen-0');
  await scribble();
  await click('sig-pen-1');
  await scribble(25);
  await click('sig-keep');
  const keepOff = (await page.getAttribute(tid('sig-keep'), 'data-state')) === 'unchecked';
  await click('sig-keep');
  await collectButtons();
  await click('sig-use');
  await page.waitForSelector(tid('placement-0'), { state: 'attached' });
  check('signature: clear empties the pad, keep can be toggled, dialog closes into placement', disabledAfterClear && keepOff && !(await page.isVisible(tid('sig-dialog'))) && /chữ ký/.test(await page.textContent(tid('tool-hint'))));
  before = await annots();
  await page.mouse.click(...(await toScreen(0, 330, 270)));
  await page.waitForTimeout(900);
  const sig1 = newest(await stamps(), before);
  check('drawn signature placed as an ezPDF picture (transparent PNG, 150 pt wide)', sig1 && sig1.custom?.kind === 'signature' && near(sig1.rect.size.width, 150, 0.01) && (await page.textContent(tid('properties-title'))) === 'Chữ ký', sig1 && JSON.stringify(sig1.rect.size));

  // ── 8. saved signature: reuse, delete, cancel / close ───────────────────
  await deselect();
  await click('tool-signature');
  await page.waitForSelector(tid('sig-saved-0'));
  await collectButtons();
  await click('sig-saved-0');
  // the dialog reads the saved PNG, closes, then placement starts: wait for that before moving on
  await page.waitForSelector(tid('sig-dialog'), { state: 'detached' });
  await page.waitForSelector(tid('placement-0'), { state: 'attached' });
  await goPage(3);
  await page.waitForSelector(tid('placement-2'), { state: 'attached' });
  before = await annots();
  await page.mouse.click(...(await toScreen(2, 250, 520)));
  await page.waitForTimeout(900);
  const sig2 = newest(await stamps(), before);
  check('a saved signature is reused on another page', sig2 && sig2.pageIndex === 2 && sig2.custom?.kind === 'signature');
  await deselect();
  await click('tool-signature');
  await page.waitForSelector(tid('sig-delete-0'));
  await click('sig-delete-0');
  await page.waitForTimeout(300);
  const emptySaved = (await page.locator('[data-testid^="sig-saved-"]').count()) === 0;
  await click('sig-close');
  await page.waitForTimeout(200);
  const closed = !(await page.isVisible(tid('sig-dialog')));
  await click('tool-signature');
  await page.waitForSelector(tid('sig-cancel'));
  await click('sig-cancel');
  await page.waitForTimeout(200);
  check('saved signature deleted from this device; dialog closes by X and Hủy', emptySaved && closed && !(await page.isVisible(tid('sig-dialog'))));

  // ── 9. signature from a photo: paper removed ────────────────────────────
  await click('tool-signature');
  await page.waitForSelector(tid('sig-tab-photo'));
  await click('sig-tab-photo');
  await pick('sig-pick', FIX('signature-photo.jpg'));
  await page.waitForSelector(tid('sig-photo-preview'));
  await page.focus(tid('sig-threshold'));
  covered.add('sig-threshold');
  for (let k = 0; k < 5; k++) await page.keyboard.press('ArrowRight');
  await pick('sig-pick-again', FIX('signature-photo.jpg'));
  await page.waitForTimeout(300);
  await collectButtons();
  await click('sig-tab-draw');
  await click('sig-tab-photo');
  await click('sig-keep'); // not kept
  await click('sig-use');
  await goPage(1);
  await page.waitForSelector(tid('placement-0'), { state: 'attached' });
  before = await annots();
  await page.mouse.click(...(await toScreen(0, 300, 720)));
  await page.waitForTimeout(900);
  const sigPhoto = newest(await stamps(), before);
  await deselect();
  check('signature from a photo placed (kept only when asked)', sigPhoto && sigPhoto.custom?.kind === 'signature');

  // ── 10. text + highlight on the CropBox page → thumbnails ───────────────
  await goPage(3);
  await page.waitForTimeout(300);
  await page.keyboard.press('t');
  await page.mouse.click(...(await toScreen(2, 60, 300)));
  await page.waitForSelector(tid('freetext-editor'));
  await page.keyboard.type(TEXT_P3);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const ftP3 = (await annots()).find((a) => a.type === 3 && a.pageIndex === 2);
  await page.evaluate(([pi, id]) => window.__ezpdf.select(pi, id), [2, ftP3.id]);
  await page.waitForTimeout(300);
  const textHandles = await page.locator('[data-epdf-rotation-handle]').count();
  check('rotation handle offered for text, never for a picture (G10)', textHandles > 0 && pictureHandles === 0, `text ${textHandles}, picture ${pictureHandles}`);
  await deselect();
  await page.keyboard.press('h');
  await drag(await toScreen(2, 23, 84), await toScreen(2, 300, 84), 10);
  await page.waitForTimeout(500);
  await page.keyboard.press('v');
  const thumb2 = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="thumb-annots-2"]');
    if (!el) return null;
    return { text: [...el.querySelectorAll('[data-thumb-annot="freetext"]')].map((d) => d.textContent).join('|'), hl: el.querySelectorAll('[data-thumb-annot="highlight"]').length, img: el.querySelectorAll('img').length };
  });
  check('thumbnail of page 3 shows the text (same lines), the highlight and the signature', thumb2 && thumb2.text.replace(/\s+/g, ' ').includes('Đã duyệt') && thumb2.hl >= 1 && thumb2.img === 1, JSON.stringify(thumb2));

  // ── 11. page rotation saved to the file ─────────────────────────────────
  await goPage(1);
  await click('btn-rotate-page');
  await page.waitForTimeout(600);
  let b0 = await pageBox(0);
  const tb0 = await page.locator(`${tid('thumb-0')} img`).first().boundingBox();
  check('rotating page 1: the page turns landscape and so does its thumbnail', b0.width > b0.height && tb0 && tb0.width > tb0.height, `${Math.round(b0.width)}×${Math.round(b0.height)}, thumb ${tb0 && Math.round(tb0.width)}×${tb0 && Math.round(tb0.height)}`);
  png = (await annots()).find((a) => a.id === png.id);
  s = await screenPicture(png, 0, 'png', 'png-page-rotated');
  check('the picture turns with its page (drawn as on paper)', s.ok, s.detail);
  await click('rotate-menu');
  await click('rotate-page-left');
  await page.waitForTimeout(500);
  b0 = await pageBox(0);
  const backPortrait = b0.width < b0.height;
  await click('rotate-menu');
  await click('rotate-all-right');
  await page.waitForTimeout(600);
  const allRight = (await pagesInfo()).map((p) => p.rotation).join(',');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  await click('rotate-menu');
  await click('rotate-all-left');
  await page.waitForTimeout(600);
  const allLeft = (await pagesInfo()).map((p) => p.rotation).join(',');
  await click('btn-undo');
  await page.waitForTimeout(500);
  const restored = (await pagesInfo()).map((p) => p.rotation).join(',');
  check('this page left/right, every page right/left, each one undoable', backPortrait && allRight === '1,2,1,0' && allLeft === '3,0,3,2' && restored === '0,1,0,3', `${allRight} | ${allLeft} | ${restored}`);
  await page.fill(tid('page-input'), '1');
  await page.press(tid('page-input'), 'Enter');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(300);
  await page.keyboard.press('r');
  await page.waitForTimeout(500);
  await page.keyboard.press('Shift+R');
  await page.waitForTimeout(400);
  await page.keyboard.press('r');
  await page.waitForTimeout(500);
  check('R and Shift+R rotate the current page', (await pagesInfo())[0].rotation === 1);

  // ── 12. draft: autosave, reload, reopen ─────────────────────────────────
  await page.waitForSelector(tid('state-draft-saved'), { timeout: 15000 });
  await deselect();
  const infoDraft = await page.textContent(tid('info-draft'));
  const beforeReload = (await annots()).map((a) => `${a.type}:${a.contents ?? ''}`).sort();
  check('changes are saved as a draft on this device a moment after editing', /Đã lưu/.test(infoDraft), infoDraft);
  await page.reload();
  await page.waitForSelector(tid('draft-list'), { timeout: 15000 });
  const row = await page.textContent(tid('draft-0'));
  check('after a reload the draft is listed (name, pages, not exported)', /sample\.pdf/.test(row) && /4 trang/.test(row) && /chưa xuất/.test(row), row);
  await collectButtons();
  await click('draft-open-0');
  await waitDoc(4);
  await page.waitForTimeout(800);
  const afterReload = (await annots()).map((a) => `${a.type}:${a.contents ?? ''}`).sort();
  b0 = await pageBox(0);
  check('the reopened draft has every annotation and the page rotation', JSON.stringify(afterReload) === JSON.stringify(beforeReload) && b0.width > b0.height, `${afterReload.length} annotations`);
  png = (await annots()).find((a) => a.id === png.id);
  s = await screenPicture(png, 0, 'png', 'png-draft');
  const ftDraft = await page.evaluate(() => [...document.querySelectorAll('[data-testid="freetext"] [data-ez-line]')].map((e) => e.textContent).join(' '));
  check('reopened draft: pictures drawn, Vietnamese text drawn with its marks (not the engine appearance)', s.ok && ftDraft.replace(/\s+/g, ' ').includes('Đã duyệt'), s.detail || ftDraft);

  // ── 13. export from the draft → Poppler, MuPDF, pdf.js ──────────────────
  const dl = page.waitForEvent('download');
  await click('btn-export');
  const d = await dl;
  const exported = path.join(OUT, 'export-m3.pdf');
  await d.saveAs(exported);
  await page.waitForSelector(tid('state-exported'), { timeout: 30000 });
  const info = JSON.parse(py('inspect_export.py', [exported]) || '{}');
  check('exported page /Rotate matches the screen (90, 90, 0, 270)', JSON.stringify(info.rotations) === '[90,90,0,270]', JSON.stringify(info.rotations));
  const st = info.stamps || [];
  const stPng = st.find((x) => x.id === png.id), stJpg = st.find((x) => x.id === jpg.id);
  check(
    'pictures are /Image stamps; PNG keeps its alpha as a soft mask, JPEG kept as JPEG',
    stPng && stPng.name === '/Image' && stPng.images.some((i) => i.smask) && stJpg && stJpg.images.some((i) => i.filter === '/DCTDecode'),
    JSON.stringify({ png: stPng, jpg: stJpg }),
  );
  const pages = await pagesInfo();
  const finalAnnots = await annots();
  const sigP = finalAnnots.find((a) => a.id === sigPhoto.id);
  const expected = {
    pages: pages.map((p) => ({ w: p.w, h: p.h })),
    outputs: [{ pdf: exported, rotations: pages.map((p) => p.rotation), pdfjs: 'export' }],
    placed: [
      { id: png.id, page: 0, kind: 'png', ...pictureModel(finalAnnots.find((a) => a.id === png.id), 0) },
      { id: jpg.id, page: 1, kind: 'jpg', ...pictureModel(finalAnnots.find((a) => a.id === jpg.id), 3) },
      { id: png4.id, page: 3, kind: 'png', ...pictureModel(finalAnnots.find((a) => a.id === png4.id), 1) },
    ],
    paper: [{ id: sigP.id, page: 0, rect: sigP.rect }],
  };
  fs.writeFileSync(path.join(OUT, 'expected.json'), JSON.stringify(expected, null, 2));
  if (!process.env.SKIP_PDFJS) {
    const pj = await ctx.newPage();
    track(pj);
    await pj.goto(server.base + '/tests/pdfjs-render.html');
    await pj.setInputFiles('#f', exported);
    await pj.waitForFunction(() => window.__pdfjsResult, null, { timeout: 30000 });
    for (let i = 1; i <= pages.length; i++) await pj.locator(`canvas[data-page="${i}"]`).screenshot({ path: path.join(OUT, 'pdfjs', `export-${i}.png`) });
    await pj.close();
  }
  const ver = py('verify_images.py', [path.join(OUT, 'expected.json'), ...(process.env.SKIP_PDFJS ? [] : ['--pdfjs', path.join(OUT, 'pdfjs')])]);
  fs.writeFileSync(path.join(OUT, 'verify_images.txt'), ver);
  const verLines = ver.split('\n').filter((l) => /^(ok|FAIL)/.test(l));
  check(
    `pictures at their place, upright, transparent; signature paper gone — ${process.env.SKIP_PDFJS ? 'Poppler + MuPDF' : 'Poppler, MuPDF, pdf.js'}`,
    /IMAGE\/ROTATION CHECK: PASS/.test(ver),
    `${verLines.filter((l) => l.startsWith('ok')).length}/${verLines.length} checks`,
  );
  // The engine probe's outputs (npm run test:m3) cover every page kind; pdf.js reads them too.
  const probe = path.join(ROOT, 'out', 'm3', 'expected.json');
  if (!process.env.SKIP_PDFJS && fs.existsSync(probe)) {
    const pexp = JSON.parse(fs.readFileSync(probe, 'utf8'));
    const pj = await ctx.newPage();
    track(pj);
    for (const o of pexp.outputs) {
      await pj.goto(server.base + '/tests/pdfjs-render.html');
      await pj.setInputFiles('#f', o.pdf);
      await pj.waitForFunction(() => window.__pdfjsResult, null, { timeout: 30000 });
      for (let i = 1; i <= pexp.pages.length; i++) await pj.locator(`canvas[data-page="${i}"]`).screenshot({ path: path.join(OUT, 'pdfjs', `${o.pdfjs}-${i}.png`) });
    }
    await pj.close();
    const pv = py('verify_images.py', [probe, '--pdfjs', path.join(OUT, 'pdfjs')]);
    fs.writeFileSync(path.join(OUT, 'verify_probe.txt'), pv);
    const pjLines = pv.split('\n').filter((l) => /^(ok|FAIL)\s+pdfjs/.test(l));
    check('engine probe files (every page kind, rotations changed) also right in pdf.js, Poppler, MuPDF', /IMAGE\/ROTATION CHECK: PASS/.test(pv) && pjLines.length > 0, `${pjLines.filter((l) => l.startsWith('ok')).length}/${pjLines.length} pdf.js checks`);
  }
  const xFt = (info.annots || []).find((a) => a.type === 'FreeText' && a.page === 3);
  check('exported text on page 3 drawn with the embedded Vietnamese font', xFt && xFt.ap_text === TEXT_P3.replace(/\s+/g, ' ') && info.vn_fonts_embedded >= 1 && info.qpdf_ok && info.poppler_errors.length === 0, xFt && xFt.ap_text);

  // ── 14. the same original again: resume / original / cancel ────────────
  await page.setInputFiles(tid('file-input'), FIX('sample.pdf'));
  await page.waitForSelector(tid('banner-draft'));
  const offer = await page.textContent(tid('banner-draft'));
  await collectButtons();
  await click('btn-draft-cancel');
  const stillOpen = (await annots()).length === finalAnnots.length && !(await page.isVisible(tid('banner-draft')));
  await page.setInputFiles(tid('file-input'), FIX('sample.pdf'));
  await page.waitForSelector(tid('banner-draft'));
  await reopen(() => click('btn-draft-original'), 4);
  const fresh = (await annots()).length === 0 && (await pageBox(0)).width < (await pageBox(0)).height;
  await page.setInputFiles(tid('file-input'), FIX('sample.pdf'));
  await page.waitForSelector(tid('banner-draft'));
  await reopen(() => click('btn-draft-resume'), 4);
  await page.waitForTimeout(500);
  const resumed = (await annots()).length === finalAnnots.length;
  check('opening the same original offers the draft: cancel keeps the current, original opens clean, resume restores', /đã xuất/.test(offer) && stillOpen && fresh && resumed, offer);

  // ── 15. close; delete a draft ───────────────────────────────────────────
  await collectButtons();
  await click('btn-close-doc');
  await page.waitForSelector(tid('draft-list'));
  const rows = await page.locator('[data-testid^="draft-open-"]').count();
  await click('draft-delete-0');
  await collectButtons();
  await click('draft-delete-cancel-0');
  const kept = (await page.locator('[data-testid^="draft-open-"]').count()) === rows;
  await click('draft-delete-0');
  await click('draft-delete-confirm-0');
  await page.waitForTimeout(400);
  check('close returns to the list; delete asks once more, then removes the draft', rows === 1 && kept && !(await page.isVisible(tid('draft-list'))), `${rows} draft(s)`);

  // ── 16. stamps from other software ──────────────────────────────────────
  await page.setInputFiles(tid('file-input'), FIX('foreign-stamp.pdf'));
  await waitDoc(4);
  let fs0 = (await annots()).find((a) => a.id === 'foreign-noname');
  const fsC = (await annots()).find((a) => a.id === 'foreign-custom');
  await page.mouse.click(...(await toScreen(0, 455, 250)));
  await page.waitForTimeout(400);
  const lockedTitle = await page.textContent(tid('properties-title'));
  const lockedHint = await page.textContent(tid('tool-hint'));
  const c0 = await toScreen(0, 455, 250);
  await drag(c0, [c0[0] - 100, c0[1] + 60]);
  await page.waitForTimeout(500);
  const stayed = (await annots()).find((a) => a.id === 'foreign-noname');
  check('a stamp without a name stays in place (G12) and says why', near(stayed.rect.origin.x, fs0.rect.origin.x, 0.01) && /chỉ xóa được/.test(lockedHint), `${lockedTitle} | ${lockedHint}`);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(1200);
  await deselect();
  await goPage(1);
  const shotF = path.join(OUT, 'screen-foreign.png');
  await page.screenshot({ path: shotF });
  const [green] = JSON.parse(py('sample_pixels.py', [shotF, JSON.stringify([await toScreen(0, 395, 235)])]));
  check('deleted, then undone: the foreign stamp is back with its own appearance', green[1] > 120 && green[0] < 80, JSON.stringify(green));
  const cc = await toScreen(0, 455, 350);
  await page.mouse.click(...cc);
  await page.waitForTimeout(300);
  await drag(cc, [cc[0] - 100, cc[1] + 60]);
  await page.waitForTimeout(600);
  const movedC = (await annots()).find((a) => a.id === 'foreign-custom');
  await deselect();
  const dl2 = page.waitForEvent('download');
  await click('btn-export');
  const fexp = path.join(OUT, 'export-foreign.pdf');
  await (await dl2).saveAs(fexp);
  await page.waitForSelector(tid('state-exported'), { timeout: 30000 });
  const fcol = JSON.parse(
    execFileSync('python3', ['-c', `
import fitz, json, sys
d = fitz.open(sys.argv[1]); pix = d[0].get_pixmap(dpi=72)
pts = json.loads(sys.argv[2])
print(json.dumps([pix.pixel(int(x), int(y)) for x, y in pts]))`, fexp, JSON.stringify([[395, 235], [movedC.rect.origin.x + 15, movedC.rect.origin.y + 15]])], { encoding: 'utf8' }),
  );
  check('a stamp with its own name can be moved; both keep their appearance in the export (MuPDF)', movedC.rect.origin.x < fsC.rect.origin.x - 50 && fcol[0][1] > 120 && fcol[1][0] > 120 && fcol[1][1] < 110, JSON.stringify(fcol));

  // ── 17. drafts that cannot be saved ─────────────────────────────────────
  const brokenCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await brokenCtx.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }));
  const bp = await brokenCtx.newPage();
  track(bp);
  const prev = page;
  page = bp;
  await bp.goto(server.base + '/?e2e');
  await bp.waitForSelector(tid('state-empty'));
  await bp.setInputFiles(tid('file-input'), FIX('sample.pdf'));
  await waitDoc(4, bp);
  await bp.keyboard.press('n');
  await bp.mouse.click(...(await toScreen(0, 500, 700)));
  await bp.waitForTimeout(300);
  await bp.keyboard.type('x');
  await bp.keyboard.press('Control+Enter');
  await bp.waitForSelector(tid('state-draft-error'), { timeout: 15000 });
  const errMsg = await bp.getAttribute(tid('state-draft-error'), 'title');
  await bp.setInputFiles(tid('file-input'), FIX('long-300.pdf'));
  await bp.waitForSelector(tid('btn-open-cancel'));
  await collectButtons(bp);
  await click('btn-open-cancel');
  const kept4 = (await bp.textContent(tid('page-total'))).includes('/ 4');
  await bp.setInputFiles(tid('file-input'), FIX('long-300.pdf'));
  await bp.waitForSelector(tid('btn-open-anyway'));
  await click('btn-open-anyway');
  await waitDoc(300, bp);
  check('when drafts cannot be saved the app says so and asks before dropping changes', /IndexedDB/.test(errMsg || '') && kept4, errMsg);
  page = prev;
  await brokenCtx.close();

  // ── 18. phone ───────────────────────────────────────────────────────────
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const ph = await phoneCtx.newPage();
  track(ph);
  page = ph;
  await ph.goto(server.base + '/?e2e');
  await ph.waitForSelector(tid('state-empty'));
  await ph.setInputFiles(tid('file-input'), FIX('sample.pdf'));
  await ph.waitForSelector(tid('page-0'), { state: 'attached', timeout: 30000 });
  await ph.waitForTimeout(1000);
  const navFit = await ph.evaluate(() => {
    const n = document.querySelector('nav[aria-label="Công cụ"]');
    return n.scrollWidth <= n.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth;
  });
  const bottomTools = await Promise.all(['tool-image', 'tool-signature', 'btn-rotate-page'].map(async (id) => ((await ph.locator(tid(id)).boundingBox())?.y ?? 0) > 780));
  check('phone: every bottom tool fits without scrolling, pictures and rotation included', navFit && bottomTools.every(Boolean));
  await ph.tap(tid('tool-signature'));
  await ph.waitForSelector(tid('sig-pad'));
  const dlg = await ph.locator(tid('sig-dialog')).boundingBox();
  const padB = await ph.locator(tid('sig-pad')).boundingBox();
  await ph.mouse.move(padB.x + 30, padB.y + 100);
  await ph.mouse.down();
  for (let i = 0; i < 28; i++) await ph.mouse.move(padB.x + 30 + i * 9, padB.y + 100 - Math.sin(i / 3) * 30);
  await ph.mouse.up();
  await collectButtons(ph);
  await ph.tap(tid('sig-use'));
  await ph.waitForSelector(tid('placement-0'), { state: 'attached' });
  const pbx = await ph.locator(tid('page-0')).boundingBox();
  await ph.touchscreen.tap(pbx.x + pbx.width * 0.5, pbx.y + pbx.height * 0.3);
  await ph.waitForTimeout(1000);
  const phSig = (await ph.evaluate(() => window.__ezpdf.annotations())).filter((a) => a.custom?.kind === 'signature');
  check('phone: signature dialog fits the screen, a tap places the signature', dlg.x >= 0 && dlg.x + dlg.width <= 390 && dlg.y >= 0 && dlg.y + dlg.height <= 844 && phSig.length === 1, JSON.stringify(dlg));
  await ph.tap(tid('btn-search'));
  covered.add('btn-search');
  check('phone: search sits in the top bar', await ph.isVisible(tid('search-input')));
  await ph.screenshot({ path: path.join(OUT, 'phone.png') });
  await collectButtons(ph);
  page = ph;
  await phoneCtx.close();

  // ── 19. buttons, privacy, errors ────────────────────────────────────────
  // M1/M2 controls are exercised by scripts/e2e.cjs; this run must cover what M3 added.
  const M2_COVERED = /^(btn-toggle-left|btn-toggle-right|btn-open|tool-select|tool-text|tool-highlight|tool-note|btn-undo|btn-redo|btn-page-prev|btn-page-next|zoom-menu|btn-zoom-in|btn-zoom-out|btn-search|btn-export|btn-delete|tab-pages|tab-search|thumb-\d+|ft-.*|hl-color-\d|note-color-\d|search-.*|btn-open-empty)$/;
  // editing existing text: scripts/e2e-edit.cjs; scanning: scripts/e2e-scan.cjs
  // covered by e2e-edit, e2e-scan and e2e-share-print
  const LATER_COVERED = /^(tool-edit-text|btn-scan|btn-scan-empty|tool-hand|btn-share|btn-print|btn-more|share-(copy|sheet|reveal))$/;
  const untested = [...seenButtons].filter((id) => !covered.has(id) && !M2_COVERED.test(id) && !LATER_COVERED.test(id) && !/^(sig-saved|sig-delete|draft-open|draft-delete|draft-delete-confirm|draft-delete-cancel)-\d+$/.test(id.replace(/-\d+$/, '-0')) );
  const families = ['sig-saved', 'sig-delete', 'draft-open', 'draft-delete', 'draft-delete-confirm', 'draft-delete-cancel'].filter(
    (f) => [...seenButtons].some((id) => new RegExp(`^${f}-\\d+$`).test(id)) && ![...covered].some((id) => new RegExp(`^${f}-\\d+$`).test(id)),
  );
  check('every new button on screen is exercised by a step', untested.length === 0 && families.length === 0, untested.concat(families).join(', '));
  check('every visible button has a test id', unnamedButtons.size === 0, [...unnamedButtons].join(', '));
  const external = requests.filter((r) => !r.url.startsWith(origin) && !/^(blob|data):/.test(r.url));
  const nonGet = requests.filter((r) => r.method !== 'GET' && !/^(blob|data):/.test(r.url));
  check('no request to any other origin', external.length === 0, external.map((r) => r.url).join(', '));
  check('nothing uploaded (no non-GET request)', nonGet.length === 0, nonGet.map((r) => `${r.method} ${r.url}`).join(', '));
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  server.stop();
  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await onCrash().catch(() => {});
  process.exit(2);
});
