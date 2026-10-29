/**
 * Signature: draw it, or take a photo/scan and remove the paper. The result
 * is a transparent PNG placed like any picture. Saved signatures live in
 * this browser only (IndexedDB) and can be deleted here.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ImageUp, Trash2 } from 'lucide-react';
import { uuidV4 } from '@embedpdf/models';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { encode, imageDataToPng, readForSignature, removePaper, trimCanvas, type PreparedImage } from './image-data';
import { deleteSignature, listSignatures, saveSignature, type SavedSignature } from '../storage/signatures';

const PENS = [
  { name: 'Mực đen', value: '#1d2433' },
  { name: 'Mực xanh', value: '#1d4ed8' },
];
const OUT_SCALE = 3; // output pixels per CSS pixel of the pad
const PEN_WIDTH = 3.2;

type Pt = { x: number; y: number };
type Stroke = { color: string; pts: Pt[] };

function drawStrokes(g: CanvasRenderingContext2D, strokes: Stroke[], k: number) {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = PEN_WIDTH * k;
  for (const s of strokes) {
    g.strokeStyle = s.color;
    g.fillStyle = s.color;
    const p = s.pts;
    if (p.length === 1) {
      g.beginPath();
      g.arc(p[0].x * k, p[0].y * k, (PEN_WIDTH * k) / 2, 0, Math.PI * 2);
      g.fill();
      continue;
    }
    g.beginPath();
    g.moveTo(p[0].x * k, p[0].y * k);
    for (let i = 1; i < p.length - 1; i++) {
      const mx = (p[i].x + p[i + 1].x) / 2, my = (p[i].y + p[i + 1].y) / 2;
      g.quadraticCurveTo(p[i].x * k, p[i].y * k, mx * k, my * k);
    }
    const last = p[p.length - 1];
    g.lineTo(last.x * k, last.y * k);
    g.stroke();
  }
}

function SignaturePad({ strokes, setStrokes, pen }: { strokes: Stroke[]; setStrokes: (s: Stroke[]) => void; pen: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef<Stroke | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const penRef = useRef(pen);
  penRef.current = pen;
  const setStrokesRef = useRef(setStrokes);
  setStrokesRef.current = setStrokes;

  const redraw = () => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    drawStrokes(g, live.current ? [...strokesRef.current, live.current] : strokesRef.current, dpr);
  };
  useEffect(redraw, [strokes]);
  useEffect(() => {
    const c = ref.current!;
    const ro = new ResizeObserver(redraw);
    ro.observe(c);
    const at = (e: PointerEvent): Pt => {
      const b = c.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      live.current = { color: penRef.current, pts: [at(e)] };
      redraw();
    };
    const move = (e: PointerEvent) => {
      if (!live.current) return;
      const evs = e.getCoalescedEvents?.() ?? [e];
      for (const ev of evs) live.current.pts.push(at(ev));
      redraw();
    };
    const up = () => {
      if (!live.current) return;
      const s = live.current;
      live.current = null;
      setStrokesRef.current([...strokesRef.current, s]);
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    return () => {
      ro.disconnect();
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointercancel', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-[180px] w-full overflow-hidden rounded-md border bg-white">
      <div className="pointer-events-none absolute inset-x-6 top-[68%] border-b border-dashed border-black/20" />
      {strokes.length === 0 && (
        <span className="pointer-events-none absolute inset-x-0 top-[40%] text-center text-[13px] text-muted-foreground">
          Ký vào đây bằng chuột, bút hoặc ngón tay
        </span>
      )}
      <canvas ref={ref} data-testid="sig-pad" className="absolute inset-0 h-full w-full touch-none" style={{ cursor: 'crosshair' }} />
    </div>
  );
}

async function strokesToPng(strokes: Stroke[], w: number, h: number): Promise<PreparedImage | null> {
  const c = document.createElement('canvas');
  c.width = Math.round(w * OUT_SCALE);
  c.height = Math.round(h * OUT_SCALE);
  drawStrokes(c.getContext('2d')!, strokes, OUT_SCALE);
  const t = trimCanvas(c, 6 * OUT_SCALE);
  if (!t) return null;
  return { bytes: await encode(t, 'image/png'), mime: 'image/png', width: t.width, height: t.height };
}

function SavedThumb({ sig, onUse, onDelete, index }: { sig: SavedSignature; onUse: () => void; onDelete: () => void; index: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(sig.png);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [sig.png]);
  return (
    <div className="group relative">
      <button
        type="button"
        data-testid={`sig-saved-${index}`}
        aria-label={`Dùng chữ ký đã lưu ${index + 1}`}
        onClick={onUse}
        className="flex h-16 w-32 items-center justify-center rounded-md border bg-white p-2 outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
      >
        {url && <img src={url} alt="" className="max-h-full max-w-full" />}
      </button>
      <button
        type="button"
        data-testid={`sig-delete-${index}`}
        aria-label={`Xóa chữ ký đã lưu ${index + 1}`}
        onClick={onDelete}
        className="absolute -top-2 -right-2 rounded-full border bg-background p-1 text-muted-foreground shadow-sm outline-none hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

export function SignatureDialog({
  open,
  onOpenChange,
  onReady,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** called with the transparent PNG to place */
  onReady: (img: PreparedImage) => void;
}) {
  const [tab, setTab] = useState<'draw' | 'photo'>('draw');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [pen, setPen] = useState(PENS[0].value);
  const [photo, setPhoto] = useState<ImageData | null>(null);
  const [strength, setStrength] = useState(0.4);
  const [keep, setKeep] = useState(true);
  const [saved, setSaved] = useState<SavedSignature[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const padSize = useRef({ w: 460, h: 180 });

  const refreshSaved = () => listSignatures().then(setSaved, () => setSaved([]));
  useEffect(() => {
    if (!open) return;
    setError(null);
    void refreshSaved();
  }, [open]);

  const processed = useMemo(() => (photo ? removePaper(photo, strength) : null), [photo, strength]);
  useEffect(() => {
    const c = previewRef.current;
    if (!c || !processed) return;
    c.width = processed.width;
    c.height = processed.height;
    c.getContext('2d')!.putImageData(processed, 0, 0);
  }, [processed, tab]);

  const reset = () => {
    setStrokes([]);
    setPhoto(null);
    setError(null);
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      let img: PreparedImage | null = null;
      if (tab === 'draw') {
        const pad = document.querySelector('[data-testid="sig-pad"]') as HTMLCanvasElement | null;
        if (pad) padSize.current = { w: pad.clientWidth, h: pad.clientHeight };
        img = await strokesToPng(strokes, padSize.current.w, padSize.current.h);
      } else if (processed) {
        img = await imageDataToPng(processed);
      }
      if (!img) {
        setError(tab === 'draw' ? 'Chưa có nét ký nào.' : 'Sau khi xóa nền không còn nét nào. Hãy giảm mức xóa nền.');
        return;
      }
      if (keep) {
        await saveSignature({
          id: uuidV4(),
          png: new Blob([img.bytes], { type: 'image/png' }),
          width: img.width,
          height: img.height,
          createdAt: Date.now(),
        }).catch(() => setError('Không lưu được chữ ký trên máy, nhưng vẫn đặt được lên trang.'));
      }
      reset();
      onOpenChange(false);
      onReady(img);
    } finally {
      setBusy(false);
    }
  };

  const pickSaved = async (s: SavedSignature) => {
    const bytes = await s.png.arrayBuffer();
    onOpenChange(false);
    onReady({ bytes, mime: 'image/png', width: s.width, height: s.height });
  };

  const ready = tab === 'draw' ? strokes.length > 0 : !!processed;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[520px]" data-testid="sig-dialog" closeTestId="sig-close">
        <DialogHeader>
          <DialogTitle>Chữ ký</DialogTitle>
          <DialogDescription>Ký trên màn hình hoặc dùng ảnh chụp chữ ký. Mọi xử lý diễn ra trên máy này.</DialogDescription>
        </DialogHeader>

        {saved.length > 0 && (
          <div className="space-y-2">
            <p className="text-[13px] font-bold">Chữ ký đã lưu</p>
            <div className="flex flex-wrap gap-3 pt-1">
              {saved.map((s, i) => (
                <SavedThumb
                  key={s.id}
                  sig={s}
                  index={i}
                  onUse={() => void pickSaved(s)}
                  onDelete={() => void deleteSignature(s.id).then(refreshSaved)}
                />
              ))}
            </div>
          </div>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'draw' | 'photo')} className="gap-3">
          <TabsList className="grid h-8 w-full grid-cols-2">
            <TabsTrigger value="draw" data-testid="sig-tab-draw" className="text-[13px]">
              Ký tay
            </TabsTrigger>
            <TabsTrigger value="photo" data-testid="sig-tab-photo" className="text-[13px]">
              Từ ảnh chụp
            </TabsTrigger>
          </TabsList>
          <TabsContent value="draw" className="space-y-2">
            <SignaturePad strokes={strokes} setStrokes={setStrokes} pen={pen} />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {PENS.map((p, i) => (
                  <button
                    key={p.value}
                    type="button"
                    data-testid={`sig-pen-${i}`}
                    aria-label={p.name}
                    aria-pressed={pen === p.value}
                    onClick={() => setPen(p.value)}
                    className={cn(
                      'size-6 rounded-full border border-black/10 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      pen === p.value && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                    )}
                    style={{ background: p.value }}
                  />
                ))}
              </div>
              <Button variant="ghost" size="sm" data-testid="sig-clear" onClick={() => setStrokes([])} disabled={!strokes.length}>
                Xóa nét
              </Button>
            </div>
          </TabsContent>
          <TabsContent value="photo" className="space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              data-testid="sig-file-input"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setError(null);
                try {
                  setPhoto(await readForSignature(f));
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
            {processed ? (
              <>
                <div
                  className="flex h-[180px] items-center justify-center overflow-hidden rounded-md border p-2"
                  style={{ background: 'repeating-conic-gradient(#eceef0 0% 25%, #fff 0% 50%) 50% / 16px 16px' }}
                >
                  <canvas ref={previewRef} data-testid="sig-photo-preview" className="max-h-full max-w-full" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[13px] font-normal text-muted-foreground">Mức xóa nền giấy</Label>
                  <Slider
                    min={0}
                    max={100}
                    step={1}
                    value={[Math.round(strength * 100)]}
                    onValueChange={([v]) => setStrength(v / 100)}
                    thumbTestId="sig-threshold"
                    thumbLabel="Mức xóa nền giấy"
                  />
                </div>
                <Button variant="outline" size="sm" data-testid="sig-pick-again" onClick={() => fileRef.current?.click()}>
                  <ImageUp /> Chọn ảnh khác
                </Button>
              </>
            ) : (
              <div className="flex h-[180px] flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-white text-center">
                <p className="max-w-72 text-[13px] text-muted-foreground">Chụp chữ ký trên giấy trắng. Nền giấy sẽ được xóa, chỉ giữ nét mực.</p>
                <Button variant="outline" size="sm" data-testid="sig-pick" onClick={() => fileRef.current?.click()}>
                  <ImageUp /> Chọn ảnh chữ ký
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {error && (
          <p role="alert" className="text-[13px] text-destructive" data-testid="sig-error">
            {error}
          </p>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <label className="flex items-center gap-2 text-[13px]">
            <Checkbox checked={keep} onCheckedChange={(v) => setKeep(v === true)} data-testid="sig-keep" />
            Lưu để dùng lại trên máy này
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" data-testid="sig-cancel" onClick={() => onOpenChange(false)}>
              Hủy
            </Button>
            <Button size="sm" data-testid="sig-use" disabled={!ready || busy} onClick={() => void finish()}>
              Đặt lên trang
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
