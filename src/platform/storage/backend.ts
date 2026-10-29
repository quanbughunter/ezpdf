/**
 * One storage interface for drafts and saved signatures, three adapters:
 *
 *  - web      IndexedDB in this browser profile            (idb.ts)
 *  - desktop  files in ezPDF's app-data folder (Tauri)     (file-tree.ts + tauri-fs.ts)
 *  - android  files in the app's private storage (Capacitor) (file-tree.ts + capacitor-fs.ts)
 *
 * Every adapter keeps data on this device only. A stored item is a small JSON
 * record plus named binary parts (the original PDF, the draft PDF, a
 * signature PNG). A put makes the record and its new parts visible together:
 * IndexedDB does it in one transaction, the file adapters write the parts
 * first and the record last (see file-tree.ts).
 */
export type Collection = 'drafts' | 'signatures';

export interface StoredRecord {
  id: string;
}

export type StorageKind = 'web' | 'desktop' | 'android' | 'memory';

export interface StorageBackend {
  readonly kind: StorageKind;
  /** where the data lives, as words that follow "chỉ nằm trong …" */
  readonly where: string;
  /** the folder on disk, when there is one (desktop) */
  readonly folder?: string;
  list<T extends StoredRecord>(col: Collection): Promise<T[]>;
  get<T extends StoredRecord>(col: Collection, id: string): Promise<T | null>;
  /** one binary part of a stored item, or null when it is missing */
  read(col: Collection, id: string, part: string): Promise<Blob | null>;
  /**
   * Store a record with some of its parts. Parts not passed keep what was
   * stored before. Either everything passed is stored, or the previous
   * state stays readable.
   */
  put<T extends StoredRecord>(col: Collection, record: T, parts?: Record<string, Blob>): Promise<void>;
  /** remove a record and all its parts; no error when it does not exist */
  remove(col: Collection, id: string): Promise<void>;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_PART = /^[a-z][a-z0-9]{0,31}$/;

export function checkId(id: string) {
  if (!SAFE_ID.test(id)) throw new Error(`Mã bản ghi không hợp lệ: ${id}`);
}

export function checkPart(part: string) {
  if (!SAFE_PART.test(part)) throw new Error(`Tên phần dữ liệu không hợp lệ: ${part}`);
}

/** Human message for a failed storage operation (no space is the usual cause). */
export function describeStorageError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  const message = e instanceof Error ? e.message : String(e);
  if (name === 'QuotaExceededError' || /quota|no space|ENOSPC|disk full|not enough space|insufficient storage/i.test(message)) {
    return 'Máy không còn đủ chỗ cho bản nháp.';
  }
  return message;
}
