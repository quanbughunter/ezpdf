/**
 * Behaviour every storage adapter must have (platform/storage/backend.ts).
 * Runs in Node (file-tree logic on a memory and a real-disk driver) and in
 * the browser (IndexedDB and Capacitor's Filesystem, tests/storage.html).
 */
import type { StorageBackend } from '../src/platform/storage/backend';

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const bytes = (n: number, seed: number) => {
  const a = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    a[i] = x & 255;
  }
  return a;
};

const same = async (blob: Blob | null, expect: Uint8Array) => {
  if (!blob || blob.size !== expect.length) return false;
  const got = new Uint8Array(await blob.arrayBuffer());
  for (let i = 0; i < got.length; i++) if (got[i] !== expect[i]) return false;
  return true;
};

export async function runStorageContract(s: StorageBackend, opts: { bigBytes?: number } = {}): Promise<Check[]> {
  const out: Check[] = [];
  const check = async (name: string, fn: () => Promise<boolean | string>) => {
    try {
      const r = await fn();
      out.push({ name, ok: r === true, detail: typeof r === 'string' ? r : undefined });
    } catch (e) {
      out.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  };

  const A = 'contract-a';
  const B = 'contract-b';
  await s.remove('drafts', A);
  await s.remove('drafts', B);
  await s.remove('signatures', A);

  const original = bytes(200_000, 1);
  const draft1 = bytes(210_000, 2);
  const draft2 = bytes(opts.bigBytes ?? 230_000, 3);
  const rec = { id: A, name: 'Hợp đồng thuê nhà.pdf', hash: 'abc', updatedAt: 1, exported: false, rotations: [0, 1, 2, 3] };

  await check('a missing record reads as null', async () => (await s.get('drafts', A)) === null && (await s.read('drafts', A, 'draft')) === null);

  await check('put stores the record and its parts', async () => {
    await s.put('drafts', rec, {
      original: new Blob([original], { type: 'application/pdf' }),
      draft: new Blob([draft1], { type: 'application/pdf' }),
    });
    const got = await s.get<typeof rec>('drafts', A);
    if (JSON.stringify(got) !== JSON.stringify(rec)) return `record ${JSON.stringify(got)}`;
    const o = await s.read('drafts', A, 'original');
    if (o?.type !== 'application/pdf') return `type ${o?.type}`;
    return (await same(o, original)) && (await same(await s.read('drafts', A, 'draft'), draft1));
  });

  await check('a later put replaces only the parts it is given', async () => {
    await s.put('drafts', { ...rec, updatedAt: 2 }, { draft: new Blob([draft2], { type: 'application/pdf' }) });
    return (
      (await s.get<typeof rec>('drafts', A))?.updatedAt === 2 &&
      (await same(await s.read('drafts', A, 'original'), original)) &&
      (await same(await s.read('drafts', A, 'draft'), draft2))
    );
  });

  await check('a put without parts keeps every part', async () => {
    await s.put('drafts', { ...rec, updatedAt: 3, exported: true });
    const got = await s.get<typeof rec>('drafts', A);
    return got?.exported === true && (await same(await s.read('drafts', A, 'draft'), draft2)) && (await same(await s.read('drafts', A, 'original'), original));
  });

  await check('list returns every record of a collection, and only those', async () => {
    await s.put('drafts', { ...rec, id: B, updatedAt: 4 }, { original: new Blob([bytes(10, 9)], { type: 'application/pdf' }) });
    await s.put('signatures', { id: A, width: 3, height: 2, createdAt: 5 }, { png: new Blob([bytes(64, 7)], { type: 'image/png' }) });
    const drafts = (await s.list<typeof rec>('drafts')).filter((r) => r.id.startsWith('contract-'));
    const sigs = (await s.list<{ id: string }>('signatures')).filter((r) => r.id.startsWith('contract-'));
    return (
      drafts.map((d) => d.id).sort().join() === `${A},${B}` &&
      sigs.length === 1 &&
      (await same(await s.read('signatures', A, 'png'), bytes(64, 7))) &&
      (await s.read('signatures', A, 'png'))?.type === 'image/png'
    );
  });

  await check('an unknown part reads as null', async () => (await s.read('drafts', A, 'thumbnail')) === null);

  await check('remove deletes the record and its parts, others stay', async () => {
    await s.remove('drafts', A);
    const left = (await s.list<typeof rec>('drafts')).filter((r) => r.id.startsWith('contract-')).map((r) => r.id);
    return (
      (await s.get('drafts', A)) === null &&
      (await s.read('drafts', A, 'original')) === null &&
      left.join() === B &&
      (await s.get('signatures', A)) !== null
    );
  });

  await check('removing something that does not exist is fine', async () => {
    await s.remove('drafts', 'contract-none');
    return true;
  });

  await check('ids that could escape the folder are refused', async () => {
    try {
      await s.put('drafts', { id: '../x' });
      return 'accepted ../x';
    } catch {
      return true;
    }
  });

  await s.remove('drafts', B);
  await s.remove('signatures', A);
  return out;
}
