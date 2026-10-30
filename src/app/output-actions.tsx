import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ClipboardCopy, FolderSearch, LayoutGrid, Loader2, MoreVertical, Printer, Share2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePlatform } from '@/platform';
import type { ShareWay } from '@/platform/types';
import { IconAction, Tip } from './controls';
import type { DocumentSession } from './use-document-session';
import { clearPrintJob, printPdfPages, type PrintProgress } from './print/print-pages';

/**
 * Sharing and printing the open document. Both use the finished PDF, the
 * same file "Xuất PDF" writes (session.buildOutput), so what another person
 * receives or what comes out of the printer is exactly what an export gives.
 * Nothing leaves the device unless the user presses one of these.
 */

export interface Notice {
  tone: 'info' | 'error';
  text: string;
  action?: { label: string; run: () => void };
}

interface OutputApi {
  busy: null | 'share' | 'print';
  shareWays: readonly ShareWay[];
  share(way: ShareWay): Promise<void>;
  print(): Promise<void>;
  printProgress: PrintProgress | null;
  cancelPrint(): void;
  notice: Notice | null;
  dismissNotice(): void;
}

const OutputContext = createContext<OutputApi | null>(null);
export const useOutput = () => useContext(OutputContext);

const message = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : String(e));
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

export function OutputProvider({ session, children }: { session: DocumentSession; children: ReactNode }) {
  const platform = usePlatform();
  const [busy, setBusy] = useState<OutputApi['busy']>(null);
  const [printProgress, setPrintProgress] = useState<PrintProgress | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** synchronous guard: two clicks before React re-renders start one job */
  const running = useRef(false);
  /** false once this document is gone (closed, another opened, reopened after a text edit) */
  const alive = useRef(true);
  const { buildOutput, docEpoch } = session;

  // an information line goes away by itself; an error stays until closed
  useEffect(() => {
    if (notice?.tone !== 'info' || notice.action) return;
    const t = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(t);
  }, [notice]);

  // another document: nothing pending belongs to it. The provider also goes
  // away with its document; a job still being prepared must not print or
  // share the document the user has left.
  useEffect(() => {
    setNotice(null);
    abort.current?.abort();
    clearPrintJob();
  }, [docEpoch]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
      clearPrintJob();
    };
  }, []);

  const share = useCallback(
    async (way: ShareWay) => {
      if (running.current) return;
      running.current = true;
      setBusy('share');
      setNotice(null);
      let bytes: Uint8Array | null = null;
      let name = '';
      try {
        const out = await buildOutput();
        if (!alive.current) return;
        bytes = new Uint8Array(out.bytes);
        name = `${out.base}.pdf`;
        const r = await platform.sharePdf(bytes, name, way);
        if (!alive.current) return;
        if (r === 'copied')
          setNotice({ tone: 'info', text: `Đã chép “${name}”. Mở Zalo, Telegram hay thư điện tử, chọn người nhận rồi bấm Ctrl V để gửi.` });
        else if (r === 'downloaded')
          setNotice({ tone: 'info', text: `Đã tải “${name}” về máy. Trình duyệt này chưa chia sẻ thẳng được: hãy kéo tệp vào Zalo, Telegram hay thư để gửi.` });
      } catch (e) {
        // a browser lets a page share only right after a tap; preparing a big file can take longer
        if (bytes && way === 'sheet' && e instanceof DOMException && e.name === 'NotAllowedError') {
          const ready = bytes;
          const file = name;
          setNotice({
            tone: 'info',
            text: `“${file}” đã sẵn sàng.`,
            action: {
              label: 'Chia sẻ',
              run: () => {
                setNotice(null);
                platform.sharePdf(ready, file, 'sheet').catch((err) => setNotice({ tone: 'error', text: `Không chia sẻ được: ${message(err)}` }));
              },
            },
          });
        } else if (alive.current) {
          setNotice({ tone: 'error', text: `Không chia sẻ được: ${message(e)}` });
        }
      } finally {
        running.current = false;
        setBusy(null);
      }
    },
    [buildOutput, platform],
  );

  const print = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy('print');
    setNotice(null);
    const ctl = new AbortController();
    abort.current = ctl;
    let ready: { bytes: Uint8Array; name: string; pages: number } | null = null;
    try {
      const out = await buildOutput();
      if (ctl.signal.aborted || !alive.current) return;
      if (platform.printPdf) {
        ready = { bytes: new Uint8Array(out.bytes), name: `${out.base}.pdf`, pages: out.pages };
        if (platform.printHint) setNotice({ tone: 'info', text: platform.printHint });
        await platform.printPdf(ready.bytes, ready.name, ready.pages);
        return;
      }
      setPrintProgress({ done: 0, total: out.pages });
      await printPdfPages(out.bytes, { title: out.base, signal: ctl.signal, onProgress: setPrintProgress });
    } catch (e) {
      // the share sheet (iPhone) opens only right after a tap; preparing a big file can take longer
      if (ready && platform.printPdf && e instanceof DOMException && e.name === 'NotAllowedError' && alive.current) {
        const job = ready;
        const printPdf = platform.printPdf;
        const hint = platform.printHint;
        setNotice({
          tone: 'info',
          text: `“${job.name}” đã sẵn sàng để in.`,
          action: {
            label: 'In',
            run: () => {
              setNotice(hint ? { tone: 'info', text: hint } : null);
              printPdf(job.bytes, job.name, job.pages).catch((err) => setNotice({ tone: 'error', text: `Không in được: ${message(err)}` }));
            },
          },
        });
      } else if (!isAbort(e) && alive.current) setNotice({ tone: 'error', text: `Không in được: ${message(e)}` });
    } finally {
      if (abort.current === ctl) abort.current = null;
      running.current = false;
      setPrintProgress(null);
      setBusy(null);
    }
  }, [buildOutput, platform]);

  const api = useMemo<OutputApi>(
    () => ({
      busy,
      shareWays: platform.shareWays,
      share,
      print,
      printProgress,
      cancelPrint: () => abort.current?.abort(),
      notice,
      dismissNotice: () => setNotice(null),
    }),
    [busy, platform.shareWays, share, print, printProgress, notice],
  );
  return <OutputContext.Provider value={api}>{children}</OutputContext.Provider>;
}

const WAYS: Record<ShareWay, { label: string; detail: string; icon: typeof Share2 }> = {
  copy: {
    label: 'Chép tệp để dán vào Zalo, Telegram, thư',
    detail: 'Rồi bấm Ctrl V trong khung chat hay thư',
    icon: ClipboardCopy,
  },
  sheet: { label: 'Chia sẻ bằng Windows…', detail: 'Outlook, Chia sẻ lân cận, ứng dụng khác', icon: Share2 },
  reveal: { label: 'Hiện tệp trong thư mục', detail: 'Kéo tệp vào trình duyệt hay ứng dụng', icon: FolderSearch },
  download: { label: 'Tải về để gửi', detail: '', icon: Share2 },
};

const SHARE_LABEL = 'Chia sẻ tệp (Zalo, Telegram, thư…)';

/** One button where the platform has one way (phone, browser), a menu on the desktop. */
export function ShareButton() {
  const out = useOutput();
  if (!out || !out.shareWays.length) return null;
  const working = out.busy === 'share';
  const icon = working ? <Loader2 className="animate-spin" /> : <Share2 />;
  if (out.shareWays.length === 1) {
    const way = out.shareWays[0];
    return (
      <IconAction
        label={way === 'download' ? 'Tải tệp về để gửi đi' : SHARE_LABEL}
        onClick={() => void out.share(way)}
        disabled={!!out.busy}
        testId="btn-share"
      >
        {icon}
      </IconAction>
    );
  }
  return (
    <DropdownMenu>
      <Tip label={SHARE_LABEL}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={SHARE_LABEL}
            data-testid="btn-share"
            disabled={!!out.busy}
            className="text-foreground/80 hover:text-foreground"
          >
            {icon}
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-72">
        {out.shareWays.map((w) => {
          const d = WAYS[w];
          return (
            <DropdownMenuItem key={w} data-testid={`share-${w}`} onSelect={() => void out.share(w)} className="items-start py-2">
              <d.icon className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span>{d.label}</span>
                {d.detail && <span className="text-xs text-muted-foreground">{d.detail}</span>}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PrintButton() {
  const out = useOutput();
  if (!out) return null;
  return (
    <IconAction label="In tài liệu" shortcut="Ctrl P" onClick={() => void out.print()} disabled={!!out.busy} testId="btn-print">
      {out.busy === 'print' ? <Loader2 className="animate-spin" /> : <Printer />}
    </IconAction>
  );
}

/** Phone top bar: printing and closing share one menu, so the bar keeps its width. */
export function MoreMenu({ onClose, onPages }: { onClose: () => void; onPages: () => void }) {
  const out = useOutput();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Thêm" data-testid="btn-more" className="text-foreground/80 hover:text-foreground">
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem data-testid="btn-pages" onSelect={onPages}>
          <LayoutGrid /> Sắp xếp trang
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="btn-print" disabled={!!out?.busy} onSelect={() => void out?.print()}>
          <Printer /> In tài liệu
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="btn-close-doc" onSelect={onClose}>
          <X /> Đóng tài liệu
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** While pages are being drawn for the printer (browser, desktop). */
export function PrintProgressOverlay() {
  const out = useOutput();
  const p = out?.printProgress;
  if (!p) return null;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      data-testid="print-progress"
      role="dialog"
      aria-modal="true"
      aria-label="Chuẩn bị bản in"
      onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), out.cancelPrint())}
    >
      <div className="w-full max-w-sm rounded-lg bg-background p-5 shadow-xl">
        <p className="font-bold">Đang chuẩn bị bản in…</p>
        <p className="mt-1 text-[13px] text-muted-foreground tabular-nums" data-testid="print-progress-text">
          Trang {p.done}/{p.total}. Xong sẽ mở hộp thoại in để chọn máy in.
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-4 flex justify-end">
          {/* focus here: Esc or Enter cancels, keys do not reach the page behind */}
          <Button variant="outline" size="sm" onClick={out.cancelPrint} data-testid="print-cancel" autoFocus>
            Hủy
          </Button>
        </div>
      </div>
    </div>
  );
}
