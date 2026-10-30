#!/usr/bin/env node
/**
 * Smoke test of the desktop app (Tauri) on Linux through WebDriver
 * (tauri-driver + WebKitWebDriver), on the real binary with its real
 * plugins. Windows uses WebView2 instead of WebKitGTK: run the manual
 * checklist in docs/06-ket-qua-moc-4.md there.
 *
 *  1. started with a PDF path (what "Open with ezPDF" does): the PDF opens
 *  2. an edit is autosaved as files in the app's own data folder; the
 *     original stored is byte-identical to the file opened
 *  3. the page cannot read files it was not given (fs scope), nor reach
 *     another site (CSP)
 *  4. restarted without arguments: the draft is listed and reopens with
 *     the edit
 *  5. a second launch with another PDF goes to the open window
 *     (single instance) and that PDF opens there
 *  6. the system open and save dialogs (GTK, driven with xdotool): the
 *     picked PDF opens, the export is written where the user chose
 *  7. the window closed (WM_DELETE_WINDOW, as the close button does) right
 *     after an edit: the draft is saved before the window goes
 *  2c. the page organizer in the shell's web view: thumbnails drawn, a split
 *     built in the PDFium worker, the rearranged document saved as the draft,
 *     and undone
 *  2b. sharing through the shell (src-tauri/src/share.rs): the share button
 *     sends the finished PDF over the IPC as raw bytes; the shell writes a
 *     temporary copy under the document's name (Vietnamese marks) and shows
 *     it in its folder (xdg-open, replaced by a recorder here); a way this
 *     system lacks is refused with a message. Windows' clipboard and share
 *     window are compiled for Windows only: see docs/08 for the manual check.
 *
 * Needs: Xvfb (or a display), WebKitWebDriver, `cargo install tauri-driver`,
 * and the app built with `npx tauri build --debug --no-bundle`.
 * Usage: node scripts/smoke-desktop.cjs [path/to/ezpdf-binary]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn, spawnSync } = require('child_process');

// Single instance on Linux goes through the session D-Bus; give the run one.
if (!process.env.DBUS_SESSION_BUS_ADDRESS && !process.env.EZPDF_SMOKE_NO_DBUS) {
  const r = spawnSync('dbus-run-session', ['--', process.execPath, __filename, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, EZPDF_SMOKE_NO_DBUS: '1' } });
  process.exit(r.status ?? 2);
}

const ROOT = path.resolve(__dirname, '..');
const BIN = path.resolve(process.argv[2] || path.join(ROOT, 'src-tauri/target/debug/ezpdf'));
const OUT = path.join(ROOT, 'out', 'smoke-desktop');
const FIX = (f) => path.join(ROOT, 'tests/fixtures', f);
const IDENT = 'app.ezpdf.desktop';
const DATA = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), IDENT);
const STORE = path.join(DATA, 'store');
const DRIVER = 'http://127.0.0.1:4444';
const hasXdotool = spawnSync('which', ['xdotool']).status === 0;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail ?? '') });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function wd(method, url, body) {
  const res = await fetch(DRIVER + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url}: ${JSON.stringify(json).slice(0, 400)}`);
  return json.value;
}

async function session(args = []) {
  const v = await wd('POST', '/session', {
    capabilities: { alwaysMatch: { 'tauri:options': { application: BIN, args } } },
  });
  const id = v.sessionId;
  const js = (script, ...a) => wd('POST', `/session/${id}/execute/sync`, { script, args: a });
  const jsAsync = (script, ...a) => wd('POST', `/session/${id}/execute/async`, { script, args: a });
  const waitFor = async (script, what, ms = 60000, ...a) => {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < ms) {
      try {
        last = await js(script, ...a);
        if (last) return last;
      } catch (e) {
        last = e.message;
      }
      await sleep(300);
    }
    throw new Error(`timeout waiting for ${what} (last: ${String(last).slice(0, 200)})`);
  };
  const shot = async (name) => (await sleep(2500), fs.writeFileSync(path.join(OUT, name), Buffer.from(await wd('GET', `/session/${id}/screenshot`), 'base64')));
  const close = () => wd('DELETE', `/session/${id}`).catch(() => {});
  return { id, js, jsAsync, waitFor, shot, close };
}

const T = (id) => `[data-testid="${id}"]`;
const text = (sel) => `return document.querySelector('${sel}')?.textContent ?? null`;
const has = (sel, needle) => `return (document.querySelector('${sel}')?.textContent ?? '').includes(${JSON.stringify(needle)})`;

(async () => {
  if (!fs.existsSync(BIN)) throw new Error(`no binary at ${BIN}; build it with: npx tauri build --debug --no-bundle`);
  const procs = [];
  let display = process.env.DISPLAY;
  if (!display) {
    display = ':97';
    procs.push(spawn('Xvfb', [display, '-screen', '0', '1400x900x24'], { stdio: 'ignore' }));
    await sleep(800);
  }
  // xdg-open replaced by a recorder: the share step must not start a file manager
  const fakeBin = path.join(OUT, 'fakebin');
  const xdgLog = path.join(OUT, 'xdg-open.log');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'xdg-open'), `#!/bin/sh\nprintf '%s\\n' "$@" >> '${xdgLog}'\n`, { mode: 0o755 });
  const env = { ...process.env, DISPLAY: display, PATH: `${fakeBin}:${process.env.PATH}` };
  const driver = spawn(path.join(os.homedir(), '.cargo/bin/tauri-driver'), ['--port', '4444'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(driver);
  driver.stderr.on('data', (d) => fs.appendFileSync(path.join(OUT, 'driver.log'), d));
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(DRIVER + '/status');
      break;
    } catch {
      await sleep(200);
    }
  }
  fs.rmSync(STORE, { recursive: true, force: true });

  const sample = FIX('sample.pdf');
  const work = path.join(OUT, 'Hợp đồng mẫu.pdf'); // a path with Vietnamese characters and a space
  fs.copyFileSync(sample, work);

  // 1. started with a PDF path
  let s = await session([work]);
  try {
    await s.waitFor(has(T('page-total'), '/ 4'), 'the PDF given on the command line to open');
    const name = await s.js(`return document.body.textContent.includes('Hợp đồng mẫu.pdf')`);
    check('started with a PDF path, the PDF opens (name with Vietnamese marks and a space)', name);
    const kind = await s.js(`return '__TAURI_INTERNALS__' in window`);
    check('runs inside the desktop shell, not a browser', kind);
    await s.shot('1-opened.png');

    // 2. an edit, autosaved into the app's folder
    await s.js(`document.querySelector('${T('btn-rotate-page')}').click()`);
    await s.waitFor(`return !!document.querySelector('${T('state-draft-saved')}')`, 'the draft to be saved', 30000);
    const drafts = fs.existsSync(path.join(STORE, 'drafts')) ? fs.readdirSync(path.join(STORE, 'drafts')) : [];
    const dir = drafts[0] ? path.join(STORE, 'drafts', drafts[0]) : null;
    const files = dir ? fs.readdirSync(dir).sort() : [];
    const orig = files.find((f) => f.startsWith('original-'));
    const meta = files.find((f) => f.startsWith('meta-'));
    const record = meta ? JSON.parse(fs.readFileSync(path.join(dir, meta), 'utf8')).record : null;
    check(
      `the edit is saved as files in the app's folder (${path.relative(os.homedir(), STORE)})`,
      drafts.length === 1 && files.length === 3 && !!files.find((f) => f.startsWith('draft-')) && record?.rotations?.[0] === 1,
      files.join(' '),
    );
    check('the original kept with the draft is byte-identical to the file opened', orig && sha(fs.readFileSync(path.join(dir, orig))) === sha(fs.readFileSync(work)));
    check('the file opened is untouched', sha(fs.readFileSync(work)) === sha(fs.readFileSync(sample)));
    await s.shot('2-saved.png');

    // 2b. share through the shell
    const ways = await s.jsAsync(`const done = arguments[0]; window.__TAURI_INTERNALS__.invoke('share_ways').then((w) => done(JSON.stringify(w)), (e) => done('err ' + e));`);
    const shareRoot = path.join(os.tmpdir(), 'ezPDF-chia-se');
    fs.rmSync(xdgLog, { force: true });
    fs.rmSync(shareRoot, { recursive: true, force: true });
    await s.js(`document.querySelector('${T('btn-share')}').click()`);
    for (let i = 0; i < 100 && !fs.existsSync(xdgLog); i++) await sleep(200);
    const stamps = fs.existsSync(shareRoot) ? fs.readdirSync(shareRoot) : [];
    const copy = stamps.length === 1 ? path.join(shareRoot, stamps[0], 'Hợp đồng mẫu.pdf') : null;
    const copyRot = copy && fs.existsSync(copy)
      ? execFileSync('python3', ['-c', 'import pikepdf,sys; pdf = pikepdf.open(sys.argv[1]); print(int(pdf.pages[0].obj.get("/Rotate", 0)))', copy], { encoding: 'utf8' }).trim()
      : null;
    const opened = fs.existsSync(xdgLog) ? fs.readFileSync(xdgLog, 'utf8').trim() : '';
    check(
      'share: the finished PDF reaches the shell as a copy named after the document (page 1 turned) and its folder is shown',
      ways === '["reveal"]' && copyRot === '90' && opened === path.dirname(copy),
      `ways ${ways}; copy ${copy && path.relative(os.tmpdir(), copy)}; /Rotate ${copyRot}; xdg-open ${opened}`,
    );
    const refused = await s.jsAsync(
      `const done = arguments[0];
       window.__TAURI_INTERNALS__.invoke('share_file', new Uint8Array([37, 80, 68, 70]), { headers: { 'x-ezpdf-name': encodeURIComponent('a.pdf'), 'x-ezpdf-way': 'copy' } })
         .then(() => done('allowed'), (e) => done('refused: ' + String(e)));`,
    );
    check('share: a way this system does not have (clipboard on Linux) is refused with a message', refused.startsWith('refused: Máy này không chia sẻ được'), refused);
    fs.rmSync(shareRoot, { recursive: true, force: true });

    // 2c. the page organizer in the shell's own web view (WebKitGTK here)
    {
      const draftPdf = () => {
        const d = fs.readdirSync(path.join(STORE, 'drafts'))[0];
        const f = fs.readdirSync(path.join(STORE, 'drafts', d)).find((x) => x.startsWith('draft-'));
        return path.join(STORE, 'drafts', d, f);
      };
      const order = (file) =>
        execFileSync('python3', ['-c', 'import pymupdf,sys; print(" ".join(p.get_text().split()[1] for p in pymupdf.open(sys.argv[1])))', file], { encoding: 'utf8' }).trim();
      const draftMeta = () => {
        const d = fs.readdirSync(path.join(STORE, 'drafts'))[0];
        const f = fs.readdirSync(path.join(STORE, 'drafts', d)).find((x) => x.startsWith('meta-'));
        return JSON.parse(fs.readFileSync(path.join(STORE, 'drafts', d, f), 'utf8')).record;
      };
      await s.js(`document.querySelector('${T('btn-pages')}').click()`);
      await s.waitFor(
        `const imgs = [...document.querySelectorAll('[data-testid="org-grid"] img')]; return imgs.length === 4 && imgs.every((i) => i.complete && i.naturalWidth > 0)`,
        'the organizer to draw the 4 pages',
        30000,
      );
      // page 1 (turned earlier) one place later, page 4 deleted
      await s.js(`document.querySelector('${T('org-card-0')}').click()`);
      await s.js(`document.querySelector('${T('org-right')}').click()`);
      await s.js(`document.querySelector('${T('org-card-1')}').click()`);
      await s.js(`document.querySelector('${T('org-card-3')}').click()`);
      await s.js(`document.querySelector('${T('org-delete')}').click()`);
      await s.shot('2c-organizer.png');
      // a split, built by the worker inside the shell
      await s.js(`document.querySelector('${T('org-split')}').click()`);
      await s.waitFor(`return !!document.querySelector('${T('split-go')}')`, 'the split dialog');
      await s.js(`document.querySelector('${T('split-go')}').click()`);
      const parts = await s.waitFor(`return document.querySelectorAll('[data-testid^="org-output-save-"]').length`, 'the split files', 30000);
      await s.js(`document.querySelector('${T('org-outputs-close')}').click()`);
      await s.js(`document.querySelector('${T('org-apply')}').click()`);
      await s.waitFor(has(T('page-total'), '/ 3'), 'the rearranged document', 30000);
      for (let i = 0; i < 100 && draftMeta()?.pages !== 3; i++) await sleep(300);
      const rec = draftMeta();
      const got = order(draftPdf());
      check(
        'the page organizer in the desktop shell: pages drawn, split built, the rearranged document saved as the draft (page 1 still turned)',
        parts === 2 && rec?.pages === 3 && got === '2 1 3' && rec?.rotations?.join(',') === '1,1,0',
        `split ${parts} files · draft pages ${got} · rotations ${rec?.rotations?.join(',')}`,
      );
      // ↶: the 4 pages again, for the steps below
      await s.js(`document.querySelector('${T('btn-undo')}').click()`);
      await s.waitFor(has(T('page-total'), '/ 4'), 'the undo of the page change', 30000);
      for (let i = 0; i < 100 && draftMeta()?.pages !== 4; i++) await sleep(300);
      check('…and ↶ brings the 4 pages back into the draft', draftMeta()?.pages === 4 && order(draftPdf()) === '1 2 3 4' && draftMeta()?.rotations?.[0] === 1);
    }

    // 3. what the page may not do
    const probe = async (cmd, args) =>
      s.jsAsync(
        `const done = arguments[arguments.length - 1];
         window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(() => done('allowed'), (e) => done('refused: ' + String(e)));`,
        cmd,
        args,
      );
    // writes go as plugin-fs sends them: raw body, path in a header
    const write = async (file) =>
      s.jsAsync(
        `const done = arguments[arguments.length - 1];
         window.__TAURI_INTERNALS__.invoke('plugin:fs|write_text_file', new TextEncoder().encode('x'), { headers: { path: encodeURIComponent(arguments[0]), options: '{}' } })
           .then(() => done('allowed'), (e) => done('refused: ' + String(e)));`,
        file,
      );
    const other = await probe('plugin:fs|read_file', { path: FIX('long-300.pdf') });
    const etc = await probe('plugin:fs|read_text_file', { path: '/etc/hostname' });
    const outside = await write(path.join(os.tmpdir(), 'ezpdf-should-not-exist.txt'));
    const inside = await write(path.join(STORE, 'probe.txt'));
    fs.rmSync(path.join(STORE, 'probe.txt'), { force: true });
    check(
      'the page cannot read a PDF it was not given, nor a system file, nor write outside its folder',
      [other, etc, outside].every((r) => r.startsWith('refused: forbidden path')) && !fs.existsSync(path.join(os.tmpdir(), 'ezpdf-should-not-exist.txt')),
      [other, etc, outside].map((r) => r.slice(0, 50)).join(' | '),
    );
    check('...while the same write into its own folder is allowed (the refusals are the scope, not the call)', inside === 'allowed', inside);
    const net = await s.jsAsync(`const done = arguments[0]; fetch('https://example.org/x', { method: 'POST', body: 'x' }).then(() => done('sent'), () => done('refused'));`);
    check('the page cannot send anything to another site (CSP)', net === 'refused');
  } finally {
    await s.close();
  }
  await sleep(800);

  // 4. restart: the draft is listed and reopens with the edit
  s = await session([]);
  try {
    await s.waitFor(`return !!document.querySelector('${T('draft-0')}')`, 'the draft list');
    const listed = await s.js(text(T('draft-0')));
    check('restarted: the draft is listed (name, pages, not exported)', /Hợp đồng mẫu\.pdf/.test(listed) && /4 trang/.test(listed) && /chưa xuất/.test(listed), listed);
    const where = await s.js(`const p = document.querySelector('${T('draft-where')}'); return [p?.textContent, p?.title]`);
    const hint = await s.js(text(T('empty-hint')));
    check(
      'the empty screen speaks of the desktop: where drafts live (folder on hover), "Open with ezPDF"',
      /thư mục dữ liệu của ezPDF/.test(where[0]) && where[1] === STORE && /Mở bằng ezPDF/.test(hint),
      `${where[1]} · ${hint}`,
    );
    await s.shot('3-draft-list.png');
    await s.js(`document.querySelector('${T('draft-open-0')}').click()`);
    await s.waitFor(has(T('page-total'), '/ 4'), 'the draft to reopen');
    const landscape = await s.waitFor(
      `const r = document.querySelector('${T('page-0')}')?.getBoundingClientRect(); return r && r.width > r.height ? r.width + 'x' + r.height : null`,
      'page 1 to show turned',
      20000,
    );
    check('the reopened draft has the edit (page 1 turned)', !!landscape, landscape);
    await s.shot('4-resumed.png');

    // 5. second launch with another PDF → same window
    const second = path.join(OUT, 'tai-lieu-300-trang.pdf');
    fs.copyFileSync(FIX('long-300.pdf'), second);
    const t0 = Date.now();
    const p2 = spawn(BIN, [second], { env, stdio: 'ignore' });
    procs.push(p2);
    const exited = await new Promise((r) => {
      p2.on('exit', (code) => r(code));
      setTimeout(() => r('still running'), 15000);
    });
    await s.waitFor(has(T('page-total'), '/ 300'), 'the second PDF in the first window', 30000);
    check('a second "Open with" goes to the open window, the second process exits', exited === 0, `exit ${exited}, opened in ${Date.now() - t0} ms`);
    check('...and that PDF opens there', await s.js(`return document.body.textContent.includes('tai-lieu-300-trang.pdf')`));
    await s.shot('5-second-launch.png');

    // 6. the system dialogs (GTK here, the Windows dialogs there), driven with xdotool
    if (hasXdotool) {
      const xdo = (...a) => execFileSync('xdotool', a, { env, encoding: 'utf8' }).trim();
      const dialog = async (title, typed, shotName) => {
        // find the dialog by its exact title among the app's windows (no window manager here)
        let win = null;
        for (let i = 0; i < 60 && !win; i++) {
          const ids = spawnSync('xdotool', ['search', '--onlyvisible', '--class', 'ezpdf'], { env, encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
          win = ids.find((w) => spawnSync('xdotool', ['getwindowname', w], { env, encoding: 'utf8' }).stdout.trim() === title) ?? null;
          if (!win) await sleep(250);
        }
        if (!win) throw new Error(`no "${title}" dialog`);
        await sleep(700);
        xdo('windowfocus', '--sync', win);
        xdo('key', 'ctrl+l');
        await sleep(200);
        xdo('key', 'ctrl+a');
        xdo('type', '--delay', '15', typed);
        await sleep(400);
        // the whole X screen, dialog included (WebDriver only sees the page)
        if (shotName) spawnSync('import', ['-window', 'root', '-display', display, path.join(OUT, shotName)]);
        // the location entry may take the first Return for its completion popup
        for (let i = 0; i < 4; i++) {
          xdo('key', 'Return');
          await sleep(900);
          const still = spawnSync('xdotool', ['search', '--onlyvisible', '--class', 'ezpdf'], { env, encoding: 'utf8' }).stdout.trim().split('\n').includes(win);
          if (!still) break;
          xdo('windowfocus', '--sync', win);
        }
      };
      // a PDF with no draft yet (the same bytes as a draft would bring up the "resume draft?" offer instead)
      const third = path.join(OUT, 'chon-qua-hop-thoai.pdf');
      fs.copyFileSync(FIX('foreign-stamp.pdf'), third);
      await s.js(`document.querySelector('${T('btn-open')}').click()`);
      await dialog('Mở tệp PDF', third, '6-open-dialog.png');
      await s.waitFor(`return document.body.textContent.includes('chon-qua-hop-thoai.pdf') && (document.querySelector('${T('page-total')}')?.textContent ?? '').includes('/ 4')`, 'the PDF picked in the open dialog', 30000);
      check('the open dialog (system file chooser) opens the PDF picked there', true);
      await sleep(1500);
      await s.js(`document.querySelector('${T('btn-rotate-page')}').click()`);
      await s.waitFor(
        `const r = document.querySelector('${T('page-0')}')?.getBoundingClientRect(); return r && r.width > r.height`,
        'page 1 to turn before exporting',
        15000,
      );
      const saved = path.join(OUT, 'xuat-qua-hop-thoai.pdf');
      await s.js(`document.querySelector('${T('btn-export')}').click()`);
      await dialog('Xuất PDF', saved, '6-save-dialog.png');
      await s.waitFor(`return !!document.querySelector('${T('state-exported')}')`, 'the export to finish', 60000);
      const head = fs.existsSync(saved) ? fs.readFileSync(saved).subarray(0, 5).toString() : '';
      let rot = '';
      try {
        rot = execFileSync('python3', ['-c', 'import sys,pikepdf; pdf = pikepdf.open(sys.argv[1]); print(int(pdf.pages[0].obj.get("/Rotate", 0)))', saved], { encoding: 'utf8' }).trim();
      } catch (e) {
        rot = String(e.stderr || e).slice(0, 120);
      }
      const where = await s.js(`return document.querySelector('${T('state-exported')}')?.title ?? ''`);
      check('the save dialog writes the export where the user chose, with the edit (page 1 /Rotate 90)', head === '%PDF-' && rot === '90', `${path.basename(saved)} · /Rotate ${rot}`);
      check('...and the app says where it went', where.includes(OUT) && where.includes('xuat-qua-hop-thoai.pdf'), where.split('\n')[0]);
      check('the PDF picked in the dialog is untouched', sha(fs.readFileSync(third)) === sha(fs.readFileSync(FIX('foreign-stamp.pdf'))));
      await s.shot('6-exported.png');
    } else {
      check('system dialogs: skipped (xdotool not installed)', true);
    }
  } finally {
    await s.close();
  }

  // 7. closing the window right after an edit: the draft is written before it goes
  if (hasXdotool) {
    fs.rmSync(STORE, { recursive: true, force: true });
    s = await session([work]);
    try {
      await s.waitFor(has(T('page-total'), '/ 4'), 'the PDF to open');
      await sleep(1500);
      await s.js(`document.querySelector('${T('btn-rotate-page')}').click()`);
      await sleep(150); // well inside the autosave delay (1.2 s)
      const pending = await s.js(`return document.querySelector('${T('state-dirty')}')?.dataset.draft ?? null`);
      const win = execFileSync('xdotool', ['search', '--onlyvisible', '--name', '^ezPDF$'], { env, encoding: 'utf8' }).trim().split('\n')[0];
      const t0 = Date.now();
      execFileSync('python3', [path.join(ROOT, 'scripts/x11_close_window.py'), display, win]);
      let gone = false;
      for (let i = 0; i < 100 && !gone; i++) {
        await sleep(200);
        gone = spawnSync('xdotool', ['search', '--onlyvisible', '--name', '^ezPDF$'], { env }).status !== 0;
      }
      const drafts = fs.existsSync(path.join(STORE, 'drafts')) ? fs.readdirSync(path.join(STORE, 'drafts')) : [];
      const meta = drafts[0] ? fs.readdirSync(path.join(STORE, 'drafts', drafts[0])).find((f) => f.startsWith('meta-')) : null;
      const rec = meta ? JSON.parse(fs.readFileSync(path.join(STORE, 'drafts', drafts[0], meta), 'utf8')).record : null;
      check(
        'closing the window just after an edit saves the draft first, then closes',
        pending !== 'saved' && gone && rec?.rotations?.[0] === 1,
        `draft state at close: ${pending}; window gone after ${Date.now() - t0} ms; saved rotation ${rec?.rotations?.[0]}`,
      );
    } finally {
      await s.close();
    }
  }

  for (const p of procs) p.kill('SIGTERM');
  const passed = results.filter((r) => r.ok).length;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ binary: BIN, results }, null, 2));
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
