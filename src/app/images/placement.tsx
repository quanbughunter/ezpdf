/**
 * Placing a picture (image or signature) on a page: a ghost follows the
 * pointer, a click or tap puts it there.
 *
 * The picture becomes a Stamp annotation (/Name /Image, marked as ezPDF's)
 * that is never rotated as an annotation (G10: PDFium crops rotated image
 * stamps). On a page displayed rotated, the pixels are turned the other way
 * instead, so the picture reads upright and every viewer draws it the same.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PdfAnnotationName, PdfAnnotationSubtype, uuidV4, type PdfAnnotationObject } from '@embedpdf/models';
import { useDocumentState } from '@embedpdf/core/react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { EZ_MARK } from '@/engine/vn-freetext-export';
import { rotateImage, type PreparedImage } from './image-data';
import { rememberStamp } from './stamp-guard';

export type PictureKind = 'image' | 'signature';

export interface Placing {
  kind: PictureKind;
  image: PreparedImage;
  /** object URL of the upright picture, for the ghost */
  url: string;
  /** size on the page as the user will see it, in points */
  width: number;
  height: number;
}

interface PlacementApi {
  placing: Placing | null;
  /** start placing; size in points is derived from the page when omitted */
  start: (kind: PictureKind, image: PreparedImage) => void;
  cancel: () => void;
  place: (pageIndex: number, x: number, y: number) => Promise<void>;
  /** Enter key: the middle of a page */
  placeAtCenter: (pageIndex: number) => Promise<void>;
  error: string | null;
}

const Ctx = createContext<PlacementApi | null>(null);
export const usePlacement = () => useContext(Ctx);

/** Default size: images at 96 dpi but at most ~45 % of the page; signatures 150 pt wide. */
export function defaultSize(kind: PictureKind, img: PreparedImage, page: { width: number; height: number }) {
  const aspect = img.height / img.width;
  if (kind === 'signature') {
    const w = Math.min(150, page.width * 0.4);
    return { width: w, height: w * aspect };
  }
  let w = img.width * 0.75;
  let h = img.height * 0.75;
  const k = Math.min(1, (page.width * 0.45) / w, (page.height * 0.45) / h);
  w *= k;
  h *= k;
  if (w < 24) {
    w = 24;
    h = 24 * aspect;
  }
  return { width: w, height: h };
}

export function PlacementProvider({ documentId, children }: { documentId: string; children: ReactNode }) {
  const docState = useDocumentState(documentId);
  const { provides } = useAnnotationCapability();
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  useEffect(
    () => () => {
      if (placing) URL.revokeObjectURL(placing.url);
    },
    [placing],
  );
  useEffect(() => setPlacing(null), [documentId]);

  const start = useCallback(
    (kind: PictureKind, image: PreparedImage) => {
      const doc = docState?.document;
      if (!doc) return;
      // size against the first page as displayed; good enough for a default
      const p = doc.pages[0];
      const rot = ((p.rotation ?? 0) + (docState?.rotation ?? 0)) % 2 === 1;
      const size = defaultSize(kind, image, rot ? { width: p.size.height, height: p.size.width } : p.size);
      provides?.forDocument(documentId).setActiveTool(null);
      setError(null);
      setPlacing({ kind, image, url: URL.createObjectURL(new Blob([image.bytes], { type: image.mime })), ...size });
    },
    [docState, provides, documentId],
  );

  const cancel = useCallback(() => setPlacing(null), []);

  const place = useCallback(
    async (pageIndex: number, x: number, y: number) => {
      const doc = docState?.document;
      const page = doc?.pages[pageIndex];
      if (!placing || !page || !provides || busy.current) return;
      busy.current = true;
      try {
        const r = ((page.rotation ?? 0) + (docState?.rotation ?? 0)) % 4;
        // turn the pixels back by the page's rotation so the page shows them upright
        const pixels = await rotateImage(placing.image, (4 - r) % 4);
        const swap = r % 2 === 1;
        const w = swap ? placing.height : placing.width;
        const h = swap ? placing.width : placing.height;
        const W = page.size.width, H = page.size.height;
        const ox = Math.min(Math.max(0, x - w / 2), Math.max(0, W - w));
        const oy = Math.min(Math.max(0, y - h / 2), Math.max(0, H - h));
        const id = uuidV4();
        const annotation = {
          type: PdfAnnotationSubtype.STAMP,
          id,
          pageIndex,
          rect: { origin: { x: ox, y: oy }, size: { width: w, height: h } },
          name: PdfAnnotationName.Image,
          subject: placing.kind === 'signature' ? 'Chữ ký' : 'Ảnh',
          flags: ['print'],
          custom: { [EZ_MARK]: 1, kind: placing.kind },
          created: new Date(),
        } as PdfAnnotationObject;
        rememberStamp(id, pixels.bytes, pixels.mime);
        const scope = provides.forDocument(documentId);
        scope.createAnnotation(pageIndex, annotation, { data: pixels.bytes.slice(0) } as never);
        scope.selectAnnotation(pageIndex, id);
        setPlacing(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        busy.current = false;
      }
    },
    [docState, placing, provides, documentId],
  );

  const placeAtCenter = useCallback(
    async (pageIndex: number) => {
      const page = docState?.document?.pages[pageIndex];
      if (page) await place(pageIndex, page.size.width / 2, page.size.height / 2);
    },
    [docState, place],
  );

  const api = useMemo(
    () => ({ placing, start, cancel, place, placeAtCenter, error }),
    [placing, start, cancel, place, placeAtCenter, error],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

/**
 * One per page, inside the page's Rotate wrapper (page space, unrotated).
 * Listens natively and stops propagation so EmbedPDF's page handlers don't
 * also act on the click.
 */
export function PlacementLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const api = usePlacement();
  const docState = useDocumentState(documentId);
  const ref = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const page = docState?.document?.pages[pageIndex];
  const scale = docState?.scale ?? 1;
  const r = page ? ((page.rotation ?? 0) + (docState?.rotation ?? 0)) % 4 : 0;
  const placing = api?.placing ?? null;

  useEffect(() => {
    const el = ref.current;
    if (!el || !placing || !page) return;
    const toPage = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      const u = (e.clientX - b.left) / b.width;
      const v = (e.clientY - b.top) / b.height;
      const { width: W, height: H } = page.size;
      const [x, y] = r === 0 ? [u * W, v * H] : r === 1 ? [v * W, (1 - u) * H] : r === 2 ? [(1 - u) * W, (1 - v) * H] : [(1 - v) * W, u * H];
      return { x, y };
    };
    let down: { x: number; y: number; id: number } | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') setGhost(toPage(e));
    };
    const onLeave = () => setGhost(null);
    const onDown = (e: PointerEvent) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    };
    const onUp = (e: PointerEvent) => {
      e.stopPropagation();
      if (!down || down.id !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 8) return; // a scroll or drag, not a placement
      const p = toPage(e);
      setGhost(null);
      void api?.place(pageIndex, p.x, p.y);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [placing, page, r, api, pageIndex]);

  if (!placing || !page) return null;
  const swap = r % 2 === 1;
  const pw = (swap ? placing.height : placing.width) * scale;
  const ph = (swap ? placing.width : placing.height) * scale;
  return (
    <div
      ref={ref}
      data-testid={`placement-${pageIndex}`}
      // its own pointer handling: EmbedPDF's handlers and the hand keep out
      data-no-interaction=""
      style={{ position: 'absolute', inset: 0, zIndex: 20, cursor: 'copy', touchAction: 'pan-x pan-y pinch-zoom' }}
    >
      {ghost && (
        <div
          style={{
            position: 'absolute',
            left: ghost.x * scale - pw / 2,
            top: ghost.y * scale - ph / 2,
            width: pw,
            height: ph,
            pointerEvents: 'none',
            outline: '1px dashed var(--color-primary)',
          }}
        >
          <img
            src={placing.url}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: placing.width * scale,
              height: placing.height * scale,
              maxWidth: 'none',
              opacity: 0.65,
              transform: `translate(-50%, -50%) rotate(${-r * 90}deg)`,
            }}
          />
        </div>
      )}
    </div>
  );
}
