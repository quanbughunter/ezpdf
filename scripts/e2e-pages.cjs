#!/usr/bin/env node
/**
 * Acceptance run for page management ("Bộ công cụ", formerly "Sắp xếp trang"; a scan added to the
 * open document), in real Chromium, on tests/fixtures/pages-a.pdf (5 pages
 * marked A-1…A-5: a sticky note on A-2, /Rotate 90 on A-3, a form field on
 * A-4, A-5 landscape) and pages-b.pdf (B-1…B-3, Letter).
 *
 * Every result is read back from the files with MuPDF (page marks, /Rotate,
 * sizes, notes), not from the app's own view:
 *  - organizer: thumbnails drawn, turned as the pages are; delete, move by
 *    buttons and by dragging (mouse; on the phone: hold, then drag by
 *    touch), turn, pages from another PDF, a blank page, its own undo;
 *    "Áp dụng" makes it the document (rotation done in the viewer kept,
 *    sticky note moved with its page); export; ↶ / ↷ of the whole change;
 *    the draft keeps the new order after a reload
 *  - extract the selected pages; split every n pages and by ranges, saving
 *    each file and all of them
 *  - leaving with changes asks first; the viewer's shortcuts are off meanwhile
 *  - a scan onto the end of the open document, and a scan as pages inside
 *    the organizer
 *  - nothing leaves the device; no page errors
 *
 * Usage: node scripts/e2e-pages.cjs
 *        BASE=http://localhost:4173 node scripts/e2e-pages.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'out', 'e2e-pages');
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

/** MuPDF's reading: each page's mark ("A-3", "" for a blank page), /Rotate, unrotated size, sticky notes. */
function read(file) {
  const code = `
import json, sys, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for p in d:
    words = p.get_text().split()
    mark = next((w for w in words if len(w) == 3 and w[1] == '-' and w[0] in 'AB'), '')
    out.append({'mark': mark, 'rot': p.rotation, 'w': round(p.mediabox.width), 'h': round(p.mediabox.height),
                'notes': [a.info.get('content', '') for a in p.annots() if a.type[0] == pymupdf.PDF_ANNOT_TEXT],
                'images': len(p.get_images())})
print(json.dumps(out))
`;
  return JSON.parse(execFileSync('python3', ['-c', code, file], { encoding: 'utf8' }));
}
const marks = (pages) => pages.map((p) => p.mark || '□').join(' ');
const qpdfClean = (file) => {
  try {
    return execFileSync('qpdf', ['--check', file], { encoding: 'utf8' }).includes('No syntax or stream encoding errors');
  } catch {
    return false;
  }
};

async function startServer() {
  if (PROD) return { base: process.env.BASE, stop() {} };
  const port = 5191;
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

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  track(page);
  onCrash = () => page.screenshot({ path: path.join(OUT, 'crash.png') });

  const pagesNow = () => page.evaluate(() => window.__ezpdf.pages());
  const waitPages = (n) => page.waitForFunction((n) => window.__ezpdf?.pages().length === n && document.querySelector('[data-testid="page-total"]')?.textContent?.includes(`/ ${n}`), n, { timeout: 60000 });
  /** each page's mark as the viewer's own engine reads it */
  const viewerMarks = () =>
    page.evaluate(async () => {
      const n = window.__ezpdf.pages().length;
      const out = [];
      for (let i = 0; i < n; i++) {
        const t = await window.__ezpdf.pageText(i);
        out.push((t.match(/\b[AB]-\d\b/) || ['□'])[0]);
      }
      return out.join(' ');
    });
  const cards = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid^="org-card-"]')).map((b) => ({ src: +b.dataset.src, page: +b.dataset.page, rot: +b.dataset.rotation })),
    );
  const cardMarks = async () => (await cards()).map((c) => (c.src === 0 ? `A-${c.page + 1}` : c.src === -1 ? '□' : `B-${c.page + 1}`)).join(' ');
  const openOrganizer = async () => {
    await page.click(tid('btn-pages'));
    await page.waitForSelector(tid('org-card-0'), { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="org-busy"]'), null, { timeout: 30000 });
  };
  const saveDownload = async (click, name) => {
    const dl = page.waitForEvent('download');
    await click();
    const d = await dl;
    const f = path.join(OUT, name);
    await d.saveAs(f);
    return { file: f, suggested: d.suggestedFilename() };
  };

  await page.goto(server.base + '/?e2e');
  await page.waitForSelector(tid('state-empty'), { timeout: 60000 });
  await page.setInputFiles(tid('file-input'), FIX('pages-a.pdf'));
  await waitPages(5);
  await sleep(600);
  {
    // "Bộ công cụ" (0.8.0): in the top bar right after Share, its own icon
    const where = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="top-bar"] [data-testid="btn-pages"]');
      return b && { prev: b.previousElementSibling?.dataset.testid, name: b.getAttribute('aria-label'), svg: !!b.querySelector('svg rect') };
    });
    check('“Bộ công cụ” sits right after Share in the top bar, with its toolbox icon', where && where.prev === 'btn-share' && where.name === 'Bộ công cụ' && where.svg, JSON.stringify(where));
  }
  // page 1 turned in the viewer (kept by the viewer until export)
  await page.click(tid('btn-rotate-page'));
  await page.waitForFunction(() => window.__ezpdf.pages()[0].rotation === 1);

  // ── the organizer ──
  await openOrganizer();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="org-grid"] img').length === 5, null, { timeout: 30000 });
  const c0 = await cards();
  const firstThumb = await page.evaluate(() => {
    const img = document.querySelector('[data-testid="org-card-2"] img');
    return { t: img.style.transform, w: img.naturalWidth, h: img.naturalHeight };
  });
  check(
    'organizer: every page drawn, turned as in the viewer (A-1 turned there, A-3 stored at 90°)',
    c0.length === 5 && c0[0].rot === 1 && c0[2].rot === 1 && c0[1].rot === 0 && /rotate\(90deg\)/.test(firstThumb.t) && firstThumb.h > firstThumb.w,
    `${c0.map((c) => c.rot).join(',')} · thumb ${firstThumb.w}×${firstThumb.h} ${firstThumb.t}`,
  );
  await page.screenshot({ path: path.join(OUT, 'organizer.png') });

  // the viewer's shortcuts are off while the organizer is open: R would turn page 1 again
  await page.keyboard.press('r');
  await sleep(150);
  const stillOne = (await pagesNow())[0].rotation === 1;

  await page.click(tid('org-card-3'));
  await page.click(tid('org-delete'));
  await page.click(tid('org-card-2'));
  await page.click(tid('org-left'));
  await page.click(tid('org-left'));
  await page.click(tid('org-rotate-left'));
  check('delete A-4, move A-3 first with “Lên trước”, turn it upright', (await cardMarks()) === 'A-3 A-1 A-2 A-5' && (await cards())[0].rot === 0, await cardMarks());
  check('the viewer’s own shortcuts do nothing while the organizer is open', stillOne);

  // pages from another PDF go after the last selected page (A-3 is selected)
  await page.setInputFiles(tid('org-file-input'), FIX('pages-b.pdf'));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="org-card-"]').length === 7 && !document.querySelector('[data-testid="org-busy"]'), null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="org-grid"] img').length === 7, null, { timeout: 30000 });
  const origin1 = await page.textContent(tid('org-grid'));
  check('“Từ tệp PDF khác”: its 3 pages come in after the selected page, marked with their file', (await cardMarks()) === 'A-3 B-1 B-2 B-3 A-1 A-2 A-5' && origin1.includes('pages-b · tr. 2'), await cardMarks());

  // a blank page after A-5 (as tall and wide as A-5 looks: landscape)
  await page.click(tid('org-select-all'));
  await page.click(tid('org-select-none'));
  await page.click(tid('org-card-6'));
  await page.click(tid('org-add'));
  await page.click(tid('org-add-blank'));
  const blank = (await cards())[7];
  check('“Trang trắng” after the selected page', (await cardMarks()) === 'A-3 B-1 B-2 B-3 A-1 A-2 A-5 □' && blank?.src === -1, await cardMarks());

  // drag A-2 (not selected) with the mouse to before B-1
  {
    const from = await page.locator(tid('org-card-5')).boundingBox();
    const to = await page.locator(tid('org-card-1')).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 - 20, from.y + from.height / 2, { steps: 4 });
    await page.mouse.move(to.x + 8, to.y + to.height / 2, { steps: 12 });
    const mark = await page.isVisible(tid('org-drop-mark'));
    await page.mouse.up();
    await sleep(100);
    check('dragging a page with the mouse moves it where the mark showed', mark && (await cardMarks()) === 'A-3 A-2 B-1 B-2 B-3 A-1 A-5 □', await cardMarks());
  }
  // the organizer's own undo
  await page.click(tid('org-card-7')); // the blank page was selected since it was added
  await page.click(tid('org-card-4'));
  await page.keyboard.press('Delete');
  const afterDelete = await cardMarks();
  await page.click(tid('org-undo'));
  check('Delete key removes the selected page, “Hoàn tác” brings it back', afterDelete === 'A-3 A-2 B-1 B-2 A-1 A-5 □' && (await cardMarks()) === 'A-3 A-2 B-1 B-2 B-3 A-1 A-5 □', `${afterDelete} → ${await cardMarks()}`);

  // apply → the document
  await page.click(tid('org-apply'));
  await page.waitForSelector(tid('organizer'), { state: 'detached', timeout: 60000 });
  await waitPages(8);
  await sleep(500);
  const vm = await viewerMarks();
  const rot = (await pagesNow()).map((p) => p.rotation);
  const notes = await page.evaluate(() => window.__ezpdf.annotations().filter((a) => a.type === 1).map((a) => a.pageIndex));
  check(
    '“Áp dụng”: the document has the new pages in order, rotations kept, the sticky note moved with A-2',
    vm === 'A-3 A-2 B-1 B-2 B-3 A-1 A-5 □' && rot.join(',') === '0,0,0,0,0,1,0,0' && notes.join() === '1',
    `${vm} · ${rot.join(',')} · note on page ${notes.map((n) => n + 1)}`,
  );
  await page.waitForSelector(tid('state-draft-saved'), { timeout: 30000 });

  const exp = await saveDownload(() => page.click(tid('btn-export')), 'exported.pdf');
  const r1 = read(exp.file);
  check(
    'the exported file (MuPDF): order, /Rotate, sizes, the note, qpdf clean',
    marks(r1) === 'A-3 A-2 B-1 B-2 B-3 A-1 A-5 □' &&
      r1.map((p) => p.rot).join(',') === '0,0,0,0,0,90,0,0' &&
      r1[2].w === 612 && r1[2].h === 792 && r1[7].w === 842 && r1[7].h === 595 &&
      r1[1].notes.join() === 'Ghi chu tren A-2' &&
      qpdfClean(exp.file),
    `${marks(r1)} · ${r1.map((p) => p.rot).join(',')} · blank ${r1[7].w}×${r1[7].h}`,
  );

  // ↶ / ↷ of the whole change
  await page.click(tid('btn-undo'));
  await waitPages(5);
  await sleep(400);
  const undone = await viewerMarks();
  const undoneRot = (await pagesNow()).map((p) => p.rotation).join(',');
  await page.click(tid('btn-redo'));
  await waitPages(8);
  await sleep(400);
  check('↶ brings the 5 original pages back (page 1 still turned), ↷ the new order again', undone === 'A-1 A-2 A-3 A-4 A-5' && undoneRot === '1,0,1,0,0' && (await viewerMarks()) === 'A-3 A-2 B-1 B-2 B-3 A-1 A-5 □', `${undone} (${undoneRot})`);

  // the draft keeps the new order across a reload
  await page.waitForSelector(tid('state-draft-saved'), { timeout: 30000 });
  await page.reload();
  await page.waitForSelector(tid('draft-open-0'), { timeout: 30000 });
  await page.click(tid('draft-open-0'));
  await waitPages(8);
  await sleep(500);
  check('the draft keeps the new pages after a reload', (await viewerMarks()) === 'A-3 A-2 B-1 B-2 B-3 A-1 A-5 □' && (await pagesNow())[5].rotation === 1);

  // ── extract and split (the document does not change) ──
  await openOrganizer();
  await page.click(tid('org-card-1'));
  await page.click(tid('org-card-3'));
  await page.click(tid('org-extract'));
  await page.waitForSelector(tid('org-outputs'), { timeout: 30000 });
  const ex = await saveDownload(() => page.click(tid('org-output-save-0')), 'extract.pdf');
  const r2 = read(ex.file);
  check('“Trích ra tệp mới”: a file with the selected pages only, named after them', marks(r2) === 'A-2 B-2' && r2[0].notes.join() === 'Ghi chu tren A-2' && /\(trang 2, 4\)\.pdf$/.test(ex.suggested) && qpdfClean(ex.file), `${marks(r2)} · ${ex.suggested}`);
  await page.click(tid('org-outputs-close'));

  await page.click(tid('org-split'));
  await page.fill(tid('split-every'), '3');
  const preview = await page.textContent(tid('split-preview'));
  await page.click(tid('split-go'));
  await page.waitForSelector(tid('org-output-2'), { timeout: 60000 });
  const files = [];
  page.on('download', async (d) => files.push(d));
  await page.click(tid('org-outputs-save-all'));
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="org-output-list"] .text-success').length === 3, null, { timeout: 30000 });
  await sleep(300);
  const parts = [];
  for (const [i, d] of files.entries()) {
    const f = path.join(OUT, `split-${i + 1}.pdf`);
    await d.saveAs(f);
    parts.push({ name: d.suggestedFilename(), marks: marks(read(f)) });
  }
  check(
    '“Tách tệp”, every 3 pages: 3 files, “Lưu tất cả” saves each with its pages',
    preview.includes('Sẽ tạo 3 tệp') && parts.map((p) => p.marks).join(' | ') === 'A-3 A-2 B-1 | B-2 B-3 A-1 | A-5 □' && /\(trang 1-3\)\.pdf$/.test(parts[0]?.name ?? ''),
    parts.map((p) => `${p.name}: ${p.marks}`).join(' | '),
  );
  page.removeAllListeners('download');
  await page.click(tid('org-outputs-close'));

  await page.click(tid('org-split'));
  await page.click(tid('split-mode-ranges'));
  await page.fill(tid('split-ranges'), '1-2, 9-');
  const bad = await page.textContent(tid('split-preview'));
  const badDisabled = await page.isDisabled(tid('split-go'));
  await page.fill(tid('split-ranges'), '2, 4-');
  const good = await page.textContent(tid('split-preview'));
  await page.click(tid('split-go'));
  await page.waitForSelector(tid('org-output-1'), { timeout: 60000 });
  const rp = await saveDownload(() => page.click(tid('org-output-save-1')), 'range-2.pdf');
  check(
    'split by ranges: a range outside the document is refused; “2, 4-” gives page 2 and pages 4–8',
    /nằm ngoài/.test(bad) && badDisabled && good.includes('Sẽ tạo 2 tệp') && marks(read(rp.file)) === 'B-2 B-3 A-1 A-5 □',
    `${bad} · ${good}`,
  );
  await page.click(tid('org-outputs-close'));
  // nothing applied: the document is as it was
  await page.click(tid('org-close'));
  await page.waitForSelector(tid('organizer'), { state: 'detached' });
  check('extracting and splitting leave the document as it is', (await pagesNow()).length === 8);

  // leaving with changes asks first
  await openOrganizer();
  await page.click(tid('org-card-0'));
  await page.click(tid('org-delete'));
  await page.keyboard.press('Escape');
  const asked = await page.isVisible(tid('org-leave'));
  await page.click(tid('org-leave-stay'));
  const stayed = (await cards()).length === 7;
  await page.click(tid('org-close'));
  await page.click(tid('org-leave-discard'));
  await page.waitForSelector(tid('organizer'), { state: 'detached' });
  check('leaving with changes asks; “Ở lại” keeps them, “Bỏ thay đổi” leaves the document as it was', asked && stayed && (await pagesNow()).length === 8);

  // ── a scan onto the end of the open document ──
  await page.click(tid('btn-scan'));
  await page.setInputFiles(tid('scan-file-input'), FIX('scan/photo-wood.jpg'));
  await page.waitForSelector(tid('scan-corner-0'), { timeout: 30000 });
  await page.click(tid('scan-adjust-done'));
  await page.waitForSelector(tid('scan-result'), { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="scan-append"]')?.disabled, null, { timeout: 30000 });
  const twoButtons = (await page.textContent(tid('scan-create'))).includes('Tạo PDF mới');
  await page.click(tid('scan-append'));
  await page.waitForSelector(tid('scan-dialog'), { state: 'detached', timeout: 60000 });
  await waitPages(9);
  await sleep(400);
  const p9 = await pagesNow();
  const shown = await page
    .waitForFunction(() => document.querySelector('[data-testid="page-input"]')?.value === '9', null, { timeout: 8000 })
    .then(() => '9', async () => page.evaluate(() => document.querySelector('[data-testid="page-input"]')?.value));
  check(
    '“Thêm vào tài liệu này”: the scan becomes page 9 of the open document, shown at once',
    twoButtons && p9.length === 9 && shown === '9' && Math.abs(p9[8].h / p9[8].w - Math.SQRT2) < 0.01 && (await viewerMarks()).startsWith('A-3 A-2 B-1'),
    `page shown ${shown}, last ${Math.round(p9[8].w)}×${Math.round(p9[8].h)}`,
  );
  const exp2 = await saveDownload(() => page.click(tid('btn-export')), 'with-scan.pdf');
  const r3 = read(exp2.file);
  check('exported with the scan: 9 pages, the last one the scanned image', r3.length === 9 && r3[8].images === 1 && marks(r3).startsWith('A-3 A-2'), marks(r3));
  await page.click(tid('btn-undo'));
  await waitPages(8);
  check('↶ takes the scanned page off again', (await pagesNow()).length === 8);

  // a scan as pages inside the organizer
  await openOrganizer();
  await page.click(tid('org-add'));
  await page.click(tid('org-add-scan'));
  await page.setInputFiles(tid('scan-file-input'), FIX('scan/photo-desk.jpg'));
  await page.waitForSelector(tid('scan-corner-0'), { timeout: 30000 });
  await page.click(tid('scan-adjust-done'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="scan-create"]')?.disabled, null, { timeout: 30000 });
  const label = await page.textContent(tid('scan-create'));
  await page.click(tid('scan-create'));
  await page.waitForSelector(tid('scan-dialog'), { state: 'detached', timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^="org-card-"]').length === 9, null, { timeout: 30000 });
  const lastCard = (await cards())[8];
  check('“Quét hoặc chụp ảnh” in the organizer: the scanned page joins the list', label.includes('Thêm các trang này') && lastCard.src === 1, label);
  await page.click(tid('org-apply'));
  await page.waitForSelector(tid('organizer'), { state: 'detached', timeout: 60000 });
  await waitPages(9);
  check('applied: 9 pages', (await pagesNow()).length === 9);
  await ctx.close();

  // ── editing text after a page change works on the new pages ──
  {
    const tctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const tp = await tctx.newPage();
    track(tp);
    onCrash = () => tp.screenshot({ path: path.join(OUT, 'crash-textedit.png') });
    await tp.goto(server.base + '/?e2e');
    await tp.waitForSelector(tid('state-empty'), { timeout: 60000 });
    await tp.setInputFiles(tid('file-input'), FIX('pages-a.pdf'));
    await tp.waitForFunction(() => window.__ezpdf?.pages().length === 5, null, { timeout: 60000 });
    await sleep(500);
    await tp.click(tid('tool-edit-text'));
    await tp.waitForSelector(`${tid('textedit-layer-0')}[data-ready="true"]`, { timeout: 30000 });
    // with the tool on: A-5 to the front
    await tp.click(tid('btn-pages'));
    await tp.waitForSelector(tid('org-card-4'), { timeout: 30000 });
    await tp.waitForFunction(() => !document.querySelector('[data-testid="org-busy"]'), null, { timeout: 30000 });
    await tp.click(tid('org-card-4'));
    for (let k = 0; k < 4; k++) await tp.click(tid('org-left'));
    await tp.click(tid('org-apply'));
    await tp.waitForSelector(tid('organizer'), { state: 'detached', timeout: 60000 });
    await tp.waitForFunction(() => window.__ezpdf?.pages().length === 5, null, { timeout: 60000 });
    await sleep(500);
    const line = `${tid('textedit-layer-0')}[data-ready="true"] [data-testid="textedit-line"][data-text="Trang 5 cua tep A"]`;
    const found = await tp.waitForSelector(line, { timeout: 30000 }).then(() => true, () => false);
    let after = '';
    if (found) {
      await tp.click(line);
      await tp.waitForSelector(tid('textedit-input'));
      await tp.fill(tid('textedit-input'), 'Trang nam cua tep A');
      await tp.press(tid('textedit-input'), 'Enter');
      await tp.waitForSelector(`${tid('textedit-layer-0')} [data-testid="textedit-line"][data-text="Trang nam cua tep A"]`, { timeout: 30000 }).catch(() => {});
      await sleep(400);
      after = await tp.evaluate(async () => {
        const n = window.__ezpdf.pages().length;
        const out = [];
        for (let i = 0; i < n; i++) out.push(((await window.__ezpdf.pageText(i)).match(/\b[AB]-\d\b/) || ['□'])[0]);
        return out.join(' ') + ' | ' + (await window.__ezpdf.pageText(0)).replace(/\s+/g, ' ');
      });
    }
    check(
      'editing text right after a page change edits the new page 1 and keeps the new order',
      found && after.startsWith('A-5 A-1 A-2 A-3 A-4 |') && after.replace(/\s/g, '').includes('Trangnamcuatep'),
      after.slice(0, 90) || 'the line of the new page 1 was not offered',
    );
    await tctx.close();
  }

  // ── phone: menu, tap to select, hold and drag by touch ──
  {
    const pctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    const ph = await pctx.newPage();
    track(ph);
    onCrash = () => ph.screenshot({ path: path.join(OUT, 'crash-phone.png') });
    await ph.goto(server.base + '/?e2e');
    await ph.waitForSelector(tid('state-empty'), { timeout: 60000 });
    await ph.setInputFiles(tid('file-input'), FIX('pages-a.pdf'));
    await ph.waitForFunction(() => window.__ezpdf?.pages().length === 5, null, { timeout: 60000 });
    await sleep(500);
    const phoneBar = await ph.evaluate(() => {
      const b = document.querySelector('[data-testid="top-bar"] [data-testid="btn-pages"]');
      const r = b?.getBoundingClientRect();
      const h = document.querySelector('[data-testid="top-bar"]');
      return b && { next: b.nextElementSibling?.dataset.testid, onScreen: r.left >= 0 && r.right <= innerWidth, fits: h.scrollWidth <= h.clientWidth + 1 };
    });
    await ph.tap(tid('btn-pages'));
    await ph.waitForSelector(tid('org-card-4'), { timeout: 30000 });
    await ph.waitForFunction(() => document.querySelectorAll('[data-testid="org-grid"] img').length === 5, null, { timeout: 30000 });
    await ph.tap(tid('org-card-0'));
    const pressed = await ph.getAttribute(tid('org-card-0'), 'aria-pressed');
    const allVisible = await ph.evaluate(() =>
      ['org-add', 'org-left', 'org-right', 'org-rotate-left', 'org-rotate-right', 'org-delete', 'org-extract', 'org-split'].every((id) => {
        const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
        return r && r.right <= innerWidth && r.left >= 0 && r.width > 0;
      }),
    );
    const title = await ph.textContent(`${tid('organizer')} header`);
    check(
      'phone: “Bộ công cụ” in the top bar beside Share (bar fits), opens the screen of that name; a tap selects; every action fits on screen',
      phoneBar && phoneBar.next === 'btn-share' && phoneBar.onScreen && phoneBar.fits && /Bộ công cụ/.test(title) && pressed === 'true' && allVisible,
      JSON.stringify(phoneBar),
    );
    await ph.tap(tid('org-card-0')); // unselect
    // hold A-5 for a moment, then drag it before A-1 (touch events through the DevTools protocol)
    const cdp = await pctx.newCDPSession(ph);
    const from = await ph.locator(tid('org-card-4')).boundingBox();
    const to = await ph.locator(tid('org-card-0')).boundingBox();
    const pt = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from.x + from.width / 2, from.y + from.height / 2) });
    await sleep(500);
    for (let k = 1; k <= 12; k++) {
      const x = from.x + from.width / 2 + ((to.x + 6 - (from.x + from.width / 2)) * k) / 12;
      const y = from.y + from.height / 2 + ((to.y + to.height / 2 - (from.y + from.height / 2)) * k) / 12;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x, y) });
      await sleep(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
    const order = await ph.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="org-card-"]')).map((b) => `A-${+b.dataset.page + 1}`).join(' '));
    // a quick swipe over the grid scrolls, it does not move a page
    const f2 = await ph.locator(tid('org-card-2')).boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(f2.x + f2.width / 2, f2.y + f2.height / 2) });
    for (let k = 1; k <= 6; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(f2.x + f2.width / 2, f2.y + f2.height / 2 - k * 25) });
      await sleep(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
    const order2 = await ph.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="org-card-"]')).map((b) => `A-${+b.dataset.page + 1}`).join(' '));
    check('phone: hold a page, then drag it by touch; a quick swipe moves nothing', order === 'A-5 A-1 A-2 A-3 A-4' && order2 === order, `${order} / ${order2}`);
    await ph.screenshot({ path: path.join(OUT, 'phone-organizer.png') });
    await ph.tap(tid('org-apply'));
    await ph.waitForSelector(tid('organizer'), { state: 'detached', timeout: 60000 });
    await ph.waitForFunction(() => window.__ezpdf?.pages().length === 5, null, { timeout: 60000 });
    await sleep(500);
    const pm = await ph.evaluate(async () => (await window.__ezpdf.pageText(0)).match(/\b[AB]-\d\b/)?.[0]);
    check('phone: applied, A-5 is now page 1', pm === 'A-5', pm);
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
  console.error('page errors so far:', JSON.stringify(results.slice(-3)));
  process.exit(1);
});
