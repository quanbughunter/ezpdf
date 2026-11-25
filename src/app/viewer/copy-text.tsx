/**
 * Copying the PDF's selected text (Ctrl C, the "Sao chép" button by the
 * selection).
 *
 * EmbedPDF draws the text selection itself: there is no text in the page
 * for the browser to copy, so Ctrl C used to put nothing on the clipboard.
 * Here the selected text is read from the engine as soon as a selection is
 * made and kept ready; the page's copy event (Ctrl C, Edit → Copy) then puts
 * it on the clipboard at once, which every browser and WebView allows. If
 * the text is not ready yet (Ctrl C right after letting go of the mouse), it
 * is fetched and written with the Clipboard API instead.
 *
 * A copy aimed at something else (a box being typed in, the search panel's
 * own text) is left to the browser.
 */
import { useSelectionCapability } from '@embedpdf/plugin-selection/react';
import type { SelectionSelectionMenuProps } from '@embedpdf/plugin-selection/react';
import { ignore } from '@embedpdf/models';
import { Copy } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { copyText } from '../file-info';
import { flashHint } from '../tool-hint';

/** the engine's text, as one would paste it: one line break between lines and pages */
export const clipboardText = (parts: string[]) =>
  parts
    .map((p) => p.replace(/\r\n?/g, '\n'))
    .join('\n')
    .replace(/\u0000/g, '');

/**
 * A field with text selected in it, or a box being edited: its copy is the browser's. A
 * field that only has the focus (the search box, after a search and a drag on the page:
 * the page does not take the focus) does not count.
 */
const editable = (t: EventTarget | null) => {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
    try {
      return t.selectionStart !== null && t.selectionStart !== t.selectionEnd;
    } catch {
      return false; // a kind of input without a text selection (checkbox, number)
    }
  }
  return t.isContentEditable;
};

/** text the browser itself has selected (a panel's text, a field), which is the browser's to copy */
const nativeSelection = () => {
  const s = window.getSelection();
  return !!s && !s.isCollapsed && s.toString().trim().length > 0;
};

const copied = (text: string) => flashHint(`Đã chép ${text.length} ký tự vào bộ nhớ tạm. Dán bằng Ctrl V.`);
/** the engine refuses when the file forbids copying its text (permission CopyContents) */
const refused = () => flashHint('Tệp này không cho chép chữ (người tạo tệp đã khóa việc chép).');

/** through the Clipboard API (or the old copy command) */
async function write(text: string) {
  if (!text) return;
  if (await copyText(text)) copied(text);
  else flashHint('Không chép được: trình duyệt không cho ghi vào bộ nhớ tạm.');
}

interface Ready {
  text: string | null;
  /** a selection is there (its text may still be on its way) */
  selected: boolean;
}

/** shared by the copy event and the button: the current document's selection */
const current: { documentId: string | null; ready: Ready; fetch: (() => Promise<string>) | null } = {
  documentId: null,
  ready: { text: null, selected: false },
  fetch: null,
};

/** The selected text of `documentId`, kept ready, and Ctrl C / Copy for it. */
export function useCopyText(documentId: string) {
  const { provides: sel } = useSelectionCapability();
  const seq = useRef(0);
  useEffect(() => {
    if (!sel) return;
    const scope = sel.forDocument(documentId);
    const fetch = () =>
      new Promise<string>((resolve, reject) =>
        scope.getSelectedText().wait(
          (parts) => resolve(clipboardText(parts)),
          (e) => reject(e),
        ),
      );
    current.documentId = documentId;
    current.ready = { text: null, selected: !!scope.getState().selection };
    current.fetch = fetch;
    const off = sel.onSelectionChange(({ documentId: d, selection }) => {
      if (d !== documentId) return;
      const n = ++seq.current;
      current.ready = { text: null, selected: !!selection };
      if (!selection) return;
      fetch().then(
        (text) => n === seq.current && (current.ready = { text, selected: true }),
        ignore,
      );
    });

    // Some browsers (Safari) send no copy event when nothing of the page is selected:
    // Ctrl C then writes through the Clipboard API, unless the copy event came.
    let handled = false;
    const onCopy = (e: ClipboardEvent) => {
      handled = true;
      if (editable(e.target) || editable(document.activeElement) || nativeSelection()) return;
      const { text, selected } = current.ready;
      if (!selected) return;
      e.preventDefault();
      if (text) {
        e.clipboardData?.setData('text/plain', text);
        copied(text);
      } else {
        void fetch().then(write, refused);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'c') return;
      if (!current.ready.selected || editable(e.target) || nativeSelection()) return;
      handled = false;
      setTimeout(() => {
        if (handled) return;
        void (current.ready.text ? Promise.resolve(current.ready.text) : fetch()).then(write, refused);
      }, 60);
    };
    document.addEventListener('copy', onCopy);
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      document.removeEventListener('copy', onCopy);
      window.removeEventListener('keydown', onKey);
      if (current.documentId === documentId) {
        current.documentId = null;
        current.ready = { text: null, selected: false };
        current.fetch = null;
      }
    };
  }, [sel, documentId]);
}

/** Copies the current selection (the button: a click, so the Clipboard API may write). */
async function copyNow() {
  const { text } = current.ready;
  if (text) return write(text);
  if (current.fetch) await current.fetch().then(write, refused);
}

/** The small bar by a text selection: "Sao chép". */
export function selectionMenu({ menuWrapperProps, rect, placement }: SelectionSelectionMenuProps) {
  // above the selection, so the next line stays readable; below when the top of the view is too close
  const below = (placement.spaceAbove ?? 0) < 56;
  return (
    <div {...menuWrapperProps}>
      <div
        data-testid="selection-menu"
        style={{
          position: 'absolute',
          left: rect.size.width / 2,
          top: below ? rect.size.height + 8 : -8,
          transform: below ? 'translateX(-50%)' : 'translate(-50%, -100%)',
          pointerEvents: 'auto',
        }}
        // the page would take a press here as the start of a new selection
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => void copyNow()}
          data-testid="selection-copy"
          title="Chép chữ đã chọn (Ctrl C)"
          className="flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-[13px] font-medium whitespace-nowrap text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.16)] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <Copy className="size-4" /> Sao chép
        </button>
      </div>
    </div>
  );
}
