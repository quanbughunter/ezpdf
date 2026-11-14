/**
 * "Bỏ tô sáng hàng loạt": every highlight of the document at once.
 *
 * Opening the dialog looks through every page (the text-edit worker's copy
 * of the document): the passages of bands Google Docs, Word or LibreOffice
 * painted under words, and highlight annotations. It then shows how many
 * there are by colour; the user keeps or drops colours and chooses pages,
 * and one click takes them all off, page by page, in one undo step. The
 * bands leave the page content (text-edit.ts removeAllMarks); nothing is
 * painted over them.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Eraser, Loader2 } from 'lucide-react';
import { useDocumentState } from '@embedpdf/core/react';
import { useScroll } from '@embedpdf/plugin-scroll/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { colorGroups } from '@/engine/marks';
import type { PageMark } from '@/engine/text-edit';
import { parseRanges } from './pages/ranges';
import type { TextEditApi } from './text-edit';

type Rgb = [number, number, number];
type PageChoice = 'all' | 'current' | 'list';
type Phase =
  | { kind: 'scanning'; done: number; total: number }
  | { kind: 'options'; found: PageMark[][] }
  | { kind: 'working'; done: number; total: number; found: PageMark[][] }
  | { kind: 'error'; message: string };

const same = (a: Rgb, b: Rgb) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

export function UnmarkAllDialog({ api, documentId }: { api: TextEditApi; documentId: string }) {
  const open = api.bulk;
  const doc = useDocumentState(documentId)?.document;
  const { state: scroll } = useScroll(documentId);
  const total = doc?.pageCount || scroll.totalPages || 0;
  const current = Math.min(Math.max(1, scroll.currentPage || 1), Math.max(1, total));
  const [phase, setPhase] = useState<Phase>({ kind: 'scanning', done: 0, total });
  const [off, setOff] = useState<Set<number>>(new Set());
  const [choice, setChoice] = useState<PageChoice>('all');
  const [list, setList] = useState('');
  const abort = useRef<AbortController | null>(null);

  // open: look through every page
  useEffect(() => {
    if (!open || !total) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setOff(new Set());
    setChoice('all');
    setList('');
    setPhase({ kind: 'scanning', done: 0, total });
    api
      .scanMarks(
        Array.from({ length: total }, (_, i) => i),
        (done) => !ctl.signal.aborted && setPhase({ kind: 'scanning', done, total }),
        ctl.signal,
      )
      .then(
        (found) => found && !ctl.signal.aborted && setPhase({ kind: 'options', found }),
        (e) => !ctl.signal.aborted && setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
      );
    return () => ctl.abort();
    // a new scan only when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, total]);

  const found = phase.kind === 'options' || phase.kind === 'working' ? phase.found : null;
  const groups = useMemo(() => colorGroups((found ?? []).flat().map((m) => m.color)), [found]);
  const groupOf = (c: Rgb) => groups.findIndex((g) => g.members.some((m) => same(m, c)));

  const parsed = choice === 'list' ? parseRanges(list, total) : null;
  const inScope: number[] =
    choice === 'all'
      ? Array.from({ length: total }, (_, i) => i)
      : choice === 'current'
        ? [current - 1]
        : parsed?.ok
          ? parsed.parts.flatMap((p) => Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from - 1 + i))
          : [];
  const countIn = (pages: number[], keep: (g: number) => boolean) =>
    pages.reduce((n, p) => n + (found?.[p] ?? []).filter((m) => keep(groupOf(m.color))).length, 0);
  const chosen = (g: number) => g >= 0 && !off.has(g);
  const pages = inScope.filter((p) => countIn([p], chosen) > 0);
  const spots = countIn(inScope, chosen);
  const allSpots = (found ?? []).flat().length;
  const allPages = (found ?? []).filter((m) => m.length).length;
  const colors: Rgb[] = groups.flatMap((g, i) => (chosen(i) ? g.members : []));

  const close = () => {
    abort.current?.abort();
    api.openBulk(false);
  };

  const go = async () => {
    if (!found || !pages.length) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase({ kind: 'working', done: 0, total: pages.length, found });
    try {
      const r = await api.unmarkAll(pages, colors, spots, (done) => !ctl.signal.aborted && setPhase({ kind: 'working', done, total: pages.length, found }), ctl.signal);
      if (ctl.signal.aborted || !r) return;
      api.openBulk(false);
    } catch (e) {
      if (!ctl.signal.aborted) setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[460px]"
        data-testid="unmark-all-dialog"
        closeTestId="unmark-all-close"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Bỏ tô sáng hàng loạt</DialogTitle>
          <DialogDescription>
            Bỏ màu tô dưới chữ (tô sáng của Google Docs, Word…) và các ghi chú tô sáng, ở nhiều chỗ một lúc. Chữ giữ nguyên; bấm Hoàn tác là lấy lại tất cả.
          </DialogDescription>
        </DialogHeader>

        {phase.kind === 'scanning' ? (
          <Progress label="Đang tìm chỗ tô…" done={phase.done} total={phase.total} onStop={close} testid="unmark-all-scanning" />
        ) : phase.kind === 'working' ? (
          <Progress
            label="Đang bỏ tô sáng…"
            done={phase.done}
            total={phase.total}
            onStop={() => {
              abort.current?.abort();
              setPhase({ kind: 'options', found: phase.found });
            }}
            testid="unmark-all-working"
          />
        ) : phase.kind === 'error' ? (
          <div className="space-y-3 text-[13px]">
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-900" data-testid="unmark-all-error">
              Không bỏ được tô sáng: {phase.message}
            </p>
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={close}>
                Đóng
              </Button>
            </div>
          </div>
        ) : !allSpots ? (
          <div className="space-y-3 text-[13px]" data-testid="unmark-all-none">
            <p className="font-bold">Không tìm thấy chỗ tô nào trong tài liệu.</p>
            <p className="text-muted-foreground">Nền ô bảng, chữ trắng trên nền đậm, khung nền sau nhiều dòng và ô che chữ không tính là tô sáng.</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={close} data-testid="unmark-all-ok">
                Đóng
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-[13px]">
            <p className="font-bold" data-testid="unmark-all-found" data-spots={allSpots} data-pages={allPages}>
              Tìm thấy {allSpots} chỗ tô trên {allPages} trang.
            </p>

            <fieldset>
              <legend className="mb-1.5 font-bold">Màu cần bỏ</legend>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((g, i) => {
                  const n = countIn(inScope, (k) => k === i);
                  const [r, gr, b] = g.color;
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={!off.has(i)}
                      data-testid="unmark-all-color"
                      data-name={g.name}
                      data-count={n}
                      onClick={() => setOff((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))}
                      className={cn(
                        'flex h-8 items-center gap-1.5 rounded-full border px-3 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        off.has(i) ? 'border-border bg-background text-muted-foreground line-through' : 'border-primary bg-primary/10 text-foreground',
                      )}
                    >
                      <span aria-hidden className="size-3.5 rounded-[3px] border border-black/15" style={{ background: `rgb(${r} ${gr} ${b})` }} />
                      {g.name} · <span className="tabular-nums">{n}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-muted-foreground">Chạm vào một màu để giữ lại màu đó.</p>
            </fieldset>

            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 font-bold">Trang</legend>
              <label className="flex items-center gap-2">
                <input type="radio" className="accent-primary" name="unmark-pages" checked={choice === 'all'} onChange={() => setChoice('all')} data-testid="unmark-all-pages-all" />
                Tất cả ({total} trang)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" className="accent-primary" name="unmark-pages" checked={choice === 'current'} onChange={() => setChoice('current')} data-testid="unmark-all-pages-current" />
                Trang đang xem (trang {current})
              </label>
              <label className="flex flex-wrap items-center gap-2">
                <input type="radio" className="accent-primary" name="unmark-pages" checked={choice === 'list'} onChange={() => setChoice('list')} data-testid="unmark-all-pages-list" />
                Các trang
                <input
                  value={list}
                  placeholder="ví dụ 1-3, 5"
                  onChange={(e) => setList(e.target.value)}
                  onFocus={() => setChoice('list')}
                  data-testid="unmark-all-pages-text"
                  aria-label="Các trang cần bỏ tô sáng"
                  className="h-8 min-w-0 flex-1 rounded-md border bg-white px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              {parsed && !parsed.ok && list.trim() && (
                <p className="text-destructive" data-testid="unmark-all-pages-error">
                  {parsed.error}
                </p>
              )}
            </fieldset>

            <p className="text-muted-foreground" data-testid="unmark-all-plan">
              {spots ? `Sẽ bỏ ${spots} chỗ tô trên ${pages.length} trang.` : 'Không có chỗ tô nào trong lựa chọn này.'}
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={close} data-testid="unmark-all-cancel">
                Hủy
              </Button>
              <Button size="sm" disabled={!spots} onClick={() => void go()} data-testid="unmark-all-go">
                <Eraser /> Bỏ {spots} chỗ tô
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Progress({ label, done, total, onStop, testid }: { label: string; done: number; total: number; onStop: () => void; testid: string }) {
  return (
    <div className="space-y-3 text-[13px]" data-testid={testid} role="status">
      <p className="flex items-center gap-2 font-bold">
        <Loader2 className="size-4 animate-spin" /> {label}
      </p>
      <p className="text-muted-foreground tabular-nums">
        Trang {done}/{total}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full bg-primary transition-[width]" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
      </div>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onStop} data-testid={`${testid}-stop`}>
          Dừng
        </Button>
      </div>
    </div>
  );
}
