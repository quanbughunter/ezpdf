/**
 * Printing in the browser and the desktop app: the finished PDF is drawn page
 * by page by ezPDF's own PDFium worker (annotations included, /Rotate
 * applied), the pictures are put in a print-only block (#ez-print, see
 * styles.css) whose CSS pages have each PDF page's own size, and the
 * system's print dialog is opened with window.print(). Printer, copies,
 * page range, colour and paper are chosen there.
 *
 * The Android app does not come here: it hands the PDF file itself to
 * Android's print service (vector, see platform/android.ts).
 */
import { closeRenderSession, openRenderSession, renderPageImage } from '@/engine/export-client';

export interface PageSize {
  /** points, as printed (page rotation applied) */
  w: number;
  h: number;
}

export interface PrintProgress {
  done: number;
  total: number;
}

/**
 * Pixels for a whole job (≈ 30 A4 pages at 300 dpi) and for one page (A2 at
 * 300 dpi). The print preview holds every page picture, so a long document
 * gets a lower resolution: 100 pages ≈ 165 dpi, 200 ≈ 120 dpi, never below
 * 96 dpi (≈ 900 A4 pages stay under ~3 GB of decoded pixels).
 */
const JOB_PIXELS = 260e6;
const PAGE_PIXELS = 36e6;
const MAX_DPI = 300;
const MIN_DPI = 96;

/** 300 dpi, lower for long or huge documents so the job fits in memory. */
export function printDpi(pages: PageSize[]) {
  const sqIn = pages.reduce((n, p) => n + (p.w / 72) * (p.h / 72), 0);
  const dpi = Math.floor(Math.sqrt(JOB_PIXELS / Math.max(1, sqIn)));
  return Math.max(MIN_DPI, Math.min(MAX_DPI, dpi));
}

export function pageDpi(jobDpi: number, p: PageSize) {
  return Math.max(36, Math.min(jobDpi, Math.floor(Math.sqrt(PAGE_PIXELS / Math.max(1e-6, (p.w / 72) * (p.h / 72))))));
}

const aborted = () => new DOMException('Đã hủy in.', 'AbortError');

interface Job {
  ready: Promise<unknown>;
  print(): void;
  cleanup(): void;
}

let active: Job | null = null;

/** Removes the print block (also when a print never reported its end). */
export function clearPrintJob() {
  active?.cleanup();
  active = null;
}

/** Puts the pictures in the print-only block; nothing changes on screen. */
export function mountPrintJob(pages: PageSize[], urls: string[], title: string): Job {
  clearPrintJob();
  const root = document.createElement('div');
  root.id = 'ez-print';
  root.setAttribute('aria-hidden', 'true');
  const style = document.createElement('style');
  style.id = 'ez-print-style';
  const named = new Map<string, number>();
  const rules: string[] = [];
  const imgs: HTMLImageElement[] = [];
  pages.forEach((p, i) => {
    const w = p.w.toFixed(2);
    const h = p.h.toFixed(2);
    const key = `${w}x${h}`;
    let n = named.get(key);
    if (n === undefined) {
      n = named.size;
      named.set(key, n);
      rules.push(`@page ezp${n} { size: ${w}pt ${h}pt; margin: 0; }`);
    }
    const sheet = document.createElement('div');
    sheet.className = 'ez-print-page';
    sheet.dataset.page = String(i + 1);
    // each size its own named page, so a landscape page prints landscape
    sheet.style.cssText = `page: ezp${n}; width: ${w}pt; height: ${h}pt;`;
    const img = new Image();
    img.alt = '';
    img.src = urls[i];
    sheet.appendChild(img);
    root.appendChild(sheet);
    imgs.push(img);
  });
  const first = pages[0];
  // the default page: the first page's size (also for browsers without named pages)
  rules.unshift(`@page { size: ${first.w.toFixed(2)}pt ${first.h.toFixed(2)}pt; margin: 0; }`);
  style.textContent = `@media print {\n${rules.join('\n')}\n}`;
  document.head.appendChild(style);
  document.body.appendChild(root);
  document.body.classList.add('ez-printing');
  const previousTitle = document.title;
  // the print dialog offers it as the file name when printing to PDF
  document.title = title;

  let done = false;
  const onAfter = () => cleanup();
  const cleanup = () => {
    if (done) return;
    done = true;
    window.removeEventListener('afterprint', onAfter);
    root.remove();
    style.remove();
    document.body.classList.remove('ez-printing');
    document.title = previousTitle;
    urls.forEach((u) => URL.revokeObjectURL(u));
    if (active === job) active = null;
  };
  const job: Job = {
    // loaded, not decoded: decoding every page at once would hold them all as raw pixels
    ready: Promise.all(
      imgs.map((im) => (im.complete ? Promise.resolve() : new Promise<void>((done) => ((im.onload = () => done()), (im.onerror = () => done()))))),
    ),
    print() {
      window.addEventListener('afterprint', onAfter);
      window.print();
    },
    cleanup,
  };
  active = job;
  return job;
}

/**
 * Renders every page of `bytes` (the finished PDF; the buffer is detached),
 * then opens the print dialog. Resolves once the dialog has been opened.
 */
export async function printPdfPages(
  bytes: ArrayBuffer,
  opts: { title: string; signal?: AbortSignal; onProgress?: (p: PrintProgress) => void },
) {
  clearPrintJob();
  const { session, pages } = await openRenderSession(bytes);
  const urls: string[] = [];
  try {
    if (!pages.length) throw new Error('Tài liệu không có trang nào.');
    const dpi = printDpi(pages);
    opts.onProgress?.({ done: 0, total: pages.length });
    for (let i = 0; i < pages.length; i++) {
      if (opts.signal?.aborted) throw aborted();
      const r = await renderPageImage(session, i, pageDpi(dpi, pages[i]));
      urls.push(URL.createObjectURL(r.image));
      opts.onProgress?.({ done: i + 1, total: pages.length });
    }
    if (opts.signal?.aborted) throw aborted();
  } catch (e) {
    urls.forEach((u) => URL.revokeObjectURL(u));
    throw e;
  } finally {
    void closeRenderSession(session);
  }
  const job = mountPrintJob(pages, urls, opts.title);
  await job.ready;
  if (opts.signal?.aborted) {
    job.cleanup();
    throw aborted();
  }
  job.print();
}
