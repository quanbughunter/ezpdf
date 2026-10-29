import { useCallback, useEffect, useSyncExternalStore, type RefObject } from 'react';
import { useInteractionManagerCapability } from '@embedpdf/plugin-interaction-manager/react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';

/**
 * The hand: dragging the page with the mouse scrolls it, as in a PDF reader.
 *
 * It is an interaction mode of its own next to EmbedPDF's "pointerMode"
 * (select): text selection and the selection box are only enabled for
 * pointerMode, so here a drag on the page selects nothing. Annotations stay
 * clickable (their elements sit under [data-no-interaction] and handle their
 * own pointer events), so a note or a picture can still be selected, moved
 * and resized without changing tool.
 *
 * Mouse and pen only: a finger already scrolls the page natively
 * (wantsRawTouch: false keeps touch-action pan-x pan-y).
 */
export const HAND_MODE = 'ezHand';
export type PointerTool = 'hand' | 'select';
export const modeFor = (t: PointerTool) => (t === 'hand' ? HAND_MODE : 'pointerMode');

/**
 * Which of the two is the resting tool: the one Esc and a finished tool go
 * back to. A mouse device starts with the hand; a touch-first device (phone,
 * tablet) keeps select, where a finger scrolls and a tap selects.
 */
let current: PointerTool = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 'select' : 'hand';
const listeners = new Set<() => void>();

export const pointerTool = {
  get: () => current,
  set(t: PointerTool) {
    if (t === current) return;
    current = t;
    listeners.forEach((l) => l());
  },
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => void listeners.delete(cb);
  },
};

export const usePointerTool = () => useSyncExternalStore(pointerTool.subscribe, pointerTool.get);

/**
 * Registers the two resting modes and keeps EmbedPDF's default mode (where
 * setActiveTool(null) lands) in step with the chosen one. Runs before any
 * page mounts.
 */
export function useRestingModes() {
  const { provides: interaction } = useInteractionManagerCapability();
  useEffect(() => {
    if (!interaction) return;
    interaction.registerMode({ id: 'pointerMode', scope: 'page', exclusive: false, cursor: 'auto', wantsRawTouch: false });
    interaction.registerMode({ id: HAND_MODE, scope: 'global', exclusive: false, cursor: 'grab', wantsRawTouch: false });
    const apply = () => interaction.setDefaultMode(modeFor(pointerTool.get()));
    apply();
    return pointerTool.subscribe(apply);
  }, [interaction]);
}

/** Switch the resting tool and go to it now (leaving any drawing tool). */
export function useSetPointerTool(documentId: string) {
  const { provides: interaction } = useInteractionManagerCapability();
  const { provides: annotations } = useAnnotationCapability();
  return useCallback(
    (t: PointerTool) => {
      pointerTool.set(t);
      annotations?.forDocument(documentId).setActiveTool(null);
      interaction?.forDocument(documentId).activate(modeFor(t));
    },
    [interaction, annotations, documentId],
  );
}

/**
 * Drag with the left button (or a pen) on the page or its margin to scroll.
 * Taken in the capture phase, before EmbedPDF's page handlers: a pan keeps
 * the selected annotation selected (EmbedPDF would deselect on any press on
 * the page); a click without a drag deselects, as in select mode.
 */
export function useHandPan(root: RefObject<HTMLElement | null>, documentId: string) {
  const { provides: interaction } = useInteractionManagerCapability();
  const { provides: annotations } = useAnnotationCapability();
  useEffect(() => {
    const el = root.current;
    if (!el || !interaction) return;
    const scope = interaction.forDocument(documentId);
    // A document starts in its resting mode without a mode change, so the
    // mode's cursor is not published yet: claim the open hand (a later mode
    // change clears the claim).
    try {
      if (scope.getActiveMode() === HAND_MODE) scope.setCursor('ez-hand-rest', 'grab', 0);
    } catch {}
    let drag: { id: number; x: number; y: number; left: number; top: number; moved: boolean; vp: HTMLElement } | null = null;

    const onDown = (e: PointerEvent) => {
      if (drag || e.pointerType === 'touch' || e.button !== 0) return;
      let mode: string;
      try {
        mode = scope.getActiveMode();
      } catch {
        return; // document closing
      }
      if (mode !== HAND_MODE) return;
      // annotations, their handles, and layers with their own handling (placing a
      // picture, editing text) keep their behaviour; same rule as EmbedPDF's
      if (e.target instanceof Element && e.target.closest('[data-no-interaction]')) return;
      const vp = el.querySelector<HTMLElement>('[data-ez-viewport]');
      if (!vp) return;
      const r = vp.getBoundingClientRect();
      if (e.clientX >= r.left + vp.clientWidth || e.clientY >= r.top + vp.clientHeight) return; // its scrollbars
      e.preventDefault(); // no native text selection or image drag
      // A text box being typed in ends the way a click outside ends it:
      // EmbedPDF's page handler must see this press. Otherwise nothing below
      // needs it, and the selection survives the pan.
      const typingInBox = document.activeElement instanceof HTMLElement && document.activeElement.dataset.testid === 'freetext-editor';
      if (!typingInBox) e.stopPropagation();
      // preventDefault also keeps focus where it was: end typing in a box or the page number
      const a = document.activeElement;
      if (a instanceof HTMLElement && a !== document.body) a.blur();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop, moved: false, vp };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
      el.style.cursor = 'grabbing';
      scope.setCursor('ez-hand', 'grabbing', 100);
    };
    const finish = (pointerId: number, click: boolean) => {
      if (!drag || pointerId !== drag.id) return;
      drag = null;
      el.style.cursor = '';
      try {
        el.releasePointerCapture(pointerId);
      } catch {}
      try {
        scope.removeCursor('ez-hand');
      } catch {}
      // a click on the page (not on an annotation) leaves the selection, as in select mode
      if (click) annotations?.forDocument(documentId).deselectAnnotation();
    };
    const onMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      // the release went elsewhere (window switch, capture lost): stop here
      if ((e.buttons & 1) === 0) return finish(e.pointerId, false);
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      drag.vp.scrollLeft = drag.left - dx;
      drag.vp.scrollTop = drag.top - dy;
    };
    const onUp = (e: PointerEvent) => finish(e.pointerId, !!drag && !drag.moved);
    const onCancel = (e: PointerEvent) => finish(e.pointerId, false);
    el.addEventListener('pointerdown', onDown, { capture: true });
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('lostpointercapture', onCancel);
    return () => {
      if (drag) finish(drag.id, false);
      el.removeEventListener('pointerdown', onDown, { capture: true });
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('lostpointercapture', onCancel);
    };
  }, [root, interaction, annotations, documentId]);
}

/**
 * How the focused element got focus: a button clicked with the mouse keeps
 * focus, but Space should not press it again; one reached with Tab should.
 * (Chromium's :focus-visible flips to "keyboard" on any key press, so it
 * cannot tell at Space time.)
 */
let focusByPointer = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => (focusByPointer = true), true);
  window.addEventListener('keydown', (e) => e.key === 'Tab' && (focusByPointer = false), true);
}

/** Where Space keeps its own meaning: typing, menus and dialogs, a button reached with the keyboard. */
const keepsSpace = (t: EventTarget | null) => {
  const el = t instanceof HTMLElement ? t : null;
  if (!el || el === document.body) return false;
  if (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  if (el.closest('[role="menu"],[role="dialog"],[role="listbox"]')) return true;
  if (/^(BUTTON|A)$/.test(el.tagName) || el.closest('[role="button"],[role="tab"]')) return !focusByPointer;
  return false;
};

/**
 * Hold Space to drag the page with any tool, let go to get the tool back
 * (as in Acrobat or a drawing program). A tap of Space without a drag still
 * pages down, Shift+Space up. Not where Space keeps its own meaning.
 */
export function useSpaceToPan(documentId: string, blocked: () => boolean) {
  const { provides: interaction } = useInteractionManagerCapability();
  const { provides: annotations } = useAnnotationCapability();
  useEffect(() => {
    if (!interaction || !annotations) return;
    const scope = interaction.forDocument(documentId);
    const annot = annotations.forDocument(documentId);
    /** tool and mode to go back to; `changed`: the user chose something else meanwhile */
    let held: { tool: string | null; mode: string | null; dragged: boolean; changed: boolean } | null = null;
    const restore = () => {
      const h = held;
      held = null;
      if (!h || h.changed || !h.mode) return;
      try {
        if (scope.getActiveMode() !== HAND_MODE) return; // already left the hand some other way
        if (h.tool) annot.setActiveTool(h.tool);
        else scope.activate(h.mode);
      } catch {}
    };
    const page = (up: boolean) => {
      const vp = document.querySelector<HTMLElement>('[data-ez-viewport]');
      vp?.scrollBy({ top: (up ? -1 : 1) * vp.clientHeight * 0.9 });
    };
    const onDown = (e: KeyboardEvent) => {
      if (held && e.code !== 'Space') {
        held.changed = true; // a tool key or Esc while holding Space wins over the restore
        return;
      }
      if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (held) return void e.preventDefault(); // auto-repeat
      if (e.repeat || keepsSpace(e.target) || blocked()) return;
      e.preventDefault();
      let mode: string;
      try {
        mode = scope.getActiveMode();
      } catch {
        return;
      }
      if (e.shiftKey) {
        page(true);
        return;
      }
      held = { tool: annot.getActiveTool()?.id ?? null, mode: mode === HAND_MODE ? null : mode, dragged: false, changed: false };
      if (mode !== HAND_MODE) scope.activate(HAND_MODE);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !held) return;
      e.preventDefault();
      const tap = !held.dragged;
      restore();
      if (tap) page(false);
    };
    const onPointer = () => held && (held.dragged = true);
    const onBlur = () => {
      if (held) held.dragged = true; // no page step for a key let go elsewhere
      restore();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('blur', onBlur);
      restore();
    };
  }, [interaction, annotations, documentId, blocked]);
}
