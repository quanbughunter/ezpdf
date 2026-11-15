/**
 * "Bộ công cụ" (the page tools): the document's pages as a grid, to rearrange before
 * applying them in one step.
 *  - select by tapping (several at once), move them by dragging (mouse: drag;
 *    touch: hold, then drag) or with the move buttons, turn, delete;
 *  - add pages: from another PDF (any number of files), from a scan, blank;
 *  - extract the selected pages to a new file, or split the whole document
 *    into several files, saved one by one: "Tách tệp" puts a pair of
 *    scissors between every two pages, a click sets or lifts a cut there
 *    (two cuts, three files); "Nhập số trang…" places the cuts by number
 *    for long documents, or makes files from page ranges directly.
 * Nothing changes the document until "Áp dụng": the result is then built in
 * the PDFium worker (engine/page-ops.ts) and becomes the document, one undo
 * step (↶). Extracting and splitting leave the document as it is.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckSquare,
  ChevronDown,
  FilePlus2,
  FileOutput,
  Hash,
  Loader2,
  RotateCcw,
  RotateCw,
  ScanLine,
  Scissors,
  Square,
  SquareDashed,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { usePlatform } from '@/platform';
import { buildPages, UserFacingError } from '@/engine/export-client';
import type { PlanPage } from '@/engine/page-ops';
import type { DocumentSession } from '../use-document-session';
import { ScanDialog } from '../scan/ScanDialog';
import { closeSource, openSource, ThumbQueue, useThumb, type SourceDoc } from './thumbs';
import { cutsToParts, everyN, pagesLabel, parseCuts, parseRanges, partFileName, partLabel, partsToCuts, type Part, type RangeResult } from './ranges';
import { ToolboxIcon } from './toolbox-icon';

interface Card {
  key: string;
  /** 0: the open document; 1…: added files; -1: blank */
  src: number;
  page: number;
  /** absolute quarter turns */
  rotation: number;
  /** unrotated size, points */
  w: number;
  h: number;
}

interface OutFile {
  name: string;
  pages: number;
  bytes: ArrayBuffer;
  saved?: string;
}

type Dialog = null | { kind: 'split' } | { kind: 'outputs'; title: string; files: OutFile[] } | { kind: 'leave' };

const A4 = { w: 595.28, h: 841.89 };
const quarter = (r: number) => ((r % 4) + 4) % 4;
let nextKey = 1;

const message = (e: unknown) => (e instanceof UserFacingError || e instanceof Error ? e.message : String(e));

export function PageOrganizer({ session, fileName, onClose }: { session: DocumentSession; fileName: string; onClose: () => void }) {
  const platform = usePlatform();
  const queue = useMemo(() => new ThumbQueue(), []);
  const sourcesRef = useRef<SourceDoc[]>([]);
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [initial, setInitial] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Card[][]>([]);
  const [busy, setBusy] = useState<string | null>('Đang đọc các trang…');
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [scanning, setScanning] = useState(false);
  /** "Tách tệp": scissors between the pages; a cut `k` is after page k (1-based) */
  const [splitting, setSplitting] = useState(false);
  const [cuts, setCuts] = useState<Set<number>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);
  /** false once the organizer is closed: late async work must not open anything */
  const alive = useRef(true);
  const base = sources[0]?.bytes ?? null;
  const baseName = fileName.replace(/\.pdf$/i, '') || 'tai-lieu';

  // The document as it is now (annotations included), opened for drawing.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const bytes = await session.currentBytes();
        const rotations = session.rotations();
        const src0 = await openSource(0, fileName, bytes);
        if (!alive) return closeSource(src0);
        sourcesRef.current = [src0];
        setSources([src0]);
        const list = src0.infos.map((inf, i) => ({ key: `o${i}`, src: 0, page: i, rotation: rotations[i] ?? inf.rotation, w: inf.w, h: inf.h }));
        setCards(list);
        setInitial(signature(list));
        setBusy(null);
      } catch (e) {
        if (alive) {
          setBusy(null);
          setError(`Không đọc được các trang: ${message(e)}`);
        }
      }
    })();
    return () => {
      alive = false;
      sourcesRef.current.forEach(closeSource);
      sourcesRef.current = [];
      queue.dispose();
    };
    // once, for the document as it is when the organizer opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changed = cards.length > 0 && signature(cards) !== initial;

  // fewer pages than before: cuts past the last page go
  useEffect(() => {
    setCuts((s) => ([...s].some((k) => k >= cards.length) ? new Set([...s].filter((k) => k < cards.length)) : s));
  }, [cards.length]);
  const toggleCut = (k: number) =>
    setCuts((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  // the list as it is right now, for changes made one after another in one event
  const cardsRef = useRef(cards);
  cardsRef.current = cards;

  /** Every change to the list goes through here, for the organizer's own undo. */
  const update = useCallback((next: Card[] | ((c: Card[]) => Card[])) => {
    const cur = cardsRef.current;
    const n = typeof next === 'function' ? next(cur) : next;
    if (n === cur) return;
    cardsRef.current = n;
    setHistory((h) => [...h.slice(-49), cur]);
    setCards(n);
  }, []);

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    cardsRef.current = prev;
    setCards(prev);
    setSelected((s) => new Set([...s].filter((k) => prev.some((c) => c.key === k))));
  };

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const selectedIdx = cards.map((c, i) => (selected.has(c.key) ? i : -1)).filter((i) => i >= 0);
  const insertAt = selectedIdx.length ? selectedIdx[selectedIdx.length - 1] + 1 : cards.length;

  const insertCards = (fresh: Card[]) => {
    const at = insertAt;
    update((c) => [...c.slice(0, at), ...fresh, ...c.slice(at)]);
    setSelected(new Set(fresh.map((c) => c.key)));
    // bring the new pages into view once they are drawn in the grid
    requestAnimationFrame(() => document.querySelector(`[data-key="${fresh[0]?.key}"]`)?.scrollIntoView({ block: 'nearest' }));
  };

  const addSource = async (name: string, bytes: ArrayBuffer) => {
    const src = sourcesRef.current.length;
    const s = await openSource(src, name, bytes);
    if (!alive.current) {
      closeSource(s);
      throw new Error('đã đóng Bộ công cụ');
    }
    sourcesRef.current = [...sourcesRef.current, s];
    setSources(sourcesRef.current);
    return s;
  };

  const addFiles = async (files: File[]) => {
    setError(null);
    const fresh: Card[] = [];
    for (const f of files) {
      setBusy(`Đang đọc “${f.name}”…`);
      try {
        if (f.type && f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) throw new Error('không phải tệp PDF');
        const s = await addSource(f.name, await f.arrayBuffer());
        s.infos.forEach((inf, i) => fresh.push({ key: `k${nextKey++}`, src: s.src, page: i, rotation: inf.rotation, w: inf.w, h: inf.h }));
      } catch (e) {
        if (!alive.current) return;
        setError(`Không thêm được “${f.name}”: ${message(e)}`);
      }
    }
    if (!alive.current) return;
    setBusy(null);
    if (fresh.length) insertCards(fresh);
  };

  const pickFiles = async () => {
    if (platform.pickPdf) {
      try {
        const f = await platform.pickPdf();
        if (f) await addFiles([f]);
      } catch (e) {
        setError(message(e));
      }
    } else fileInput.current?.click();
  };

  const addBlank = () => {
    const before = cards[insertAt - 1] ?? cards[insertAt];
    // as wide and tall as the page before it looks
    const size = before ? (before.rotation % 2 ? { w: before.h, h: before.w } : { w: before.w, h: before.h }) : A4;
    insertCards([{ key: `k${nextKey++}`, src: -1, page: 0, rotation: 0, ...size }]);
  };

  const rotate = (delta: number) => update((c) => c.map((x) => (selected.has(x.key) ? { ...x, rotation: quarter(x.rotation + delta) } : x)));

  const remove = () => {
    if (selectedIdx.length === cards.length) {
      setError('Tài liệu phải còn ít nhất một trang. Hãy bỏ chọn một trang để giữ lại.');
      return;
    }
    update((c) => c.filter((x) => !selected.has(x.key)));
    setSelected(new Set());
  };

  /** The selected pages one place earlier (-1) or later (+1). */
  const step = (dir: -1 | 1) =>
    update((c) => {
      const a = [...c];
      const order = dir < 0 ? a.map((_, i) => i) : a.map((_, i) => a.length - 1 - i);
      let moved = false;
      for (const i of order) {
        const j = i + dir;
        if (j < 0 || j >= a.length || !selected.has(a[i].key) || selected.has(a[j].key)) continue;
        [a[i], a[j]] = [a[j], a[i]];
        moved = true;
      }
      return moved ? a : c;
    });

  /** Dragged pages, in their order, to slot `at` (0…length, counted in the list before the move). */
  const moveTo = (keys: string[], at: number) =>
    update((c) => {
      const moving = c.filter((x) => keys.includes(x.key));
      const before = c.slice(0, at).filter((x) => !keys.includes(x.key));
      const after = c.slice(at).filter((x) => !keys.includes(x.key));
      const next = [...before, ...moving, ...after];
      return next.every((x, i) => x === c[i]) ? c : next;
    });

  const plan = (list: Card[]): PlanPage[] =>
    list.map((c) => ({ src: c.src, page: c.page, rotation: c.rotation, ...(c.src === -1 ? { size: { w: c.w, h: c.h } } : {}) }));
  const extras = () => sourcesRef.current.slice(1).map((s) => s.bytes);

  const apply = async () => {
    if (!base) return;
    if (!changed) return onClose();
    setBusy('Đang áp dụng…');
    setError(null);
    try {
      const { bytes } = await buildPages(base, extras(), plan(cards), 'in-place');
      // show the first page that is not where it was
      const first = cards.findIndex((c, i) => c.key !== `o${i}` || c.rotation !== (initialRotation(initial, i) ?? c.rotation));
      await session.applyPages(bytes, base, cards.map((c) => c.rotation), Math.max(0, first) + 1);
      onClose();
    } catch (e) {
      setBusy(null);
      setError(`Không áp dụng được: ${message(e)}`);
    }
  };

  const build = async (list: Card[], name: string): Promise<OutFile> => {
    const { bytes } = await buildPages(base!, extras(), plan(list), 'new');
    return { name, pages: list.length, bytes };
  };

  const extract = async () => {
    if (!base || !selectedIdx.length) return;
    setBusy('Đang trích trang…');
    setError(null);
    try {
      const list = selectedIdx.map((i) => cards[i]);
      const file = await build(list, partFileName(baseName, pagesLabel(selectedIdx.map((i) => i + 1))));
      setDialog({ kind: 'outputs', title: 'Tệp mới từ các trang đã chọn', files: [file] });
    } catch (e) {
      setError(`Không trích được trang: ${message(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const split = async (parts: Part[]) => {
    if (!base) return;
    setDialog(null);
    setError(null);
    const files: OutFile[] = [];
    try {
      for (const [k, p] of parts.entries()) {
        setBusy(`Đang tạo tệp ${k + 1}/${parts.length}…`);
        files.push(await build(cards.slice(p.from - 1, p.to), partFileName(baseName, partLabel(p))));
      }
      setDialog({ kind: 'outputs', title: `Tách thành ${files.length} tệp`, files });
    } catch (e) {
      setError(`Không tách được tài liệu: ${message(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const leave = () => (changed ? setDialog({ kind: 'leave' }) : onClose());

  // keys of the organizer itself (the document's own shortcuts are off while it is open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // a menu closing on Escape has had it; the scan has its own keys
      if (scanning || e.defaultPrevented) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '');
      if (e.key === 'Escape') {
        e.preventDefault();
        if (busy) return; // applying or reading a file: wait for it
        if (dialog) setDialog(null);
        else if (splitting) setSplitting(false);
        else leave();
        return;
      }
      if (typing || dialog || busy || splitting) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') return void (e.preventDefault(), undo());
      if (mod && e.key.toLowerCase() === 'a') return void (e.preventDefault(), setSelected(new Set(cards.map((c) => c.key))));
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) return void (e.preventDefault(), remove());
      if (e.altKey && e.key === 'ArrowLeft' && selected.size) return void (e.preventDefault(), step(-1));
      if (e.altKey && e.key === 'ArrowRight' && selected.size) return void (e.preventDefault(), step(1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const some = selected.size > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bộ công cụ"
      data-ez-overlay=""
      data-testid="organizer"
      className="fixed inset-0 z-50 flex flex-col bg-background pt-[var(--ez-top-gap,0px)]"
    >
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        data-testid="org-file-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void addFiles(files);
        }}
      />
      <header className="flex h-12 shrink-0 items-center gap-1 border-b bg-background px-2">
        <Button variant="ghost" size="icon-sm" aria-label="Đóng, không áp dụng" onClick={leave} disabled={!!busy} data-testid="org-close">
          <X />
        </Button>
        <ToolboxIcon className="ml-1 size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 pl-1 leading-tight">
          <p className="truncate text-[15px] font-bold">Bộ công cụ</p>
          <p className="truncate text-xs text-muted-foreground tabular-nums" data-testid="org-summary">
            {cards.length} trang{some ? ` · đã chọn ${selected.size}` : ''}
            {changed ? ' · chưa áp dụng' : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={undo} disabled={!history.length || !!busy || splitting} data-testid="org-undo" aria-label="Hoàn tác trong màn này">
          <Undo2 />
          <span className="hidden sm:inline">Hoàn tác</span>
        </Button>
        <Button size="sm" onClick={() => void apply()} disabled={!!busy || !cards.length || splitting} data-testid="org-apply">
          <Check /> Áp dụng
        </Button>
      </header>

      {splitting ? (
        <SplitBar
          total={cards.length}
          cuts={cuts}
          disabled={!!busy}
          onNumbers={() => setDialog({ kind: 'split' })}
          onClear={() => setCuts(new Set())}
          onCreate={() => void split(cutsToParts(cuts, cards.length))}
          onDone={() => setSplitting(false)}
        />
      ) : (
        <div className="flex shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-b bg-background px-2 py-1.5" data-testid="org-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={!!busy || !base} data-testid="org-add">
                <FilePlus2 /> Thêm trang <ChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              <DropdownMenuItem data-testid="org-add-pdf" onSelect={() => void pickFiles()}>
                <FilePlus2 /> Từ tệp PDF khác…
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="org-add-scan" onSelect={() => setScanning(true)}>
                <ScanLine /> Quét hoặc chụp ảnh…
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="org-add-blank" onSelect={addBlank}>
                <SquareDashed /> Trang trắng
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Divider />
          <Action label="Lên trước" icon={<ArrowLeft />} onClick={() => step(-1)} disabled={!some || !!busy} testId="org-left" />
          <Action label="Ra sau" icon={<ArrowRight />} onClick={() => step(1)} disabled={!some || !!busy} testId="org-right" />
          <Action label="Xoay trái" icon={<RotateCcw />} onClick={() => rotate(-1)} disabled={!some || !!busy} testId="org-rotate-left" />
          <Action label="Xoay phải" icon={<RotateCw />} onClick={() => rotate(1)} disabled={!some || !!busy} testId="org-rotate-right" />
          <Action label="Xóa" icon={<Trash2 />} onClick={remove} disabled={!some || !!busy} testId="org-delete" />
          <Divider />
          <Action label="Trích ra tệp mới" icon={<FileOutput />} onClick={() => void extract()} disabled={!some || !!busy} testId="org-extract" />
          <Action
            label="Tách tệp"
            icon={<Scissors />}
            onClick={() => {
              setSelected(new Set());
              setSplitting(true);
            }}
            disabled={cards.length < 2 || !!busy}
            testId="org-split"
          />
          <Divider />
          {selected.size === cards.length && cards.length ? (
            <Action label="Bỏ chọn" icon={<Square />} onClick={() => setSelected(new Set())} disabled={!!busy} testId="org-select-none" />
          ) : (
            <Action label="Chọn tất cả" icon={<CheckSquare />} onClick={() => setSelected(new Set(cards.map((c) => c.key)))} disabled={!!busy || !cards.length} testId="org-select-all" />
          )}
        </div>
      )}

      {error && (
        <div role="alert" data-testid="org-error" className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-900">
          <span className="min-w-0 flex-1">{error}</span>
          <Button size="xs" variant="ghost" onClick={() => setError(null)} data-testid="org-error-close">
            Đóng
          </Button>
        </div>
      )}

      <Grid
        cards={cards}
        sources={sources}
        selected={selected}
        queue={queue}
        onToggle={toggle}
        onMove={moveTo}
        disabled={!!busy}
        split={splitting ? { cuts, onToggle: toggleCut } : undefined}
      />

      <p className="shrink-0 border-t bg-background px-4 py-1.5 text-center text-xs text-muted-foreground" data-testid="org-footer">
        {splitting
          ? 'Bấm cây kéo giữa hai trang để cắt, bấm lần nữa để bỏ vết cắt. Mỗi phần thành một tệp PDF mới; tài liệu đang mở không đổi.'
          : 'Chạm để chọn. Kéo để đổi chỗ (trên điện thoại: giữ một chút rồi kéo). Trang mới được thêm sau trang chọn cuối cùng.'}
      </p>

      {busy && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60" data-testid="org-busy" role="status">
          <div className="flex items-center gap-2 rounded-md bg-background px-4 py-3 text-[13px] shadow-lg">
            <Loader2 className="size-4 animate-spin" /> {busy}
          </div>
        </div>
      )}

      {dialog?.kind === 'split' && (
        <SplitDialog
          total={cards.length}
          cuts={[...cuts].sort((a, b) => a - b)}
          onCancel={() => setDialog(null)}
          onCuts={(c) => {
            setCuts(new Set(c));
            setSplitting(true);
            setDialog(null);
          }}
          onSplit={(parts) => void split(parts)}
        />
      )}
      {dialog?.kind === 'outputs' && (
        <OutputsDialog
          title={dialog.title}
          files={dialog.files}
          onSave={async (i) => {
            const f = dialog.files[i];
            const r = await platform.savePdf(new Uint8Array(f.bytes), f.name);
            if (!r) return false; // the save dialog was cancelled
            setDialog((d) => (d?.kind === 'outputs' ? { ...d, files: d.files.map((x, k) => (k === i ? { ...x, saved: r.name } : x)) } : d));
            return true;
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'leave' && (
        <Modal title="Bỏ các thay đổi?" testId="org-leave">
          <p className="text-[13px] text-muted-foreground">Các thay đổi trong màn này chưa được áp dụng vào tài liệu.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDialog(null)} data-testid="org-leave-stay">
              Ở lại
            </Button>
            <Button variant="destructive" size="sm" onClick={onClose} data-testid="org-leave-discard">
              Bỏ thay đổi
            </Button>
          </div>
        </Modal>
      )}
      {scanning && (
        <ScanDialog
          doneLabel="Thêm các trang này"
          onClose={() => setScanning(false)}
          onDone={async (file) => {
            await addFiles([file]);
            setScanning(false);
            return true;
          }}
        />
      )}
    </div>
  );
}

/** The list's identity: which pages, in which order, turned how. */
function signature(list: Card[]) {
  return list.map((c) => `${c.key}:${c.rotation}`).join(',');
}

function initialRotation(sig: string, i: number) {
  const part = sig.split(',')[i];
  return part ? Number(part.split(':')[1]) : undefined;
}

function Divider() {
  return <span className="mx-0.5 hidden h-5 w-px shrink-0 bg-border sm:block" aria-hidden />;
}

function Action({ label, icon, onClick, disabled, testId }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; testId: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={disabled} data-testid={testId} className="shrink-0 px-2">
      {icon}
      {label}
    </Button>
  );
}

// ---- the grid ------------------------------------------------------------------

interface Drag {
  keys: string[];
  x: number;
  y: number;
  /** insertion slot, 0…length */
  at: number;
}

function Grid(p: {
  cards: Card[];
  sources: SourceDoc[];
  selected: Set<string>;
  queue: ThumbQueue;
  onToggle: (key: string) => void;
  onMove: (keys: string[], at: number) => void;
  disabled: boolean;
  /** "Tách tệp": scissors between the pages instead of selecting and moving */
  split?: { cuts: Set<number>; onToggle: (after: number) => void };
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const pending = useRef<{ key: string; x: number; y: number; id: number; touch: boolean; timer?: number; armed: boolean } | null>(null);
  const suppressClick = useRef(false);
  const scrollVel = useRef(0);

  /** The slot the pointer is over: before the card under it, or after it when past its middle. */
  const slotAt = (x: number, y: number) => {
    const els = Array.from(box.current?.querySelectorAll<HTMLElement>('[data-card-index]') ?? []);
    let best = p.cards.length;
    let bestD = Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const i = Number(el.dataset.cardIndex);
      const cy = r.top + r.height / 2;
      // same row first, then the nearest card
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const d = dy * 4 + dx + Math.abs(y - cy) * 0.01;
      if (d < bestD) {
        bestD = d;
        best = x < r.left + r.width / 2 ? i : i + 1;
      }
    }
    return best;
  };

  /** state for the screen, ref for the pointer handlers (which may run before the next render) */
  const setDragNow = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const lastPointer = useRef({ x: 0, y: 0 });

  const start = (key: string, x: number, y: number) => {
    const keys = p.selected.has(key) ? p.cards.filter((c) => p.selected.has(c.key)).map((c) => c.key) : [key];
    lastPointer.current = { x, y };
    setDragNow({ keys, x, y, at: slotAt(x, y) });
    suppressClick.current = true;
  };

  useEffect(() => {
    if (!drag) return;
    // a finger that holds a page must not scroll the grid
    const stopScroll = (e: TouchEvent) => e.cancelable && e.preventDefault();
    window.addEventListener('touchmove', stopScroll, { passive: false });
    let raf = 0;
    const tick = () => {
      const d = dragRef.current;
      if (scrollVel.current && box.current && d) {
        box.current.scrollTop += scrollVel.current;
        // the grid moved under a still pointer: the slot under it changed
        const { x, y } = lastPointer.current;
        const at = slotAt(x, y);
        if (at !== d.at) setDragNow({ ...d, at });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('touchmove', stopScroll);
      cancelAnimationFrame(raf);
      scrollVel.current = 0;
    };
  }, [!!drag]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (key: string) => (e: React.PointerEvent) => {
    if (p.disabled || p.split || (e.pointerType === 'mouse' && e.button !== 0)) return;
    suppressClick.current = false;
    const touch = e.pointerType !== 'mouse';
    const pd = { key, x: e.clientX, y: e.clientY, id: e.pointerId, touch, armed: !touch, timer: undefined as number | undefined };
    if (touch) {
      // hold to pick a page up; moving first is a scroll
      pd.timer = window.setTimeout(() => {
        if (pending.current !== pd) return;
        pd.armed = true;
        navigator.vibrate?.(15);
        start(key, pd.x, pd.y);
      }, 350);
    }
    pending.current = pd;
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const pd = pending.current;
      if (!pd || e.pointerId !== pd.id) return;
      const d = dragRef.current;
      if (!d) {
        const dist = Math.hypot(e.clientX - pd.x, e.clientY - pd.y);
        if (pd.touch) {
          if (dist > 8) {
            clearTimeout(pd.timer);
            pending.current = null; // a scroll
          }
          return;
        }
        if (dist > 6) start(pd.key, e.clientX, e.clientY);
        return;
      }
      const r = box.current?.getBoundingClientRect();
      scrollVel.current = r ? (e.clientY < r.top + 48 ? -12 : e.clientY > r.bottom - 48 ? 12 : 0) : 0;
      lastPointer.current = { x: e.clientX, y: e.clientY };
      setDragNow({ ...d, x: e.clientX, y: e.clientY, at: slotAt(e.clientX, e.clientY) });
    };
    const up = (e: PointerEvent) => {
      const pd = pending.current;
      if (!pd || e.pointerId !== pd.id) return;
      clearTimeout(pd.timer);
      pending.current = null;
      const d = dragRef.current;
      if (d) {
        setDragNow(null);
        if (e.type === 'pointerup') p.onMove(d.keys, d.at);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  });

  const srcName = (src: number) => p.sources[src]?.name.replace(/\.pdf$/i, '') ?? '';

  return (
    <div ref={box} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-canvas p-3 sm:p-4" data-testid="org-grid">
      <ol
        className={cn(
          'grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-3 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-4',
          // room for the scissors between two pages, and after the last page of a row
          p.split && 'gap-x-10 pr-10 sm:gap-x-10',
        )}
      >
        {p.cards.map((c, i) => (
          <li key={c.key} data-card-index={i} data-key={c.key} className="relative">
            {drag && drag.at === i && <DropMark side="left" />}
            {drag && drag.at === p.cards.length && i === p.cards.length - 1 && <DropMark side="right" />}
            {p.split && <PartLabel index={i} part={partOf(p.split.cuts, i)} />}
            {p.split && i < p.cards.length - 1 && <CutMark after={i + 1} on={p.split.cuts.has(i + 1)} onToggle={p.split.onToggle} />}
            <PageCard
              tint={p.split ? PART_TINTS[partOf(p.split.cuts, i) % PART_TINTS.length].soft : undefined}
              card={c}
              index={i}
              selected={p.selected.has(c.key)}
              dragging={!!drag?.keys.includes(c.key)}
              source={c.src >= 0 ? p.sources[c.src] : undefined}
              origin={c.src > 0 ? `${srcName(c.src)} · tr. ${c.page + 1}` : c.src === -1 ? 'Trang trắng' : c.key !== `o${i}` ? `vốn là tr. ${c.page + 1}` : ''}
              queue={p.queue}
              onPointerDown={onPointerDown(c.key)}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                if (!p.disabled && !p.split) p.onToggle(c.key);
              }}
            />
          </li>
        ))}
      </ol>
      {drag && (
        <div
          className="pointer-events-none fixed z-20 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-lg"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
          data-testid="org-drag-badge"
        >
          {drag.keys.length === 1 ? '1 trang' : `${drag.keys.length} trang`}
        </div>
      )}
    </div>
  );
}

/** Colours of the parts while cutting: a dark pill with white text, and a soft wash behind the page. */
const PART_TINTS = [
  { pill: '#0b6e69', soft: '#e3f3f1' },
  { pill: '#8f5400', soft: '#fcf0db' },
  { pill: '#6741c9', soft: '#efe9fd' },
  { pill: '#b4233a', soft: '#fde8ea' },
  { pill: '#1f6fb2', soft: '#e2f0fb' },
  { pill: '#3f7a1d', soft: '#e9f5e1' },
];

/** Part of page `i` (0-based): how many cuts come before it. */
const partOf = (cuts: Set<number>, i: number) => [...cuts].filter((k) => k <= i).length;

function PartLabel({ index, part }: { index: number; part: number }) {
  const t = PART_TINTS[part % PART_TINTS.length];
  return (
    <span
      data-testid={`org-part-${index}`}
      data-part={part + 1}
      className="mb-1.5 flex h-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
      style={{ background: t.pill }}
    >
      Phần {part + 1}
    </span>
  );
}

/** The scissors between page `after` and the next one: a click sets the cut, another lifts it. */
function CutMark({ after, on, onToggle }: { after: number; on: boolean; onToggle: (after: number) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Bỏ vết cắt sau trang ${after}` : `Cắt sau trang ${after}`}
      title={on ? `Bỏ vết cắt sau trang ${after}` : `Cắt sau trang ${after}`}
      data-testid={`org-cut-${after}`}
      onClick={() => onToggle(after)}
      className="group absolute top-7 bottom-8 left-full z-10 flex w-10 items-center justify-center outline-none"
    >
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-1/2 -translate-x-1/2 border-l-2 border-dashed', on ? 'border-primary' : 'border-muted-foreground/25 group-hover:border-muted-foreground/60')}
      />
      <span
        className={cn(
          'relative flex size-8 items-center justify-center rounded-full border shadow-sm transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring',
          on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background text-muted-foreground group-hover:text-foreground',
        )}
      >
        <Scissors className="size-4" />
      </span>
    </button>
  );
}

function DropMark({ side }: { side: 'left' | 'right' }) {
  return (
    <span
      aria-hidden
      data-testid="org-drop-mark"
      className={cn('absolute top-0 bottom-6 z-10 w-1 rounded-full bg-primary', side === 'left' ? '-left-2' : '-right-2')}
    />
  );
}

function PageCard(p: {
  card: Card;
  index: number;
  /** while cutting: the part's colour behind the page */
  tint?: string;
  selected: boolean;
  dragging: boolean;
  source?: SourceDoc;
  origin: string;
  queue: ThumbQueue;
  onPointerDown: (e: React.PointerEvent) => void;
  onClick: () => void;
}) {
  const c = p.card;
  const odd = c.rotation % 2 === 1;
  // as the page will look: turned
  const dw = odd ? c.h : c.w;
  const dh = odd ? c.w : c.h;
  const { ref, url } = useThumb(p.queue, `${c.src}:${c.page}`, c.src >= 0 ? (p.source?.session ?? null) : null, c.page, { w: c.w, h: c.h });
  return (
    <div className={cn('flex flex-col items-center gap-1.5', p.dragging && 'opacity-40')}>
      <button
        type="button"
        aria-pressed={p.selected}
        aria-label={`Trang ${p.index + 1}${p.origin ? `, ${p.origin}` : ''}`}
        data-testid={`org-card-${p.index}`}
        data-src={c.src}
        data-page={c.page}
        data-rotation={c.rotation}
        onPointerDown={p.onPointerDown}
        onClick={p.onClick}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          'relative flex w-full touch-pan-y items-center justify-center rounded-md p-1.5 outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-2 focus-visible:ring-ring',
          p.tint ? 'cursor-default' : p.selected ? 'bg-primary-soft ring-2 ring-primary' : 'hover:bg-black/5',
        )}
        style={p.tint ? { background: p.tint } : undefined}
      >
        <div
          ref={ref}
          className="relative w-full overflow-hidden bg-white shadow-[0_1px_3px_rgba(0,0,0,0.18)]"
          style={{ aspectRatio: `${dw} / ${dh}`, maxHeight: 220 }}
        >
          {url ? (
            <img
              src={url}
              alt=""
              draggable={false}
              className="absolute top-1/2 left-1/2 max-w-none"
              style={{
                width: odd ? `${(dh / dw) * 100}%` : '100%',
                height: odd ? `${(dw / dh) * 100}%` : '100%',
                transform: `translate(-50%, -50%) rotate(${c.rotation * 90}deg)`,
              }}
            />
          ) : c.src === -1 ? null : (
            <Loader2 className="absolute inset-0 m-auto size-4 animate-spin text-muted-foreground/60" />
          )}
        </div>
        {p.selected && (
          <span className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
            <Check className="size-3.5" />
          </span>
        )}
      </button>
      <span className="flex max-w-full flex-col items-center leading-tight">
        <span className="text-[13px] font-medium tabular-nums">{p.index + 1}</span>
        {p.origin && <span className="max-w-full truncate text-[11px] text-muted-foreground">{p.origin}</span>}
      </span>
    </div>
  );
}

// ---- dialogs -----------------------------------------------------------------

function Modal({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-4" data-testid={testId}>
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-lg bg-background p-5 shadow-xl" role="dialog" aria-modal="true" aria-label={title}>
        <p className="mb-2 font-bold">{title}</p>
        {children}
      </div>
    </div>
  );
}

/** "trang 1–3 · 4–7 · 8–12": the parts in a short line. */
function partsLine(parts: Part[], max = 6) {
  const shown = parts.slice(0, max).map((p, i) => (i ? (p.from === p.to ? `${p.from}` : `${p.from}–${p.to}`) : partLabel(p)));
  return shown.join(' · ') + (parts.length > max ? ' · …' : '');
}

/** While cutting, in place of the actions: what the cuts make, typing them instead, and making the files. */
function SplitBar(p: {
  total: number;
  cuts: Set<number>;
  disabled: boolean;
  onNumbers: () => void;
  onClear: () => void;
  onCreate: () => void;
  onDone: () => void;
}) {
  const n = p.cuts.size;
  const parts = cutsToParts(p.cuts, p.total);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b bg-background px-3 py-1.5" data-testid="split-bar">
      <p className="flex min-w-0 flex-1 basis-72 items-center gap-2 text-[13px]">
        <Scissors className="size-4 shrink-0 text-primary" aria-hidden />
        <span className="shrink-0 font-bold">Tách tệp</span>
        <span className="min-w-0 truncate text-muted-foreground tabular-nums" data-testid="split-summary" data-cuts={[...p.cuts].sort((a, b) => a - b).join(',')}>
          {n ? `${n} vết cắt → ${n + 1} tệp: ${partsLine(parts)}` : 'Bấm cây kéo giữa hai trang để đặt vết cắt.'}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-1 max-sm:w-full max-sm:justify-end">
        <Button variant="ghost" size="sm" onClick={p.onNumbers} disabled={p.disabled} data-testid="split-numbers" className="px-2" aria-label="Nhập số trang để cắt">
          <Hash /> <span className="sm:hidden">Nhập số</span>
          <span className="max-sm:hidden">Nhập số trang…</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={p.onClear} disabled={!n || p.disabled} data-testid="split-clear" className="px-2" aria-label="Bỏ hết vết cắt">
          <span className="sm:hidden">Bỏ hết</span>
          <span className="max-sm:hidden">Bỏ hết vết cắt</span>
        </Button>
        <Button variant="outline" size="sm" onClick={p.onDone} disabled={p.disabled} data-testid="split-exit">
          Xong
        </Button>
        <Button size="sm" onClick={p.onCreate} disabled={!n || p.disabled} data-testid="split-create">
          <Scissors /> {n ? `Tạo ${n + 1} tệp` : 'Tạo tệp'}
        </Button>
      </div>
    </div>
  );
}

/**
 * The cuts by number, for long documents: every n pages, after given pages,
 * or by page ranges. Parts that cover every page become cuts on the grid
 * (to see before making the files); ranges that leave pages out make their
 * files directly.
 */
function SplitDialog({
  total,
  cuts,
  onCancel,
  onCuts,
  onSplit,
}: {
  total: number;
  cuts: number[];
  onCancel: () => void;
  onCuts: (cuts: number[]) => void;
  onSplit: (parts: Part[]) => void;
}) {
  const [mode, setMode] = useState<'every' | 'cuts' | 'ranges'>(cuts.length ? 'cuts' : 'every');
  const [n, setN] = useState(String(Math.min(total - 1, Math.max(1, Math.ceil(total / 2)))));
  const [cutText, setCutText] = useState(cuts.join(', '));
  const [ranges, setRanges] = useState('');
  let result: RangeResult;
  if (mode === 'every') result = { ok: true, parts: everyN(parseInt(n, 10) || 0, total) };
  else if (mode === 'cuts') {
    const c = parseCuts(cutText, total);
    result = c.ok ? { ok: true, parts: cutsToParts(c.cuts, total) } : c;
  } else result = parseRanges(ranges, total);
  const valid = result.ok && (mode !== 'every' || (parseInt(n, 10) || 0) >= 1);
  const parts = result.ok ? result.parts : [];
  const asCuts = valid ? partsToCuts(parts, total) : null;
  const ready = valid && (asCuts ? asCuts.length > 0 : parts.length > 0);
  return (
    <Modal title="Cắt theo số trang" testId="org-split-dialog">
      <p className="text-[13px] text-muted-foreground">
        Tài liệu có {total} trang, theo thứ tự đang thấy. Các vết cắt hiện ra giữa các trang để bạn xem lại trước khi tạo tệp. Tài liệu đang mở không thay đổi.
      </p>
      <fieldset className="mt-3 space-y-3 text-[13px]">
        <label className="flex items-center gap-2">
          <input type="radio" name="split" checked={mode === 'every'} onChange={() => setMode('every')} data-testid="split-mode-every" />
          Mỗi tệp
          <input
            inputMode="numeric"
            value={n}
            onChange={(e) => setN(e.target.value.replace(/\D/g, ''))}
            onFocus={() => setMode('every')}
            data-testid="split-every"
            aria-label="Số trang mỗi tệp"
            className="h-8 w-14 rounded-md border bg-white text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          trang
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <input type="radio" name="split" checked={mode === 'cuts'} onChange={() => setMode('cuts')} data-testid="split-mode-cuts" />
          Cắt sau trang
          <input
            inputMode="numeric"
            value={cutText}
            placeholder="ví dụ 3, 7"
            onChange={(e) => setCutText(e.target.value)}
            onFocus={() => setMode('cuts')}
            data-testid="split-cuts"
            aria-label="Cắt sau các trang"
            className="h-8 min-w-0 flex-1 rounded-md border bg-white px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="flex flex-wrap items-center gap-2">
          <input type="radio" name="split" checked={mode === 'ranges'} onChange={() => setMode('ranges')} data-testid="split-mode-ranges" />
          Theo khoảng trang
          <input
            value={ranges}
            placeholder="ví dụ 1-3, 4-6, 7-"
            onChange={(e) => setRanges(e.target.value)}
            onFocus={() => setMode('ranges')}
            data-testid="split-ranges"
            aria-label="Các khoảng trang"
            className="h-8 min-w-0 flex-1 rounded-md border bg-white px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </fieldset>
      <p className={cn('mt-3 text-[13px]', valid ? 'text-foreground' : 'text-destructive')} data-testid="split-preview">
        {!result.ok
          ? result.error
          : !valid
            ? 'Hãy ghi số trang mỗi tệp.'
            : asCuts
              ? asCuts.length
                ? `${asCuts.length} vết cắt, ${parts.length} tệp: ${parts.map(partLabel).join('; ')}.`
                : 'Cả tài liệu là một phần: chưa có vết cắt nào.'
              : `Sẽ tạo ${parts.length} tệp: ${parts.map(partLabel).join('; ')}. Các trang khác không vào tệp nào.`}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} data-testid="split-cancel">
          Hủy
        </Button>
        <Button size="sm" disabled={!ready} onClick={() => (asCuts ? onCuts(asCuts) : onSplit(parts))} data-testid="split-go">
          <Scissors /> {asCuts ? `Đặt ${asCuts.length} vết cắt` : `Tạo ${parts.length} tệp`}
        </Button>
      </div>
    </Modal>
  );
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function OutputsDialog({
  title,
  files,
  onSave,
  onClose,
}: {
  title: string;
  files: OutFile[];
  onSave: (i: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const [working, setWorking] = useState<number | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (i: number) => {
    setWorking(i);
    setError(null);
    try {
      await onSave(i);
    } catch (e) {
      setError(`Không lưu được: ${message(e)}`);
    } finally {
      setWorking(null);
    }
  };
  const saveAll = async () => {
    setWorking('all');
    setError(null);
    try {
      for (let i = 0; i < files.length; i++) {
        if (files[i].saved) continue;
        if (!(await onSave(i))) break; // a save dialog was cancelled: stop there
      }
    } catch (e) {
      setError(`Không lưu được: ${message(e)}`);
    } finally {
      setWorking(null);
    }
  };
  const allSaved = files.every((f) => f.saved);
  return (
    <Modal title={title} testId="org-outputs">
      <ul className="divide-y rounded-md border" data-testid="org-output-list">
        {files.map((f, i) => (
          <li key={f.name} className="flex items-center gap-2 px-3 py-2" data-testid={`org-output-${i}`}>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-medium" title={f.name}>
                {f.name}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {f.pages} trang · {kb(f.bytes.byteLength)}
                {f.saved && <span className="text-success"> · đã lưu</span>}
              </p>
            </div>
            <Button size="sm" variant={f.saved ? 'ghost' : 'outline'} onClick={() => void save(i)} disabled={working !== null} data-testid={`org-output-save-${i}`}>
              {working === i ? <Loader2 className="animate-spin" /> : f.saved ? <Check /> : null}
              {f.saved ? 'Lưu lại' : 'Lưu'}
            </Button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="mt-2 text-[13px] text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={working !== null} data-testid="org-outputs-close">
          {allSaved ? 'Xong' : 'Đóng'}
        </Button>
        {files.length > 1 && !allSaved && (
          <Button size="sm" onClick={() => void saveAll()} disabled={working !== null} data-testid="org-outputs-save-all">
            {working === 'all' && <Loader2 className="animate-spin" />}
            Lưu tất cả
          </Button>
        )}
      </div>
    </Modal>
  );
}
