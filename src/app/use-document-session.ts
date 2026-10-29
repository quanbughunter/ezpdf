import { useCallback, useEffect, useRef, useState } from 'react';
import { PdfErrorCode, uuidV4, type Task } from '@embedpdf/models';
import { useDocumentState, useRegistry } from '@embedpdf/core/react';
import { useDocumentManagerCapability } from '@embedpdf/plugin-document-manager/react';
import { useExportCapability } from '@embedpdf/plugin-export/react';
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/react';
import { useHistoryCapability } from '@embedpdf/plugin-history/react';
import { useScrollCapability } from '@embedpdf/plugin-scroll/react';
import { finalizePdf } from '@/engine/export-client';
import { applyPageRotations, getPageRotations } from './page-rotation';
import {
  createDraft,
  latestDraftFor,
  loadDraftFiles,
  markExported,
  sha256,
  updateDraft,
  type DraftRecord,
} from './storage/drafts';
import { describeStorageError } from '@/platform/storage/backend';
import { usePlatform } from '@/platform';

export const asPromise = <T>(task: Task<T, any>) =>
  new Promise<T>((resolve, reject) =>
    task.wait(resolve, (e: any) => reject(new Error(e?.reason?.message ?? e?.message ?? 'Thao tác thất bại'))),
  );

export type ExportStatus =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; fileName: string; folder?: string; warnings: string[] }
  | { kind: 'error'; message: string };

export type DraftStatus =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string };

export interface DraftOffer {
  name: string;
  buffer: ArrayBuffer;
  original: Blob;
  hash: string;
  record: DraftRecord;
}

interface Current {
  draftId: string;
  hash: string;
  name: string;
  original: Blob;
  /** null until the first autosave of this session */
  record: DraftRecord | null;
}

/**
 * Autosave waits this long after the last change. Saving a large file keeps
 * the engine worker busy (G6: EmbedPDF copies the saved bytes one by one),
 * so big documents wait longer between saves; leaving the tab saves at once.
 */
const autosaveDelay = (bytes: number) => 1200 + Math.min(6800, (bytes / 1e6) * 120);

/**
 * One open document and its lifecycle:
 *  - original: the file the user opened, never written
 *  - draft: autosaved to this device a moment after each change (original +
 *    current state, see storage/drafts.ts), so a reload or a closed tab
 *    loses nothing; reopening the same file offers the draft
 *  - export: always a new file, built from the current state
 */
export function useDocumentSession(documentId: string | null) {
  const platform = usePlatform();
  const { registry } = useRegistry();
  const { provides: docs } = useDocumentManagerCapability();
  const { provides: exporter } = useExportCapability();
  const { provides: annotations } = useAnnotationCapability();
  const { provides: history } = useHistoryCapability();
  const { provides: scroll } = useScrollCapability();
  const docState = useDocumentState(documentId);
  const [fileName, setFileName] = useState('');
  const [openError, setOpenError] = useState<string | null>(null);
  const [changes, setChanges] = useState({ seq: 0, exportedSeq: 0, savedSeq: 0 });
  const [exportStatus, setExportStatus] = useState<ExportStatus>({ kind: 'idle' });
  const [draftStatus, setDraftStatus] = useState<DraftStatus>({ kind: 'none' });
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [draftOffer, setDraftOffer] = useState<DraftOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState<null | 'open' | 'close'>(null);
  const current = useRef<Current | null>(null);
  const restore = useRef<{ rotations: number[]; lastPage: number } | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const changesRef = useRef(changes);
  changesRef.current = changes;
  const dirty = changes.seq !== changes.exportedSeq;
  const unsaved = changes.seq !== changes.savedSeq;

  // Every undoable action (annotations, page rotation, undo, redo) changes the document.
  useEffect(() => {
    if (!history) return;
    return history.onHistoryChange(() => {
      setChanges((c) => ({ ...c, seq: c.seq + 1 }));
      setExportStatus((s) => (s.kind === 'done' ? { kind: 'idle' } : s));
    });
  }, [history]);

  // A resumed draft gets its page rotations and reading position back once loaded.
  useEffect(() => {
    if (!registry || !documentId || docState?.status !== 'loaded' || !restore.current) return;
    const r = restore.current;
    restore.current = null;
    applyPageRotations(registry, documentId, Object.fromEntries(r.rotations.map((v, i) => [i, v])));
    if (r.lastPage > 1) {
      setTimeout(() => scroll?.forDocument(documentId).scrollToPage({ pageNumber: r.lastPage, behavior: 'instant' }), 50);
    }
  }, [registry, documentId, docState?.status, scroll]);

  const saveNow = useCallback((): Promise<void> => {
    const run = async () => {
      const cur = current.current;
      const id = documentId;
      if (!cur || !id || !exporter || !annotations || !registry) return;
      const seq = changesRef.current.seq;
      if (seq === changesRef.current.savedSeq) return;
      setDraftStatus({ kind: 'saving' });
      try {
        await asPromise(annotations.forDocument(id).commit());
        const bytes = await asPromise(exporter.forDocument(id).saveAsCopy());
        const draft = new Blob([bytes], { type: 'application/pdf' });
        const now = Date.now();
        let lastPage = 1;
        try {
          lastPage = scroll?.forDocument(id).getCurrentPage() ?? 1;
        } catch {}
        const rec: DraftRecord = {
          id: cur.draftId,
          name: cur.name,
          hash: cur.hash,
          originalSize: cur.original.size,
          draftSize: draft.size,
          pages: registry.getStore().getState().core.documents[id]?.document?.pageCount ?? 0,
          rotations: getPageRotations(registry, id),
          lastPage,
          createdAt: cur.record?.createdAt ?? now,
          updatedAt: now,
          exported: changesRef.current.exportedSeq === seq,
        };
        if (cur.record) await updateDraft(rec, draft);
        else await createDraft(rec, cur.original, draft);
        cur.record = rec;
        if (current.current === cur) {
          setChanges((c) => ({ ...c, savedSeq: Math.max(c.savedSeq, seq) }));
          setDraftStatus({ kind: 'saved', at: now });
        }
      } catch (e) {
        if (current.current === cur) setDraftStatus({ kind: 'error', message: describeStorageError(e) });
      }
    };
    const p = saving.current.then(run, run);
    saving.current = p;
    return p;
  }, [documentId, exporter, annotations, registry, scroll]);

  // Autosave shortly after the last change.
  useEffect(() => {
    if (!documentId || changes.seq === changes.savedSeq) return;
    setDraftStatus((s) => (s.kind === 'saving' || s.kind === 'error' ? s : { kind: 'pending' }));
    const t = setTimeout(() => void saveNow(), autosaveDelay(current.current?.original.size ?? 0));
    return () => clearTimeout(t);
  }, [changes.seq, changes.savedSeq, documentId, saveNow]);

  // Leaving the tab or app: save right away.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && changesRef.current.seq !== changesRef.current.savedSeq && void saveNow();
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [saveNow]);

  // Only changes that are not yet in the draft are at risk when the tab closes.
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  /** Save what is pending; true when every change is now in the draft. */
  const flush = useCallback(async () => {
    if (changesRef.current.seq !== changesRef.current.savedSeq) await saveNow();
    await saving.current;
    return changesRef.current.seq === changesRef.current.savedSeq;
  }, [saveNow]);

  // Desktop window closing: finish the draft first (bounded, a stuck save must not keep the window open).
  useEffect(
    () => platform.onCloseRequested?.(async () => void (await Promise.race([flush(), new Promise((r) => setTimeout(r, 15_000))]))),
    [platform, flush],
  );

  /**
   * G14: EmbedPDF's page pointer handlers stay attached until React unmounts
   * the viewer; a pointer event that reaches them after the document is
   * closed throws ("Interaction state not found"). Take the viewer down
   * first, then close.
   */
  const unmountViewer = useCallback(async (why: 'open' | 'close') => {
    setSwitching(why);
    await new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  }, []);

  const openAfterUnmount = useCallback(
    async (buffer: ArrayBuffer, cur: Current, resumed?: DraftRecord) => {
      if (!docs) return;
      await asPromise(docs.closeAllDocuments());
      current.current = cur;
      setFileName(cur.name);
      setExportStatus({ kind: 'idle' });
      setChanges(resumed ? { seq: 1, savedSeq: 1, exportedSeq: resumed.exported ? 1 : 0 } : { seq: 0, savedSeq: 0, exportedSeq: 0 });
      setDraftStatus(resumed ? { kind: 'saved', at: resumed.updatedAt } : { kind: 'none' });
      restore.current = resumed ? { rotations: resumed.rotations, lastPage: resumed.lastPage } : null;
      await asPromise(docs.openDocumentBuffer({ buffer, name: cur.name, autoActivate: true }));
    },
    [docs],
  );

  const openBuffer = useCallback(
    async (buffer: ArrayBuffer, cur: Current, resumed?: DraftRecord) => {
      if (!docs) return;
      await unmountViewer('open');
      try {
        await openAfterUnmount(buffer, cur, resumed);
      } finally {
        setSwitching(null);
      }
    },
    [docs, unmountViewer, openAfterUnmount],
  );

  const guarded = useCallback(
    async (file: File | null, force: boolean) => {
      const safe = await flush();
      if (!safe && changesRef.current.seq !== changesRef.current.exportedSeq && !force) {
        if (file) setPendingFile(file);
        return false;
      }
      return true;
    },
    [flush],
  );

  const openFile = useCallback(
    async (file: File, force = false) => {
      if (!docs) return;
      setDraftOffer(null);
      if (!(await guarded(file, force))) return;
      setPendingFile(null);
      setOpenError(null);
      if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        setOpenError(`“${file.name}” không phải tệp PDF. Hãy chọn một tệp .pdf.`);
        return;
      }
      setBusy(true);
      try {
        const buffer = await file.arrayBuffer();
        const hash = await sha256(buffer);
        const existing = await latestDraftFor(hash).catch(() => null);
        if (existing) {
          setDraftOffer({ name: file.name, buffer, original: file, hash, record: existing });
          return;
        }
        await openBuffer(buffer, { draftId: uuidV4(), hash, name: file.name, original: file, record: null });
      } catch (e) {
        setOpenError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [docs, guarded, openBuffer],
  );

  /** Open through the platform's own picker (desktop and Android dialogs). */
  const openPicked = useCallback(
    async (pick: () => Promise<File | null>) => {
      try {
        const file = await pick();
        if (file) await openFile(file);
      } catch (e) {
        setOpenError(e instanceof Error ? e.message : String(e));
      }
    },
    [openFile],
  );

  const resumeDraft = useCallback(
    async (record: DraftRecord) => {
      setDraftOffer(null);
      if (!(await guarded(null, false))) return;
      setOpenError(null);
      setBusy(true);
      try {
        const files = await loadDraftFiles(record.id);
        if (!files) throw new Error('Bản nháp này không còn đủ dữ liệu trên máy.');
        const buffer = await files.draft.arrayBuffer();
        await openBuffer(buffer, { draftId: record.id, hash: record.hash, name: record.name, original: files.original, record }, record);
      } catch (e) {
        setOpenError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [guarded, openBuffer],
  );

  /** Open the original of an offered draft as a fresh session; the draft stays listed. */
  const openOfferedOriginal = useCallback(async () => {
    const offer = draftOffer;
    if (!offer) return;
    setDraftOffer(null);
    setBusy(true);
    try {
      await openBuffer(offer.buffer, { draftId: uuidV4(), hash: offer.hash, name: offer.name, original: offer.original, record: null });
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [draftOffer, openBuffer]);

  const closeDocument = useCallback(async () => {
    if (!docs || !(await guarded(null, false))) return;
    current.current = null;
    await unmountViewer('close');
    try {
      await asPromise(docs.closeAllDocuments());
    } finally {
      setSwitching(null);
    }
    setFileName('');
    setChanges({ seq: 0, exportedSeq: 0, savedSeq: 0 });
    setDraftStatus({ kind: 'none' });
    setExportStatus({ kind: 'idle' });
  }, [docs, guarded, unmountViewer]);

  const exportPdf = useCallback(async () => {
    if (!documentId || !exporter || !annotations || !registry) return;
    setExportStatus({ kind: 'working' });
    try {
      await asPromise(annotations.forDocument(documentId).commit());
      const seq = changesRef.current.seq;
      const raw = await asPromise(exporter.forDocument(documentId).saveAsCopy());
      const rotations = getPageRotations(registry, documentId);
      const out = await finalizePdf(raw, { pageRotations: Object.fromEntries(rotations.map((r, i) => [i, r])) });
      const base = fileName.replace(/\.pdf$/i, '') || 'tai-lieu';
      const saved = await platform.savePdf(new Uint8Array(out.bytes), `${base} (ezPDF).pdf`);
      if (!saved) {
        setExportStatus({ kind: 'idle' }); // save dialog cancelled
        return;
      }
      const warnings = [...out.report.warnings];
      if (out.report.missingGlyphs.length) warnings.push(`Phông chưa có ký tự: ${out.report.missingGlyphs.join(' ')}`);
      setChanges((c) => ({ ...c, exportedSeq: seq }));
      const rec = current.current?.record;
      if (rec && changesRef.current.savedSeq === seq) void markExported(rec.id).then(() => (rec.exported = true), () => {});
      setExportStatus({ kind: 'done', fileName: saved.name, folder: saved.how === 'file' ? saved.folder : undefined, warnings });
    } catch (e) {
      setExportStatus({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [documentId, exporter, annotations, registry, fileName, platform]);

  return {
    fileName,
    openError,
    dirty,
    unsaved,
    exportStatus,
    draftStatus,
    pendingFile,
    draftOffer,
    busy,
    switching,
    openFile,
    openPicked,
    resumeDraft,
    openOfferedOriginal,
    dismissDraftOffer: () => setDraftOffer(null),
    cancelPendingOpen: () => setPendingFile(null),
    closeDocument,
    exportPdf,
  };
}

export type DocumentSession = ReturnType<typeof useDocumentSession>;

export function describeOpenError(state: { error: string | null; errorCode?: PdfErrorCode }): string {
  if (state.errorCode === PdfErrorCode.Password) return 'Tài liệu có mật khẩu. Bản này chưa hỗ trợ nhập mật khẩu.';
  return state.error || 'Tệp có thể bị hỏng hoặc không phải PDF hợp lệ.';
}
