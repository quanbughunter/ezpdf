/**
 * "Sửa chữ có sẵn": change a line of text that is already in the PDF.
 *
 * While the tool is on, ezPDF's PDFium worker holds a copy of the document
 * (engine/text-edit.ts). Each page shows its lines as dashed boxes; a tap on
 * one opens the edit bar. Saving replaces the line's text objects in the page
 * content, then the viewer reopens the document from the new bytes, keeping
 * the draft, the page rotations, the zoom and the scroll position.
 *
 * The old text is removed from the file, never covered. When the line's own
 * font cannot draw a new character, the bar says so before saving, and the
 * line is set in ezSansVN.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Loader2, TriangleAlert } from 'lucide-react';
import { useDocumentState } from '@embedpdf/core/react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { useHistoryCapability } from '@embedpdf/plugin-history/react';
import type { PdfPageObject } from '@embedpdf/models';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  closeTextEditSession,
  openTextEditSession,
  replaceTextLine,
  textLines,
  UserFacingError,
} from '@/engine/export-client';
import { describeEdit, normalizeLineText, type TextLine } from '@/engine/text-edit';
import type { DocumentSession } from './use-document-session';
import { usePlacement } from './images/placement';

const ACCENT = '#0b6e69';

type Status = 'off' | 'opening' | 'ready' | 'saving';

export interface TextEditApi {
  active: boolean;
  status: Status;
  /** result of the last action, or why it failed */
  message: { text: string; tone: 'ok' | 'warn' | 'error' } | null;
  selected: { pageIndex: number; line: TextLine } | null;
  setActive(on: boolean): void;
  /** lines of a page, null while loading (the request starts on first call) */
  lines(pageIndex: number): TextLine[] | null;
  select(pageIndex: number, line: TextLine): void;
  explain(line: TextLine): void;
  cancel(): void;
  commit(text: string): Promise<void>;
  /** content undo/redo, after EmbedPDF's own history */
  contentUndo: DocumentSession['contentUndo'];
}

const Ctx = createContext<TextEditApi | null>(null);
export const useTextEdit = () => useContext(Ctx);

export function TextEditProvider({
  documentId,
  session,
  children,
}: {
  documentId: string | null;
  session: DocumentSession;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<Status>('off');
  const [message, setMessage] = useState<TextEditApi['message']>(null);
  const [selected, setSelected] = useState<TextEditApi['selected']>(null);
  const [tick, bump] = useState(0);
  const sessionId = useRef<Promise<number> | null>(null);
  const base = useRef<ArrayBuffer | null>(null);
  const cache = useRef(new Map<number, TextLine[] | 'loading'>());
  const generation = useRef(0);
  const { provides: annotations } = useAnnotationCapability();
  const { provides: history } = useHistoryCapability();
  const placement = usePlacement();
  const active = status !== 'off';

  const dropSession = useCallback(() => {
    const s = sessionId.current;
    sessionId.current = null;
    base.current = null;
    cache.current.clear();
    generation.current++;
    if (s) void s.then(closeTextEditSession, () => {});
    bump((n) => n + 1);
  }, []);

  const ensureSession = useCallback(() => {
    if (sessionId.current) return sessionId.current;
    const p = (async () => {
      const bytes = await session.currentBytes();
      base.current = bytes.slice(0);
      return openTextEditSession(bytes);
    })();
    sessionId.current = p;
    p.catch(() => {
      if (sessionId.current === p) sessionId.current = null;
    });
    return p;
  }, [session]);

  // The document changed under the worker's copy: start a new copy when needed.
  useEffect(() => dropSession, [session.contentEpoch, dropSession]);
  useEffect(() => history?.onHistoryChange(() => sessionId.current && dropSession()), [history, dropSession]);

  const setActive = useCallback(
    (on: boolean) => {
      setSelected(null);
      setMessage(null);
      if (!on) {
        setStatus('off');
        dropSession();
        return;
      }
      placement?.cancel();
      if (documentId && annotations) {
        const scope = annotations.forDocument(documentId);
        scope.setActiveTool(null);
        scope.deselectAnnotation();
      }
      setStatus('opening');
      ensureSession().then(
        () => setStatus((s) => (s === 'opening' ? 'ready' : s)),
        (e) => {
          setStatus('off');
          dropSession();
          setMessage({ text: `Không bật được sửa chữ: ${e instanceof Error ? e.message : String(e)}`, tone: 'error' });
        },
      );
    },
    [documentId, annotations, placement, ensureSession, dropSession],
  );

  // Another tool took over.
  const activeTool = useActiveTool(documentId);
  useEffect(() => {
    if (activeTool && active) setActive(false);
  }, [activeTool, active, setActive]);
  useEffect(() => {
    if (placement?.placing && active) setActive(false);
  }, [placement?.placing, active, setActive]);
  // Another document opened, or this one closed.
  const docEpoch = useRef(session.docEpoch);
  useEffect(() => {
    if (docEpoch.current === session.docEpoch) return;
    docEpoch.current = session.docEpoch;
    setActive(false);
  }, [session.docEpoch, setActive]);

  const lines = useCallback(
    (pageIndex: number): TextLine[] | null => {
      if (!active) return null;
      const hit = cache.current.get(pageIndex);
      if (hit === 'loading') return null;
      if (hit) return hit;
      cache.current.set(pageIndex, 'loading');
      const gen = generation.current;
      ensureSession()
        .then((id) => textLines(id, pageIndex))
        .then(
          (ls) => {
            if (gen !== generation.current) return;
            cache.current.set(pageIndex, ls);
            bump((n) => n + 1);
          },
          () => {
            if (gen === generation.current) cache.current.delete(pageIndex);
          },
        );
      return null;
    },
    [active, ensureSession],
  );

  const commit = useCallback(
    async (text: string) => {
      const sel = selected;
      if (!sel || status !== 'ready') return;
      if (normalizeLineText(text) === sel.line.text) {
        setSelected(null);
        return;
      }
      setStatus('saving');
      setMessage(null);
      try {
        const id = await ensureSession();
        const previous = base.current;
        const r = await replaceTextLine(id, sel.pageIndex, sel.line.key, text);
        base.current = r.bytes.slice(0);
        cache.current.delete(sel.pageIndex);
        setSelected(null);
        setMessage(
          r.report.fontKept
            ? { text: `Đã sửa dòng, giữ phông gốc ${r.report.fontName}. Chọn dòng khác để sửa tiếp.`, tone: 'ok' }
            : {
                text: `Đã sửa dòng bằng phông ${r.report.fontName} vì ${r.report.fallbackReason}.`,
                tone: 'warn',
              },
        );
        if (previous) await session.replaceContent(r.bytes, previous);
        setStatus((s) => (s === 'saving' ? 'ready' : s));
      } catch (e) {
        setStatus((s) => (s === 'saving' ? 'ready' : s));
        if (e instanceof UserFacingError) setMessage({ text: e.message, tone: 'error' });
        else {
          dropSession();
          setMessage({ text: `Không sửa được dòng: ${e instanceof Error ? e.message : String(e)}`, tone: 'error' });
        }
      }
    },
    [selected, status, ensureSession, session, dropSession],
  );

  const api = useMemo<TextEditApi>(
    () => ({
      active,
      status,
      message,
      selected,
      setActive,
      lines,
      select: (pageIndex, line) => {
        setMessage(null);
        setSelected({ pageIndex, line });
      },
      explain: (line) => setMessage({ text: line.reason ?? 'Dòng này không sửa được.', tone: 'warn' }),
      cancel: () => setSelected(null),
      commit,
      contentUndo: session.contentUndo,
    }),
    // `tick` changes when a page's lines arrive, so pages asking for them re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, status, message, selected, setActive, lines, commit, session.contentUndo, tick],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

function useActiveTool(documentId: string | null) {
  const { provides } = useAnnotationCapability();
  const [tool, setTool] = useState<string | null>(null);
  useEffect(() => {
    if (!provides || !documentId) return;
    const scope = provides.forDocument(documentId);
    setTool(scope.getActiveTool()?.id ?? null);
    return scope.onActiveToolChange((t) => setTool(t?.id ?? null));
  }, [provides, documentId]);
  return tool;
}

// ---- page layer ---------------------------------------------------------------

/** PDF user space (y up) → EmbedPDF page space (y down, from the crop box corner). */
function toPageRect(page: PdfPageObject, b: TextLine['box']) {
  const crop = (page as PdfPageObject & { boxes?: { crop?: { left: number; bottom: number } } }).boxes?.crop;
  const ox = crop?.left ?? 0;
  const oy = crop?.bottom ?? 0;
  return { x: b.left - ox, y: page.size.height - (b.top - oy), w: b.right - b.left, h: b.top - b.bottom };
}

export function TextEditLayer({ documentId, pageIndex }: { documentId: string; pageIndex: number }) {
  const api = useTextEdit();
  const docState = useDocumentState(documentId);
  const ref = useRef<HTMLDivElement>(null);
  const page = docState?.document?.pages[pageIndex];
  const scale = docState?.scale ?? 1;
  const r = page ? ((page.rotation ?? 0) + (docState?.rotation ?? 0)) % 4 : 0;
  const lines = api?.active ? api.lines(pageIndex) : null;

  useEffect(() => {
    const el = ref.current;
    if (!el || !page || !api?.active || !lines) return;
    const toPage = (e: PointerEvent) => {
      const b = el.getBoundingClientRect();
      const u = (e.clientX - b.left) / b.width;
      const v = (e.clientY - b.top) / b.height;
      const { width: W, height: H } = page.size;
      const [x, y] = r === 0 ? [u * W, v * H] : r === 1 ? [v * W, (1 - u) * H] : r === 2 ? [(1 - u) * W, (1 - v) * H] : [(1 - v) * W, u * H];
      return { x, y };
    };
    let down: { x: number; y: number; id: number } | null = null;
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
      if (moved > 8) return; // a scroll, not a tap
      const p = toPage(e);
      let best: { line: TextLine; d: number } | null = null;
      for (const line of lines) {
        const q = toPageRect(page, line.box);
        const pad = Math.max(2, line.fontSize * 0.25);
        if (p.x < q.x - pad || p.x > q.x + q.w + pad || p.y < q.y - pad || p.y > q.y + q.h + pad) continue;
        const d = Math.abs(p.y - (q.y + q.h / 2));
        if (!best || d < best.d) best = { line, d };
      }
      if (!best) return void api.cancel();
      if (best.line.editable) api.select(pageIndex, best.line);
      else api.explain(best.line);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [api, page, r, lines, pageIndex]);

  if (!api?.active || !page) return null;
  const sel = api.selected?.pageIndex === pageIndex ? api.selected.line.key : null;
  return (
    <div
      ref={ref}
      data-testid={`textedit-layer-${pageIndex}`}
      data-ready={lines ? 'true' : 'false'}
      style={{ position: 'absolute', inset: 0, zIndex: 20, cursor: 'text', touchAction: 'pan-x pan-y pinch-zoom' }}
    >
      {lines?.map((line) => {
        const q = toPageRect(page, line.box);
        const pad = 1.5;
        const on = line.key === sel;
        return (
          <div
            key={line.key}
            data-testid="textedit-line"
            data-key={line.key}
            data-text={line.text}
            data-editable={line.editable ? 'true' : 'false'}
            data-box={JSON.stringify(line.box)}
            className={cn('absolute rounded-[2px]', line.editable ? 'hover:bg-primary/10' : 'cursor-not-allowed')}
            style={{
              left: (q.x - pad) * scale,
              top: (q.y - pad) * scale,
              width: (q.w + pad * 2) * scale,
              height: (q.h + pad * 2) * scale,
              outline: on ? `2px solid ${ACCENT}` : line.editable ? `1px dashed ${ACCENT}80` : '1px dotted #9ca3af',
              background: on ? `${ACCENT}22` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

// ---- edit bar -------------------------------------------------------------------

export function TextEditBar() {
  const api = useTextEdit();
  const sel = api?.selected ?? null;
  if (!api || !sel) return null;
  return <EditBar key={`${sel.pageIndex}:${sel.line.key}`} api={api} pageIndex={sel.pageIndex} line={sel.line} />;
}

/**
 * Keep the selected line in sight: below the bar and above the on-screen
 * keyboard (the visual viewport shrinks when it opens).
 */
function keepLineVisible(pageIndex: number, key: string) {
  const el = document.querySelector<HTMLElement>(`[data-testid="textedit-layer-${pageIndex}"] [data-key="${CSS.escape(key)}"]`);
  if (!el) return;
  let scroller: HTMLElement | null = el.parentElement;
  while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) {
    scroller = scroller.parentElement;
  }
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();
  const vv = window.visualViewport;
  const top = box.top + 12;
  const bottom = Math.min(box.bottom, vv ? vv.offsetTop + vv.height : box.bottom) - 56; // the hint strip
  const r = el.getBoundingClientRect();
  if (r.top < top) scroller.scrollBy({ top: r.top - top, behavior: 'instant' });
  else if (r.bottom > bottom) scroller.scrollBy({ top: Math.min(r.bottom - bottom, r.top - top), behavior: 'instant' });
}

export const isTouchFirst = () => window.matchMedia('(pointer: coarse)').matches;

function EditBar({ api, pageIndex, line }: { api: TextEditApi; pageIndex: number; line: TextLine }) {
  const [text, setText] = useState(line.text);
  const input = useRef<HTMLInputElement>(null);
  const saving = api.status === 'saving';
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    // after the bar has taken its place above the pages
    const t = requestAnimationFrame(() => requestAnimationFrame(() => keepLineVisible(pageIndex, line.key)));
    const onResize = () => keepLineVisible(pageIndex, line.key);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(t);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, [pageIndex, line.key]);
  const edit = describeEdit(line, text);
  const missing = edit?.missing ?? [];
  const font = edit?.font ?? { name: line.fontName, bold: line.bold, italic: line.italic, embedded: line.fontEmbedded };
  // which part of the line gets rewritten, in the user's words
  const what = !edit ? null : edit.whole ? 'cả dòng' : `phần “${edit.replaced}”`;
  const unchanged = normalizeLineText(text) === line.text;
  const empty = !normalizeLineText(text);
  return (
    <div className="z-20 flex shrink-0 justify-center border-b bg-background px-2 py-2 shadow-[0_2px_6px_rgba(0,0,0,0.06)]">
      <form
        data-testid="textedit-bar"
        className="flex w-full max-w-2xl flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!empty) void api.commit(text);
        }}
      >
        <label htmlFor="textedit-input" className="px-0.5 text-xs text-muted-foreground">
          Sửa dòng trên trang {pageIndex + 1}
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id="textedit-input"
            ref={input}
            data-testid="textedit-input"
            value={text}
            disabled={saving}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                api.cancel();
              }
            }}
            className="h-9 min-w-0 flex-1 rounded-md border bg-white px-2.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            autoComplete="off"
            spellCheck={false}
          />
          <Button type="button" variant="ghost" size="sm" onClick={api.cancel} disabled={saving} data-testid="textedit-cancel">
            Hủy
          </Button>
          <Button type="submit" size="sm" disabled={saving || empty || unchanged} data-testid="textedit-save">
            {saving && <Loader2 className="animate-spin" />}
            Lưu dòng
          </Button>
        </div>
        <p
          data-testid="textedit-font"
          data-keep={missing.length ? 'false' : 'true'}
          data-scope={edit ? (edit.whole ? 'line' : 'part') : 'none'}
          className={cn('flex items-start gap-1.5 px-0.5 text-xs leading-snug', missing.length ? 'text-amber-800' : 'text-muted-foreground')}
        >
          {missing.length ? (
            <>
              <TriangleAlert className="mt-px size-3.5 shrink-0" />
              <span>
                Phông gốc ({font.name}) {font.embedded ? 'trong tệp' : 'chỉ có bảng chữ Latin,'} thiếu {missing.map((c) => `“${c}”`).join(' ')}, nên {what} sẽ dùng phông ezSans
                {font.bold ? ' đậm' : ''}
                {font.italic ? ' nghiêng' : ''}. Phần còn lại của dòng giữ nguyên.
              </span>
            </>
          ) : (
            <>
              <Check className="mt-px size-3.5 shrink-0" />
              <span>
                {!edit
                  ? `Chỉ phần bạn sửa được viết lại, bằng phông gốc nếu phông đó đủ chữ. Dòng không tự dàn lại đoạn văn.`
                  : !edit.plan.middle
                    ? `Xóa ${what}; phần còn lại của dòng giữ nguyên.`
                    : `Viết lại ${what}, giữ phông gốc ${font.name}.${edit.whole ? '' : ' Phần còn lại của dòng giữ nguyên.'}`}
              </span>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
