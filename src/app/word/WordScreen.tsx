/**
 * The Word screen: a .docx opened on the device, shown as a page and
 * edited lightly (text, bold/italic/underline, paragraphs, table cells),
 * then saved as a new .docx. See src/word for how the file is read and
 * written; whatever is not edited is written back exactly as it was.
 *
 * It covers the PDF workspace while open (an overlay: the viewer's
 * shortcuts stay off) and returns to it when closed.
 */
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bold,
  Check,
  FolderOpen,
  Info,
  Italic,
  Loader2,
  Lock,
  Pencil,
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
import './word-fonts.css';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { usePlatform } from '@/platform';
import { DOCX_MIME, sourceOf, type ShareWay } from '@/platform/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Fact, FactList, FileFacts, formatDate, type FileFactsInfo } from '../file-info';
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
  toggleUnderline, setFont, setSize } from '@/word/commands';
import { BarDivider, Tip } from '../controls';
import { FontPicker, SizePicker, ZoomControl } from './format-controls';
import { makeRasterizer } from './raster-client';
import { pageLayout, type PagesInfo } from './page-layout';
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

export const WordScreen = forwardRef<
  WordScreenHandle,
  { file: File; onClose: () => void; onOpen: () => void; phone: boolean; onOpenFile?: (file: File) => void }
>(
  function WordScreen({ file, onClose, onOpen, phone, onOpenFile }, ref) {
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
      const raster = makeRasterizer();
      (async () => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const m = await readDocx(bytes, file.name, {
            imageUrl: pictureUrl,
            canShow: browserShows,
            rasterize: raster.rasterize,
          });
          made = m;
          if (live) setModel(m);
          else m.urls.forEach((u) => URL.revokeObjectURL(u));
        } catch (e) {
          if (live) setError(message(e));
        } finally {
          raster.dispose();
        }
      })();
      return () => {
        live = false;
        raster.dispose();
        made?.urls.forEach((u) => URL.revokeObjectURL(u));
      };
    }, [file]);

    const info = useMemo<FileFactsInfo>(() => {
      const source = sourceOf(file);
      return { name: file.name, size: file.size, source, modified: source?.modified ?? (platform.kind === 'web' ? file.lastModified : undefined) };
    }, [file, platform]);

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
          <WordEditor
            model={model}
            phone={phone}
            info={info}
            onDirty={(d) => (dirtyRef.current = d)}
            onClose={() => leave(onClose)}
            onOpen={onOpen}
            onOpenFile={onOpenFile ? (f) => leave(() => onOpenFile(f)) : undefined}
          />
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

/** zoom limits and the steps of the − and + buttons, in percent of the text's real size */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const STEPS = [25, 50, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400];
/**
 * A phone (either way round, not a tablet) opens a document to read it: a tap
 * does not bring up the keyboard and the editing bars are out of the way.
 * “Sửa” turns editing on, “Xong” off again.
 */
const READ_FIRST = '(pointer: coarse) and (max-width: 999px) and (max-height: 999px)';

function WordEditor({
  model,
  phone,
  info,
  onDirty,
  onClose,
  onOpen,
  onOpenFile,
}: {
  model: WordModel;
  phone: boolean;
  info: FileFactsInfo;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
  onOpen: () => void;
  onOpenFile?: (file: File) => void;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const platform = usePlatform();
  const mount = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLDivElement>(null);
  /** the pages the layout made (page-layout.ts): how many, how tall */
  const [pages, setPages] = useState<PagesInfo | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [, setTick] = useState(0);
  const saved = useRef(model.doc);
  const [dirty, setDirty] = useState(false);
  const [everSaved, setEverSaved] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'share'>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [lockedNote, setLockedNote] = useState(model.locked.count > 0);
  const outName = savedName(model.name);
  const [readFirst] = useState(() => typeof matchMedia === 'function' && matchMedia(READ_FIRST).matches);
  const [editing, setEditing] = useState(!readFirst);
  const editingRef = useRef(editing);
  editingRef.current = editing;

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
        pageLayout({
          page: model.page,
          defaultTab: model.defaultTab,
          pageEl: () => pageRef.current,
          notesEl: () => notesRef.current,
          onPages: (info) => setPages((old) => (old && old.count === info.count && old.pageH === info.pageH ? old : info)),
        }),
      ],
    });
    const view = new EditorView(host, {
      state,
      editable: () => editingRef.current,
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
    setTick((n) => n + 1); // the toolbar reads the view (font and size at the caret)
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

  /*
   * Zoom. At 1 the page is the document's own width and the text is its real
   * size: 100 %. Zooming scales that page as a whole, as Word does, so the
   * lines stay where they are; the percentage is the text's size. A screen
   * narrower than the page starts zoomed out to fit it.
   */
  const canvasRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  /** the zoom the page is drawn at now (zoomRef runs ahead of it until React has drawn) */
  const shownZoom = useRef(1);
  const [canvasW, setCanvasW] = useState(0);
  const [pageH, setPageH] = useState(0);
  const pagePx = (model.page.width * 4) / 3;
  /** the page keeps its own width everywhere (as Word's print layout): a phone shows it zoomed out to fit */
  const baseW = pagePx;
  const fitZoom = canvasW ? Math.min(ZOOM_MAX, canvasW / pagePx) : 1;
  const minZoom = useRef(ZOOM_MIN);
  minZoom.current = Math.max(0.05, Math.min(ZOOM_MIN, fitZoom));
  /** zoomed to fit the width (follows the screen when it turns or the window changes); a zoom by hand ends it */
  const fitMode = useRef<boolean | null>(null);
  const fitRef = useRef(fitZoom);
  fitRef.current = fitZoom;
  const percent = Math.round(zoom * 100);
  const focal = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const page = pageRef.current;
    if (!canvas || !page) return;
    const measure = () => {
      const cs = getComputedStyle(canvas);
      setCanvasW(Math.max(0, canvas.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
      setPageH(page.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    ro.observe(page);
    return () => ro.disconnect();
  }, []);

  /** zoom to `z` (1: the page fits the screen), keeping the point under (clientX, clientY) where it is */
  const zoomTo = useCallback((z: number, clientX?: number, clientY?: number) => {
    const canvas = canvasRef.current;
    const sizer = sizerRef.current;
    const next = Math.max(minZoom.current, Math.min(ZOOM_MAX, z));
    fitMode.current = false;
    if (!canvas || !sizer || Math.abs(next - zoomRef.current) < 1e-4) return;
    const r = canvas.getBoundingClientRect();
    const cx = (clientX ?? r.left + canvas.clientWidth / 2) - r.left;
    const cy = (clientY ?? r.top + canvas.clientHeight / 2) - r.top;
    const cur = shownZoom.current;
    focal.current = { px: (canvas.scrollLeft + cx - sizer.offsetLeft) / cur, py: (canvas.scrollTop + cy - sizer.offsetTop) / cur, cx, cy };
    zoomRef.current = next;
    setZoom(next);
  }, []);
  // at first: 100 % when the page fits the screen, else zoomed out to its width; later, follow the width while fitted
  useLayoutEffect(() => {
    if (!canvasW) return;
    if (fitMode.current === null) fitMode.current = canvasW < pagePx - 1;
    if (!fitMode.current) return;
    const z = Math.max(0.05, canvasW / pagePx);
    if (Math.abs(z - zoomRef.current) > 1e-4) {
      zoomRef.current = z;
      setZoom(z);
    }
  }, [canvasW, pagePx]);
  useLayoutEffect(() => {
    shownZoom.current = zoom;
    const f = focal.current;
    const canvas = canvasRef.current;
    const sizer = sizerRef.current;
    if (!f || !canvas || !sizer) return;
    focal.current = null;
    canvas.scrollLeft = f.px * zoom + sizer.offsetLeft - f.cx;
    canvas.scrollTop = f.py * zoom + sizer.offsetTop - f.cy;
  }, [zoom]);
  const zoomStep = useCallback(
    (dir: 1 | -1) => {
      const now = zoomRef.current * 100;
      const to = dir > 0 ? (STEPS.find((p) => p > now + 0.5) ?? 400) : ([...STEPS].reverse().find((p) => p < now - 0.5) ?? 25);
      zoomTo(to / 100);
    },
    [zoomTo],
  );

  // Ctrl + wheel (and a touchpad pinch, which arrives as one), two-finger pinch on touch screens
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // anywhere on the Word screen (over the bar too, where the browser would zoom the whole app); around the pointer when it is over the page
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const target = e.target as Node | null;
      if (!target || !canvas.closest('[data-testid="word-screen"]')?.contains(target)) return;
      e.preventDefault();
      const over = canvas.contains(target);
      // a mouse wheel moves in notches (100 px each, or 3 lines): 10 % a notch, as in Word;
      // a touchpad pinch sends many small steps: follow the fingers
      const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const notches = Math.min(4, Math.round(Math.abs(d) / 100));
      const factor = Math.abs(d) >= 50 ? 1.1 ** (Math.sign(-d) * Math.max(1, notches)) : Math.exp(-d * 0.01);
      zoomTo(zoomRef.current * factor, over ? e.clientX : undefined, over ? e.clientY : undefined);
    };
    let pinch: { d0: number; z0: number } | null = null;
    let raf = 0;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    // a double tap while reading: in to the text's real size (100 %) around the finger, or back to the whole width
    let tap: { t: number; x: number; y: number; moved: boolean } | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    const doubleTap = (x: number, y: number) => {
      const fit = fitRef.current;
      const near = fit < 0.9 ? 1 : Math.min(ZOOM_MAX, fit * 2);
      if (zoomRef.current < near * 0.9) zoomTo(near, x, y);
      else {
        zoomTo(fit);
        fitMode.current = true;
      }
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        tap = { t: e.timeStamp, x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false };
        return;
      }
      tap = null;
      lastTap = null;
      if (e.touches.length !== 2) return;
      pinch = { d0: Math.max(1, dist(e.touches)), z0: zoomRef.current };
      e.preventDefault();
    };
    const onMove = (e: TouchEvent) => {
      if (tap && e.touches.length === 1 && Math.hypot(e.touches[0].clientX - tap.x, e.touches[0].clientY - tap.y) > 10) tap.moved = true;
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const z = (pinch.z0 * dist(e.touches)) / pinch.d0;
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => zoomTo(z, mx, my));
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
      if (e.type !== 'touchend' || !tap || tap.moved || e.touches.length || e.timeStamp - tap.t > 300) {
        tap = null;
        return;
      }
      const t = { t: e.timeStamp, x: tap.x, y: tap.y };
      tap = null;
      if (!editingRef.current && lastTap && t.t - lastTap.t < 350 && Math.hypot(t.x - lastTap.x, t.y - lastTap.y) < 30) {
        e.preventDefault();
        lastTap = null;
        doubleTap(t.x, t.y);
      } else lastTap = t;
    };
    // Safari's pinch gesture: on a Mac touchpad it is the only signal (no Ctrl + wheel); on an iPhone the touches above already zoom
    let gesture0 = 0;
    const onGesture = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale?: number; clientX?: number; clientY?: number };
      if (e.type === 'gesturestart') gesture0 = zoomRef.current;
      else if (!pinch && gesture0 && g.scale) zoomTo(gesture0 * g.scale, g.clientX, g.clientY);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd, { passive: false });
    canvas.addEventListener('touchcancel', onEnd);
    canvas.addEventListener('gesturestart', onGesture);
    canvas.addEventListener('gesturechange', onGesture);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onStart);
      canvas.removeEventListener('touchmove', onMove);
      canvas.removeEventListener('touchend', onEnd);
      canvas.removeEventListener('touchcancel', onEnd);
      canvas.removeEventListener('gesturestart', onGesture);
      canvas.removeEventListener('gesturechange', onGesture);
    };
  }, [zoomTo]);

  // reading or editing: the text takes the keyboard only while editing (leaving editing puts the keyboard away)
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.setProps({ editable: () => editingRef.current });
    if (!editing) (v.dom as HTMLElement).blur();
  }, [editing]);

  // Ctrl + / Ctrl − / Ctrl 0
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.defaultPrevented) return;
      if (e.key === '=' || e.key === '+') zoomStep(1);
      else if (e.key === '-' || e.key === '_') zoomStep(-1);
      else if (e.key === '0') zoomTo(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomStep, zoomTo]);

  const view = viewRef.current;
  const st = view?.state;
  const run = (cmd: (s: EditorState, d?: (tr: Transaction) => void) => boolean) => {
    const v = viewRef.current;
    if (!v) return;
    cmd(v.state, v.dispatch);
    v.focus();
  };
  const refocus = useCallback(() => viewRef.current?.focus(), []);
  const ways = useMemo(() => wordShareWays(platform.kind, platform.shareWays), [platform]);
  const format = view ? currentFormat(view) : { font: '', size: 0 };
  const p = model.page;
  const pageStyle = useMemo(
    () => ({
      width: pagePx,
      // as many whole sheets as the text needs (the gaps between them are drawn over the page)
      minHeight: pages ? pages.count * (pages.pageH + pages.gap) - pages.gap : `${p.height}pt`,
      padding: `${p.top}pt ${p.right}pt ${p.bottom}pt ${p.left}pt`,
    }),
    [p, pages, pagePx],
  );

  const deleteTool = (
    <WBtn label="Xóa đoạn đang chọn" testId="word-delete-para" onClick={() => run(deleteParagraphs(model))}>
      <Trash2 />
    </WBtn>
  );
  const formatTools = (
    <>
      <FontPicker value={format.font} fonts={model.fonts} onPick={(name) => run(setFont(name))} refocus={refocus} className={phone ? 'flex-1' : 'w-32 shrink-0 lg:w-48'} />
      <SizePicker value={format.size} onPick={(pt) => run(setSize(pt))} refocus={refocus} />
      <span className="w-1 shrink-0" />
      <WBtn label="Chữ đậm" shortcut="Ctrl B" testId="word-bold" onClick={() => run(toggleBold)} pressed={!!st && markActive(st, schema.marks.b)}>
        <Bold />
      </WBtn>
      <WBtn label="Chữ nghiêng" shortcut="Ctrl I" testId="word-italic" onClick={() => run(toggleItalic)} pressed={!!st && markActive(st, schema.marks.i)}>
        <Italic />
      </WBtn>
      <WBtn label="Gạch chân" shortcut="Ctrl U" testId="word-underline" onClick={() => run(toggleUnderline)} pressed={!!st && markActive(st, schema.marks.u)}>
        <Underline />
      </WBtn>
      {!phone && deleteTool}
    </>
  );
  const zoomTools = (
    <ZoomControl
      percent={percent}
      fit={Math.abs(zoom - fitZoom) < 0.005}
      onIn={() => zoomStep(1)}
      onOut={() => zoomStep(-1)}
      onPercent={(p) => zoomTo(p / 100)}
      onFit={() => {
        zoomTo(fitZoom);
        fitMode.current = true;
      }}
      refocus={phone ? () => {} : refocus /* on a phone, focusing the text would bring up the keyboard */}
      compact={phone}
    />
  );

  // reading (a phone, before “Sửa”): only what reading needs; editing: the whole bar
  const reading = !editing;
  const editToggle = !readFirst ? null : editing ? (
    <WBtn label="Xong, chỉ xem" testId="word-done" onClick={() => setEditing(false)}>
      <Check />
    </WBtn>
  ) : (
    <Button size="sm" variant="outline" data-testid="word-edit" onClick={() => setEditing(true)} className="ml-1 shrink-0" title="Sửa tài liệu">
      <Pencil />
      Sửa
    </Button>
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
        {editing && (
          <>
            {!phone && <BarDivider />}
            <WBtn label="Hoàn tác" shortcut="Ctrl Z" testId="word-undo" onClick={() => run(undo)} disabled={!st || undoDepth(st) === 0}>
              <Undo2 />
            </WBtn>
            <WBtn label="Làm lại" shortcut="Ctrl Y" testId="word-redo" onClick={() => run(redo)} disabled={!st || redoDepth(st) === 0}>
              <Redo2 />
            </WBtn>
            {!phone && <BarDivider />}
            {!phone && formatTools}
            {!phone && <BarDivider />}
            {phone ? deleteTool : null}
            {!phone && zoomTools}
          </>
        )}
        <div className="min-w-2 flex-1" />
        {(phone || reading) && zoomTools}
        <div className="mr-1 hidden max-w-64 min-w-0 flex-col items-end leading-tight md:flex">
          <span className="w-full truncate text-right text-[13px]" title={model.name} data-testid="word-name">
            {model.name}
          </span>
          <WordState dirty={dirty} saved={everSaved} />
        </div>
        <span className="mr-1 md:hidden">
          <WordState dirty={dirty} saved={everSaved} compact />
        </span>
        <WBtn label="Thông tin tệp" testId="word-info" onClick={() => setInfoOpen(true)} pressed={infoOpen}>
          <Info />
        </WBtn>
        {ways.length > 0 && <WordShare ways={ways} busy={busy === 'share'} disabled={!!busy} onShare={(w) => void share(w)} />}
        {editing && !phone && editToggle}
        {(editing || dirty) && (
          <Button size="sm" data-testid="word-save" onClick={() => void save()} disabled={!!busy} className="ml-1 shrink-0" title="Lưu thành tệp Word mới (Ctrl S)">
            {busy === 'save' ? <Loader2 className="animate-spin" /> : <Save />}
            {phone ? (
              'Lưu'
            ) : (
              <>
                <span className="lg:hidden">Lưu</span>
                <span className="hidden lg:inline">Lưu tệp Word</span>
              </>
            )}
          </Button>
        )}
        {reading && editToggle}
      </header>
      <WordInfoDialog open={infoOpen} onOpenChange={setInfoOpen} info={info} model={model} pages={pages} onOpenFile={onOpenFile} />
      {phone && editing && (
        <div data-testid="word-format-bar" className="flex h-11 shrink-0 items-center gap-0.5 border-b bg-background px-1">
          {formatTools}
          {editToggle}
        </div>
      )}
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
      {lockedNote && editing && (
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
      <div ref={canvasRef} className="ez-wcanvas relative min-h-0 flex-1 touch-pan-x touch-pan-y overflow-auto px-2 py-3 sm:px-6 sm:py-6" data-testid="word-canvas">
        <div
          ref={sizerRef}
          className="ez-wzoom"
          data-testid="word-zoom"
          style={baseW ? { width: baseW * zoom, height: pageH ? pageH * zoom : undefined, margin: '0 auto' } : undefined}
        >
        <div
          ref={pageRef}
          className={cn('ez-wpage', reading && 'ez-wreading')}
          style={{ ...pageStyle, margin: 0, transform: zoom !== 1 ? `scale(${zoom})` : undefined, transformOrigin: '0 0' }}
          data-testid="word-page"
          data-pages={pages?.count ?? 1}
        >
          <Sheets model={model} pages={pages} />
          <div className="ez-wdoc" ref={mount} />
          {model.notesHtml && <div ref={notesRef} className="ez-wnotes-wrap" data-testid="word-notes" dangerouslySetInnerHTML={{ __html: model.notesHtml }} />}
        </div>
        </div>
      </div>
    </>
  );
}

/** a header or footer for page `n` of `count`: its page-number fields show that page */
function numbered(html: string, n: number, count: number): string {
  return html.replace(/(<span data-ezpage="">)[^<]*(<\/span>)/g, `$1${n}$2`).replace(/(<span data-ezpages="">)[^<]*(<\/span>)/g, `$1${count}$2`);
}

/**
 * The sheets over the page: the gap between two pages, and each page's
 * header and footer (in its top and bottom margins, faded: they are not
 * edited here).
 */
const Sheets = memo(function Sheets({ model, pages }: { model: WordModel; pages: PagesInfo | null }) {
  const p = model.page;
  const count = pages?.count ?? 1;
  const stride = pages ? pages.pageH + pages.gap : 0;
  const header = model.headerHtml, footer = model.footerHtml;
  return (
    <div className="ez-wpages" aria-hidden>
      {Array.from({ length: count }, (_, k) => (
        <div key={k} className="ez-wsheet" style={{ top: k * stride, height: pages ? pages.pageH : `${p.height}pt` }} data-testid="word-sheet">
          {k > 0 && pages && <div className="ez-wband" style={{ top: -pages.gap, height: pages.gap }} data-testid="word-page-gap" />}
          {header && (
            <div
              className="ez-whf"
              data-testid={k === 0 ? 'word-header' : undefined}
              style={{ top: `${p.header}pt`, left: `${p.left}pt`, right: `${p.right}pt`, maxHeight: `${Math.max(12, p.top - p.header)}pt` }}
              dangerouslySetInnerHTML={{ __html: numbered(header, k + 1, count) }}
            />
          )}
          {footer && (
            <div
              className="ez-whf"
              data-testid={k === 0 ? 'word-footer' : undefined}
              style={{ bottom: `${p.footer}pt`, left: `${p.left}pt`, right: `${p.right}pt`, maxHeight: `${Math.max(12, p.bottom - p.footer)}pt` }}
              dangerouslySetInnerHTML={{ __html: numbered(footer, k + 1, count) }}
            />
          )}
        </div>
      ))}
    </div>
  );
});

/**
 * A URL for picture bytes: a blob URL; an SVG as a data URL instead, which
 * a browser never opens as a page of the app (“Open image in new tab”), so
 * a script inside one can never run.
 */
function pictureUrl(bytes: Uint8Array, mime: string): string {
  if (mime !== 'image/svg+xml') return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

/**
 * Does this browser show a picture of this format (AVIF, HEIC, JPEG XR are
 * shown by some browsers only)? It is decoded off-screen; 4 seconds at most.
 */
function browserShows(bytes: Uint8Array, mime: string): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    const img = new Image();
    const done = (ok: boolean) => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 4000);
    img.onload = () => done(img.naturalWidth > 0);
    img.onerror = () => done(false);
    img.src = url;
  });
}

/** generic and ezPDF's own fallback families: not a font the document chose */
const NOT_A_CHOICE = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+|ezPDF [\w ]+)$/i;

/**
 * The font and size at the caret, for the toolbar: a font or size just
 * picked (stored or on the text) first, else what the page shows there,
 * which takes in the paragraph's and document's styles.
 */
function currentFormat(view: EditorView): { font: string; size: number } {
  const st = view.state;
  let font = '';
  let size = 0;
  for (const m of st.storedMarks ?? st.selection.$from.marks()) {
    if (m.type === schema.marks.font) font = String(m.attrs.name);
    else if (m.type === schema.marks.size) size = Number(m.attrs.hp) / 2;
  }
  if (font && size) return { font, size };
  try {
    const at = view.domAtPos(st.selection.from);
    let node: Node | null = at.node;
    if (node.nodeType === 1 && at.offset > 0 && node.childNodes[at.offset - 1]) node = node.childNodes[at.offset - 1];
    while (node && node.nodeType !== 1) node = node.parentNode;
    if (node && view.dom.contains(node)) {
      const cs = getComputedStyle(node as Element);
      if (!font) {
        const first = cs.fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '') ?? '';
        font = NOT_A_CHOICE.test(first) ? '' : first;
      }
      if (!size) size = Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2 || 0;
    }
  } catch {
    /* the view is between updates */
  }
  return { font, size };
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

/** the Word file's information: its name and place (each to copy), size, date, pages, and the properties Word keeps in it */
function WordInfoDialog({
  open,
  onOpenChange,
  info,
  model,
  pages,
  onOpenFile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  info: FileFactsInfo;
  model: WordModel;
  pages: PagesInfo | null;
  onOpenFile?: (file: File) => void;
}) {
  const p = model.props;
  const rows: [string, string | undefined][] = [
    ['Tiêu đề', p.title],
    ['Chủ đề', p.subject],
    ['Tác giả', p.creator],
    ['Người lưu lần cuối', p.lastModifiedBy],
    ['Ngày tạo', p.created !== undefined ? formatDate(p.created) : undefined],
    ['Ngày lưu trong tệp', p.modified !== undefined ? formatDate(p.modified) : undefined],
    ['Số lần lưu', p.revision !== undefined ? String(p.revision) : undefined],
    ['Ứng dụng', p.application],
    ['Số trang lúc lưu', p.pages !== undefined ? String(p.pages) : undefined],
    ['Số từ', p.words !== undefined ? p.words.toLocaleString('vi-VN') : undefined],
  ];
  const present = rows.filter((r): r is [string, string] => !!r[1]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[440px]"
        data-testid="word-info-panel"
        closeTestId="word-info-close"
        // nothing focused on opening: the first button would be the copy button, with its focus ring
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Thông tin tệp</DialogTitle>
          <DialogDescription className="sr-only">Tên, vị trí, dung lượng và thuộc tính của tệp Word đang mở</DialogDescription>
        </DialogHeader>
        <FileFacts
          info={info}
          onOpenFile={
            onOpenFile
              ? (f) => {
                  onOpenChange(false);
                  onOpenFile(f);
                }
              : undefined
          }
        />
        {pages && (
          <FactList>
            <Fact label="Số trang" testId="word-info-pages">
              {pages.count}
            </Fact>
          </FactList>
        )}
        {present.length > 0 && (
          <div data-testid="word-info-props">
            <h3 className="mb-2 text-[13px] font-bold">Thuộc tính trong tệp</h3>
            <FactList>
              {present.map(([k, v]) => (
                <Fact key={k} label={k}>
                  {v}
                </Fact>
              ))}
            </FactList>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
