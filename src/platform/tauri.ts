/**
 * Desktop app (Tauri 2).
 *  - open/save: the system's file dialogs; the picked path is the only file
 *    outside the app-data folder the webview may touch (the dialog plugin
 *    adds it to the fs scope for this run)
 *  - incoming: PDF paths passed on the command line, i.e. "Open with ezPDF"
 *    from Explorer's context menu or a double click once ezPDF is the
 *    default app. A second launch is forwarded to the running window
 *    (single-instance plugin). See src-tauri/src/lib.rs.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { createTauriBackend } from './storage/tauri-fs';
import { asPdfFile, baseName, dirName, incomingQueue, type Platform } from './types';

const PDF = [{ name: 'PDF', extensions: ['pdf'] }];

async function fileAt(path: string) {
  return asPdfFile(await readFile(path), baseName(path));
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

  return {
    kind: 'desktop',
    storage: await createTauriBackend(),
    async pickPdf() {
      const path = await open({ multiple: false, directory: false, filters: PDF, title: 'Mở tệp PDF' });
      return typeof path === 'string' ? fileAt(path) : null;
    },
    async savePdf(bytes, suggestedName) {
      // Written exactly where the user chose: only that path is in the fs scope.
      const path = await save({ defaultPath: suggestedName, filters: PDF, title: 'Xuất PDF' });
      if (!path) return null;
      await writeFile(path, bytes);
      return { how: 'file', name: baseName(path), folder: dirName(path) };
    },
    onIncomingFiles: incoming.subscribe,
    onCloseRequested(cb) {
      // Tauri closes the window once this handler has finished.
      const off = getCurrentWindow().onCloseRequested(() => cb());
      return () => void off.then((f) => f());
    },
  };
}
