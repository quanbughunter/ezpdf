/**
 * Desktop app (Tauri 2).
 *  - open/save: the system's file dialogs; the picked path is the only file
 *    outside the app-data folder the webview may touch (the dialog plugin
 *    adds it to the fs scope for this run)
 *  - incoming: PDF paths passed on the command line, i.e. "Open with ezPDF"
 *    from Explorer's context menu or a double click once ezPDF is the
 *    default app. A second launch is forwarded to the running window
 *    (single-instance plugin). See src-tauri/src/lib.rs.
 *  - share: the finished PDF goes to the shell as raw bytes; it writes a
 *    temporary copy and puts it on the clipboard, in Windows' share window,
 *    or shows it in Explorer (src-tauri/src/share.rs)
 *  - print: the page's own (rendered pages, window.print in WebView2)
 *  - page pictures: written into a folder picked in the system's dialog, never
 *    over an existing file; then shown in Explorer (reveal_file)
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { exists, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { createTauriBackend } from './storage/tauri-fs';
import { asDocFile, baseName, dirName, incomingQueue, rememberSource, type Platform, type ShareWay } from './types';

const PDF = [{ name: 'PDF', extensions: ['pdf'] }];
const WORD = [{ name: 'Word', extensions: ['docx'] }];
const ANY = [{ name: 'PDF hoặc Word', extensions: ['pdf', 'docx'] }, ...PDF, ...WORD];

async function fileAt(path: string) {
  return rememberSource(asDocFile(await readFile(path), baseName(path)), { path });
}

/** `name` in `folder`, or "name (2).ext"… when a file of that name is already there: nothing is overwritten */
async function freePath(folder: string, name: string) {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; n < 1000; n++) {
    const path = await join(folder, n === 1 ? name : `${stem} (${n})${ext}`);
    if (!(await exists(path))) return path;
  }
  throw new Error(`Thư mục đã có quá nhiều tệp tên “${name}”.`);
}

export async function createTauriPlatform(): Promise<Platform> {
  const incoming = incomingQueue();
  const take = async () => {
    const paths = await invoke<string[]>('take_launch_files');
    const files: File[] = [];
    for (const p of paths) files.push(await fileAt(p));
    incoming.push(files);
  };
  await listen('ezpdf://launch-files', () => void take().catch((e) => console.error('ezPDF: launch file', e)));
  void take().catch((e) => console.error('ezPDF: launch file', e));

  const shareWays = await invoke<ShareWay[]>('share_ways').catch(() => [] as ShareWay[]);

  // One listener for the window's close: the guards may keep it open; otherwise every
  // callback runs to the end, then Tauri closes the window.
  const guards = new Set<() => Promise<boolean>>();
  const closing = new Set<() => Promise<void>>();
  void getCurrentWindow().onCloseRequested(async (e) => {
    for (const g of [...guards]) {
      let stay = false;
      try {
        stay = !(await g());
      } catch {
        stay = false; // a failing check must not trap the window
      }
      if (stay) {
        e.preventDefault();
        return;
      }
    }
    for (const cb of [...closing]) await cb().catch(() => {});
  });

  return {
    kind: 'desktop',
    canCapture: false,
    storage: await createTauriBackend(),
    async pickPdf() {
      const path = await open({ multiple: false, directory: false, filters: PDF, title: 'Mở tệp PDF' });
      return typeof path === 'string' ? fileAt(path) : null;
    },
    async pickFile() {
      const path = await open({ multiple: false, directory: false, filters: ANY, title: 'Mở tệp PDF hoặc Word' });
      return typeof path === 'string' ? fileAt(path) : null;
    },
    async savePdf(bytes, suggestedName) {
      // Written exactly where the user chose: only that path is in the fs scope.
      const path = await save({ defaultPath: suggestedName, filters: PDF, title: 'Xuất PDF' });
      if (!path) return null;
      await writeFile(path, bytes);
      return { how: 'file', name: baseName(path), folder: dirName(path) };
    },
    async saveWord(bytes, suggestedName) {
      const path = await save({ defaultPath: suggestedName, filters: WORD, title: 'Lưu tệp Word' });
      if (!path) return null;
      await writeFile(path, bytes);
      return { how: 'file', name: baseName(path), folder: dirName(path) };
    },
    shareWays,
    async sharePdf(bytes, name, way) {
      await invoke('share_file', bytes, { headers: { 'x-ezpdf-name': encodeURIComponent(name), 'x-ezpdf-way': way } });
      return way === 'copy' ? 'copied' : 'done';
    },
    printPdf: null,
    async openImageSink() {
      // the folder dialog adds the folder to the fs scope for this run, nothing above or beside it
      const folder = await open({ directory: true, multiple: false, title: 'Chọn thư mục để lưu ảnh' });
      if (typeof folder !== 'string') return null;
      const paths: string[] = [];
      return {
        async write(f) {
          const path = await freePath(folder, f.name);
          await writeFile(path, f.bytes);
          paths.push(path);
        },
        async finish() {
          return { how: 'folder', folder, paths };
        },
        async abort() {},
      };
    },
    async revealFile(path) {
      await invoke('reveal_file', { path });
    },
    onIncomingFiles: incoming.subscribe,
    onCloseRequested(cb) {
      closing.add(cb);
      return () => void closing.delete(cb);
    },
    guardClose(check) {
      guards.add(check);
      return () => void guards.delete(check);
    },
  };
}
