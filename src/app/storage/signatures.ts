/** Signatures the user chose to keep, as transparent PNGs, on this device only. */
import { storage } from '@/platform';

export interface SavedSignature {
  id: string;
  png: Blob;
  /** pixel size of the PNG */
  width: number;
  height: number;
  createdAt: number;
}

type SignatureRecord = Omit<SavedSignature, 'png'>;

const MAX_SAVED = 12;

async function records(): Promise<SignatureRecord[]> {
  const all = await (await storage()).list<SignatureRecord>('signatures');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listSignatures(): Promise<SavedSignature[]> {
  const s = await storage();
  const out: SavedSignature[] = [];
  for (const r of await records()) {
    const png = await s.read('signatures', r.id, 'png');
    if (png) out.push({ id: r.id, width: r.width, height: r.height, createdAt: r.createdAt, png });
  }
  return out;
}

export async function saveSignature(sig: SavedSignature): Promise<void> {
  const s = await storage();
  const { png, ...record } = sig;
  await s.put('signatures', record, { png });
  // keep the newest MAX_SAVED
  for (const old of (await records()).slice(MAX_SAVED)) await s.remove('signatures', old.id);
}

export async function deleteSignature(id: string): Promise<void> {
  await (await storage()).remove('signatures', id);
}
