/**
 * Shared logic of the desktop and Android adapters: records and parts as
 * plain files in a folder that belongs to the app.
 *
 *   <col>/<id>/meta-<rev>.json     { v, rev, record, parts: { name: { file, type, size } } }
 *   <col>/<id>/<part>-<rev>.<ext>  e.g. draft-1761650000123.pdf
 *
 * Nothing is renamed or overwritten in place (rename semantics differ between
 * platforms and providers). A put writes new part files under a new revision,
 * then the new meta file; only then are older metas and unreferenced parts
 * deleted. If the app dies halfway, the newest meta that parses and whose
 * part files exist wins, so readers see either the old state or the new one.
 */
import { checkId, checkPart, type Collection, type StorageBackend, type StorageKind, type StoredRecord } from './backend';

/** Minimal file access, paths relative to the adapter's root, "/" separated. */
export interface FsDriver {
  readText(path: string): Promise<string | null>;
  readBlob(path: string, type: string): Promise<Blob | null>;
  writeText(path: string, text: string): Promise<void>;
  writeBlob(path: string, blob: Blob): Promise<void>;
  /** entry names in a folder; [] when the folder does not exist */
  list(dir: string): Promise<string[]>;
  /** create a folder and its parents; fine when it exists */
  mkdir(dir: string): Promise<void>;
  /** remove a file or a folder with its content; fine when missing */
  remove(path: string): Promise<void>;
}

interface PartRef {
  file: string;
  type: string;
  size: number;
}

interface Meta<T> {
  v: 1;
  rev: number;
  record: T;
  parts: Record<string, PartRef>;
}

const META = /^meta-(\d+)\.json$/;

const EXT: Record<string, string> = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg' };

export function createFileTreeBackend(kind: StorageKind, where: string, fs: FsDriver, folder?: string): StorageBackend {
  const dirOf = (col: Collection, id: string) => {
    checkId(id);
    return `${col}/${id}`;
  };

  /** the newest valid meta, and the highest revision found in the folder (valid or not) */
  async function scan<T extends StoredRecord>(col: Collection, id: string): Promise<{ meta: Meta<T> | null; maxRev: number }> {
    const dir = dirOf(col, id);
    const names = await fs.list(dir);
    const revs = names
      .map((n) => META.exec(n))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => Number(m[1]))
      .sort((a, b) => b - a);
    const present = new Set(names);
    for (const rev of revs) {
      const text = await fs.readText(`${dir}/meta-${rev}.json`);
      if (!text) continue;
      let meta: Meta<T>;
      try {
        meta = JSON.parse(text);
      } catch {
        continue; // interrupted write: fall back to the previous revision
      }
      if (meta?.v !== 1 || meta.rev !== rev || meta.record?.id !== id) continue;
      if (!Object.values(meta.parts ?? {}).every((p) => present.has(p.file))) continue;
      return { meta, maxRev: revs[0] };
    }
    return { meta: null, maxRev: revs[0] ?? 0 };
  }

  const loadMeta = async <T extends StoredRecord>(col: Collection, id: string) => (await scan<T>(col, id)).meta;

  return {
    kind,
    where,
    folder,

    async list<T extends StoredRecord>(col: Collection) {
      const ids = (await fs.list(col)).filter((n) => /^[A-Za-z0-9_-]{1,80}$/.test(n));
      const metas = await Promise.all(ids.map((id) => loadMeta<T>(col, id).catch(() => null)));
      return metas.filter((m) => !!m).map((m) => m!.record);
    },

    async get<T extends StoredRecord>(col: Collection, id: string) {
      return (await loadMeta<T>(col, id))?.record ?? null;
    },

    async read(col, id, part) {
      checkPart(part);
      const ref = (await loadMeta(col, id))?.parts[part];
      if (!ref) return null;
      return fs.readBlob(`${dirOf(col, id)}/${ref.file}`, ref.type);
    },

    async put(col, record, parts = {}) {
      const dir = dirOf(col, record.id);
      Object.keys(parts).forEach(checkPart);
      const prev = await scan(col, record.id);
      // newer than every meta in the folder, including unreadable leftovers
      const rev = Math.max(Date.now(), prev.maxRev + 1);
      await fs.mkdir(dir);
      const refs: Record<string, PartRef> = { ...(prev.meta?.parts ?? {}) };
      for (const [name, blob] of Object.entries(parts)) {
        const type = blob.type || 'application/octet-stream';
        const file = `${name}-${rev}${EXT[type] ?? '.bin'}`;
        await fs.writeBlob(`${dir}/${file}`, blob);
        refs[name] = { file, type, size: blob.size };
      }
      const meta: Meta<typeof record> = { v: 1, rev, record, parts: refs };
      await fs.writeText(`${dir}/meta-${rev}.json`, JSON.stringify(meta));
      // The new state is in place; clearing what it replaced is best effort.
      const keep = new Set([`meta-${rev}.json`, ...Object.values(refs).map((r) => r.file)]);
      const names = await fs.list(dir).catch(() => [] as string[]);
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => fs.remove(`${dir}/${n}`).catch(() => {})));
    },

    async remove(col, id) {
      await fs.remove(dirOf(col, id));
    },
  };
}
