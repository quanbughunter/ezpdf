/**
 * Android adapter: files in the app's private storage (Directory.Data,
 * i.e. /data/data/<app>/files/store), through Capacitor's Filesystem plugin.
 *
 * Reading goes through the WebView's local server (convertFileSrc), so large
 * PDFs come back as a stream instead of a base64 string. Capacitor's bridge
 * only carries JSON, so writing sends base64 in chunks of a few MB.
 * In a browser (tests) the plugin's own IndexedDB implementation is used.
 */
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { StorageBackend } from './backend';
import { createFileTreeBackend, type FsDriver } from './file-tree';

const ROOT = 'store';
const at = (p: string) => (p ? `${ROOT}/${p}` : ROOT);
const D = Directory.Data;
/** raw bytes per bridge call; a multiple of 3 keeps every chunk valid base64 on its own */
const CHUNK = 3 * 1024 * 1024;

async function kindOf(path: string): Promise<'file' | 'directory' | null> {
  try {
    return (await Filesystem.stat({ path: at(path), directory: D })).type;
  } catch {
    return null;
  }
}

export function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error('Không đọc được dữ liệu để lưu.'));
    r.readAsDataURL(blob);
  });
}

function blobOfBase64(data: string, type: string): Blob {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new Blob([out], { type });
}

export function capacitorFsDriver(): FsDriver {
  const native = Capacitor.isNativePlatform();
  return {
    async readText(path) {
      if ((await kindOf(path)) !== 'file') return null;
      return String((await Filesystem.readFile({ path: at(path), directory: D, encoding: Encoding.UTF8 })).data);
    },
    async readBlob(path, type) {
      if ((await kindOf(path)) !== 'file') return null;
      if (native) {
        const { uri } = await Filesystem.getUri({ path: at(path), directory: D });
        const res = await fetch(Capacitor.convertFileSrc(uri));
        if (!res.ok) throw new Error(`Không đọc được dữ liệu đã lưu (${res.status}).`);
        const blob = await res.blob();
        return blob.slice(0, blob.size, type);
      }
      const { data } = await Filesystem.readFile({ path: at(path), directory: D });
      return data instanceof Blob ? data.slice(0, data.size, type) : blobOfBase64(data, type);
    },
    async writeText(path, text) {
      await Filesystem.writeFile({ path: at(path), directory: D, data: text, encoding: Encoding.UTF8, recursive: true });
    },
    async writeBlob(path, blob) {
      await Filesystem.writeFile({ path: at(path), directory: D, data: await base64Of(blob.slice(0, CHUNK)), recursive: true });
      for (let off = CHUNK; off < blob.size; off += CHUNK) {
        await Filesystem.appendFile({ path: at(path), directory: D, data: await base64Of(blob.slice(off, off + CHUNK)) });
      }
    },
    async list(dir) {
      if ((await kindOf(dir)) !== 'directory') return [];
      return (await Filesystem.readdir({ path: at(dir), directory: D })).files.map((f) => f.name);
    },
    async mkdir(dir) {
      if ((await kindOf(dir)) === 'directory') return;
      await Filesystem.mkdir({ path: at(dir), directory: D, recursive: true });
    },
    async remove(path) {
      const kind = await kindOf(path);
      if (kind === 'directory') await Filesystem.rmdir({ path: at(path), directory: D, recursive: true });
      else if (kind === 'file') await Filesystem.deleteFile({ path: at(path), directory: D });
    },
  };
}

export function createCapacitorBackend(): StorageBackend {
  return createFileTreeBackend('android', 'bộ nhớ riêng của ezPDF trên máy này', capacitorFsDriver());
}
