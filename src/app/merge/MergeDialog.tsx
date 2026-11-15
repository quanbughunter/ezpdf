/**
 * "Gộp PDF": several PDF files joined, in the order the user sets, into one
 * new file. The files themselves are not changed.
 *
 * Each file is read once when it is added (PDFium in the export worker:
 * pages and their rotation); a file that cannot be read (not a PDF, a
 * password, damaged) is shown with the reason and left out. Joining builds a
 * new document from all the pages (page-ops.ts assembleNew, as "Tách tệp"
 * does), finished like an export. The result can be saved, or opened in
 * ezPDF to rearrange its pages in Bộ công cụ before saving.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Combine, FilePlus2, FolderOpen, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { buildPages, closeRenderSession, openRenderSession } from '@/engine/export-client';
import type { PageInfo, PlanPage } from '@/engine/page-ops';
import { usePlatform } from '@/platform';
import { cn } from '@/lib/utils';

interface Item {
  id: number;
  name: string;
  size: number;
  state: 'reading' | 'ok' | 'error';
  infos?: PageInfo[];
  error?: string;
}

type Phase = { kind: 'list' } | { kind: 'working' } | { kind: 'done'; bytes: Uint8Array; name: string; pages: number; files: number } | { kind: 'error'; message: string };

let nextId = 1;

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const stem = (name: string) => name.replace(/\.pdf$/i, '');

/** Why a file cannot be joined, in the user's words. */
function unreadable(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/mã lỗi 4\b/.test(m)) return 'Tệp có mật khẩu mở, chưa gộp được.';
  if (/mã lỗi 3\b|mã lỗi 2\b/.test(m)) return 'Tệp hỏng hoặc không phải PDF.';
  return `Không đọc được tệp: ${m}`;
}

export function MergeDialog({ files, onClose, onOpen }: { files: File[]; onClose: () => void; onOpen: (file: File) => Promise<boolean> }) {
  const platform = usePlatform();
  const [items, setItems] = useState<Item[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: 'list' });
  const [saved, setSaved] = useState<{ name: string; path?: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const bytes = useRef(new Map<number, ArrayBuffer>());
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  // (React's strict mode mounts twice: alive again on the second mount)
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const add = async (picked: File[]) => {
    const fresh: Item[] = picked.map((f) => ({ id: nextId++, name: f.name, size: f.size, state: 'reading' }));
    setItems((s) => [...s, ...fresh]);
    for (const [i, f] of picked.entries()) {
      const it = fresh[i];
      let update: Partial<Item>;
      try {
        const buf = await f.arrayBuffer();
        const head = new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 1024)));
        if (!head.includes('%PDF-')) throw new Error('not-pdf');
        const r = await openRenderSession(buf.slice(0));
        void closeRenderSession(r.session);
        bytes.current.set(it.id, buf);
        update = { state: 'ok', infos: r.infos };
      } catch (e) {
        update = { state: 'error', error: e instanceof Error && e.message === 'not-pdf' ? 'Không phải tệp PDF.' : unreadable(e) };
      }
      if (!alive.current) return;
      setItems((s) => s.map((x) => (x.id === it.id ? { ...x, ...update } : x)));
    }
  };

  // the files picked to open the dialog
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void add(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickMore = async () => {
    setNote(null);
    if (platform.pickPdfs) {
      try {
        const more = await platform.pickPdfs();
        if (more?.length) await add(more);
      } catch (e) {
        setNote(e instanceof Error ? e.message : String(e));
      }
    } else input.current?.click();
  };

  const move = (id: number, dir: -1 | 1) =>
    setItems((s) => {
      const i = s.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const a = [...s];
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    });
  const remove = (id: number) => {
    bytes.current.delete(id);
    setItems((s) => s.filter((x) => x.id !== id));
  };

  const ready = items.filter((x) => x.state === 'ok');
  const reading = items.some((x) => x.state === 'reading');
  const pages = ready.reduce((n, x) => n + (x.infos?.length ?? 0), 0);

  const merge = async () => {
    if (ready.length < 2) return;
    setPhase({ kind: 'working' });
    setNote(null);
    try {
      const bufs = ready.map((x) => bytes.current.get(x.id)!);
      const plan: PlanPage[] = ready.flatMap((x, src) => x.infos!.map((inf, page) => ({ src, page, rotation: inf.rotation })));
      const r = await buildPages(bufs[0], bufs.slice(1), plan, 'new');
      if (!alive.current) return;
      setSaved(null);
      setPhase({ kind: 'done', bytes: new Uint8Array(r.bytes), name: `${stem(ready[0].name)} (gộp ${ready.length} tệp).pdf`, pages: plan.length, files: ready.length });
    } catch (e) {
      if (alive.current) setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  const save = async (done: Extract<Phase, { kind: 'done' }>) => {
    setNote(null);
    try {
      const r = await platform.savePdf(done.bytes, done.name);
      if (!r) return;
      const folder = r.how === 'file' ? r.folder : undefined;
      setSaved({ name: r.name, path: folder ? `${folder}${folder.includes('\\') ? '\\' : '/'}${r.name}` : undefined });
    } catch (e) {
      setNote(`Không lưu được: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const open = async (done: Extract<Phase, { kind: 'done' }>) => {
    const ok = await onOpen(new File([done.bytes as BlobPart], saved?.name ?? done.name, { type: 'application/pdf' }));
    if (ok) onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && phase.kind !== 'working' && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[520px]" data-testid="merge-dialog" closeTestId="merge-close" onOpenAutoFocus={(e) => e.preventDefault()}>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          data-testid="merge-file-input"
          onChange={(e) => {
            const more = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (more.length) void add(more);
          }}
        />
        <DialogHeader>
          <DialogTitle>Gộp PDF</DialogTitle>
          <DialogDescription>Các tệp được nối theo thứ tự dưới đây thành một tệp mới. Các tệp gốc không thay đổi.</DialogDescription>
        </DialogHeader>

        {phase.kind === 'done' ? (
          <div className="space-y-3 text-[13px]" data-testid="merge-done">
            <p className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              <span data-testid="merge-done-text">
                Đã gộp {phase.files} tệp thành một tệp {phase.pages} trang: “{phase.name}”.
              </span>
            </p>
            {saved && (
              <p className="text-muted-foreground [overflow-wrap:anywhere]" data-testid="merge-saved">
                Đã lưu: {saved.path ?? saved.name}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={saved ? 'outline' : 'default'} onClick={() => void save(phase)} data-testid="merge-save">
                Lưu tệp…
              </Button>
              {saved?.path && platform.revealFile && (
                <Button size="sm" variant="outline" onClick={() => platform.revealFile!(saved.path!).catch((e) => setNote(String(e)))} data-testid="merge-reveal">
                  <FolderOpen /> Mở thư mục
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => void open(phase)} data-testid="merge-open">
                Mở trong ezPDF
              </Button>
            </div>
            <p className="text-muted-foreground">Mở trong ezPDF để xem, đổi chỗ hay xóa trang (Bộ công cụ) trước khi lưu.</p>
            {note && (
              <p role="alert" className="text-destructive">
                {note}
              </p>
            )}
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={onClose} data-testid="merge-finish">
                Xong
              </Button>
            </div>
          </div>
        ) : phase.kind === 'error' ? (
          <div className="space-y-3 text-[13px]">
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-900" data-testid="merge-error">
              Không gộp được: {phase.message}
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setPhase({ kind: 'list' })}>
                Quay lại
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-[13px]">
            <ol className="space-y-1.5" data-testid="merge-list">
              {items.map((x, i) => (
                <li
                  key={x.id}
                  data-testid="merge-item"
                  data-name={x.name}
                  data-state={x.state}
                  data-pages={x.infos?.length ?? ''}
                  className={cn('flex items-center gap-2 rounded-md border px-2.5 py-2', x.state === 'error' && 'border-destructive/40 bg-red-50/60')}
                >
                  <span className="w-5 shrink-0 text-center font-bold text-muted-foreground tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium" title={x.name}>
                      {x.name}
                    </span>
                    <span className={cn('block text-[12px]', x.state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                      {x.state === 'reading' ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="size-3 animate-spin" /> Đang đọc…
                        </span>
                      ) : x.state === 'error' ? (
                        `${x.error} Tệp này sẽ không được gộp.`
                      ) : (
                        `${x.infos!.length} trang · ${kb(x.size)}`
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center">
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => move(x.id, -1)} disabled={i === 0 || phase.kind === 'working'} aria-label={`Đưa “${x.name}” lên trước`} data-testid="merge-up">
                      <ArrowUp />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => move(x.id, 1)} disabled={i === items.length - 1 || phase.kind === 'working'} aria-label={`Đưa “${x.name}” ra sau`} data-testid="merge-down">
                      <ArrowDown />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => remove(x.id)} disabled={phase.kind === 'working'} aria-label={`Bỏ “${x.name}” khỏi danh sách`} data-testid="merge-remove">
                      <X />
                    </Button>
                  </span>
                </li>
              ))}
            </ol>
            <Button size="sm" variant="outline" onClick={() => void pickMore()} disabled={phase.kind === 'working'} data-testid="merge-add">
              <FilePlus2 /> Thêm tệp…
            </Button>
            <p className="text-muted-foreground" data-testid="merge-summary">
              {ready.length >= 2
                ? `${ready.length} tệp, ${pages} trang sẽ được gộp theo thứ tự trên.`
                : reading
                  ? 'Đang đọc các tệp…'
                  : 'Cần ít nhất hai tệp PDF để gộp.'}
            </p>
            {note && (
              <p role="alert" className="text-destructive">
                {note}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={phase.kind === 'working'} data-testid="merge-cancel">
                Hủy
              </Button>
              <Button size="sm" onClick={() => void merge()} disabled={ready.length < 2 || reading || phase.kind === 'working'} data-testid="merge-go">
                {phase.kind === 'working' ? <Loader2 className="animate-spin" /> : <Combine />}
                {phase.kind === 'working' ? 'Đang gộp…' : `Gộp ${ready.length >= 2 ? ready.length : ''} tệp`.replace('  ', ' ')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
