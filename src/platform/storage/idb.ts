/**
 * Web adapter: IndexedDB in this browser profile on this device.
 *
 * Schema (unchanged since M3, so existing drafts keep working)
 *  - drafts      DraftRecord, keyPath "id" (index "hash", unused since M4)
 *  - signatures  signature records, keyPath "id"; M3 kept the PNG inside the
 *                record as `png`, M4 keeps parts in "files" and still reads
 *                the old form
 *  - files       Blob parts, out-of-line keys:
 *                  drafts      "<id>:<part>"            (M3 keys, e.g. "<id>:original")
 *                  signatures  "signatures/<id>:<part>"
 */
import { checkId, checkPart, type Collection, type StorageBackend, type StoredRecord } from './backend';

const DB_NAME = 'ezpdf';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Trình duyệt này không cho lưu dữ liệu trên máy (IndexedDB).'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('drafts')) {
        const s = db.createObjectStore('drafts', { keyPath: 'id' });
        s.createIndex('hash', 'hash', { unique: false });
      }
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('signatures')) db.createObjectStore('signatures', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('Không mở được kho lưu trên máy.'));
    };
    req.onblocked = () => reject(new Error('Kho lưu trên máy đang bị một tab khác giữ. Hãy đóng các tab ezPDF khác.'));
  });
  return dbPromise;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Ghi dữ liệu bị hủy.'));
    tx.onerror = () => reject(tx.error ?? new Error('Ghi dữ liệu thất bại.'));
  });

const result = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const prefix = (col: Collection, id: string) => `${col === 'drafts' ? '' : `${col}/`}${id}:`;

export function createIdbBackend(): StorageBackend {
  return {
    kind: 'web',
    where: 'trình duyệt này, trên máy này',

    async list<T extends StoredRecord>(col: Collection) {
      const db = await openDb();
      return (await result(db.transaction(col, 'readonly').objectStore(col).getAll())) as T[];
    },

    async get<T extends StoredRecord>(col: Collection, id: string) {
      const db = await openDb();
      return ((await result(db.transaction(col, 'readonly').objectStore(col).get(id))) as T | undefined) ?? null;
    },

    async read(col, id, part) {
      checkPart(part);
      const db = await openDb();
      const tx = db.transaction([col, 'files'], 'readonly');
      const blob = (await result(tx.objectStore('files').get(prefix(col, id) + part))) as Blob | undefined;
      if (blob) return blob;
      // M3 signatures kept the PNG inside the record.
      const rec = (await result(tx.objectStore(col).get(id))) as Record<string, unknown> | undefined;
      const inline = rec?.[part];
      return inline instanceof Blob ? inline : null;
    },

    async put(col, record, parts = {}) {
      checkId(record.id);
      Object.keys(parts).forEach(checkPart);
      const db = await openDb();
      const tx = db.transaction([col, 'files'], 'readwrite');
      for (const [part, blob] of Object.entries(parts)) tx.objectStore('files').put(blob, prefix(col, record.id) + part);
      tx.objectStore(col).put(record);
      await done(tx);
    },

    async remove(col, id) {
      const db = await openDb();
      const tx = db.transaction([col, 'files'], 'readwrite');
      tx.objectStore(col).delete(id);
      const p = prefix(col, id);
      tx.objectStore('files').delete(IDBKeyRange.bound(p, `${p}￿`));
      await done(tx);
    },
  };
}
