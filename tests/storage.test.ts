/**
 * File-tree storage (desktop and Android adapters share it), run in Node on
 * an in-memory driver and on the real disk, plus interrupted-write cases.
 *   npm run test:storage
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileTreeBackend, type FsDriver } from '../src/platform/storage/file-tree';
import { runStorageContract, type Check } from './storage-contract';

function memoryDriver(): FsDriver & { files: Map<string, Uint8Array<ArrayBuffer> | string> } {
  const files = new Map<string, Uint8Array<ArrayBuffer> | string>();
  const dirs = new Set<string>(['']);
  const parent = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
  return {
    files,
    async readText(p) {
      const v = files.get(p);
      return typeof v === 'string' ? v : null;
    },
    async readBlob(p, type) {
      const v = files.get(p);
      return v instanceof Uint8Array ? new Blob([v], { type }) : null;
    },
    async writeText(p, t) {
      if (!dirs.has(parent(p))) throw new Error(`no folder ${parent(p)}`);
      files.set(p, t);
    },
    async writeBlob(p, b) {
      if (!dirs.has(parent(p))) throw new Error(`no folder ${parent(p)}`);
      files.set(p, new Uint8Array(await b.arrayBuffer()));
    },
    async list(d) {
      if (!dirs.has(d)) return [];
      const names = new Set<string>();
      for (const k of [...files.keys(), ...dirs]) if (k !== d && parent(k) === d) names.add(k.slice(d.length + 1));
      return [...names];
    },
    async mkdir(d) {
      for (let p = d; p; p = parent(p)) dirs.add(p);
    },
    async remove(p) {
      for (const k of [...files.keys()]) if (k === p || k.startsWith(`${p}/`)) files.delete(k);
      for (const k of [...dirs]) if (k === p || k.startsWith(`${p}/`)) dirs.delete(k);
    },
  };
}

function diskDriver(root: string): FsDriver {
  const at = (p: string) => join(root, ...p.split('/'));
  const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';
  return {
    readText: (p) => readFile(at(p), 'utf8').catch((e) => (missing(e) ? null : Promise.reject(e))),
    readBlob: (p, type) => readFile(at(p)).then((b) => new Blob([b], { type }), (e) => (missing(e) ? null : Promise.reject(e))),
    writeText: (p, t) => writeFile(at(p), t, 'utf8'),
    writeBlob: async (p, b) => writeFile(at(p), new Uint8Array(await b.arrayBuffer())),
    list: (d) => readdir(at(d)).catch((e) => (missing(e) ? [] : Promise.reject(e))),
    mkdir: async (d) => void (await mkdir(at(d), { recursive: true })),
    remove: (p) => rm(at(p), { recursive: true, force: true }),
  };
}

const results: { suite: string; checks: Check[] }[] = [];

async function main() {
  results.push({ suite: 'file-tree / memory', checks: await runStorageContract(createFileTreeBackend('memory', 'memory', memoryDriver())) });

  const root = mkdtempSync(join(tmpdir(), 'ezpdf-store-'));
  try {
    const disk = createFileTreeBackend('desktop', root, diskDriver(root));
    results.push({ suite: 'file-tree / disk', checks: await runStorageContract(disk, { bigBytes: 12_000_000 }) });

    // Interrupted writes, on the real disk.
    const checks: Check[] = [];
    const ok = (name: string, cond: boolean, detail?: string) => checks.push({ name, ok: cond, detail });
    const id = 'crash-1';
    const pdf = (s: string) => new Blob([s], { type: 'application/pdf' });
    await disk.put('drafts', { id, step: 1 }, { original: pdf('ORIG'), draft: pdf('D1') });
    const dir = join(root, 'drafts', id);
    const files1 = readdirSync(dir).sort();
    ok('one meta and one file per part after a put', files1.length === 3 && files1.filter((f) => f.startsWith('meta-')).length === 1, files1.join(' '));

    await disk.put('drafts', { id, step: 2 }, { draft: pdf('D2') });
    const files2 = readdirSync(dir).sort();
    ok('replaced parts and metas are cleared', files2.length === 3 && !files2.some((f) => files1.includes(f) && f.startsWith('draft')), files2.join(' '));

    // The app dies while writing the next meta: half a JSON file.
    const meta2 = files2.find((f) => f.startsWith('meta-'))!;
    const rev2 = Number(/meta-(\d+)/.exec(meta2)![1]);
    writeFileSync(join(dir, `draft-${rev2 + 5}.pdf`), 'D3');
    writeFileSync(join(dir, `meta-${rev2 + 5}.json`), readFileSync(join(dir, meta2), 'utf8').slice(0, 40));
    ok('a half-written meta is skipped, the previous state is read', (await disk.get<{ id: string; step: number }>('drafts', id))?.step === 2 && (await (await disk.read('drafts', id, 'draft'))!.text()) === 'D2');

    // The app dies after the meta but a part file is missing (written elsewhere, lost).
    const full = JSON.parse(readFileSync(join(dir, meta2), 'utf8'));
    full.rev = rev2 + 9;
    full.record.step = 9;
    full.parts.draft.file = `draft-${rev2 + 9}.pdf`;
    writeFileSync(join(dir, `meta-${rev2 + 9}.json`), JSON.stringify(full));
    ok('a meta whose part file is missing is skipped', (await disk.get<{ id: string; step: number }>('drafts', id))?.step === 2);

    await disk.put('drafts', { id, step: 3 }, { draft: pdf('D4') });
    const files3 = readdirSync(dir).sort();
    ok(
      'the next put clears leftovers of interrupted writes',
      files3.length === 3 && (await (await disk.read('drafts', id, 'draft'))!.text()) === 'D4' && (await (await disk.read('drafts', id, 'original'))!.text()) === 'ORIG',
      files3.join(' '),
    );
    ok('the new revision is newer than any leftover', Number(/meta-(\d+)/.exec(files3.find((f) => f.startsWith('meta-'))!)![1]) > rev2 + 9);

    // A folder with no readable meta (crash during the first save) is not listed.
    await mkdir(join(root, 'drafts', 'orphan'), { recursive: true });
    writeFileSync(join(root, 'drafts', 'orphan', 'original-1.pdf'), 'X');
    ok('a draft folder without a meta is not listed', (await disk.list<{ id: string }>('drafts')).map((r) => r.id).join() === id);
    results.push({ suite: 'file-tree / interrupted writes', checks });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  let failed = 0;
  for (const r of results) {
    console.log(`\n${r.suite}`);
    for (const c of r.checks) {
      if (!c.ok) failed++;
      console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`);
    }
  }
  const total = results.reduce((n, r) => n + r.checks.length, 0);
  console.log(`\n${total - failed}/${total} checks passed`);
  process.exit(failed ? 1 : 0);
}

void main();
