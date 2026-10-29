import { useEffect, useState, useSyncExternalStore } from 'react';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import { useAnnotation } from '@embedpdf/plugin-annotation/react';
import { cn } from '@/lib/utils';
import { usePlacement } from './images/placement';
import { isEzImage, isLockedForeignStamp } from './images/stamp-guard';

const TOOL_HINTS: Record<string, string> = {
  freeText: 'Bấm vào trang để đặt ô chữ, hoặc kéo để vẽ ô. Esc để quay về chọn.',
  highlight: 'Kéo qua đoạn chữ cần tô sáng. Esc để quay về chọn.',
  textComment: 'Bấm vào chỗ cần ghi chú, rồi viết nội dung ở cột bên phải.',
};

/**
 * A short confirmation shown in the hint strip for a moment, e.g. which page
 * was just rotated (on a phone the page number is not on screen). It only
 * shows when no tool, editor or selection has something to say.
 */
let flash: { text: string; until: number } | null = null;
const flashListeners = new Set<() => void>();
const emitFlash = () => flashListeners.forEach((l) => l());

export function flashHint(text: string, ms = 2600) {
  flash = { text, until: Date.now() + ms };
  emitFlash();
  setTimeout(() => {
    if (flash && Date.now() >= flash.until) {
      flash = null;
      emitFlash();
    }
  }, ms + 20);
}

function useFlash() {
  return useSyncExternalStore(
    (cb) => {
      flashListeners.add(cb);
      return () => flashListeners.delete(cb);
    },
    () => flash?.text ?? null,
  );
}

/** True while a FreeText editor on the page has focus. */
function useEditingText() {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const check = () => setEditing(document.activeElement?.getAttribute('data-testid') === 'freetext-editor');
    const later = () => setTimeout(check, 0);
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', later);
    return () => {
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', later);
    };
  }, []);
  return editing;
}

/**
 * One line at the bottom of the page area saying what the active tool does
 * and how to leave it — the tool state is never only an icon.
 */
export function ToolHint({ documentId }: { documentId: string }) {
  const { state } = useAnnotation(documentId);
  const editing = useEditingText();
  const placing = usePlacement()?.placing;
  const flashText = useFlash();
  const tool = state.activeToolId;
  let text: string | null = placing
    ? `Bấm vào trang để đặt ${placing.kind === 'signature' ? 'chữ ký' : 'ảnh'} (Enter: giữa trang đang xem). Esc để hủy.`
    : editing
      ? 'Đang sửa chữ. Enter để xuống dòng, Esc hoặc bấm ra ngoài để xong.'
      : tool
        ? (TOOL_HINTS[tool] ?? null)
        : null;
  let tone: 'tool' | 'selection' = 'tool';
  if (!text && state.selectedUids.length) {
    tone = 'selection';
    const one = state.selectedUids.length === 1 ? state.byUid[state.selectedUids[0]]?.object : null;
    text =
      one?.type === PdfAnnotationSubtype.FREETEXT
        ? 'Kéo để di chuyển, kéo góc để đổi cỡ. Bấm đúp để sửa chữ. Delete để xóa.'
        : one?.type === PdfAnnotationSubtype.HIGHLIGHT
          ? 'Đổi màu hoặc viết lời nhắn ở cột bên phải. Delete để xóa.'
          : one && isEzImage(one)
            ? 'Kéo để di chuyển, kéo góc để đổi cỡ (giữ tỉ lệ). Delete để xóa.'
            : one && isLockedForeignStamp(one)
              ? 'Dấu có sẵn trong tệp: chỉ xóa được. Delete để xóa.'
              : 'Kéo để di chuyển. Delete để xóa.';
  }
  const kind = text ? 'hint' : 'flash';
  if (!text && flashText) {
    tone = 'selection';
    text = flashText;
  }
  if (!text) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-4">
      <p
        role="status"
        data-testid="tool-hint"
        data-kind={kind}
        className={cn(
          'max-w-[min(560px,100%)] rounded-full px-4 py-2 text-center text-[13px] leading-snug shadow-[0_2px_10px_rgba(0,0,0,0.18)]',
          tone === 'tool' ? 'bg-primary text-primary-foreground' : 'bg-foreground text-background',
        )}
      >
        {text}
      </p>
    </div>
  );
}
