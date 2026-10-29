#!/usr/bin/env node
/**
 * A 50 MB scanned PDF on a phone-sized screen with the CPU slowed 4× (what
 * Chromium's DevTools calls a mid-tier mobile), production build:
 * open → first page drawn → last page drawn → edit → draft saved →
 * reload and resume the draft → export. Prints the time of each step and
 * the memory of the browser processes. This is a stand-in, not the real
 * phone: the M4 acceptance still needs the APK on a real mid-range Android.
 *
 * Usage: python3 scripts/make_big_fixture.py out/big-50mb.pdf
 *        npm run preview &  BASE=http://localhost:4173 node scripts/perf-big.cjs
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.BASE || 'http://localhost:4173';
const FILE = process.env.BIG || path.join(ROOT, 'out', 'big-50mb.pdf');
const OUT = path.join(ROOT, 'out', 'perf-big');
const RATE = Number(process.env.CPU_RATE || 4);
fs.mkdirSync(OUT, { recursive: true });
const tid = (id) => `[data-testid="${id}"]`;

const steps = [];
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail ?? '') });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
function rssMB() {
  try {
    const out = execFileSync('bash', ['-c', "ps -eo rss,args | grep -E 'chrom(e|ium)' | grep -v grep | awk '{s+=$1} END {print s}'"], { encoding: 'utf8' });
    return Math.round(Number(out.trim()) / 1024);
  } catch {
    return null;
  }
}

(async () => {
  if (!fs.existsSync(FILE)) throw new Error(`missing ${FILE}: python3 scripts/make_big_fixture.py ${FILE}`);
  const size = fs.statSync(FILE).size;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const throttle = () => cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
  let t0 = 0;
  const lap = (name) => {
    const ms = Date.now() - t0;
    steps.push({ step: name, ms, rssMB: rssMB() });
    console.log(`  ${name}: ${(ms / 1000).toFixed(1)} s`);
    return ms;
  };
  const drawn = (i) =>
    page.waitForFunction(
      (n) => {
        const p = document.querySelector(`[data-testid="page-${n}"]`)?.parentElement;
        return !!p && [...p.querySelectorAll('img')].some((im) => im.complete && im.naturalWidth > 0);
      },
      i,
      { timeout: 180000 },
    );

  await page.goto(BASE + '/?e2e');
  await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
  await throttle();
  const base = rssMB();
  console.log(`file ${(size / 1e6).toFixed(1)} MB, CPU ÷${RATE}, browser memory before ${base} MB`);

  // open
  const chooser = page.waitForEvent('filechooser');
  await page.click(tid('btn-open-empty'));
  t0 = Date.now();
  await (await chooser).setFiles(FILE);
  await page.waitForSelector(tid('page-0'), { state: 'attached', timeout: 180000 });
  const tOpen = lap('opened (page layout ready)');
  await drawn(0);
  const tFirst = lap('first page drawn');
  const pages = (await page.evaluate(() => window.__ezpdf.pages())).length;

  // last page
  t0 = Date.now();
  await page.evaluate(() => {
    const vp = [...document.querySelectorAll('[data-testid="viewer"] *')].find((e) => e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    vp.scrollTop = vp.scrollHeight;
  });
  await page.waitForSelector(tid(`page-${pages - 1}`), { state: 'attached', timeout: 60000 }).catch(() => {});
  await drawn(pages - 1);
  const tLast = lap('last page drawn');

  // edit → draft
  t0 = Date.now();
  await page.keyboard.press('r');
  await page.waitForSelector(`${tid('state-dirty')}[data-draft="saved"]`, { state: 'attached', timeout: 300000 });
  const tDraft = lap('draft saved (original + edited copy)');

  // reload, resume
  await page.reload();
  await page.waitForSelector(tid('draft-open-0'), { timeout: 60000 });
  await throttle();
  t0 = Date.now();
  await page.click(tid('draft-open-0'));
  await page.waitForFunction((n) => document.querySelector('[data-testid="page-total"]')?.textContent?.includes(`/ ${n}`) || !!document.querySelector('[data-testid="page-0"]'), pages, { timeout: 180000 });
  await drawn(0);
  const tResume = lap('draft reopened, first page drawn');

  // export
  t0 = Date.now();
  const dl = page.waitForEvent('download', { timeout: 300000 });
  const exportBtn = (await page.$(tid('btn-export'))) ? tid('btn-export') : null;
  if (exportBtn) await page.click(exportBtn);
  else await page.keyboard.press('Control+s');
  const d = await dl;
  const outFile = path.join(OUT, 'big-export.pdf');
  await d.saveAs(outFile);
  const tExport = lap('exported');

  // what writing it in the Android app's way costs: base64 in 3 MB chunks
  const b64ms = await page.evaluate(async (n) => {
    const blob = new Blob([new Uint8Array(n)]);
    const t = performance.now();
    for (let off = 0; off < blob.size; off += 3 * 1024 * 1024) {
      await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result.length);
        r.readAsDataURL(blob.slice(off, off + 3 * 1024 * 1024));
      });
    }
    return Math.round(performance.now() - t);
  }, size);
  steps.push({ step: 'base64 of the whole file in 3 MB chunks (Android save path, JS side)', ms: b64ms });
  console.log(`  base64 chunks: ${(b64ms / 1000).toFixed(1)} s`);

  const peak = Math.max(...steps.map((s) => s.rssMB || 0));
  check(`${(size / 1e6).toFixed(0)} MB, ${pages} pages: opens and the first page is drawn`, tFirst > 0, `${(tFirst / 1000).toFixed(1)} s (layout ${(tOpen / 1000).toFixed(1)} s)`);
  check('the last page is drawn after scrolling', tLast > 0, `${(tLast / 1000).toFixed(1)} s`);
  check('an edit is kept as a draft on the device', tDraft > 0, `${(tDraft / 1000).toFixed(1)} s`);
  check('the draft reopens after a reload', tResume > 0, `${(tResume / 1000).toFixed(1)} s`);
  check('export produces the file', fs.statSync(outFile).size > size * 0.9, `${(tExport / 1000).toFixed(1)} s, ${(fs.statSync(outFile).size / 1e6).toFixed(1)} MB`);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(`browser memory: ${base} MB before, peak ${peak} MB`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ file: path.basename(FILE), bytes: size, pages, cpuSlowdown: RATE, viewport: '412×915 @2.625', memoryBeforeMB: base, memoryPeakMB: peak, steps, results }, null, 2));
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
