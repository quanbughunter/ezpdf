/**
 * The "Xuất thành ảnh" dialog: format, pages, resolution, quality, grey;
 * then the pictures made one by one with a progress bar; then where they
 * went (the folder, with "Mở thư mục", on the desktop; the phone's pictures
 * on Android; in the browser a share button, the iPhone's way to keep them
 * in Photos, and a download).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, FolderOpen, ImageDown, Loader2, Share2 } from 'lucide-react';
import { useDocumentState } from '@embedpdf/core/react';
import { useScroll } from '@embedpdf/plugin-scroll/react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePlatform } from '@/platform';
import type { ImagesSaved } from '@/platform/types';
import { downloadPdf } from '@/platform/web';
import { cn } from '@/lib/utils';
import { parseRanges } from '../pages/ranges';
import type { DocumentSession } from '../use-document-session';
import { useOutput } from '../output-actions';
import { convertPages, dpiFor, DPI_HINT, DPIS, FORMATS, pixelSize, safeBase, type ConvertProgress, type ImageFormat } from './to-images';

type PageChoice = 'all' | 'current' | 'list';

type Phase =
  | { kind: 'options' }
  | { kind: 'working'; progress: ConvertProgress; picking?: boolean }
  | { kind: 'done'; saved: ImagesSaved; count: number; lowered: number[]; format: ImageFormat }
  | { kind: 'error'; message: string };

/** Can this browser's canvas write WebP? (Safari cannot: it would hand back PNG.) */
function canWebp() {
  try {
    return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

function canShareFiles(files: File[]) {
  try {
    return typeof navigator.share === 'function' && !!navigator.canShare?.({ files });
  } catch {
    return false;
  }
}

export function ImagesDialog({
  documentId,
  session,
  open,
  onOpenChange,
}: {
  documentId: string;
  session: DocumentSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const platform = usePlatform();
  const doc = useDocumentState(documentId)?.document;
  const { state: scroll } = useScroll(documentId);
  const total = doc?.pageCount || scroll.totalPages || 0;
  const current = Math.min(Math.max(1, scroll.currentPage || 1), Math.max(1, total));
  const webp = useMemo(canWebp, []);
  const [format, setFormat] = useState<ImageFormat>('png');
  const [choice, setChoice] = useState<PageChoice>('all');
  const [list, setList] = useState('');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(90);
  const [gray, setGray] = useState(false);
  const [oneTiff, setOneTiff] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: 'options' });
  const abort = useRef<AbortController | null>(null);
  const working = phase.kind === 'working';

  // closed, or the document gone: a job still running stops; the next opening starts from the options
  useEffect(() => {
    if (!open) {
      abort.current?.abort();
      setPhase({ kind: 'options' });
    }
  }, [open]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    abort.current?.abort();
    onOpenChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.docEpoch]);

  const parsed = choice === 'list' ? parseRanges(list, total) : null;
  const pages: number[] =
    choice === 'all'
      ? Array.from({ length: total }, (_, i) => i)
      : choice === 'current'
        ? [current - 1]
        : parsed?.ok
          ? parsed.parts.flatMap((p) => Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from - 1 + i))
          : [];
  const valid = total > 0 && pages.length > 0;
  const one = format === 'tiff' && oneTiff && pages.length > 1;
  const files = one ? 1 : pages.length;

  // the first chosen page's size, as an idea of how big the pictures are
  const first = pages[0] ?? current - 1;
  const p = doc?.pages[first];
  const size = p ? (p.rotation % 2 ? { w: p.size.height, h: p.size.width } : { w: p.size.width, h: p.size.height }) : null;
  const px = size ? pixelSize(size, dpiFor(size, dpi)) : null;

  const start = async () => {
    if (!valid || working) return;
    const ctl = new AbortController();
    abort.current = ctl;
    // on the desktop the system's folder dialog comes first
    setPhase({ kind: 'working', progress: { done: 0, total: pages.length }, picking: platform.kind === 'desktop' });
    try {
      // the desktop asks for the folder first: nothing is drawn for a cancelled dialog
      const sink = await platform.openImageSink({ tiff: format === 'tiff' });
      if (!sink) {
        setPhase({ kind: 'options' });
        return;
      }
      if (ctl.signal.aborted) return void (await sink.abort());
      setPhase({ kind: 'working', progress: { done: 0, total: pages.length } });
      const out = await session.buildOutput();
      if (ctl.signal.aborted) return void (await sink.abort());
      const r = await convertPages(
        out.bytes,
        { format, dpi, quality: quality / 100, gray, oneTiff, pages, base: out.base },
        sink,
        { signal: ctl.signal, onProgress: (progress) => !ctl.signal.aborted && setPhase({ kind: 'working', progress }) },
      );
      const saved = await sink.finish();
      if (ctl.signal.aborted) return;
      setPhase({ kind: 'done', saved, count: one ? 1 : pages.length, lowered: r.lowered, format });
    } catch (e) {
      if (ctl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (abort.current === ctl) abort.current = null;
    }
  };

  const stop = () => {
    abort.current?.abort();
    setPhase({ kind: 'options' });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : (stop(), onOpenChange(false)))}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[460px]"
        data-testid="images-dialog"
        closeTestId="images-close"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Xuất thành ảnh</DialogTitle>
          <DialogDescription>
            Mỗi trang thành một ảnh, đúng như đang thấy: chữ đã thêm, tô sáng, chữ ký, phần đã sửa. Ảnh được tạo ngay trên máy này.
          </DialogDescription>
        </DialogHeader>

        {phase.kind === 'options' || phase.kind === 'error' ? (
          <div className="space-y-4 text-[13px]">
            <fieldset>
              <legend className="mb-1.5 font-bold">Định dạng</legend>
              <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Định dạng ảnh">
                {(Object.keys(FORMATS) as ImageFormat[])
                  .filter((k) => k !== 'webp' || webp)
                  .map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={format === k}
                      data-testid={`images-format-${k}`}
                      onClick={() => setFormat(k)}
                      className={cn(
                        'h-8 rounded-md text-[13px] font-bold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        format === k ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {FORMATS[k].label}
                    </button>
                  ))}
              </div>
              <p className="mt-1.5 text-muted-foreground">{FORMATS[format].hint}</p>
            </fieldset>

            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 font-bold">Trang</legend>
              <label className="flex items-center gap-2">
                <input type="radio" className="accent-primary" name="images-pages" checked={choice === 'all'} onChange={() => setChoice('all')} data-testid="images-pages-all" />
                Tất cả ({total} trang)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" className="accent-primary" name="images-pages" checked={choice === 'current'} onChange={() => setChoice('current')} data-testid="images-pages-current" />
                Trang đang xem (trang {current})
              </label>
              <label className="flex flex-wrap items-center gap-2">
                <input type="radio" className="accent-primary" name="images-pages" checked={choice === 'list'} onChange={() => setChoice('list')} data-testid="images-pages-list" />
                Các trang
                <input
                  value={list}
                  placeholder="ví dụ 1-3, 5"
                  onChange={(e) => setList(e.target.value)}
                  onFocus={() => setChoice('list')}
                  data-testid="images-pages-text"
                  aria-label="Các trang cần xuất"
                  className="h-8 min-w-0 flex-1 rounded-md border bg-white px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              {parsed && !parsed.ok && list.trim() && (
                <p className="text-destructive" data-testid="images-pages-error">
                  {parsed.error}
                </p>
              )}
            </fieldset>

            <label className="block">
              <span className="mb-1.5 block font-bold">Độ phân giải</span>
              <select
                value={dpi}
                onChange={(e) => setDpi(Number(e.target.value))}
                data-testid="images-dpi"
                className="h-9 w-full rounded-md border bg-white px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {DPIS.map((d) => (
                  <option key={d} value={d}>
                    {d} dpi: {DPI_HINT[d]}
                  </option>
                ))}
              </select>
              {px && (
                <span className="mt-1.5 block text-muted-foreground tabular-nums" data-testid="images-size">
                  Trang {first + 1}: {px.w} × {px.h} điểm ảnh
                  {size && dpiFor(size, dpi) < dpi ? ` (khổ lớn: ${dpiFor(size, dpi)} dpi)` : ''}
                </span>
              )}
            </label>

            {(format === 'jpeg' || format === 'webp') && (
              <label className="block">
                <span className="mb-1.5 flex justify-between font-bold">
                  Chất lượng <span className="font-normal tabular-nums" data-testid="images-quality-value">{quality}</span>
                </span>
                <input
                  type="range"
                  min={50}
                  max={100}
                  step={5}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                  data-testid="images-quality"
                  className="w-full accent-primary"
                />
                <span className="flex justify-between text-xs text-muted-foreground">
                  <span>nhẹ hơn</span>
                  <span>nét hơn</span>
                </span>
              </label>
            )}

            <div className="space-y-1.5">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-primary" checked={gray} onChange={(e) => setGray(e.target.checked)} data-testid="images-gray" />
                Ảnh xám (bỏ màu, tệp nhẹ hơn)
              </label>
              {format === 'tiff' && pages.length > 1 && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" className="accent-primary" checked={oneTiff} onChange={(e) => setOneTiff(e.target.checked)} data-testid="images-one-tiff" />
                  Gộp {pages.length} trang vào một tệp TIFF
                </label>
              )}
            </div>

            <p className="text-muted-foreground" data-testid="images-where">
              {platform.kind === 'desktop'
                ? 'Bấm Xuất rồi chọn thư mục để lưu. Không ghi đè tệp đã có.'
                : platform.kind === 'android'
                  ? format === 'tiff'
                    ? 'Ảnh TIFF được lưu vào Tải xuống › ezPDF.'
                    : 'Ảnh được lưu vào Ảnh › ezPDF, xem được ngay trong Thư viện.'
                  : 'Xong sẽ có nút để lưu vào Ảnh hoặc gửi đi (điện thoại), và nút tải về.'}
            </p>

            {phase.kind === 'error' && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-900" data-testid="images-error">
                Không xuất được ảnh: {phase.message}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} data-testid="images-cancel">
                Hủy
              </Button>
              <Button size="sm" disabled={!valid} onClick={() => void start()} data-testid="images-go">
                <ImageDown /> Xuất {files} ảnh {FORMATS[format].label}
              </Button>
            </div>
          </div>
        ) : phase.kind === 'working' ? (
          <div className="space-y-3 text-[13px]" data-testid="images-working" role="status">
            <p className="flex items-center gap-2 font-bold">
              <Loader2 className="size-4 animate-spin" /> {phase.picking ? 'Chọn thư mục để lưu ảnh…' : 'Đang tạo ảnh…'}
            </p>
            <p className="text-muted-foreground tabular-nums" data-testid="images-progress">
              {phase.picking
                ? 'Ảnh được tạo sau khi chọn thư mục trong hộp thoại vừa mở.'
                : phase.progress.total
                  ? `Trang ${phase.progress.done}/${phase.progress.total}`
                  : 'Chuẩn bị tài liệu'}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${phase.progress.total ? Math.round((phase.progress.done / phase.progress.total) * 100) : 0}%` }}
              />
            </div>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={stop} data-testid="images-stop">
                Dừng
              </Button>
            </div>
          </div>
        ) : (
          <Done phase={phase} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Done({ phase, onClose }: { phase: Extract<Phase, { kind: 'done' }>; onClose: () => void }) {
  const platform = usePlatform();
  const [note, setNote] = useState<string | null>(null);
  const { saved, count, lowered } = phase;
  const what = `${count} ảnh ${FORMATS[phase.format].label}`;
  const reveal = platform.revealFile;
  const shareable = saved.how === 'held' && canShareFiles(saved.files);

  const download = () => {
    if (saved.how !== 'held') return;
    if (saved.files.length === 1) {
      void saved.files[0].arrayBuffer().then((b) => downloadPdf(new Uint8Array(b), saved.files[0].name, saved.files[0].type));
      return;
    }
    // several pictures: one .zip, stored as they are (pictures are already compressed)
    void (async () => {
      const { zipSync } = await import('fflate');
      const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
      for (const f of saved.files) entries[f.name] = [new Uint8Array(await f.arrayBuffer()), { level: 0 }];
      const zip = zipSync(entries);
      const base = safeBase(saved.files[0].name.replace(/ - trang \d+\.\w+$/, ''));
      downloadPdf(zip, `${base} (ảnh ${FORMATS[phase.format].label}).zip`, 'application/zip');
    })().catch((e) => setNote(`Không tải về được: ${e instanceof Error ? e.message : String(e)}`));
  };

  const share = async () => {
    if (saved.how !== 'held') return;
    try {
      await navigator.share({ files: saved.files });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setNote(`Không chia sẻ được: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="space-y-3 text-[13px]" data-testid="images-done">
      <p className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
        <span data-testid="images-done-text" className="[overflow-wrap:anywhere]">
          {saved.how === 'folder'
            ? `Đã lưu ${what} vào ${saved.folder}`
            : saved.how === 'gallery'
              ? `Đã lưu ${what} vào ${saved.place}.`
              : `${what} đã sẵn sàng.${shareable ? ' Trên iPhone, chọn “Lưu hình ảnh” để đưa vào app Ảnh.' : ''}`}
        </span>
      </p>
      {saved.how !== 'held' && (
        <ul className="max-h-28 overflow-y-auto rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="images-names">
          {(saved.how === 'folder' ? saved.paths.map((p) => p.split(/[\\/]/).pop() ?? p) : saved.names).map((n) => (
            <li key={n} className="truncate">
              {n}
            </li>
          ))}
        </ul>
      )}
      {lowered.length > 0 && (
        <p className="text-muted-foreground">
          Trang {lowered.slice(0, 6).join(', ')}
          {lowered.length > 6 ? '…' : ''} có khổ giấy lớn nên được tạo ở độ phân giải thấp hơn, để máy không hết bộ nhớ.
        </p>
      )}
      {note && (
        <p role="alert" className="text-destructive">
          {note}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {saved.how === 'folder' && reveal && saved.paths.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            data-testid="images-reveal"
            onClick={() => reveal(saved.paths[0]).catch((e) => setNote(e instanceof Error ? e.message : String(e)))}
          >
            <FolderOpen /> Mở thư mục
          </Button>
        )}
        {saved.how === 'held' && (
          <Button variant={shareable ? 'outline' : 'default'} size="sm" onClick={download} data-testid="images-download">
            <Download /> Tải về{saved.files.length > 1 ? ' (.zip)' : ''}
          </Button>
        )}
        {shareable && (
          <Button size="sm" onClick={() => void share()} data-testid="images-share">
            <Share2 /> Lưu hoặc chia sẻ
          </Button>
        )}
        <Button variant={saved.how === 'held' ? 'ghost' : 'default'} size="sm" onClick={onClose} data-testid="images-finish">
          Xong
        </Button>
      </div>
    </div>
  );
}

/** The dialog where the output menu opens it (desktop button, phone menu). */
export function ImagesHost({ documentId, session }: { documentId: string; session: DocumentSession }) {
  const out = useOutput();
  if (!out) return null;
  return <ImagesDialog documentId={documentId} session={session} open={out.imagesOpen} onOpenChange={out.setImagesOpen} />;
}
