/**
 * "Nhận dạng chữ (OCR)": reads the text in scanned pages or pictures, on
 * this device, with the Vietnamese model inside the app, and makes
 *  - a Word file laid out like the paper: tables as Word tables (merged
 *    cells too), paragraphs, headings, pictures, header and footer
 *  - a searchable PDF: the pages as they are, with the words laid over them
 *    invisibly, to find, select and copy
 * From the open PDF (as it would be exported), or from files picked on the
 * start screen: one PDF, or pictures (JPEG, PNG, TIFF with all its pages…).
 * Desktop app only for now (src/app/ocr/available.ts).
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileText, FolderOpen, Loader2, ScanText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDocumentState } from '@embedpdf/core/react';
import { useScroll } from '@embedpdf/plugin-scroll/react';
import { usePlatform } from '@/platform';
import type { SaveResult } from '@/platform/types';
import { closeRenderSession, openRenderSession } from '@/engine/export-client';
import { pictureKind } from '@/ocr/images-pdf';
import { OcrUserError, runOcr, type OcrInput, type OcrProgress, type OcrResult } from '@/ocr/ocr-client';
import { parseRanges } from '../pages/ranges';
import type { DocumentSession } from '../use-document-session';

export type OcrSource =
  /** the open PDF */
  | { kind: 'document'; session: DocumentSession; total: number; current: number }
  /** files picked for OCR: one PDF, or pictures */
  | { kind: 'files'; files: File[] };

type PageChoice = 'all' | 'current' | 'list';

type Phase =
  | { kind: 'options' }
  | { kind: 'working'; progress: OcrProgress }
  | { kind: 'done'; result: OcrResult; seconds: number }
  | { kind: 'error'; message: string };

const stem = (name: string) => name.replace(/\.[^.]+$/, '') || 'tai-lieu';

/** what the picked files are: one PDF (its pages counted), pictures, or something else */
async function describe(files: File[]): Promise<{ pdf: boolean; pages: number; error?: string }> {
  const heads = await Promise.all(files.map(async (f) => new Uint8Array(await f.slice(0, 16).arrayBuffer())));
  const isPdf = heads.map((h) => h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46);
  if (isPdf.some(Boolean)) {
    if (files.length > 1) return { pdf: true, pages: 0, error: 'Chọn một tệp PDF, hoặc một hay nhiều ảnh (không lẫn cả hai).' };
    const { session, pages } = await openRenderSession(await files[0].arrayBuffer());
    void closeRenderSession(session);
    return { pdf: true, pages: pages.length };
  }
  const bad = files.find((_, i) => !pictureKind(heads[i]));
  if (bad) return { pdf: false, pages: 0, error: `${bad.name}: không phải ảnh JPEG, PNG, TIFF, BMP, GIF, WebP hay tệp PDF.` };
  return { pdf: false, pages: files.length };
}

export function OcrDialog({ source, onClose, onOpenFile }: { source: OcrSource; onClose: () => void; onOpenFile: (f: File) => void }) {
  const platform = usePlatform();
  const [choice, setChoice] = useState<PageChoice>('all');
  const [list, setList] = useState('');
  const [word, setWord] = useState(true);
  const [pdf, setPdf] = useState(true);
  const [phase, setPhase] = useState<Phase>({ kind: 'options' });
  const [files, setFiles] = useState<{ pdf: boolean; pages: number; error?: string } | null>(source.kind === 'files' ? null : { pdf: true, pages: source.total });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (source.kind !== 'files') return;
    let live = true;
    describe(source.files).then(
      (d) => live && setFiles(d),
      (e) => live && setFiles({ pdf: true, pages: 0, error: `Không mở được tệp: ${e instanceof Error ? e.message : String(e)}` }),
    );
    return () => {
      live = false;
    };
  }, [source]);
  useEffect(() => () => abort.current?.abort(), []);

  const total = files?.pages ?? 0;
  const pictures = source.kind === 'files' && files && !files.pdf;
  const parsed = choice === 'list' ? parseRanges(list, Math.max(1, total)) : null;
  const pages: number[] | null =
    pictures || choice === 'all'
      ? null
      : choice === 'current' && source.kind === 'document'
        ? [source.current - 1]
        : parsed?.ok
          ? parsed.parts.flatMap((p) => Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from - 1 + i))
          : [];
  const count = pages ? pages.length : total;
  const valid = !!files && !files.error && total > 0 && count > 0 && (word || pdf);
  const working = phase.kind === 'working';

  const start = async () => {
    if (!valid || working) return;
    const ctl = new AbortController();
    abort.current = ctl;
    const t0 = performance.now();
    setPhase({ kind: 'working', progress: { stage: 'prepare', done: 0, total: count } });
    try {
      let input: OcrInput;
      if (source.kind === 'document') {
        const out = await source.session.buildOutput();
        input = { kind: 'pdf', bytes: out.bytes, base: out.base };
      } else if (files!.pdf) {
        input = { kind: 'pdf', bytes: await source.files[0].arrayBuffer(), base: stem(source.files[0].name) };
      } else {
        input = { kind: 'pictures', files: await Promise.all(source.files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))), base: stem(source.files[0].name) };
      }
      if (ctl.signal.aborted) return;
      const result = await runOcr(input, { pages, word, pdf }, { signal: ctl.signal, onProgress: (progress) => !ctl.signal.aborted && setPhase({ kind: 'working', progress }) });
      if (ctl.signal.aborted) return;
      setPhase({ kind: 'done', result, seconds: Math.round((performance.now() - t0) / 1000) });
    } catch (e) {
      if (ctl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setPhase({ kind: 'error', message: e instanceof OcrUserError || e instanceof Error ? e.message : String(e) });
    } finally {
      if (abort.current === ctl) abort.current = null;
    }
  };

  const stop = () => {
    abort.current?.abort();
    setPhase({ kind: 'options' });
  };

  const what = source.kind === 'files' ? (source.files.length === 1 ? source.files[0].name : `${source.files.length} ảnh: ${source.files.map((f) => f.name).join(', ')}`) : null;

  return (
    <Dialog open onOpenChange={(o) => !o && (stop(), onClose())}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[480px]" data-testid="ocr-dialog" closeTestId="ocr-close" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Nhận dạng chữ (OCR)</DialogTitle>
          <DialogDescription>
            Đọc chữ trong trang quét hoặc ảnh bằng mô hình tiếng Việt có sẵn trong ứng dụng. Mọi việc làm ngay trên máy này, tài liệu không được gửi đi đâu.
          </DialogDescription>
        </DialogHeader>

        {phase.kind === 'options' || phase.kind === 'error' ? (
          <div className="space-y-4 text-[13px]">
            {what && (
              <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 [overflow-wrap:anywhere]" data-testid="ocr-source">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  {what}
                  {files && !files.error && <span className="text-muted-foreground"> · {files.pdf ? `${total} trang` : total === 1 ? '1 ảnh' : `${total} ảnh`}</span>}
                </span>
              </p>
            )}
            {files?.error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-900" data-testid="ocr-source-error">
                {files.error}
              </p>
            )}
            {!files && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Đang mở tệp…
              </p>
            )}

            {files && !files.error && !pictures && (
              <fieldset className="space-y-1.5">
                <legend className="mb-1.5 font-bold">Trang</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" className="accent-primary" name="ocr-pages" checked={choice === 'all'} onChange={() => setChoice('all')} data-testid="ocr-pages-all" />
                  Tất cả ({total} trang)
                </label>
                {source.kind === 'document' && (
                  <label className="flex items-center gap-2">
                    <input type="radio" className="accent-primary" name="ocr-pages" checked={choice === 'current'} onChange={() => setChoice('current')} data-testid="ocr-pages-current" />
                    Trang đang xem (trang {source.current})
                  </label>
                )}
                <label className="flex flex-wrap items-center gap-2">
                  <input type="radio" className="accent-primary" name="ocr-pages" checked={choice === 'list'} onChange={() => setChoice('list')} data-testid="ocr-pages-list" />
                  Các trang
                  <input
                    value={list}
                    placeholder="ví dụ 1-3, 5"
                    onChange={(e) => setList(e.target.value)}
                    onFocus={() => setChoice('list')}
                    data-testid="ocr-pages-text"
                    aria-label="Các trang cần nhận dạng"
                    className="h-8 min-w-0 flex-1 rounded-md border bg-white px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
                {parsed && !parsed.ok && list.trim() && (
                  <p className="text-destructive" data-testid="ocr-pages-error">
                    {parsed.error}
                  </p>
                )}
              </fieldset>
            )}

            <fieldset className="space-y-2">
              <legend className="mb-1.5 font-bold">Kết quả</legend>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 accent-primary" checked={word} onChange={(e) => setWord(e.target.checked)} data-testid="ocr-word" />
                <span>
                  <span className="font-medium">Tệp Word (.docx)</span>
                  <span className="block text-muted-foreground">Dựng lại như bản giấy: bảng thành bảng Word (cả ô gộp), đoạn văn, tiêu đề, hình, đầu trang và chân trang.</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 accent-primary" checked={pdf} onChange={(e) => setPdf(e.target.checked)} data-testid="ocr-pdf" />
                <span>
                  <span className="font-medium">PDF tìm được chữ</span>
                  <span className="block text-muted-foreground">Giữ nguyên trang quét, thêm lớp chữ ẩn đúng chỗ từng từ để tìm, chọn và chép. Trang đã có chữ được để nguyên.</span>
                </span>
              </label>
              {!word && !pdf && <p className="text-destructive">Chọn ít nhất một kết quả.</p>}
            </fieldset>

            <p className="text-muted-foreground">Mỗi trang mất vài giây. Chữ in rõ đọc tốt nhất; chữ viết tay, con dấu và chữ ký được giữ như hình.</p>

            {phase.kind === 'error' && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-900" data-testid="ocr-error">
                Không nhận dạng được: {phase.message}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} data-testid="ocr-cancel">
                Hủy
              </Button>
              <Button size="sm" disabled={!valid} onClick={() => void start()} data-testid="ocr-go">
                <ScanText /> Nhận dạng {count > 0 ? (pictures ? (count === 1 ? '1 ảnh' : `${count} ảnh`) : `${count} trang`) : ''}
              </Button>
            </div>
          </div>
        ) : phase.kind === 'working' ? (
          <div className="space-y-3 text-[13px]" data-testid="ocr-working" role="status">
            <p className="flex items-center gap-2 font-bold">
              <Loader2 className="size-4 animate-spin" />
              {phase.progress.stage === 'prepare' ? 'Chuẩn bị (nạp mô hình tiếng Việt)…' : phase.progress.stage === 'write' ? 'Đang tạo tệp kết quả…' : 'Đang nhận dạng chữ…'}
            </p>
            <p className="text-muted-foreground tabular-nums" data-testid="ocr-progress">
              {phase.progress.stage === 'read' ? `Trang ${phase.progress.done}/${phase.progress.total}` : phase.progress.stage === 'write' ? 'Word và PDF' : 'Một lát'}
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full bg-primary transition-[width]" style={{ width: `${phase.progress.total ? Math.round((phase.progress.done / phase.progress.total) * 100) : 0}%` }} />
            </div>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={stop} data-testid="ocr-stop">
                Dừng
              </Button>
            </div>
          </div>
        ) : (
          <Done result={phase.result} seconds={phase.seconds} onClose={onClose} onOpenFile={onOpenFile} />
        )}
      </DialogContent>
    </Dialog>
  );
}

type Saved = { name: string; path?: string; folder?: string };

function Done({ result, seconds, onClose, onOpenFile }: { result: OcrResult; seconds: number; onClose: () => void; onOpenFile: (f: File) => void }) {
  const platform = usePlatform();
  const [saved, setSaved] = useState<{ docx?: Saved; pdf?: Saved }>({});
  const [note, setNote] = useState<string | null>(null);
  const docxName = `${result.base} (OCR).docx`;
  const pdfName = `${result.base} (OCR).pdf`;
  const words = result.layouts.reduce((a, p) => a + countWords(p), 0);
  const tables = result.layouts.reduce((a, p) => a + p.blocks.filter((b) => b.kind === 'table' && !b.borderless).length, 0);

  const keep = async (kind: 'docx' | 'pdf') => {
    setNote(null);
    try {
      const r: SaveResult | null = kind === 'docx' ? await platform.saveWord(result.docx!, docxName) : await platform.savePdf(result.pdf!, pdfName);
      if (!r) return;
      const folder = r.how === 'file' ? r.folder : undefined;
      const path = folder ? `${folder}${folder.includes('\\') ? '\\' : '/'}${r.name}` : undefined;
      setSaved((s) => ({ ...s, [kind]: { name: r.name, folder, path } }));
    } catch (e) {
      setNote(`Không lưu được: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const open = (kind: 'docx' | 'pdf') => {
    const f =
      kind === 'docx'
        ? new File([result.docx! as BlobPart], saved.docx?.name ?? docxName, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
        : new File([result.pdf! as BlobPart], saved.pdf?.name ?? pdfName, { type: 'application/pdf' });
    onClose();
    onOpenFile(f);
  };

  const row = (kind: 'docx' | 'pdf', label: string) => {
    const s = saved[kind];
    return (
      <div className="space-y-1.5 rounded-md border px-3 py-2" data-testid={`ocr-result-${kind}`}>
        <p className="font-medium">{label}</p>
        {s && (
          <p className="text-muted-foreground [overflow-wrap:anywhere]" data-testid={`ocr-saved-${kind}`}>
            Đã lưu: {s.path ?? s.name}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={s ? 'outline' : 'default'} onClick={() => void keep(kind)} data-testid={`ocr-save-${kind}`}>
            {kind === 'docx' ? 'Lưu tệp Word…' : 'Lưu tệp PDF…'}
          </Button>
          {s?.path && platform.revealFile && (
            <Button size="sm" variant="outline" onClick={() => platform.revealFile!(s.path!).catch((e) => setNote(e instanceof Error ? e.message : String(e)))} data-testid={`ocr-reveal-${kind}`}>
              <FolderOpen /> Mở thư mục
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => open(kind)} data-testid={`ocr-open-${kind}`}>
            Xem trong ezPDF
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3 text-[13px]" data-testid="ocr-done">
      <p className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
        <span data-testid="ocr-done-text">
          Đã nhận dạng {result.pages} trang trong {seconds} giây: {words} từ{tables ? `, ${tables} bảng` : ''}.
          {result.hadText.length > 0 && ` Trang ${result.hadText.slice(0, 8).map((p) => p + 1).join(', ')}${result.hadText.length > 8 ? '…' : ''} đã có chữ sẵn${result.pdf ? ', được để nguyên trong bản PDF' : ''}.`}
        </span>
      </p>
      {result.docx && row('docx', 'Tệp Word')}
      {result.pdf && row('pdf', 'PDF tìm được chữ')}
      <p className="text-muted-foreground">Máy đọc vẫn có thể nhầm vài chữ: hãy soát lại những chỗ quan trọng (số liệu, tên riêng) với bản gốc.</p>
      {note && (
        <p role="alert" className="text-destructive">
          {note}
        </p>
      )}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onClose} data-testid="ocr-finish">
          Xong
        </Button>
      </div>
    </div>
  );
}

function countWords(p: OcrResult['layouts'][number]): number {
  let n = 0;
  const walk = (blocks: OcrResult['layouts'][number]['blocks']) => {
    for (const b of blocks) {
      if (b.kind === 'para') n += b.lines.reduce((a, l) => a + l.words.length, 0);
      else if (b.kind === 'table') for (const c of b.cells) for (const q of c.paras) n += q.lines.reduce((a, l) => a + l.words.length, 0);
    }
  };
  walk(p.header);
  walk(p.blocks);
  walk(p.footer);
  return n;
}

/** the dialog for the open PDF: its page count and the page in view */
export function DocumentOcrDialog({ documentId, session, onClose, onOpenFile }: { documentId: string; session: DocumentSession; onClose: () => void; onOpenFile: (f: File) => void }) {
  const doc = useDocumentState(documentId)?.document;
  const { state: scroll } = useScroll(documentId);
  const total = doc?.pageCount || scroll.totalPages || 0;
  const current = Math.min(Math.max(1, scroll.currentPage || 1), Math.max(1, total));
  const [source] = useState<OcrSource>(() => ({ kind: 'document', session, total, current }));
  // another document opened meanwhile: this one is gone
  const epoch = useRef(session.docEpoch);
  useEffect(() => {
    if (session.docEpoch !== epoch.current) onClose();
  }, [session.docEpoch, onClose]);
  return <OcrDialog source={source} onClose={onClose} onOpenFile={onOpenFile} />;
}
