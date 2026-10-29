/**
 * Page rotation that is saved into the file.
 *
 * G7: EmbedPDF 2.15.1 has no page-rotation API, and its core reducer ignores
 * REFRESH_DOCUMENT / SET_PAGES. The document is opened with
 * normalizeRotation, so the engine never uses a page's /Rotate itself: every
 * layer (render, tiles, thumbnails, layout, annotations, the Rotate wrapper)
 * takes rotation from the page objects in the core store. Replacing those
 * page objects therefore rotates the page everywhere on screen; the export
 * step writes the same values as /Rotate (FPDFPage_SetRotation).
 *
 * The swap is announced with actions the reducer does handle: REFRESH_PAGES
 * (thumbnails and page renders refresh) and SET_ROTATION with the unchanged
 * view rotation (layout, thumbnails and zoom recompute).
 */
import { useCallback } from 'react';
import { refreshPages, setRotation, type PluginRegistry } from '@embedpdf/core';
import { useRegistry } from '@embedpdf/core/react';
import { useHistoryCapability } from '@embedpdf/plugin-history/react';
import type { PdfPageObject, Rotation } from '@embedpdf/models';

export const PAGES_HISTORY_TOPIC = 'pages';

const quarter = (r: number) => ((Math.round(r) % 4) + 4) % 4;

export function getPageRotations(registry: PluginRegistry, documentId: string): number[] {
  const doc = registry.getStore().getState().core.documents[documentId]?.document;
  return doc ? doc.pages.map((p) => p.rotation) : [];
}

/** Set absolute rotations (quarter turns) for some pages, without history. */
export function applyPageRotations(registry: PluginRegistry, documentId: string, rotations: Record<number, number>) {
  const store = registry.getStore();
  const docState = store.getState().core.documents[documentId];
  const doc = docState?.document;
  if (!docState || !doc) return;
  const changed: number[] = [];
  const pages: PdfPageObject[] = doc.pages.map((p) => {
    const want = rotations[p.index];
    if (want === undefined || quarter(want) === p.rotation) return p;
    changed.push(p.index);
    return { ...p, rotation: quarter(want) as Rotation };
  });
  if (!changed.length) return;
  (docState as { document: typeof doc }).document = { ...doc, pages };
  store.dispatchToCore(refreshPages(documentId, changed));
  store.dispatchToCore(setRotation(docState.rotation, documentId));
}

/** Rotate pages by quarter turns as one undoable step. */
export function usePageRotation(documentId: string) {
  const { registry } = useRegistry();
  const { provides: history } = useHistoryCapability();
  return useCallback(
    (pageIndexes: number[], delta: number) => {
      if (!registry || !pageIndexes.length) return;
      const now = getPageRotations(registry, documentId);
      const before: Record<number, number> = {};
      const after: Record<number, number> = {};
      for (const i of pageIndexes) {
        if (now[i] === undefined) continue;
        before[i] = now[i];
        after[i] = quarter(now[i] + delta);
      }
      const command = {
        execute: () => applyPageRotations(registry, documentId, after),
        undo: () => applyPageRotations(registry, documentId, before),
      };
      if (history) history.forDocument(documentId).register(command, PAGES_HISTORY_TOPIC);
      else command.execute();
    },
    [registry, history, documentId],
  );
}
