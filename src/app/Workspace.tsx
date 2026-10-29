import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileText, FolderOpen, Loader2, ScanLine } from 'lucide-react';
import { PdfAnnotationSubtype } from '@embedpdf/models';
import { DocumentContent } from '@embedpdf/plugin-document-manager/react';
import { useAnnotation, useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { useHistoryCapability } from '@embedpdf/plugin-history/react';
import { useZoom } from '@embedpdf/plugin-zoom/react';
import { useScrollCapability } from '@embedpdf/plugin-scroll/react';
import { useRegistry } from '@embedpdf/core/react';
import { useInteractionManagerCapability } from '@embedpdf/plugin-interaction-manager/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FullScreenMessage } from './App';
import { BottomBar, TopBar } from './top-bar';
import { LeftPanel, type LeftTab } from './side-panels';
import { PropertiesPanel } from './properties-panel';
import { ToolHint } from './tool-hint';
import { Viewer } from './viewer/Viewer';
import { describeOpenError, useDocumentSession, type DocumentSession } from './use-document-session';
import { PicturesProvider, usePictures } from './images/pictures';
import { usePlacement } from './images/placement';
import { useStampUndoGuard } from './images/stamp-guard';
import { usePageRotation } from './page-rotation';
import { DraftList, formatWhen } from './draft-list';
import { useEzFreeTextTool } from './viewer/free-text';
import { usePlatform } from '@/platform';
import { TextEditBar, TextEditProvider, useTextEdit } from './text-edit';
import { ScanDialog } from './scan/ScanDialog';

function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/**
 * On touch screens the default "select" mode lets one finger scroll the
 * pages (EmbedPDF's default mode takes every touch, so a page could only be
 * scrolled from the grey margin). Tools that draw on the page, and dragging
 * an annotation, still take the touch. Registered before any page mounts.
 */
function useTouchScrolling() {
  const { provides: interaction } = useInteractionManagerCapability();
  useEffect(() => {
    interaction?.registerMode({ id: 'pointerMode', scope: 'page', exclusive: false, cursor: 'auto', wantsRawTouch: false });
  }, [interaction]);
}

export function Workspace({ documentId }: { documentId: string | null }) {
  useTouchScrolling();
  const session = useDocumentSession(documentId);
  const platform = usePlatform();
  const fileInput = useRef<HTMLInputElement>(null);
  const narrow = useMedia('(max-width: 1023px)'); // properties become an overlay
  const phone = useMedia('(max-width: 639px)'); // page list becomes an overlay
  const [leftOpen, setLeftOpen] = useState(!phone);
  const [rightOpen, setRightOpen] = useState(!narrow);
  const [leftTab, setLeftTab] = useState<LeftTab>('pages');
  const [searchFocusKey, setSearchFocusKey] = useState(0);
  const [scanning, setScanning] = useState(false);
  useEffect(() => setLeftOpen(!phone), [phone]);
  useEffect(() => setRightOpen(!narrow), [narrow]);

  const { openPicked } = session;
  const openPicker = useCallback(
    () => (platform.pickPdf ? void openPicked(platform.pickPdf) : fileInput.current?.click()),
    [platform, openPicked],
  );

  // Files handed over from outside: Open with, share sheet, command line.
  const openFileRef = useRef(session.openFile);
  openFileRef.current = session.openFile;
  useEffect(() => platform.onIncomingFiles((files) => void openFileRef.current(files[0])), [platform]);
  const openSearch = useCallback(() => {
    setLeftOpen(true);
    setLeftTab('search');
    setSearchFocusKey((k) => k + 1);
  }, []);

  const shortcutActions = useMemo(
    () => ({ open: openPicker, search: openSearch, exportPdf: session.exportPdf }),
    [openPicker, openSearch, session.exportPdf],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void session.openFile(f);
  };

  const frame = (
    <div className="flex h-full flex-col" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void session.openFile(f);
        }}
      />
      <TopBar
        documentId={session.switching ? null : documentId}
        fileName={session.fileName}
        dirty={session.dirty}
        exportStatus={session.exportStatus}
        draftStatus={session.draftStatus}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
        onOpen={openPicker}
        onScan={() => setScanning(true)}
        onSearch={openSearch}
        onExport={session.exportPdf}
        onClose={() => void session.closeDocument()}
        compact={phone}
      />
      <Banners session={session} />
      <div className="relative flex min-h-0 flex-1">
        {session.openError ? (
          <FullScreenMessage tone="error" title="Không mở được tệp">
            {session.openError}
          </FullScreenMessage>
        ) : session.switching ? (
          <FullScreenMessage
            tone="loading"
            title={session.switching === 'open' ? 'Đang mở tài liệu…' : session.switching === 'update' ? 'Đang cập nhật trang…' : 'Đang đóng tài liệu…'}
          />
        ) : !documentId ? (
          <EmptyState onOpen={openPicker} onScan={() => setScanning(true)} session={session} />
        ) : (
          <DocumentContent documentId={documentId}>
            {({ documentState, isLoading, isError, isLoaded }) => (
              <>
                {isLoading && <FullScreenMessage tone="loading" title="Đang mở tài liệu…" />}
                {isError && (
                  <FullScreenMessage tone="error" title="Không mở được tài liệu">
                    {describeOpenError(documentState)}
                  </FullScreenMessage>
                )}
                {isLoaded && (
                  <LoadedDocument
                    documentId={documentId}
                    fileName={session.fileName}
                    session={session}
                    leftOpen={leftOpen}
                    rightOpen={rightOpen}
                    phone={phone}
                    narrow={narrow}
                    leftTab={leftTab}
                    onLeftTab={setLeftTab}
                    searchFocusKey={searchFocusKey}
                    closeLeft={() => setLeftOpen(false)}
                    closeRight={() => setRightOpen(false)}
                    openRight={() => setRightOpen(true)}
                    shortcuts={shortcutActions}
                  />
                )}
              </>
            )}
          </DocumentContent>
        )}
      </div>
      {phone && documentId && !session.switching && !session.openError && <BottomBar documentId={documentId} />}
      {scanning && (
        <ScanDialog
          onClose={() => setScanning(false)}
          onDone={async (file) => {
            const ok = await session.openMade(file);
            if (ok) setScanning(false);
            return ok;
          }}
        />
      )}
    </div>
  );

  return documentId ? (
    <PicturesProvider documentId={documentId}>
      <TextEditProvider documentId={documentId} session={session}>
        {frame}
      </TextEditProvider>
    </PicturesProvider>
  ) : (
    frame
  );
}

function Banner({ tone = 'warn', children, testId }: { tone?: 'warn' | 'info' | 'error'; children: ReactNode; testId?: string }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      data-testid={testId}
      className={cn(
        'flex flex-wrap items-center gap-2 border-b px-4 py-2 text-[13px]',
        tone === 'warn' && 'border-amber-200 bg-amber-50 text-amber-900',
        tone === 'info' && 'border-primary/20 bg-primary-soft text-foreground',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-900',
      )}
    >
      {children}
    </div>
  );
}

function Banners({ session }: { session: DocumentSession }) {
  const pictures = usePictures();
  return (
    <>
      {session.pendingFile && (
        <Banner testId="banner-unsaved">
          <span>
            Thay đổi gần nhất chưa lưu được vào nháp và chưa xuất. Mở “{session.pendingFile.name}” sẽ bỏ các thay đổi đó.
          </span>
          <Button size="xs" variant="outline" onClick={() => session.openFile(session.pendingFile!, true)} data-testid="btn-open-anyway">
            Bỏ thay đổi và mở
          </Button>
          <Button size="xs" variant="ghost" onClick={session.cancelPendingOpen} data-testid="btn-open-cancel">
            Giữ lại
          </Button>
        </Banner>
      )}
      {session.draftOffer && (
        <Banner tone="info" testId="banner-draft">
          <span>
            “{session.draftOffer.name}” có bản nháp trên máy này, sửa {formatWhen(session.draftOffer.record.updatedAt)}
            {session.draftOffer.record.exported ? ', đã xuất.' : ', chưa xuất.'}
          </span>
          <Button size="xs" onClick={() => void session.resumeDraft(session.draftOffer!.record)} data-testid="btn-draft-resume">
            Mở bản nháp
          </Button>
          <Button size="xs" variant="outline" onClick={() => void session.openOfferedOriginal()} data-testid="btn-draft-original">
            Mở tệp gốc
          </Button>
          <Button size="xs" variant="ghost" onClick={session.dismissDraftOffer} data-testid="btn-draft-cancel">
            Hủy
          </Button>
        </Banner>
      )}
      {pictures?.error && (
        <Banner tone="error" testId="banner-picture-error">
          <span>{pictures.error}</span>
          <Button size="xs" variant="ghost" onClick={pictures.clearError} data-testid="btn-picture-error-close">
            Đóng
          </Button>
        </Banner>
      )}
    </>
  );
}

function LoadedDocument(p: {
  documentId: string;
  fileName: string;
  session: DocumentSession;
  leftOpen: boolean;
  rightOpen: boolean;
  phone: boolean;
  narrow: boolean;
  leftTab: LeftTab;
  onLeftTab: (t: LeftTab) => void;
  searchFocusKey: number;
  closeLeft: () => void;
  closeRight: () => void;
  openRight: () => void;
  shortcuts: { open: () => void; search: () => void; exportPdf: () => void };
}) {
  useShortcuts(p.documentId, p.shortcuts);
  useTestProbe(p.documentId);
  useStampUndoGuard(p.documentId);
  useEzFreeTextTool();
  const { state } = useAnnotation(p.documentId);

  // A new sticky note needs its text: on small screens bring the properties in.
  const selectedNote =
    state.selectedUids.length === 1 && state.byUid[state.selectedUids[0]]?.object.type === PdfAnnotationSubtype.TEXT
      ? state.selectedUids[0]
      : null;
  const { openRight } = p;
  useEffect(() => {
    if (selectedNote && p.narrow) openRight();
  }, [selectedNote, p.narrow, openRight]);

  return (
    <>
      {p.leftOpen && (
        <aside
          data-testid="left-panel"
          className={cn(
            'z-30 w-[196px] shrink-0 border-r bg-background',
            p.phone && 'absolute inset-y-0 left-0 w-[240px] shadow-[4px_0_16px_rgba(0,0,0,0.12)]',
          )}
        >
          <LeftPanel
            documentId={p.documentId}
            tab={p.leftTab}
            onTab={p.onLeftTab}
            searchFocusKey={p.searchFocusKey}
            onNavigate={p.phone ? p.closeLeft : undefined}
          />
        </aside>
      )}
      <main className="flex min-w-0 flex-1 flex-col" data-testid="canvas">
        {/* in the flow, above the pages: it pushes them down instead of covering a line */}
        <TextEditBar />
        <div className="relative min-h-0 flex-1">
          <Viewer documentId={p.documentId} />
          <ToolHint documentId={p.documentId} />
        </div>
      </main>
      {p.rightOpen && (
        <aside
          data-testid="right-panel"
          className={cn(
            'z-30 w-[272px] shrink-0 border-l bg-background',
            p.narrow && 'absolute inset-y-0 right-0 shadow-[-4px_0_16px_rgba(0,0,0,0.12)]',
          )}
        >
          <PropertiesPanel documentId={p.documentId} fileName={p.fileName} session={p.session} />
        </aside>
      )}
    </>
  );
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

function useShortcuts(documentId: string, actions: { open: () => void; search: () => void; exportPdf: () => void }) {
  const { provides: annot } = useAnnotationCapability();
  const { provides: history } = useHistoryCapability();
  const { provides: zoom } = useZoom(documentId);
  const { provides: scroll } = useScrollCapability();
  const placement = usePlacement();
  const pictures = usePictures();
  const rotatePages = usePageRotation(documentId);
  const textEdit = useTextEdit();
  useEffect(() => {
    const scope = annot?.forDocument(documentId);
    const hist = history?.forDocument(documentId);
    const undo = () => (hist?.canUndo() ? hist.undo() : textEdit?.contentUndo.canUndo && void textEdit.contentUndo.undo());
    const redo = () => (hist?.canRedo() ? hist.redo() : textEdit?.contentUndo.canRedo && void textEdit.contentUndo.redo());
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      // App-level shortcuts that also work while typing in the search box
      if (mod && k === 'f') return void (e.preventDefault(), actions.search());
      if (mod && k === 'o') return void (e.preventDefault(), actions.open());
      if (mod && k === 's') return void (e.preventDefault(), actions.exportPdf());
      if (isTyping(e.target) || pictures?.signatureOpen) return;
      if (mod && (k === '=' || k === '+')) return void (e.preventDefault(), zoom?.zoomIn());
      if (mod && k === '-') return void (e.preventDefault(), zoom?.zoomOut());
      if (mod && k === 'z' && !e.shiftKey) return void (e.preventDefault(), undo());
      if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) return void (e.preventDefault(), redo());
      if (mod || e.altKey || !scope) return;
      if (k === 'enter' && placement?.placing) {
        // keyboard placement: the middle of the current page
        e.preventDefault();
        const pi = (scroll?.forDocument(documentId).getCurrentPage() ?? 1) - 1;
        void placement.placeAtCenter(pi);
        return;
      }
      if (k === 'escape') {
        if (textEdit?.selected) textEdit.cancel();
        else if (textEdit?.active) textEdit.setActive(false);
        else if (placement?.placing) placement.cancel();
        else if (scope.getActiveTool()) scope.setActiveTool(null);
        else scope.deselectAnnotation();
        return;
      }
      if (k === 'delete' || k === 'backspace') {
        const sel = scope.getSelectedAnnotations();
        if (sel.length) {
          e.preventDefault();
          scope.deleteAnnotations(sel.map((t) => ({ pageIndex: t.object.pageIndex, id: t.object.id })));
        }
        return;
      }
      if (k === 'r') {
        const page = (scroll?.forDocument(documentId).getCurrentPage() ?? 1) - 1;
        rotatePages([page], e.shiftKey ? -1 : 1);
        return;
      }
      if (k === 'i') return void pictures?.pickImage();
      if (k === 'k') return void (e.preventDefault(), pictures?.openSignature());
      if (k === 'e') return void textEdit?.setActive(!textEdit.active);
      if (!['v', 't', 'h', 'n'].includes(k)) return;
      placement?.cancel();
      textEdit?.setActive(false);
      if (k === 'v') scope.setActiveTool(null);
      else if (k === 't') scope.setActiveTool('freeText');
      else if (k === 'h') scope.setActiveTool('highlight');
      else if (k === 'n') scope.setActiveTool('textComment');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [annot, history, zoom, scroll, documentId, actions, placement, pictures, rotatePages, textEdit]);
}

/** Read-only probe for automated acceptance tests (dev server or ?e2e only). */
function useTestProbe(documentId: string) {
  const { provides } = useAnnotationCapability();
  const { registry } = useRegistry();
  useEffect(() => {
    if (!import.meta.env.DEV && !new URLSearchParams(location.search).has('e2e')) return;
    (window as any).__ezpdf = {
      documentId,
      pages: () =>
        registry?.getStore().getState().core.documents[documentId]?.document?.pages.map((p) => ({
          w: p.size.width,
          h: p.size.height,
          rotation: p.rotation,
        })) ?? [],
      annotations: () => {
        if (!provides) return [];
        const st = provides.forDocument(documentId).getState();
        return Object.values(st.byUid).map((t) => ({ ...t.object, commitState: t.commitState }));
      },
      select: (pageIndex: number, id: string) => provides?.forDocument(documentId).selectAnnotation(pageIndex, id),
      /** what the viewer's own engine reads on a page (not the edit worker) */
      pageText: (pageIndex: number) =>
        new Promise<string>((resolve, reject) => {
          const doc = registry?.getStore().getState().core.documents[documentId]?.document;
          if (!registry || !doc) return reject(new Error('no document'));
          registry
            .getEngine()
            .getPageTextRuns(doc, doc.pages[pageIndex])
            .wait((r) => resolve(r.runs.map((x) => x.text).join(' ')), (e) => reject(new Error(String(e?.reason?.message ?? e))));
        }),
      selected: () => {
        if (!provides) return [];
        const st = provides.forDocument(documentId).getState();
        return (st.selectedUids ?? []).map((uid: string) => st.byUid[uid]?.object.id).filter(Boolean);
      },
    };
  }, [documentId, provides, registry]);
}

const OPEN_HINT = {
  web: 'Kéo thả tệp vào đây hoặc chọn tệp.',
  desktop: 'Kéo thả tệp vào đây, chọn tệp, hoặc bấm chuột phải vào một tệp PDF và chọn Mở bằng ezPDF.',
  android: 'Chọn tệp, hoặc mở hay chia sẻ một PDF sang ezPDF từ ứng dụng khác.',
} as const;

function EmptyState({ onOpen, onScan, session }: { onOpen: () => void; onScan: () => void; session: DocumentSession }) {
  const platform = usePlatform();
  return (
    <div className="flex h-full w-full flex-col items-center overflow-y-auto bg-canvas p-6" data-testid="state-empty">
      <div className="my-auto flex w-full max-w-md flex-col gap-6 py-6">
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-black/15 bg-background px-8 py-10 text-center">
          {session.busy ? (
            <Loader2 className="size-7 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <FileText className="size-7 text-muted-foreground" aria-hidden />
          )}
          <div className="space-y-1">
            <p className="font-bold">Mở một tệp PDF trên máy</p>
            <p className="text-[13px] text-muted-foreground" data-testid="empty-hint">
              {OPEN_HINT[platform.kind]} Tài liệu chỉ được xử lý trên thiết bị này.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={onOpen} data-testid="btn-open-empty" disabled={session.busy}>
              <FolderOpen /> Chọn tệp PDF
            </Button>
            <Button variant="outline" onClick={onScan} data-testid="btn-scan-empty" disabled={session.busy}>
              <ScanLine /> Quét tài liệu
            </Button>
          </div>
        </div>
        <DraftList onOpen={(r) => void session.resumeDraft(r)} />
      </div>
    </div>
  );
}
