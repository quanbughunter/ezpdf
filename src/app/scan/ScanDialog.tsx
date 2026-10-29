/**
 * "Quét tài liệu": photos of paper → a flat, evenly lit PDF.
 *
 * One photo goes straight to the corner editor (drag the four corners onto
 * the sheet's corners; the app has already placed them where it found the
 * sheet). Several photos are processed at once and land in the review, where
 * each page can be turned, re-cornered, deleted, or shown without the
 * brightening. "Tạo PDF" opens the result as a new document.
 *
 * Photos are decoded and processed in a worker on this device
 * (src/scan/scan.worker.ts); nothing is uploaded.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Camera, Check, Crop, ImagePlus, Loader2, Plus, RotateCw, Sparkles, Trash2, X } from 'lucide-react';
import { uuidV4 } from '@embedpdf/models';
import { cn } from '@/lib/utils';
import { usePlatform } from '@/platform';
import { detectSheetIn, processPage } from '@/scan/scan-client';
import { isConvex, type Pt, type Quad } from '@/scan/geometry';
import { jpegPagesToPdf, pageSizeFor } from '@/scan/jpeg-pdf';

interface ScanPage {
  id: string;
  file: Blob;
  photoUrl: string;
  /** the photo as shown (EXIF orientation applied), once read */
  size: { w: number; h: number } | null;
  /** corners, 0–1 of the photo as shown */
  quad: Quad | null;
  found: boolean;
  rotation: number;
  enhance: boolean;
  result: { blob: Blob; url: string; width: number; height: number; a4: boolean } | null;
  busy: boolean;
  error?: string;
}

const WHOLE: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const fileName = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Bản quét ${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}.${p(d.getMinutes())}.pdf`;
};

export function ScanDialog({ onClose, onDone }: { onClose: () => void; onDone: (file: File) => Promise<boolean> }) {
  const platform = usePlatform();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [mode, setMode] = useState<'adjust' | 'review'>('review');
  const [creating, setCreating] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // object URLs live as long as their page
  useEffect(
    () => () => {
      for (const p of pagesRef.current) {
        URL.revokeObjectURL(p.photoUrl);
        if (p.result) URL.revokeObjectURL(p.result.url);
      }
      void platform.clearCapturedPhotos?.().catch(() => {});
    },
    [platform],
  );

  const patch = useCallback((id: string, f: (p: ScanPage) => Partial<ScanPage>) => {
    setPages((ps) => ps.map((p) => (p.id === id ? { ...p, ...f(p) } : p)));
  }, []);

  const run = useCallback(
    async (id: string, with_: Partial<ScanPage> = {}) => {
      const found = pagesRef.current.find((x) => x.id === id);
      const p = found && { ...found, ...with_ };
      if (!p || !p.quad) return;
      patch(id, () => ({ busy: true, error: undefined }));
      try {
        const r = await processPage(p.file, p.quad, p.rotation, p.enhance);
        const url = URL.createObjectURL(r.jpeg);
        patch(id, (old) => {
          if (old.result) URL.revokeObjectURL(old.result.url);
          return { busy: false, result: { blob: r.jpeg, url, width: r.width, height: r.height, a4: r.a4 } };
        });
      } catch (e) {
        patch(id, () => ({ busy: false, error: `Không xử lý được ảnh: ${e instanceof Error ? e.message : String(e)}` }));
      }
    },
    [patch],
  );

  const addPhotos = useCallback(
    async (files: File[]) => {
      const imgs = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
      if (!imgs.length) return;
      setError(null);
      const fresh: ScanPage[] = imgs.map((file) => ({
        id: uuidV4(),
        file,
        photoUrl: URL.createObjectURL(file),
        size: null,
        quad: null,
        found: false,
        rotation: 0,
        enhance: true,
        result: null,
        busy: true,
      }));
      setPages((ps) => [...ps, ...fresh]);
      setCurrent(fresh[0].id);
      setMode(imgs.length === 1 ? 'adjust' : 'review');
      for (const p of fresh) {
        try {
          const d = await detectSheetIn(p.file);
          const got = { size: { w: d.width, h: d.height }, quad: d.quad, found: d.found };
          patch(p.id, () => ({ ...got, busy: imgs.length > 1 }));
          if (imgs.length > 1) await run(p.id, got);
        } catch (e) {
          patch(p.id, () => ({
            busy: false,
            quad: WHOLE,
            error: `Không đọc được ảnh “${(p.file as File).name ?? ''}”: ${e instanceof Error ? e.message : String(e)}`,
          }));
        }
      }
    },
    [patch, run],
  );

  const page = pages.find((p) => p.id === current) ?? null;
  const index = page ? pages.indexOf(page) : -1;

  const finishAdjust = async () => {
    if (!page) return;
    setMode('review');
    await run(page.id);
  };

  const remove = (id: string) => {
    const i = pages.findIndex((p) => p.id === id);
    const p = pages[i];
    if (!p) return;
    URL.revokeObjectURL(p.photoUrl);
    if (p.result) URL.revokeObjectURL(p.result.url);
    const rest = pages.filter((x) => x.id !== id);
    setPages(rest);
    setCurrent(rest[Math.min(i, rest.length - 1)]?.id ?? null);
    setMode('review');
  };

  const change = (id: string, f: Partial<ScanPage>) => {
    patch(id, () => f);
    void run(id, f);
  };

  const ready = pages.length > 0 && pages.every((p) => p.result && !p.busy);
  const create = async () => {
    if (!ready) return;
    setCreating(true);
    setError(null);
    try {
      const out = await Promise.all(
        pages.map(async (p) => {
          const r = p.result!;
          return { jpeg: new Uint8Array(await r.blob.arrayBuffer()), width: r.width, height: r.height, ...pageSizeFor(r.width, r.height, r.a4) };
        }),
      );
      const name = fileName();
      const bytes = jpegPagesToPdf(out, { title: name.replace(/\.pdf$/, '') });
      const ok = await onDone(new File([bytes as BlobPart], name, { type: 'application/pdf' }));
      if (!ok) setError('Chưa mở được bản quét: tài liệu đang mở còn thay đổi chưa lưu được vào nháp. Hãy xuất tài liệu đó trước.');
    } catch (e) {
      setError(`Không tạo được PDF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  const leave = () => (pages.length && !confirmLeave ? setConfirmLeave(true) : onClose());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (mode === 'adjust' && page?.result) setMode('review');
      else leave();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const pick = (input: HTMLInputElement | null) => input?.click();
  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    void addPhotos(files);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quét tài liệu"
      data-testid="scan-dialog"
      data-mode={pages.length ? mode : 'empty'}
      className="fixed inset-0 z-[60] flex flex-col bg-[#1b1f21] text-[#eef1f0]"
    >
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" data-testid="scan-camera-input" onChange={onFiles} />
      <input ref={gallery} type="file" accept="image/*" multiple className="hidden" data-testid="scan-file-input" onChange={onFiles} />

      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-2">
        <DarkIcon label="Đóng" onClick={leave} testId="scan-close">
          <X />
        </DarkIcon>
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
          {mode === 'adjust' && page ? `Trang ${index + 1}: kéo 4 góc vào mép giấy` : 'Quét tài liệu'}
        </h2>
        {pages.length > 0 && (
          <span className="text-[13px] text-[#a6b0ae] tabular-nums" data-testid="scan-count">
            {pages.length} trang
          </span>
        )}
      </header>

      {confirmLeave && (
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-300/30 bg-amber-200/10 px-4 py-2 text-[13px]" role="alert">
          <span className="flex-1">Bỏ {pages.length} trang đã quét? Chưa có gì được lưu.</span>
          <DarkButton onClick={onClose} testId="scan-discard">
            Bỏ bản quét
          </DarkButton>
          <DarkButton primary onClick={() => setConfirmLeave(false)} testId="scan-stay">
            Ở lại
          </DarkButton>
        </div>
      )}
      {error && (
        <div className="border-b border-red-300/30 bg-red-400/15 px-4 py-2 text-[13px]" role="alert" data-testid="scan-error">
          {error}
        </div>
      )}

      {!pages.length ? (
        <EmptyScan canCapture={platform.canCapture} onCamera={() => pick(camera.current)} onGallery={() => pick(gallery.current)} />
      ) : mode === 'adjust' && page ? (
        <>
          <div className="relative min-h-0 flex-1">
            {page.quad && page.size ? (
              <CornerEditor
                photoUrl={page.photoUrl}
                size={page.size}
                quad={page.quad}
                onChange={(q) => patch(page.id, () => ({ quad: q }))}
              />
            ) : (
              <Centered>
                <Loader2 className="size-7 animate-spin text-[#a6b0ae]" />
              </Centered>
            )}
          </div>
          <p className="px-4 pt-2 text-center text-[13px] text-[#a6b0ae]" data-testid="scan-adjust-note">
            {page.quad && !page.found
              ? 'Không thấy rõ mép giấy. Hãy kéo 4 góc vào 4 góc tờ giấy.'
              : page.quad && !isConvex(page.quad)
                ? 'Bốn góc đang bắt chéo nhau. Hãy kéo lại cho đúng thứ tự.'
                : 'Ứng dụng đã tìm mép giấy. Chỉnh lại góc nếu chưa khớp.'}
          </p>
          <footer className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-3 py-3">
            <DarkButton onClick={() => patch(page.id, () => ({ quad: WHOLE }))} testId="scan-whole">
              Lấy cả ảnh
            </DarkButton>
            <DarkButton onClick={() => remove(page.id)} testId="scan-retake">
              Bỏ ảnh này
            </DarkButton>
            <DarkButton primary disabled={!page.quad || !isConvex(page.quad)} onClick={() => void finishAdjust()} testId="scan-adjust-done">
              <Check /> Xong
            </DarkButton>
          </footer>
        </>
      ) : (
        <>
          <div className="relative min-h-0 flex-1 p-4">
            {page && (
              <div className="flex h-full items-center justify-center">
                {page.result ? (
                  <img
                    src={page.result.url}
                    alt={`Trang ${index + 1} đã quét`}
                    data-testid="scan-result"
                    data-width={page.result.width}
                    data-height={page.result.height}
                    className={cn('max-h-full max-w-full bg-white object-contain shadow-[0_6px_28px_rgba(0,0,0,0.45)]', page.busy && 'opacity-60')}
                  />
                ) : (
                  <Loader2 className="size-7 animate-spin text-[#a6b0ae]" />
                )}
                {page.busy && page.result && <Loader2 className="absolute size-7 animate-spin text-white" />}
              </div>
            )}
            {page?.error && (
              <p className="absolute inset-x-4 bottom-2 text-center text-[13px] text-red-300" role="alert">
                {page.error}
              </p>
            )}
          </div>
          {page && (
            <div className="flex shrink-0 flex-wrap items-center justify-center gap-1 px-2 pb-1">
              <DarkButton onClick={() => change(page.id, { rotation: (page.rotation + 1) % 4 })} disabled={page.busy} testId="scan-rotate">
                <RotateCw /> Xoay
              </DarkButton>
              <DarkButton onClick={() => setMode('adjust')} disabled={page.busy || !page.quad} testId="scan-recrop">
                <Crop /> Căn lại góc
              </DarkButton>
              <DarkButton onClick={() => remove(page.id)} disabled={page.busy} testId="scan-delete">
                <Trash2 /> Xóa trang
              </DarkButton>
              <label
                data-testid="scan-enhance-toggle"
                className={cn(
                  'flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-[13px] select-none hover:bg-white/10',
                  page.busy && 'pointer-events-none opacity-50',
                )}
              >
                <Sparkles className="size-4" />
                Làm sáng
                <input
                  type="checkbox"
                  role="switch"
                  data-testid="scan-enhance"
                  checked={page.enhance}
                  onChange={(e) => change(page.id, { enhance: e.target.checked })}
                  className="peer sr-only"
                />
                <span className="relative h-5 w-9 rounded-full bg-white/25 transition-colors peer-checked:bg-[#2fa79c] peer-focus-visible:ring-2 peer-focus-visible:ring-white after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
              </label>
            </div>
          )}
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-white/10 px-3 py-2" data-testid="scan-strip">
            {pages.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setCurrent(p.id);
                  setMode('review');
                }}
                aria-label={`Trang ${i + 1}`}
                aria-current={p.id === current}
                data-testid={`scan-thumb-${i}`}
                className={cn(
                  'relative h-[68px] w-[50px] shrink-0 overflow-hidden rounded-[3px] bg-white/10 outline-offset-2',
                  p.id === current ? 'outline-2 outline-[#2fa79c]' : 'outline-1 outline-white/15',
                )}
              >
                <img src={p.result?.url ?? p.photoUrl} alt="" className="size-full object-cover" />
                {p.busy && <Loader2 className="absolute inset-0 m-auto size-4 animate-spin text-white" />}
                <span className="absolute right-0.5 bottom-0.5 rounded-sm bg-black/60 px-1 text-[10px] tabular-nums">{i + 1}</span>
              </button>
            ))}
            <AddMore canCapture={platform.canCapture} onCamera={() => pick(camera.current)} onGallery={() => pick(gallery.current)} />
          </div>
          <footer className="flex shrink-0 items-center justify-end gap-2 px-3 pt-1 pb-3">
            <p className="mr-auto text-[12px] leading-snug text-[#a6b0ae]">Ảnh chỉ được xử lý trên máy này.</p>
            <DarkButton primary disabled={!ready || creating} onClick={() => void create()} testId="scan-create">
              {creating ? <Loader2 className="animate-spin" /> : <Check />}
              Tạo PDF ({pages.length} trang)
            </DarkButton>
          </footer>
        </>
      )}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center">{children}</div>;
}

function EmptyScan({ canCapture, onCamera, onGallery }: { canCapture: boolean; onCamera: () => void; onGallery: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 text-center" data-testid="scan-empty">
      <SheetMark />
      <div className="max-w-sm space-y-2">
        <p className="text-[17px] font-semibold">Quét giấy tờ thành PDF</p>
        <p className="text-[14px] leading-relaxed text-[#a6b0ae]">
          Chụp từng trang giấy. ezPDF tìm mép giấy, làm phẳng và làm sáng ảnh; bạn chỉnh lại góc nếu cần. Ảnh chỉ được xử lý trên máy này.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {canCapture && (
          <DarkButton primary onClick={onCamera} testId="scan-camera">
            <Camera /> Chụp ảnh
          </DarkButton>
        )}
        <DarkButton primary={!canCapture} onClick={onGallery} testId="scan-gallery">
          <ImagePlus /> Chọn ảnh có sẵn
        </DarkButton>
      </div>
    </div>
  );
}

/** A sheet seen at an angle with its corners marked: what the screen does. */
function SheetMark() {
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden className="text-[#2fa79c]">
      <path d="M22 18 L74 12 L80 84 L16 80 Z" fill="rgba(255,255,255,0.08)" stroke="currentColor" strokeWidth="2" />
      {[
        [22, 18],
        [74, 12],
        [80, 84],
        [16, 80],
      ].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="5" fill="#fff" stroke="currentColor" strokeWidth="2.5" />
      ))}
      <path d="M32 34 H62 M32 44 H66 M32 54 H58" stroke="rgba(255,255,255,0.35)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function AddMore({ canCapture, onCamera, onGallery }: { canCapture: boolean; onCamera: () => void; onGallery: () => void }) {
  const [open, setOpen] = useState(false);
  if (!canCapture)
    return (
      <button
        type="button"
        onClick={onGallery}
        data-testid="scan-add"
        aria-label="Thêm trang từ ảnh"
        className="flex h-[68px] w-[50px] shrink-0 items-center justify-center rounded-[3px] border border-dashed border-white/30 hover:bg-white/10"
      >
        <Plus className="size-5" />
      </button>
    );
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="scan-add"
        aria-label="Thêm trang"
        aria-expanded={open}
        className="flex h-[68px] w-[50px] items-center justify-center rounded-[3px] border border-dashed border-white/30 hover:bg-white/10"
      >
        <Plus className="size-5" />
      </button>
      {open && (
        <span className="fixed bottom-[150px] left-1/2 z-10 flex -translate-x-1/2 gap-2 rounded-lg bg-[#2a3033] p-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
          <DarkButton
            primary
            onClick={() => {
              setOpen(false);
              onCamera();
            }}
            testId="scan-add-camera"
          >
            <Camera /> Chụp thêm
          </DarkButton>
          <DarkButton
            onClick={() => {
              setOpen(false);
              onGallery();
            }}
            testId="scan-add-gallery"
          >
            <ImagePlus /> Chọn ảnh
          </DarkButton>
        </span>
      )}
    </span>
  );
}

function DarkButton({
  children,
  onClick,
  primary,
  disabled,
  testId,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40 [&_svg]:size-4',
        primary ? 'bg-[#0b6e69] text-white hover:bg-[#0d7f79]' : 'text-[#eef1f0] hover:bg-white/10',
      )}
    >
      {children}
    </button>
  );
}

function DarkIcon({ label, onClick, children, testId }: { label: string; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={testId}
      className="inline-flex size-9 items-center justify-center rounded-md hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white [&_svg]:size-5"
    >
      {children}
    </button>
  );
}

// ---- corner editor -----------------------------------------------------------------

const CORNER_NAMES = ['Góc trên trái', 'Góc trên phải', 'Góc dưới phải', 'Góc dưới trái'];
const LOUPE = 116;
const ZOOM = 2.5;

/**
 * The photo with the sheet's outline. Each corner is a handle (finger-sized
 * hit area); while one is dragged a loupe shows the photo under the finger,
 * which the finger itself hides. Arrow keys move a focused handle.
 */
function CornerEditor({ photoUrl, size, quad, onChange }: { photoUrl: string; size: { w: number; h: number }; quad: Quad; onChange: (q: Quad) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [drag, setDrag] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setArea({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const pad = 24;
  const rect = useMemo(() => {
    const s = Math.min((area.w - pad * 2) / size.w, (area.h - pad * 2) / size.h);
    const w = size.w * Math.max(0, s), h = size.h * Math.max(0, s);
    return { x: (area.w - w) / 2, y: (area.h - h) / 2, w, h };
  }, [area, size]);
  const pts = quad.map((p) => ({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h }));
  const quadRef = useRef(quad);
  quadRef.current = quad;

  const move = (i: number, to: Pt) => {
    const q = [...quadRef.current] as Quad;
    q[i] = { x: Math.min(1, Math.max(0, to.x)), y: Math.min(1, Math.max(0, to.y)) };
    onChange(q);
  };

  const onPointerDown = (i: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const b = box.current!.getBoundingClientRect();
    // keep the offset between the finger and the corner while dragging
    const start = quadRef.current[i];
    const ox = e.clientX - b.left - (rect.x + start.x * rect.w);
    const oy = e.clientY - b.top - (rect.y + start.y * rect.h);
    setDrag(i);
    const onMove = (ev: PointerEvent) => {
      move(i, { x: (ev.clientX - b.left - ox - rect.x) / rect.w, y: (ev.clientY - b.top - oy - rect.y) / rect.h });
    };
    const onUp = () => {
      setDrag(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onKey = (i: number) => (e: React.KeyboardEvent) => {
    // one press = 1 screen pixel (10 with Shift), the same both ways
    const px = e.shiftKey ? 10 : 1;
    const sx = px / rect.w, sy = px / rect.h;
    const d = { ArrowLeft: [-sx, 0], ArrowRight: [sx, 0], ArrowUp: [0, -sy], ArrowDown: [0, sy] }[e.key];
    if (!d) return;
    e.preventDefault();
    move(i, { x: quad[i].x + d[0], y: quad[i].y + d[1] });
  };

  const poly = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const loupe = drag !== null ? pts[drag] : null;
  const loupeAt = loupe && { x: Math.min(area.w - LOUPE - 8, Math.max(8, loupe.x - LOUPE / 2)), y: loupe.y - LOUPE - 48 < 8 ? loupe.y + 48 : loupe.y - LOUPE - 48 };

  return (
    <div ref={box} className="absolute inset-0 touch-none select-none" data-testid="scan-editor" data-rect={JSON.stringify(rect)}>
      {rect.w > 0 && (
        <>
          <img
            src={photoUrl}
            alt="Ảnh chụp tài liệu"
            draggable={false}
            className="absolute max-w-none"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          />
          <svg className="pointer-events-none absolute inset-0" width={area.w} height={area.h} aria-hidden>
            <path
              d={`M${rect.x} ${rect.y}H${rect.x + rect.w}V${rect.y + rect.h}H${rect.x}Z M${poly.replace(/ /g, ' L')}Z`}
              fill="rgba(10,14,16,0.55)"
              fillRule="evenodd"
            />
            <polygon points={poly} fill="rgba(47,167,156,0.10)" stroke="#3cc4b8" strokeWidth={2} strokeLinejoin="round" />
          </svg>
          {pts.map((p, i) => (
            <button
              key={i}
              type="button"
              aria-label={`${CORNER_NAMES[i]}, dùng phím mũi tên để dịch`}
              data-testid={`scan-corner-${i}`}
              onPointerDown={onPointerDown(i)}
              onKeyDown={onKey(i)}
              className="group absolute flex size-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full outline-none"
              style={{ left: p.x, top: p.y }}
            >
              <span
                className={cn(
                  'size-5 rounded-full border-[3px] border-[#2fa79c] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.5)] transition-transform group-focus-visible:ring-2 group-focus-visible:ring-white',
                  drag === i && 'scale-125',
                )}
              />
            </button>
          ))}
          {loupe && loupeAt && (
            <div
              className="pointer-events-none absolute overflow-hidden rounded-full border-2 border-white shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
              style={{
                left: loupeAt.x,
                top: loupeAt.y,
                width: LOUPE,
                height: LOUPE,
                backgroundImage: `url("${photoUrl}")`,
                backgroundRepeat: 'no-repeat',
                backgroundSize: `${rect.w * ZOOM}px ${rect.h * ZOOM}px`,
                backgroundPosition: `${LOUPE / 2 - (loupe.x - rect.x) * ZOOM}px ${LOUPE / 2 - (loupe.y - rect.y) * ZOOM}px`,
                backgroundColor: '#000',
              }}
              data-testid="scan-loupe"
            >
              <span className="absolute top-1/2 left-1/2 h-px w-6 -translate-x-1/2 bg-[#3cc4b8]" />
              <span className="absolute top-1/2 left-1/2 h-6 w-px -translate-y-1/2 bg-[#3cc4b8]" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
