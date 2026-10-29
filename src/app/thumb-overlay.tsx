/**
 * Annotations drawn over a page thumbnail. The thumbnail bitmap itself is the
 * plugin's page render without annotations; the overlay follows the
 * annotation state, so it updates as soon as something is added, moved,
 * restyled or deleted.
 *
 *  - FreeText: the same line layout as the page and the export (our font)
 *  - highlight: its segment rectangles, multiplied over the page
 *  - sticky note: a small square in the note colour
 *  - everything else (images, signatures, annotations that came with the
 *    file): the engine's render of the annotation's own appearance
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { PdfAnnotationSubtype, type PdfAnnotationObject, type PdfFreeTextAnnoObject, type Rect } from '@embedpdf/models';
import { useDocumentState } from '@embedpdf/core/react';
import { useAnnotation, useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import type { TrackedAnnotation } from '@embedpdf/plugin-annotation';
import { layoutFreeText } from '@/engine/text-layout';
import { useTextFont } from './text-font';
import { FreeTextLines } from './viewer/free-text';

const SKIP = new Set<number>([PdfAnnotationSubtype.LINK, PdfAnnotationSubtype.WIDGET, PdfAnnotationSubtype.POPUP]);

const box = (r: Rect, s: number): React.CSSProperties => ({
  position: 'absolute',
  left: r.origin.x * s,
  top: r.origin.y * s,
  width: r.size.width * s,
  height: r.size.height * s,
});

export function ThumbOverlay({ documentId, pageIndex, width }: { documentId: string; pageIndex: number; width: number }) {
  const docState = useDocumentState(documentId);
  const page = docState?.document?.pages[pageIndex];
  const { state } = useAnnotation(documentId);
  const uids = state.pages[pageIndex] ?? [];
  if (!page || !uids.length) return null;
  const r = page.rotation % 4;
  const W = page.size.width, H = page.size.height;
  const s = width / (r % 2 ? H : W);
  const transform =
    r === 1
      ? `translate(${H * s}px,0) rotate(90deg)`
      : r === 2
        ? `translate(${W * s}px,${H * s}px) rotate(180deg)`
        : r === 3
          ? `translate(0,${W * s}px) rotate(270deg)`
          : undefined;
  return (
    <div data-testid={`thumb-annots-${pageIndex}`} className="pointer-events-none absolute inset-0 overflow-hidden">
      <div style={{ position: 'absolute', left: 0, top: 0, width: W * s, height: H * s, transformOrigin: '0 0', transform }}>
        {uids.map((uid) => {
          const t = state.byUid[uid];
          if (!t || t.commitState === 'deleted' || SKIP.has(t.object.type)) return null;
          return <ThumbAnnotation key={uid} documentId={documentId} t={t} s={s} />;
        })}
      </div>
    </div>
  );
}

const ThumbAnnotation = memo(function ThumbAnnotation({ documentId, t, s }: { documentId: string; t: TrackedAnnotation; s: number }) {
  const o = t.object;
  if (o.type === PdfAnnotationSubtype.FREETEXT) return <ThumbFreeText obj={o as PdfFreeTextAnnoObject} s={s} />;
  if (o.type === PdfAnnotationSubtype.HIGHLIGHT) {
    const h = o as PdfAnnotationObject & { segmentRects?: Rect[]; strokeColor?: string; color?: string; opacity?: number };
    const color = h.strokeColor ?? h.color ?? '#ffd43b';
    return (
      <>
        {(h.segmentRects?.length ? h.segmentRects : [h.rect]).map((r, i) => (
          <div key={i} data-thumb-annot="highlight" style={{ ...box(r, s), background: color, opacity: h.opacity ?? 0.55, mixBlendMode: 'multiply' }} />
        ))}
      </>
    );
  }
  if (o.type === PdfAnnotationSubtype.TEXT) {
    const n = o as PdfAnnotationObject & { strokeColor?: string; color?: string };
    return (
      <div
        data-thumb-annot="note"
        style={{ ...box(o.rect, s), background: n.strokeColor ?? n.color ?? '#ffcd45', borderRadius: 2, boxShadow: '0 0 0 0.5px rgba(0,0,0,.35)' }}
      />
    );
  }
  return <ThumbAppearance documentId={documentId} t={t} s={s} />;
});

function ThumbFreeText({ obj, s }: { obj: PdfFreeTextAnnoObject; s: number }) {
  const { metrics } = useTextFont();
  const local = obj.unrotatedRect ?? obj.rect;
  const border = obj.strokeWidth ?? 0;
  const layout = useMemo(
    () =>
      metrics
        ? layoutFreeText(metrics, {
            text: obj.contents ?? '',
            fontSize: obj.fontSize,
            align: obj.textAlign,
            valign: obj.verticalAlign,
            width: local.size.width,
            height: local.size.height,
            borderWidth: border,
          })
        : null,
    [metrics, obj.contents, obj.fontSize, obj.textAlign, obj.verticalAlign, local.size.width, local.size.height, border],
  );
  const bg = obj.color ?? obj.backgroundColor;
  return (
    <div
      data-thumb-annot="freetext"
      style={{
        ...box(local, s),
        overflow: 'hidden',
        background: bg && bg !== 'transparent' ? bg : undefined,
        opacity: obj.opacity,
        border: border ? `${border * s}px solid ${obj.fontColor}` : undefined,
        boxSizing: 'border-box',
        transform: obj.rotation && obj.unrotatedRect ? `rotate(${obj.rotation}deg)` : undefined,
      }}
    >
      {layout && <FreeTextLines obj={obj} layout={layout} scale={s} />}
    </div>
  );
}

/** The engine's render of the annotation's appearance, refreshed when it is committed again. */
function ThumbAppearance({ documentId, t, s }: { documentId: string; t: TrackedAnnotation; s: number }) {
  const { provides } = useAnnotationCapability();
  const [url, setUrl] = useState<string | null>(null);
  const o = t.object;
  const synced = t.commitState === 'synced';
  const key = `${o.rect.origin.x},${o.rect.origin.y},${o.rect.size.width},${o.rect.size.height},${o.rotation ?? 0}`;
  useEffect(() => {
    if (!provides || !synced) return;
    let alive = true;
    let made: string | null = null;
    const task = provides.forDocument(documentId).renderAnnotation({
      pageIndex: o.pageIndex,
      annotation: o,
      options: { scaleFactor: s, dpr: Math.min(2, window.devicePixelRatio || 1) },
    });
    task.wait(
      (blob) => {
        if (!alive) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      },
      () => {},
    );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provides, documentId, o.id, key, synced, s]);
  if (!url) return null;
  return <img data-thumb-annot="appearance" src={url} alt="" style={{ ...box(o.rect, s), maxWidth: 'none' }} />;
}
