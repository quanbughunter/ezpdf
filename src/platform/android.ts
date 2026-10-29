/**
 * Android app (Capacitor 8) with ezPDF's own native plugin "EzFiles"
 * (android/app/src/main/java/app/ezpdf/EzFilesPlugin.java):
 *  - open: Storage Access Framework, ACTION_OPEN_DOCUMENT for PDFs
 *  - save: ACTION_CREATE_DOCUMENT, then the bytes are streamed to the
 *          returned document in base64 chunks (the bridge carries JSON only)
 *  - incoming: PDFs opened with ezPDF (ACTION_VIEW) or shared to it
 *          (ACTION_SEND), delivered as content:// URIs
 * Picked and incoming documents are read through the WebView's local server
 * (convertFileSrc), so a 50 MB PDF is streamed, not passed as base64.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { createCapacitorBackend, base64Of } from './storage/capacitor-fs';
import { asPdfFile, incomingQueue, type Platform } from './types';

interface DocRef {
  uri: string;
  name: string;
  size?: number;
}

interface EzFilesPlugin {
  clearCaptures(): Promise<{ removed: number }>;
  openDocument(): Promise<{ cancelled: boolean; file?: DocRef }>;
  createDocument(o: { name: string; mime: string }): Promise<{ cancelled: boolean; file?: DocRef }>;
  openWrite(o: { uri: string }): Promise<{ handle: string }>;
  write(o: { handle: string; data: string }): Promise<void>;
  closeWrite(o: { handle: string; abort: boolean }): Promise<void>;
  takeIncoming(): Promise<{ files: DocRef[] }>;
  addListener(event: 'incoming', cb: () => void): Promise<PluginListenerHandle>;
}

const EzFiles = registerPlugin<EzFilesPlugin>('EzFiles');

/** raw bytes per bridge call when saving */
const CHUNK = 3 * 1024 * 1024;

async function fileOf(ref: DocRef) {
  const res = await fetch(Capacitor.convertFileSrc(ref.uri));
  if (!res.ok) throw new Error(`Không đọc được “${ref.name}” (${res.status}).`);
  return asPdfFile(await res.blob(), ref.name || 'tai-lieu.pdf');
}

export async function createAndroidPlatform(): Promise<Platform> {
  const incoming = incomingQueue();
  const take = async () => {
    const { files } = await EzFiles.takeIncoming();
    const out: File[] = [];
    for (const f of files) out.push(await fileOf(f));
    incoming.push(out);
  };
  await EzFiles.addListener('incoming', () => void take().catch((e) => console.error('ezPDF: incoming file', e)));
  void take().catch((e) => console.error('ezPDF: incoming file', e));

  // photos a scan left behind (the app was closed in the middle of one)
  void EzFiles.clearCaptures().catch(() => {});

  return {
    kind: 'android',
    storage: createCapacitorBackend(),
    canCapture: true,
    async clearCapturedPhotos() {
      await EzFiles.clearCaptures();
    },
    async pickPdf() {
      const r = await EzFiles.openDocument();
      return r.cancelled || !r.file ? null : fileOf(r.file);
    },
    async savePdf(bytes, suggestedName) {
      const r = await EzFiles.createDocument({ name: suggestedName, mime: 'application/pdf' });
      if (r.cancelled || !r.file) return null;
      const { handle } = await EzFiles.openWrite({ uri: r.file.uri });
      const blob = new Blob([bytes as BlobPart]);
      try {
        for (let off = 0; off < blob.size; off += CHUNK) {
          await EzFiles.write({ handle, data: await base64Of(blob.slice(off, off + CHUNK)) });
        }
      } catch (e) {
        await EzFiles.closeWrite({ handle, abort: true }).catch(() => {});
        throw e;
      }
      await EzFiles.closeWrite({ handle, abort: false });
      return { how: 'file', name: r.file.name || suggestedName };
    },
    onIncomingFiles: incoming.subscribe,
  };
}
