import { useEffect, type RefObject } from 'react';
import { useInteractionManagerCapability } from '@embedpdf/plugin-interaction-manager/react';
import { HAND_MODE } from './hand';

/**
 * Touch on the pages, between the browser (scroll, pinch to zoom) and
 * EmbedPDF's pointer handlers (text selection, tools, annotations).
 *
 *  - Select and hand modes: a finger moving on the page is a scroll, never a text
 *    selection or a selection box, so its moves stop here (taps still pass:
 *    they select or deselect annotations). Annotations and their handles mark
 *    themselves with touch-action: none; those keep every event, so they can
 *    still be dragged and resized.
 *  - Any mode: once a second finger touches, the gesture is a pinch.
 *    Nothing below sees the second finger, nor any move or release of that
 *    gesture, so a pinch never draws, selects or places anything.
 */
export function useTouchGuard(root: RefObject<HTMLElement | null>, documentId: string) {
  const { provides: interaction } = useInteractionManagerCapability();
  useEffect(() => {
    const el = root.current;
    if (!el || !interaction) return;
    const down = new Set<number>();
    let pinching = false;
    const selectMode = () => {
      const m = interaction.forDocument(documentId).getActiveMode();
      return m === 'pointerMode' || m === HAND_MODE;
    };
    const onDraggable = (t: EventTarget | null) => t instanceof Element && !!t.closest('[style*="touch-action: none"]');

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      down.add(e.pointerId);
      if (down.size > 1) pinching = true;
      if (pinching) e.stopPropagation();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (pinching || (selectMode() && !onDraggable(e.target))) e.stopPropagation();
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      down.delete(e.pointerId);
      if (pinching) e.stopPropagation();
      if (!down.size) setTimeout(() => (pinching = false), 0); // let the click of this release be swallowed too
    };
    const onClick = (e: MouseEvent) => {
      if (pinching) e.stopPropagation();
    };
    const opts = { capture: true };
    el.addEventListener('pointerdown', onDown, opts);
    el.addEventListener('pointermove', onMove, opts);
    el.addEventListener('pointerup', onUp, opts);
    el.addEventListener('pointercancel', onUp, opts);
    el.addEventListener('click', onClick, opts);
    return () => {
      el.removeEventListener('pointerdown', onDown, opts);
      el.removeEventListener('pointermove', onMove, opts);
      el.removeEventListener('pointerup', onUp, opts);
      el.removeEventListener('pointercancel', onUp, opts);
      el.removeEventListener('click', onClick, opts);
    };
  }, [root, interaction, documentId]);
}
