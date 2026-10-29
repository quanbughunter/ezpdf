/**
 * Browser half of the storage tests (dev server only, see scripts/e2e-m4.cjs):
 *  - the contract on the web adapter (IndexedDB)
 *  - the contract on the Android adapter's code with Capacitor's own web
 *    implementation of Filesystem (same JS calls, IndexedDB underneath)
 *  - drafts and signatures saved by M3 (old IndexedDB layout) still open
 */
import { createIdbBackend } from '../src/platform/storage/idb';
import { createCapacitorBackend } from '../src/platform/storage/capacitor-fs';
import { runStorageContract, type Check } from './storage-contract';

async function m3Compat(): Promise<Check[]> {
  const out: Check[] = [];
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('ezpdf', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      const s = d.createObjectStore('drafts', { keyPath: 'id' });
      s.createIndex('hash', 'hash', { unique: false });
      d.createObjectStore('files');
      d.createObjectStore('signatures', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = db.transaction(['drafts', 'files', 'signatures'], 'readwrite');
  tx.objectStore('drafts').put({ id: 'm3-draft', name: 'cu.pdf', hash: 'h', updatedAt: 7 });
  tx.objectStore('files').put(new Blob(['%PDF-orig'], { type: 'application/pdf' }), 'm3-draft:original');
  tx.objectStore('files').put(new Blob(['%PDF-draft'], { type: 'application/pdf' }), 'm3-draft:draft');
  tx.objectStore('signatures').put({ id: 'm3-sig', png: new Blob(['PNG'], { type: 'image/png' }), width: 4, height: 2, createdAt: 1 });
  await new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();

  const s = createIdbBackend();
  const drafts = await s.list<{ id: string; name: string }>('drafts');
  out.push({ name: 'an M3 draft is listed', ok: drafts.some((d) => d.id === 'm3-draft' && d.name === 'cu.pdf') });
  out.push({
    name: 'an M3 draft opens (original and draft parts)',
    ok: (await (await s.read('drafts', 'm3-draft', 'original'))?.text()) === '%PDF-orig' && (await (await s.read('drafts', 'm3-draft', 'draft'))?.text()) === '%PDF-draft',
  });
  out.push({ name: 'an M3 signature (PNG inside the record) is read', ok: (await (await s.read('signatures', 'm3-sig', 'png'))?.text()) === 'PNG' });
  await s.remove('drafts', 'm3-draft');
  await s.remove('signatures', 'm3-sig');
  out.push({ name: 'removing an M3 draft also removes its files', ok: (await s.read('drafts', 'm3-draft', 'original')) === null && (await s.get('drafts', 'm3-draft')) === null });
  return out;
}

async function main() {
  const suites: { suite: string; checks: Check[] }[] = [];
  suites.push({ suite: 'web adapter (IndexedDB)', checks: await runStorageContract(createIdbBackend(), { bigBytes: 7_000_000 }) });
  suites.push({ suite: 'Android adapter code on Capacitor Filesystem (web implementation)', checks: await runStorageContract(createCapacitorBackend(), { bigBytes: 7_000_000 }) });
  suites.push({ suite: 'M3 data in IndexedDB', checks: await m3Compat() });
  (window as unknown as { __storage: unknown }).__storage = suites;
  document.getElementById('out')!.textContent = JSON.stringify(suites, null, 2);
}

main().catch((e) => {
  (window as unknown as { __storage: unknown }).__storage = [{ suite: 'crash', checks: [{ name: String(e), ok: false }] }];
});
