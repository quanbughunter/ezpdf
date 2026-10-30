/**
 * The Word screen: a .docx opened on the device, shown as a page and
 * edited lightly (text, bold/italic/underline, paragraphs, table cells),
 * then saved as a new .docx. See src/word for how the file is read and
 * written; whatever is not edited is written back exactly as it was.
 *
 * It covers the PDF workspace while open (an overlay: the viewer's
 * shortcuts stay off) and returns to it when closed.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bold,
  Check,
  FolderOpen,
  Italic,
  Loader2,
  Lock,
  Redo2,
  Save,
  Share2,
  Trash2,
  TriangleAlert,
  Underline,
  Undo2,
  X,
} from 'lucide-react';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { Plugin } from 'prosemirror-state';
import { history, undo, redo, undoDepth, redoDepth } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import 'prosemirror-view/style/prosemirror.css';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { usePlatform } from '@/platform';
import { DOCX_MIME, type ShareWay } from '@/platform/types';
import { readDocx, type WordModel } from '@/word/read';
import { writeDocx } from '@/word/write';
import { markers } from '@/word/numbering';
import { schema, setPasteTag } from '@/word/schema';
import {
  backspace,
  del,
  deleteParagraphs,
  lineBreak,
  lockedGuard,
  markActive,
  splitParagraph,
  tableGuard,
  toggleBold,
  toggleItalic,
  toggleUnderline,
} from '@/word/commands';
import { BarDivider, Tip } from '../controls';
import { SHARE_LABEL, WAYS } from '../output-actions';
import { runCss } from '@/word/styles';

export interface WordScreenHandle {
  /** run `go` now, or after the user agrees to drop unsaved changes */
  leave(go: () => void): void;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** "Hợp đồng.docx" → "Hợp đồng (ezPDF).docx": the original is never overwritten */
export const savedName = (name: string) => `${name.replace(/\.docx$/i, '').replace(/ \(ezPDF\)$/, '')} (ezPDF).docx`;

export const WordScreen = forwardRef<WordScreenHandle, { file: File; onClose: () => void; onOpen: () => void; phone: boolean }>(
  function WordScreen({ file, onClose, onOpen, phone }, ref) {
    const [model, setModel] = useState<WordModel | null>(null);
    const [error, setError] = useState<string | null>(null);
    const dirtyRef = useRef(false);
    const platform = usePlatform();
    /** the question "drop unsaved changes?": what to do on each answer */
    const [confirm, setConfirm] = useState<null | { go: () => void; stay?: () => void }>(null);

    useEffect(() => {
      let live = true;
      let made: WordModel | null = null;
      setModel(null);
      setError(null);
      dirtyRef.current = false;
      (async () => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const m = await readDocx(bytes, file.name, {
            imageUrl: (b, mime) => URL.createObjectURL(new Blob([b as BlobPart], { type: mime })),
          });
          made = m;
          if (live) setModel(m);
          else m.urls.forEach((u) => URL.revokeObjectURL(u));
        } catch (e) {
          if (live) setError(message(e));
        }
      })();
      return () => {
        live = false;
        made?.urls.forEach((u) => URL.revokeObjectURL(u));
      };
    }, [file]);

    const leave = useCallback((go: () => void) => {
      if (!dirtyRef.current) go();
      else setConfirm({ go });
    }, []);
    useImperativeHandle(ref, () => ({ leave }), [leave]);

    // the desktop window closing: the same question first
    useEffect(
      () =>
        platform.guardClose?.(
          () =>
            new Promise<boolean>((resolve) => {
              if (!dirtyRef.current) return resolve(true);
              setConfirm({ go: () => resolve(true), stay: () => resolve(false) });
            }),
        ),
      [platform],
    );

    // the browser asks before closing the tab while changes are unsaved
    useEffect(() => {
      const onBefore = (e: BeforeUnloadEvent) => {
        if (!dirtyRef.current) return;
        e.preventDefault();
        e.returnValue = '';
      };
      window.addEventListener('beforeunload', onBefore);
      return () => window.removeEventListener('beforeunload', onBefore);
    }, []);

    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Tệp Word: ${file.name}`}
        data-ez-overlay=""
        data-testid="word-screen"
        className="fixed inset-0 z-50 flex flex-col bg-canvas"
      >
        {model ? (
          <WordEditor model={model} phone={phone} onDirty={(d) => (dirtyRef.current = d)} onClose={() => leave(onClose)} onOpen={onOpen} />
        ) : (
          <>
            <header className="ez-topbar sticky top-0 z-30 flex shrink-0 items-center gap-1 border-b bg-background px-2">
              <WBtn label="Đóng tệp Word" testId="word-close" onClick={onClose}>
                <X />
              </WBtn>
              <span className="truncate text-[13px]">{file.name}</span>
            </header>
            <div className="flex flex-1 items-center justify-center p-6" data-testid={error ? 'word-error' : 'word-loading'} role={error ? 'alert' : 'status'}>
              <div className="flex max-w-md flex-col items-center gap-3 text-center">
                {error ? <TriangleAlert className="size-5 text-destructive" /> : <Loader2 className="size-5 animate-spin text-muted-foreground" />}
                <p className="font-bold">{error ? 'Không mở được tệp Word' : 'Đang mở tệp Word…'}</p>
                {error && <p className="text-sm text-muted-foreground">{error}</p>}
                {error && (
                  <Button variant="outline" size="sm" onClick={onClose}>
                    Đóng
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
        {confirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" data-testid="word-leave">
            <div role="alertdialog" aria-modal="true" aria-labelledby="word-leave-title" className="w-full max-w-sm rounded-lg bg-background p-5 shadow-xl">
              <p id="word-leave-title" className="font-bold">
                Bỏ các thay đổi chưa lưu?
              </p>
              <p className="mt-1 text-sm text-muted-foreground">Các thay đổi trong “{file.name}” chưa được lưu thành tệp Word. Tệp gốc không bị đổi.</p>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="word-leave-stay"
                  onClick={() => {
                    confirm.stay?.();
                    setConfirm(null);
                  }}
                  autoFocus
                >
                  Ở lại
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  data-testid="word-leave-discard"
                  onClick={() => {
                    const { go } = confirm;
                    setConfirm(null);
                    dirtyRef.current = false;
                    go();
                  }}
                >
                  Bỏ thay đổi
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);

/**
 * How a Word file can be shared. The browser's share sheet takes only the
 * file types the browser allows (Chrome: no .docx), so a browser that cannot
 * share a Word file offers the download instead.
 */
function wordShareWays(kind: string, ways: readonly ShareWay[]): readonly ShareWay[] {
  if (kind !== 'web' || !ways.includes('sheet')) return ways;
  try {
    const probe = new File([new Uint8Array(1)], 'a.docx', { type: DOCX_MIME });
    if (navigator.canShare?.({ files: [probe] })) return ways;
  } catch {
    // no Web Share
  }
  return ['download'];
}

/** A toolbar button that does not take the focus (and the selection) from the page. */
function WBtn(props: { label: string; shortcut?: string; testId: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  return (
    <Tip label={props.label} shortcut={props.shortcut}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={props.label}
        aria-pressed={props.pressed}
        data-testid={props.testId}
        disabled={props.disabled}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => e.pointerType !== 'mouse' && e.preventDefault()}
        onClick={props.onClick}
        className={cn(
          'shrink-0 text-foreground/80 hover:text-foreground',
          props.pressed && 'bg-primary-soft text-primary ring-1 ring-primary/40 hover:bg-primary-soft hover:text-primary',
        )}
      >
        {props.children}
      </Button>
    </Tip>
  );
}

/** List numbers and bullets, counted again after every change (a new item gets the next number). */
function listMarkers(model: WordModel) {
  const build = (doc: EditorState['doc']) => {
    const items: { pos: number; list: { numId: string; ilvl: number } | null }[] = [];
    doc.descendants((n, pos) => {
      if (n.type === schema.nodes.paragraph) {
        items.push({ pos, list: n.attrs.list });
        return false;
      }
      return true;
    });
    const labels = markers(model.numbering, items.map((i) => i.list));
    const decos: Decoration[] = [];
    items.forEach((it, k) => {
      const label = labels[k];
      if (!label || !it.list) return;
      const lvl = model.numbering.level(it.list.numId, it.list.ilvl);
      const hang = lvl?.p.hanging ? lvl.p.hanging / 20 : 18;
      const font = lvl && lvl.fmt !== 'bullet' ? runCss({ font: lvl.r.font, sz: lvl.r.sz, color: lvl.r.color }) : '';
      decos.push(
        Decoration.widget(
          it.pos + 1,
          () => {
            const s = document.createElement('span');
            s.className = 'ez-wmarker';
            s.textContent = label;
            s.setAttribute('style', `min-width:${hang}pt;${font}`);
            s.contentEditable = 'false';
            return s;
          },
          { side: -1, key: `m:${label}:${hang}`, ignoreSelection: true },
        ),
      );
    });
    return DecorationSet.create(doc, decos);
  };
  return new Plugin<DecorationSet>({
    state: {
      init: (_, s) => build(s.doc),
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

function WordEditor({
  model,
  phone,
  onDirty,
  onClose,
  onOpen,
}: {
  model: WordModel;
  phone: boolean;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
  onOpen: () => void;
}) {
  const platform = usePlatform();
  const mount = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [, setTick] = useState(0);
  const saved = useRef(model.doc);
  const [dirty, setDirty] = useState(false);
  const [everSaved, setEverSaved] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'share'>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [lockedNote, setLockedNote] = useState(model.locked.count > 0);
  const outName = savedName(model.name);

  const save = useCallback(async () => {
    const view = viewRef.current;
    if (!view || busy) return;
    setBusy('save');
    setNotice(null);
    try {
      const doc = view.state.doc;
      const bytes = writeDocx(model, doc);
      const r = await platform.saveWord(bytes, outName);
      if (r) {
        saved.current = doc;
        const d = !viewRef.current?.state.doc.eq(doc);
        setDirty(d);
        onDirty(d);
        setEverSaved(true);
        setNotice({
          tone: 'info',
          text: r.how === 'download' ? `Đã tải về “${r.name}”.` : `Đã lưu “${r.name}”${r.folder ? ` vào ${r.folder}` : ''}.`,
        });
      }
    } catch (e) {
      setNotice({ tone: 'error', text: `Không lưu được: ${message(e)}` });
    } finally {
      setBusy(null);
    }
  }, [busy, model, onDirty, outName, platform]);

  const share = useCallback(
    async (way: ShareWay) => {
      const view = viewRef.current;
      if (!view || busy) return;
      setBusy('share');
      try {
        const bytes = writeDocx(model, view.state.doc);
        const r = await platform.sharePdf(bytes, outName, way);
        if (r === 'copied') setNotice({ tone: 'info', text: `Đã chép “${outName}”. Dán (Ctrl V) vào khung chat hay thư.` });
        else if (r === 'downloaded') setNotice({ tone: 'info', text: `Đã tải về “${outName}” để gửi.` });
      } catch (e) {
        if (!isAbort(e)) setNotice({ tone: 'error', text: `Không chia sẻ được: ${message(e)}` });
      } finally {
        setBusy(null);
      }
    },
    [busy, model, outName, platform],
  );

  const saveRef = useRef(save);
  saveRef.current = save;
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    setPasteTag(`w${Math.random().toString(36).slice(2, 10)}`, (ref) => model.visuals.get(ref) ?? null);
    const state = EditorState.create({
      doc: model.doc,
      plugins: [
        history(),
        keymap({
          Enter: splitParagraph(model),
          'Shift-Enter': lineBreak,
          'Mod-b': toggleBold,
          'Mod-i': toggleItalic,
          'Mod-u': toggleUnderline,
          'Mod-z': undo,
          'Mod-y': redo,
          'Shift-Mod-z': redo,
          Backspace: backspace,
          Delete: del,
          'Mod-s': () => (void saveRef.current(), true),
          'Mod-o': () => (openRef.current(), true),
        }),
        keymap(baseKeymap),
        tableGuard(model),
        lockedGuard,
        listMarkers(model),
      ],
    });
    const view = new EditorView(host, {
      state,
      attributes: { 'data-testid': 'word-editor', spellcheck: 'false', 'aria-label': 'Nội dung tệp Word' },
      dispatchTransaction(tr: Transaction) {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) {
          const d = !next.doc.eq(saved.current);
          setDirty(d);
          onDirty(d);
        }
        setTick((n) => n + 1);
      },
    });
    viewRef.current = view;
    if (new URLSearchParams(location.search).has('e2e')) {
      // for the acceptance run (scripts/e2e-word.cjs): read the model, place the caret
      (window as unknown as { __ezword?: unknown }).__ezword = {
        view,
        model,
        texts: () => {
          const out: string[] = [];
          view.state.doc.forEach((b) => out.push(b.type === schema.nodes.locked ? '[locked]' : b.textContent));
          return out;
        },
        find: (needle: string) => {
          let res: { from: number; to: number } | null = null;
          view.state.doc.descendants((node, pos) => {
            if (res) return false;
            if (!node.isTextblock) return true;
            let text = '';
            const map: number[] = [];
            node.forEach((c, off) => {
              const t = c.isText ? c.text! : '\uFFFC';
              for (let k = 0; k < t.length; k++) map.push(pos + 1 + off + (c.isText ? k : 0));
              text += t;
            });
            const i = text.indexOf(needle);
            if (i >= 0) res = { from: map[i], to: map[i + needle.length - 1] + 1 };
            return false;
          });
          return res;
        },
        select: (from: number, to = from) => {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
          view.focus();
        },
        marksAt: (pos: number) => view.state.doc.resolve(pos).marks().map((m) => m.type.name),
      };
    }
    return () => {
      view.destroy();
      viewRef.current = null;
      setPasteTag('');
    };
    // the editor lives as long as this model
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  // Ctrl S / Ctrl O also when the focus is on the toolbar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void saveRef.current();
      } else if (k === 'o') {
        e.preventDefault();
        openRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (notice?.tone !== 'info') return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const view = viewRef.current;
  const st = view?.state;
  const run = (cmd: (s: EditorState, d?: (tr: Transaction) => void) => boolean) => {
    const v = viewRef.current;
    if (!v) return;
    cmd(v.state, v.dispatch);
    v.focus();
  };
  const ways = useMemo(() => wordShareWays(platform.kind, platform.shareWays), [platform]);
  const p = model.page;
  const pad = (v: number) => `min(${v}pt, ${+((v / p.width) * 100).toFixed(3)}cqw)`;
  const pageStyle = useMemo(
    () => ({
      width: `min(100%, ${p.width}pt)`,
      minHeight: phone ? undefined : `${Math.min(p.height, 900)}pt`,
      padding: `${pad(p.top)} ${pad(p.right)} ${pad(p.bottom)} ${pad(p.left)}`,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p, phone],
  );

  return (
    <>
      <header
        data-testid="word-bar"
        className="ez-topbar sticky top-0 z-30 flex shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-background px-1 sm:px-2 [scrollbar-width:none]"
      >
        <WBtn label="Đóng tệp Word" testId="word-close" onClick={onClose}>
          <X />
        </WBtn>
        {!phone && (
          <WBtn label="Mở tệp PDF hoặc Word" shortcut="Ctrl O" testId="word-open" onClick={onOpen}>
            <FolderOpen />
          </WBtn>
        )}
        {!phone && <BarDivider />}
        <WBtn label="Hoàn tác" shortcut="Ctrl Z" testId="word-undo" onClick={() => run(undo)} disabled={!st || undoDepth(st) === 0}>
          <Undo2 />
        </WBtn>
        <WBtn label="Làm lại" shortcut="Ctrl Y" testId="word-redo" onClick={() => run(redo)} disabled={!st || redoDepth(st) === 0}>
          <Redo2 />
        </WBtn>
        {!phone && <BarDivider />}
        <WBtn label="Chữ đậm" shortcut="Ctrl B" testId="word-bold" onClick={() => run(toggleBold)} pressed={!!st && markActive(st, schema.marks.b)}>
          <Bold />
        </WBtn>
        <WBtn label="Chữ nghiêng" shortcut="Ctrl I" testId="word-italic" onClick={() => run(toggleItalic)} pressed={!!st && markActive(st, schema.marks.i)}>
          <Italic />
        </WBtn>
        <WBtn label="Gạch chân" shortcut="Ctrl U" testId="word-underline" onClick={() => run(toggleUnderline)} pressed={!!st && markActive(st, schema.marks.u)}>
          <Underline />
        </WBtn>
        <WBtn label="Xóa đoạn đang chọn" testId="word-delete-para" onClick={() => run(deleteParagraphs(model))}>
          <Trash2 />
        </WBtn>
        <div className="min-w-2 flex-1" />
        <div className="mr-1 hidden max-w-64 min-w-0 flex-col items-end leading-tight md:flex">
          <span className="w-full truncate text-right text-[13px]" title={model.name} data-testid="word-name">
            {model.name}
          </span>
          <WordState dirty={dirty} saved={everSaved} />
        </div>
        <span className="mr-1 md:hidden">
          <WordState dirty={dirty} saved={everSaved} compact />
        </span>
        {ways.length > 0 && <WordShare ways={ways} busy={busy === 'share'} disabled={!!busy} onShare={(w) => void share(w)} />}
        <Button size="sm" data-testid="word-save" onClick={() => void save()} disabled={!!busy} className="ml-1 shrink-0" title="Lưu thành tệp Word mới (Ctrl S)">
          {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
          {phone ? 'Lưu' : 'Lưu tệp Word'}
        </Button>
      </header>
      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          data-testid="word-notice"
          className={cn(
            'flex items-center gap-2 border-b px-4 py-2 text-[13px]',
            notice.tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-primary/20 bg-primary-soft',
          )}
        >
          <span className="flex-1">{notice.text}</span>
          <Button size="xs" variant="ghost" onClick={() => setNotice(null)}>
            Đóng
          </Button>
        </div>
      )}
      {lockedNote && (
        <div role="status" data-testid="word-locked-note" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[13px] text-amber-900">
          <Lock className="size-3.5 shrink-0" />
          <span className="flex-1">
            {model.locked.count} đoạn chỉ xem được<span className="hidden sm:inline"> ({model.locked.reasons.join('; ')})</span>. ezPDF giữ nguyên
            chúng khi lưu.
          </span>
          <Button size="xs" variant="ghost" onClick={() => setLockedNote(false)}>
            Đóng
          </Button>
        </div>
      )}
      <div className="ez-wcanvas min-h-0 flex-1 overflow-auto px-2 py-3 sm:px-6 sm:py-6" data-testid="word-canvas">
        <div className="ez-wpage" style={pageStyle} data-testid="word-page">
          {model.headerHtml && <div className="ez-whf ez-whf-top" data-testid="word-header" dangerouslySetInnerHTML={{ __html: model.headerHtml }} />}
          <div className="ez-wdoc" ref={mount} />
          {model.notesHtml && <div className="ez-wnotes-wrap" data-testid="word-notes" dangerouslySetInnerHTML={{ __html: model.notesHtml }} />}
          {model.footerHtml && <div className="ez-whf ez-whf-bottom" data-testid="word-footer" dangerouslySetInnerHTML={{ __html: model.footerHtml }} />}
        </div>
      </div>
    </>
  );
}

function WordState({ dirty, saved, compact }: { dirty: boolean; saved: boolean; compact?: boolean }) {
  if (dirty)
    return (
      <span className="flex items-center gap-1 text-xs text-amber-700" data-testid="word-dirty" title="Có thay đổi chưa lưu thành tệp Word">
        <span className="size-2 rounded-full bg-amber-500" aria-hidden />
        {!compact && 'Chưa lưu'}
      </span>
    );
  if (saved)
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="word-saved" title="Đã lưu thành tệp Word">
        <Check className="size-3" aria-hidden />
        {!compact && 'Đã lưu'}
      </span>
    );
  return null;
}

function WordShare({ ways, busy, disabled, onShare }: { ways: readonly ShareWay[]; busy: boolean; disabled: boolean; onShare: (w: ShareWay) => void }) {
  const icon = busy ? <Loader2 className="animate-spin" /> : <Share2 />;
  if (ways.length === 1) {
    return (
      <WBtn label={ways[0] === 'download' ? 'Tải tệp Word về để gửi đi' : SHARE_LABEL} testId="word-share" onClick={() => onShare(ways[0])} disabled={disabled}>
        {icon}
      </WBtn>
    );
  }
  return (
    <DropdownMenu>
      <Tip label={SHARE_LABEL}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={SHARE_LABEL} data-testid="word-share" disabled={disabled} className="shrink-0 text-foreground/80 hover:text-foreground">
            {icon}
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-72">
        {ways.map((w) => {
          const d = WAYS[w];
          return (
            <DropdownMenuItem key={w} data-testid={`word-share-${w}`} onSelect={() => onShare(w)} className="items-start py-2">
              <d.icon className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span>{d.label}</span>
                {d.detail && <span className="text-xs text-muted-foreground">{d.detail}</span>}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
