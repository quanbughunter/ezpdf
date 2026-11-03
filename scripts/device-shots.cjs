/**
 * Screenshots of ezPDF on the phones it is used on, taken on GitHub's
 * machines after every push (.github/workflows/build.yml):
 *
 *   node scripts/device-shots.cjs android <app-debug.apk>
 *       the APK just built, installed on an Android emulator whose screen is
 *       set like a Galaxy S24 Ultra's (1080 × 2340, 450 dpi: 384 px wide in
 *       CSS); driven through the app's WebView (debug builds allow it)
 *   node scripts/device-shots.cjs ios [web build folder]
 *       Safari on an iPhone 15 Pro Max simulator, showing the web app built
 *       with `vite build --mode shots` (src/shots.ts opens each test file)
 *
 * The same test files are opened on both (tests/fixtures: public test files,
 * nothing of anyone's own). The pictures go to out/screens/<android|iphone>/,
 * with notes.json saying what each one is and anything that went wrong.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIX = (f) => path.join(ROOT, 'tests', 'fixtures', f);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** in the page: the zoomed Word page scrolled to its first picture (the equations), a little of the text before it in view */
const SHOW_PICTURES = () => {
  const c = document.querySelector('[data-testid="word-canvas"]');
  const img = [...document.querySelectorAll('[data-testid="word-page"] img')].find((i) => i.getBoundingClientRect().width > 20);
  if (!c || !img) return;
  const r = img.getBoundingClientRect(), cr = c.getBoundingClientRect();
  c.scrollBy(r.left - cr.left - 120, r.top - cr.top - 160);
};

/** what is shown, in order: id, test file ('none': the start screen), the information panel open, a Word zoom */
const SHOTS = [
  { id: '1-start', file: 'none', title: 'Màn hình đầu' },
  { id: '2-word-math', file: 'word-math.docx', title: 'Công thức MathType: ngoặc tròn, ngoặc nhọn, mũ góc' },
  { id: '2b-word-math-150', file: 'word-math.docx', zoom: 150, title: 'Các công thức đó, phóng to 150%' },
  { id: '3-word-info', file: 'word-math.docx', info: true, title: 'Thông tin tệp Word' },
  { id: '4-word-pages', file: 'word-pages.docx', title: 'Đề có điểm dừng tab, bảng, công thức' },
  { id: '5-pdf-info', file: 'sample.pdf', info: true, title: 'Tệp PDF và bảng thông tin' },
];

function writeNotes(dir, notes) {
  fs.writeFileSync(path.join(dir, 'notes.json'), JSON.stringify(notes, null, 2));
  console.log(notes.map((n) => `${n.id}: ${n.note}`).join('\n'));
}

// ── Android: the APK on an emulator ──────────────────────────────────────

async function android(apk) {
  const dir = path.join(ROOT, 'out', 'screens', 'android');
  fs.mkdirSync(dir, { recursive: true });
  const notes = [];
  const wait = async (page, sel, ms) => page.waitForSelector(sel, { timeout: ms }).then(() => true, () => false);
  let page = null;
  let launch, shoot, done;
  if (process.env.SHOTS_BROWSER === 'chromium') {
    // the same steps in Playwright's Chromium at the S24 Ultra's size (a check of this script without an emulator)
    const { chromium } = require('playwright');
    const web = serve(path.resolve(apk || path.join(ROOT, 'out', 'shots-dist')));
    await web.listening;
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 384, height: 832 }, deviceScaleFactor: 2.8125, isMobile: true, hasTouch: true });
    launch = async () => {
      page = await ctx.newPage();
      await page.goto('http://127.0.0.1:4180/');
      await wait(page, '[data-testid="state-empty"]', 120000);
    };
    shoot = (file) => page.screenshot({ path: file });
    done = async () => {
      await browser.close();
      web.server.close();
    };
  } else {
    const { _android } = require('playwright');
    const [device] = await _android.devices();
    if (!device) throw new Error('no Android device');
    const sh = async (cmd) => (await device.shell(cmd)).toString().trim();
    // the Galaxy S24 Ultra's default screen (FHD+): 1080 × 2340 at 450 dpi
    await sh('wm size 1080x2340');
    await sh('wm density 450');
    // on a busy emulator the launcher stops answering and Android puts "Pixel Launcher isn't
    // responding" over every picture: no error boxes, and no launcher (the app is started directly)
    await sh('settings put global hide_error_dialogs 1');
    await sh('pm disable-user --user 0 com.google.android.apps.nexuslauncher');
    await sh('am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS');
    await device.installApk(fs.readFileSync(apk));
    launch = async () => {
      await sh('am force-stop app.ezpdf');
      await sh('am start -W -n app.ezpdf/.MainActivity');
      const webview = await device.webView({ pkg: 'app.ezpdf' }, { timeout: 120000 });
      page = await webview.page();
      // the emulator's screen takes the computer's mouse, so the page sees a mouse (pointer: fine) and
      // opens Word files to edit; a phone has a touch screen (pointer: coarse) and opens them to read
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await page.reload();
      await wait(page, '[data-testid="state-empty"]', 120000);
    };
    shoot = async (file) => {
      await sh('am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS');
      await device.screenshot({ path: file });
    };
    done = () => device.close();
  }
  await launch();
  for (const s of SHOTS) {
    let note = 'ok';
    try {
      if (s.file !== 'none') {
        // what the last picture left open is closed first: the information panel, the Word screen
        if (await page.$('[data-testid="word-info-panel"]')) await page.click('[data-testid="word-info-close"]');
        if (await page.$('[data-testid="word-screen"]')) {
          await page.click('[data-testid="word-close"]');
          await page.waitForSelector('[data-testid="word-screen"]', { state: 'detached', timeout: 30000 });
        }
        await page.setInputFiles('[data-testid="file-input"]', {
          name: s.file,
          mimeType: s.file.endsWith('.docx') ? DOCX : 'application/pdf',
          buffer: fs.readFileSync(FIX(s.file)),
        });
        if (s.file.endsWith('.docx')) {
          if (!(await wait(page, '[data-testid="word-page"]', 120000))) throw new Error('the Word file did not open');
          await page.evaluate(async () => {
            let last = '', since = Date.now();
            for (const end = Date.now() + 30000; Date.now() < end; ) {
              const p = document.querySelector('[data-testid="word-page"]');
              const now = p ? `${p.dataset.pages}:${p.offsetHeight}` : '';
              if (now !== last) [last, since] = [now, Date.now()];
              else if (now && Date.now() - since > 1500) return;
              await new Promise((r) => setTimeout(r, 200));
            }
          });
          if (s.zoom) {
            await page.click('[data-testid="word-zoom-level"]');
            await page.click(`[data-testid="word-zoom-${s.zoom}"]`);
            await sleep(800);
            await page.evaluate(SHOW_PICTURES);
          }
          if (s.info) await page.click('[data-testid="word-info"]');
        } else {
          if (!(await wait(page, '[data-testid="page-0"]', 120000))) throw new Error('the PDF did not open');
          await sleep(1500);
          if (s.info && !(await page.$('[data-testid="right-panel"]'))) await page.click('[data-testid="btn-toggle-right"]');
        }
      }
      await sleep(1500);
    } catch (e) {
      note = e.message.split('\n')[0];
    }
    await shoot(path.join(dir, `${s.id}.png`));
    notes.push({ id: s.id, title: s.title, note });
  }
  writeNotes(dir, notes);
  await done();
}

// ── iPhone: Safari on the simulator ──────────────────────────────────────

const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

/** the newest iOS runtime installed, and an iPhone 15 Pro Max on it (made for this run) */
function bootIphone() {
  const runtimes = JSON.parse(simctl('list', 'runtimes', '-j')).runtimes.filter((r) => r.isAvailable && /iOS/.test(r.name));
  runtimes.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  const runtime = runtimes.at(-1);
  if (!runtime) throw new Error('no iOS simulator runtime');
  const types = JSON.parse(simctl('list', 'devicetypes', '-j')).devicetypes;
  const type = types.find((t) => t.name === 'iPhone 15 Pro Max') ?? types.filter((t) => /iPhone \d+ Pro Max/.test(t.name)).at(-1);
  if (!type) throw new Error('no iPhone Pro Max simulator');
  const udid = simctl('create', 'ezPDF', type.identifier, runtime.identifier).trim();
  simctl('boot', udid);
  simctl('bootstatus', udid, '-b');
  try {
    simctl('status_bar', udid, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100');
  } catch {}
  console.log(`${type.name}, ${runtime.name}: ${udid}`);
  return { udid, name: `${type.name}, ${runtime.name}` };
}

/** the shots build, the test files, and the page's "ready" call */
function serve(root) {
  const ready = new Map();
  const waiting = new Map();
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.docx': DOCX };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__shot-ready') {
      const id = url.searchParams.get('id') ?? '';
      const note = url.searchParams.get('note') ?? '';
      const w = waiting.get(id);
      if (w) w(note);
      else ready.set(id, note);
      res.end('ok');
      return;
    }
    let file;
    const fx = /^\/__fixtures\/([\w.-]+)$/.exec(url.pathname);
    if (fx) file = FIX(fx[1]);
    else file = path.join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(fx ? path.join(ROOT, 'tests', 'fixtures') : root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  const listening = new Promise((resolve) => server.listen(4180, '127.0.0.1', resolve));
  return {
    server,
    /** bound: wait for it before anything blocks Node (execFileSync), or the phone finds no server */
    listening,
    /** the page's ready call for `id`, or a timeout */
    until(id, ms) {
      if (ready.has(id)) return Promise.resolve(ready.get(id));
      return new Promise((resolve) => {
        const t = setTimeout(() => resolve('timeout: the page never said it was ready'), ms);
        waiting.set(id, (note) => {
          clearTimeout(t);
          resolve(note);
        });
      });
    },
  };
}

async function ios(build) {
  const root = path.resolve(build || path.join(ROOT, 'out', 'shots-dist'));
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error(`no shots build at ${root} (vite build --mode shots)`);
  const dir = path.join(ROOT, 'out', 'screens', 'iphone');
  fs.mkdirSync(dir, { recursive: true });
  const web = serve(root);
  await web.listening;
  // SHOTS_BROWSER=chromium: the same steps in Playwright's Chromium at the iPhone's size (a check of this script away from a Mac)
  const local = process.env.SHOTS_BROWSER === 'chromium';
  let browser = null;
  let phone;
  if (local) {
    const { chromium, devices } = require('playwright');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ ...devices['iPhone 15 Pro Max'], defaultBrowserType: undefined });
    const page = await ctx.newPage();
    phone = { name: 'Chromium (iPhone 15 Pro Max size)', open: (url) => void page.goto(url), shot: (file) => page.screenshot({ path: file }), close: () => browser.close() };
  } else {
    const { udid, name } = bootIphone();
    phone = {
      name,
      open: (url) => simctl('openurl', udid, url),
      shot: (file) => simctl('io', udid, 'screenshot', file),
      close: () => {
        try {
          simctl('shutdown', udid);
        } catch {}
      },
    };
  }
  const notes = [];
  try {
    // Safari's first page of a new phone gets its tips ("View Bookmarks, Share Menu…"): on a page not kept
    phone.open('http://127.0.0.1:4180/?shot=none&id=warm-up');
    await web.until('warm-up', 150000);
    await sleep(3000);
    for (const s of SHOTS) {
      const q = new URLSearchParams({ shot: s.file, id: s.id });
      if (s.info) q.set('info', '1');
      if (s.zoom) q.set('zoom', String(s.zoom));
      phone.open(`http://127.0.0.1:4180/?${q}`);
      const note = await web.until(s.id, 150000);
      await sleep(1000);
      await phone.shot(path.join(dir, `${s.id}.png`));
      notes.push({ id: s.id, title: s.title, note, device: phone.name });
    }
  } finally {
    writeNotes(dir, notes);
    web.server.close();
    await phone.close();
  }
}

const [mode, arg] = process.argv.slice(2);
(mode === 'android' ? android(arg) : mode === 'ios' ? ios(arg) : Promise.reject(new Error('usage: device-shots.cjs android <apk> | ios [build]'))).catch((e) => {
  console.error(e);
  process.exit(1);
});
