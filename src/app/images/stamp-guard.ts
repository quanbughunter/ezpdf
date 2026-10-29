/**
 * Workarounds for EmbedPDF 2.15.1 image stamps.
 *
 * G11 — undo after delete brings a stamp back without its picture: the
 * plugin re-creates the annotation without the image context it was created
 * with. ezPDF keeps that context per stamp (the bytes it created it from, or
 * for stamps that came with the file, their appearance exported as a
 * one-page PDF when they get selected) and hands it to the plugin's pending
 * contexts at the moment the undo re-creates the stamp, before the commit
 * reaches the engine.
 *
 * G12 — a stamp whose /Name EmbedPDF doesn't know (read back as Unknown)
 * loses its appearance on any move or resize. Such stamps (only ever foreign:
 * ezPDF's own carry /Name /Image) are locked in place by a tool definition
 * with a higher match score; they can still be selected and deleted.
 */
import { useEffect } from 'react';
import { PdfAnnotationName, PdfAnnotationSubtype, type PdfAnnotationObject } from '@embedpdf/models';
import { useRegistry } from '@embedpdf/core/react';
import { useAnnotationCapability, useAnnotationPlugin } from '@embedpdf/plugin-annotation/react';
import type { AnnotationDocumentState, AnnotationTool } from '@embedpdf/plugin-annotation';
import { EZ_MARK } from '@/engine/vn-freetext-export';

type StampCtx = { data: ArrayBuffer; mimeType?: string };
const contexts = new Map<string, StampCtx>();

/** Remember what a stamp was made from (a private copy: the original buffer may be transferred to the engine worker). */
export function rememberStamp(id: string, data: ArrayBuffer, mimeType?: string) {
  contexts.set(id, { data: data.slice(0), mimeType });
}

export const isEzImage = (a: PdfAnnotationObject) =>
  a.type === PdfAnnotationSubtype.STAMP && !!(a.custom as Record<string, unknown> | undefined)?.[EZ_MARK];

export const isLockedForeignStamp = (a: PdfAnnotationObject) =>
  a.type === PdfAnnotationSubtype.STAMP &&
  !isEzImage(a) &&
  ((a as { name?: number }).name === undefined || (a as { name?: number }).name === PdfAnnotationName.Unknown);

/** Interaction rules for stamps; registered with the annotation plugin. */
export const STAMP_TOOLS: AnnotationTool[] = [
  {
    id: 'ezImage',
    name: 'Ảnh',
    matchScore: (a) => (isEzImage(a) ? 3 : 0),
    defaults: { type: PdfAnnotationSubtype.STAMP },
    interaction: {
      exclusive: false,
      isDraggable: true,
      isResizable: true,
      lockAspectRatio: true,
      lockGroupAspectRatio: true,
      // G10: PDFium crops a rotated image stamp; images stay axis-aligned.
      isRotatable: false,
    },
    behavior: { useAppearanceStream: false },
  } as AnnotationTool,
  {
    id: 'ezLockedStamp',
    name: 'Dấu có sẵn',
    matchScore: (a) => (isLockedForeignStamp(a) ? 3 : 0),
    defaults: { type: PdfAnnotationSubtype.STAMP },
    interaction: { exclusive: false, isDraggable: false, isResizable: false, isRotatable: false },
    behavior: { useAppearanceStream: false },
  } as AnnotationTool,
];

export function useStampUndoGuard(documentId: string) {
  const { registry } = useRegistry();
  const { plugin } = useAnnotationPlugin();
  const { provides } = useAnnotationCapability();

  useEffect(() => {
    if (!registry || !plugin || !provides) return;
    const scope = provides.forDocument(documentId);
    const pending = () =>
      (plugin as unknown as { pendingContexts?: Map<string, Map<string, StampCtx>> }).pendingContexts?.get(documentId);

    const offEvent = scope.onAnnotationEvent((ev) => {
      if (ev.type !== 'create' || ev.committed || ev.annotation.type !== PdfAnnotationSubtype.STAMP) return;
      if ((ev as { ctx?: unknown }).ctx) return;
      const saved = contexts.get(ev.annotation.id);
      const map = pending();
      if (saved && map && !map.has(ev.annotation.id)) {
        map.set(ev.annotation.id, { data: saved.data.slice(0), mimeType: saved.mimeType });
      }
    });

    const inFlight = new Set<string>();
    const capture = (st: AnnotationDocumentState) => {
      for (const uid of st.selectedUids) {
        const t = st.byUid[uid];
        if (!t || t.object.type !== PdfAnnotationSubtype.STAMP || t.commitState !== 'synced') continue;
        const id = t.object.id;
        if (contexts.has(id) || inFlight.has(id)) continue;
        const doc = registry.getStore().getState().core.documents[documentId]?.document;
        const page = doc?.pages[t.object.pageIndex];
        if (!doc || !page) continue;
        inFlight.add(id);
        registry
          .getEngine()
          .exportAnnotationAppearanceAsPdf(doc, page, t.object)
          .wait(
            (buf) => {
              inFlight.delete(id);
              if (!contexts.has(id)) contexts.set(id, { data: buf, mimeType: 'application/pdf' });
            },
            () => inFlight.delete(id),
          );
      }
    };
    capture(scope.getState());
    const offState = scope.onStateChange(capture);
    return () => {
      offEvent();
      offState();
    };
  }, [registry, plugin, provides, documentId]);
}
