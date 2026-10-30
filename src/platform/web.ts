/**
 * Browser and installed web app (PWA).
 *  - open: the page's <input type=file> and drag and drop
 *  - save: a download, named by ezPDF
 *  - incoming: an installed web app registered as a PDF handler receives
 *    "Open with ezPDF" files through window.launchQueue
 *  - share: the system share sheet (Web Share with files), else a download
 *  - print: the page prints rendered pages (print/print-pages.ts), except on
 *    iPhone and iPad, where the PDF itself goes to the share sheet and its
 *    "Print" (AirPrint) prints it: window.print() in a Home Screen web app
 *    has been unreliable on iOS, and AirPrint prints the PDF as vectors
 *  - storage: asks the browser to keep the drafts (persistent storage), so
 *    Safari does not clear them after a while without use
 */
import { createIdbBackend } from './storage/idb';
import { DOCX_MIME, incomingQueue, mimeOf, type Platform, type ShareWay } from './types';

interface LaunchParams {
  files?: { kind: string; getFile(): Promise<File> }[];
}

export function downloadPdf(bytes: Uint8Array, name: string, type = mimeOf(name)) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Web Share with files: Chrome and Edge (Windows, Android), Safari; not Firefox desktop. */
function canShareFiles() {
  try {
    const probe = new File([new Uint8Array(1)], 'a.pdf', { type: 'application/pdf' });
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

/** iPhone, iPad (iPadOS presents itself as a Mac with a touch screen). */
export const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function shareFile(bytes: Uint8Array, name: string) {
  const file = new File([bytes as BlobPart], name, { type: mimeOf(name) });
  try {
    await navigator.share({ files: [file], title: name });
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return false;
    throw e;
  }
}

/**
 * Drafts live in IndexedDB, which a browser may clear when space runs low or,
 * in Safari, after a while without use. Persistent storage exempts them;
 * Chrome and Safari 17+ decide silently (an installed app counts). Firefox
 * would show a permission prompt at start-up, so it is not asked there.
 */
function keepDrafts() {
  if (/Firefox\//.test(navigator.userAgent)) return;
  const s = navigator.storage;
  if (!s?.persist || !s.persisted) return;
  void s.persisted().then((yes) => (yes ? undefined : s.persist())).catch(() => {});
}

export function createWebPlatform(): Platform {
  const incoming = incomingQueue();
  keepDrafts();
  const sheet = canShareFiles();
  const printBySheet = sheet && isIos();
  const launchQueue = (window as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }).launchQueue;
  launchQueue?.setConsumer(async (params) => {
    const handles = (params.files ?? []).filter((h) => h.kind === 'file');
    const files = await Promise.all(handles.map((h) => h.getFile()));
    incoming.push(files);
  });
  return {
    kind: 'web',
    storage: createIdbBackend(),
    // a phone browser opens its camera for <input capture>; a desktop one shows a file dialog
    canCapture: window.matchMedia('(pointer: coarse)').matches,
    pickPdf: null,
    pickFile: null,
    async savePdf(bytes, name) {
      downloadPdf(bytes, name);
      return { how: 'download', name };
    },
    async saveWord(bytes, name) {
      downloadPdf(bytes, name, DOCX_MIME);
      return { how: 'download', name };
    },
    shareWays: (sheet ? ['sheet'] : ['download']) as ShareWay[],
    async sharePdf(bytes, name, way) {
      if (way !== 'sheet') {
        downloadPdf(bytes, name);
        return 'downloaded';
      }
      return (await shareFile(bytes, name)) ? 'done' : 'cancelled';
    },
    printPdf: printBySheet
      ? async (bytes, name) => {
          await shareFile(bytes, name);
        }
      : null,
    printHint: printBySheet ? 'Trong bảng chia sẻ, chọn “In” để chọn máy in (AirPrint).' : undefined,
    onIncomingFiles: incoming.subscribe,
  };
}
