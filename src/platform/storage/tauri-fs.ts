/**
 * Desktop adapter: files under ezPDF's local app-data folder, through Tauri's fs
 * plugin (%LOCALAPPDATA% on Windows, so drafts never roam with a
 * domain profile; permissions limited to $APPLOCALDATA/store/** in
 * src-tauri/capabilities/default.json). Bytes cross the IPC as raw binary.
 */
import { BaseDirectory, exists, mkdir, readDir, readFile, readTextFile, remove, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { appLocalDataDir, join } from '@tauri-apps/api/path';
import type { StorageBackend } from './backend';
import { createFileTreeBackend, type FsDriver } from './file-tree';

const ROOT = 'store';
const at = (p: string) => (p ? `${ROOT}/${p}` : ROOT);
const base = { baseDir: BaseDirectory.AppLocalData };

export function tauriFsDriver(): FsDriver {
  return {
    async readText(path) {
      if (!(await exists(at(path), base))) return null;
      return readTextFile(at(path), base);
    },
    async readBlob(path, type) {
      if (!(await exists(at(path), base))) return null;
      return new Blob([await readFile(at(path), base)], { type });
    },
    async writeText(path, text) {
      await writeTextFile(at(path), text, base);
    },
    async writeBlob(path, blob) {
      await writeFile(at(path), new Uint8Array(await blob.arrayBuffer()), base);
    },
    async list(dir) {
      if (!(await exists(at(dir), base))) return [];
      return (await readDir(at(dir), base)).map((e) => e.name);
    },
    async mkdir(dir) {
      await mkdir(at(dir), { ...base, recursive: true });
    },
    async remove(path) {
      if (await exists(at(path), base)) await remove(at(path), { ...base, recursive: true });
    },
  };
}

export async function createTauriBackend(): Promise<StorageBackend> {
  const folder = await join(await appLocalDataDir(), ROOT).catch(() => undefined);
  return createFileTreeBackend('desktop', 'thư mục dữ liệu của ezPDF trên máy này', tauriFsDriver(), folder);
}
