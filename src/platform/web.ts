/**
 * Browser and installed web app (PWA).
 *  - open: the page's <input type=file> and drag and drop
 *  - save: a download, named by ezPDF
 *  - incoming: an installed web app registered as a PDF handler receives
 *    "Open with ezPDF" files through window.launchQueue
 */
import { createIdbBackend } from './storage/idb';
import { incomingQueue, type Platform } from './types';

interface LaunchParams {
  files?: { kind: string; getFile(): Promise<File> }[];
}

export function downloadPdf(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function createWebPlatform(): Platform {
  const incoming = incomingQueue();
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
    async savePdf(bytes, name) {
      downloadPdf(bytes, name);
      return { how: 'download', name };
    },
    onIncomingFiles: incoming.subscribe,
  };
}
