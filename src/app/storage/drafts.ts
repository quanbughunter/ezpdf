/**
 * Drafts: the original file plus the latest edited state, kept on this
 * device so work survives a reload or a closed tab.
 *
 *  - original  the bytes the user opened, stored once, never modified
 *  - draft     EmbedPDF's save of the current document (annotations are
 *              committed to the engine as they are made), replaced on every
 *              autosave
 *  - record    name, hash of the original, page rotations (kept by the app,
 *              see page-rotation.ts), last page, timestamps, whether the
 *              latest state has been exported
 *
 * Export is separate: it always builds a new file and never touches these.
 * Where they are kept depends on the platform (see platform/storage).
 */
import { storage } from '@/platform';

export interface DraftRecord {
  id: string;
  name: string;
  /** SHA-256 of the original file, hex */
  hash: string;
  originalSize: number;
  draftSize: number;
  pages: number;
  /** page rotation per page index, clockwise quarter turns */
  rotations: number[];
  lastPage: number;
  createdAt: number;
  updatedAt: number;
  /** the saved state has been exported since it was saved */
  exported: boolean;
}

export async function sha256(buffer: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function listDrafts(): Promise<DraftRecord[]> {
  const all = await (await storage()).list<DraftRecord>('drafts');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function latestDraftFor(hash: string): Promise<DraftRecord | null> {
  return (await listDrafts()).find((d) => d.hash === hash) ?? null;
}

export async function getDraft(id: string): Promise<DraftRecord | null> {
  return (await storage()).get<DraftRecord>('drafts', id);
}

/** First save of a session: original + draft + record together. */
export async function createDraft(record: DraftRecord, original: Blob, draft: Blob): Promise<void> {
  await (await storage()).put('drafts', record, { original, draft });
}

/** Later saves replace the draft bytes and the record together; the original stays. */
export async function updateDraft(record: DraftRecord, draft: Blob): Promise<void> {
  await (await storage()).put('drafts', record, { draft });
}

export async function markExported(id: string): Promise<void> {
  const rec = await getDraft(id);
  if (!rec) return;
  await (await storage()).put('drafts', { ...rec, exported: true });
}

export async function loadDraftFiles(id: string): Promise<{ original: Blob; draft: Blob } | null> {
  const s = await storage();
  const [original, draft] = await Promise.all([s.read('drafts', id, 'original'), s.read('drafts', id, 'draft')]);
  return original && draft ? { original, draft } : null;
}

export async function deleteDraft(id: string): Promise<void> {
  await (await storage()).remove('drafts', id);
}
