/**
 * Device screenshots only: built in with `vite build --mode shots`, never in
 * the app's own builds (main.tsx imports it for that mode alone).
 * scripts/device-shots.cjs opens Safari on GitHub's iPhone simulator at
 * ?shot=<test file>[&info=1]&id=<name>; this opens that test file (from
 * tests/fixtures, served by the script) as if it had been picked, waits until
 * it is laid out, opens the information panel if asked, then tells the script
 * it can take the screenshot.
 */
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(selector: string, ms: number): Promise<HTMLElement | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
    await sleep(150);
  }
  return null;
}

/** the Word page's laid-out height and page count, unchanged for a second and a half */
async function settled(ms: number) {
  const end = Date.now() + ms;
  let last = '';
  let since = Date.now();
  while (Date.now() < end) {
    const page = document.querySelector<HTMLElement>('[data-testid="word-page"]');
    const now = page ? `${page.dataset.pages}:${page.offsetHeight}` : '';
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (now && Date.now() - since > 1500) return;
    await sleep(200);
  }
}

async function run(name: string, id: string, info: boolean, zoom: number) {
  let note = 'ok';
  try {
    const input = await waitFor('[data-testid="file-input"]', 60000);
    if (!input) throw new Error('no file input');
    if (name !== 'none') {
      const blob = await (await fetch(`./__fixtures/${encodeURIComponent(name)}`)).blob();
      const file = new File([blob], name, { type: name.endsWith('.docx') ? DOCX : 'application/pdf' });
      const dt = new DataTransfer();
      dt.items.add(file);
      (input as HTMLInputElement).files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (name.endsWith('.docx')) {
        if (!(await waitFor('[data-testid="word-page"]', 90000))) throw new Error('the Word file did not open');
        await settled(30000);
        if (zoom) {
          // the zoom menu opens on a pointer press (Radix), its items on a click
          (await waitFor('[data-testid="word-zoom-level"]', 5000))?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
          (await waitFor(`[data-testid="word-zoom-${zoom}"]`, 5000))?.click();
          await settled(10000);
          // the first picture (the equations) in view, a little of the text before it too
          const c = document.querySelector('[data-testid="word-canvas"]');
          const img = [...document.querySelectorAll('[data-testid="word-page"] img')].find((i) => i.getBoundingClientRect().width > 20);
          if (c && img) {
            const r = img.getBoundingClientRect(), cr = c.getBoundingClientRect();
            c.scrollBy(r.left - cr.left - 120, r.top - cr.top - 160);
          }
        }
        if (info) (await waitFor('[data-testid="word-info"]', 5000))?.click();
      } else {
        if (!(await waitFor('[data-testid="page-0"]', 90000))) throw new Error('the PDF did not open');
        await sleep(1500);
        if (info && !document.querySelector('[data-testid="right-panel"]')) (await waitFor('[data-testid="btn-toggle-right"]', 5000))?.click();
      }
    }
    await sleep(1200);
  } catch (e) {
    note = e instanceof Error ? e.message : String(e);
  }
  await fetch(`./__shot-ready?id=${encodeURIComponent(id)}&note=${encodeURIComponent(note)}`).catch(() => {});
}

const q = new URLSearchParams(location.search);
const shot = q.get('shot');
const id = q.get('id') ?? '';
if (shot && /^[\w.-]+$/.test(shot) && /^[\w-]+$/.test(id)) void run(shot, id, q.get('info') === '1', Number(q.get('zoom')) || 0);

export {};
