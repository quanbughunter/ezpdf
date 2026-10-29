import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  Highlighter,
  ImagePlus,
  Loader2,
  MessageSquareText,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Redo2,
  RotateCcw,
  RotateCw,
  ScanLine,
  Search,
  Signature,
  TextCursorInput,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useZoom, ZoomMode } from '@embedpdf/plugin-zoom/react';
import { useAnnotation } from '@embedpdf/plugin-annotation/react';
import { useHistoryCapability } from '@embedpdf/plugin-history/react';
import { useScroll } from '@embedpdf/plugin-scroll/react';
import { useDocumentState } from '@embedpdf/core/react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BarDivider, IconAction, ToolToggle } from './controls';
import type { DraftStatus, ExportStatus } from './use-document-session';
import { usePictures } from './images/pictures';
import { usePlacement } from './images/placement';
import { usePageRotation } from './page-rotation';
import { useTextEdit } from './text-edit';

export const TOOLS = [
  { id: null, label: 'Chọn và di chuyển', shortcut: 'V', icon: MousePointer2, testId: 'tool-select' },
  { id: 'freeText', label: 'Thêm chữ', shortcut: 'T', icon: Type, testId: 'tool-text' },
  { id: 'highlight', label: 'Tô sáng chữ', shortcut: 'H', icon: Highlighter, testId: 'tool-highlight' },
  { id: 'textComment', label: 'Ghi chú dán', shortcut: 'N', icon: MessageSquareText, testId: 'tool-note' },
] as const;

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

interface Props {
  documentId: string | null;
  fileName: string;
  dirty: boolean;
  exportStatus: ExportStatus;
  draftStatus: DraftStatus;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onOpen: () => void;
  onScan: () => void;
  onSearch: () => void;
  onExport: () => void;
  onClose: () => void;
  /** phone layout: tools move to BottomBar, the top keeps file actions */
  compact?: boolean;
}

export function TopBar(p: Props) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-background px-2 [scrollbar-width:none]">
      {p.documentId && (
        <IconAction
          label={p.leftOpen ? 'Ẩn cột trang' : 'Hiện cột trang'}
          onClick={p.onToggleLeft}
          testId="btn-toggle-left"
        >
          <PanelLeft />
        </IconAction>
      )}
      <IconAction label="Mở tệp PDF" shortcut="Ctrl O" onClick={p.onOpen} testId="btn-open">
        <FolderOpen />
      </IconAction>
      <IconAction label="Quét tài liệu thành PDF" onClick={p.onScan} testId="btn-scan">
        <ScanLine />
      </IconAction>
      {p.documentId && !p.compact && <DocumentTools documentId={p.documentId} onSearch={p.onSearch} />}
      {p.documentId && p.compact && (
        <IconAction label="Tìm trong tài liệu" shortcut="Ctrl F" onClick={p.onSearch} testId="btn-search">
          <Search />
        </IconAction>
      )}
      {p.documentId && p.compact && <CompactPage documentId={p.documentId} />}
      <div className="min-w-4 flex-1" />
      {p.documentId && (
        <>
          <div className="mr-1 hidden max-w-64 min-w-0 flex-col items-end leading-tight md:flex">
            <span className="w-full truncate text-right text-[13px]" title={p.fileName}>
              {p.fileName}
            </span>
            <SaveState dirty={p.dirty} status={p.exportStatus} draft={p.draftStatus} />
          </div>
          <span className="mr-1 md:hidden">
            <SaveState dirty={p.dirty} status={p.exportStatus} draft={p.draftStatus} compact />
          </span>
          <IconAction label="Đóng tài liệu (nháp đã lưu trên máy)" onClick={p.onClose} testId="btn-close-doc">
            <X />
          </IconAction>
          <IconAction
            label={p.rightOpen ? 'Ẩn thuộc tính' : 'Hiện thuộc tính'}
            onClick={p.onToggleRight}
            testId="btn-toggle-right"
          >
            <PanelRight />
          </IconAction>
          <Button
            size="sm"
            data-testid="btn-export"
            onClick={p.onExport}
            disabled={p.exportStatus.kind === 'working'}
            className="ml-1 shrink-0"
            title="Xuất ra tệp PDF mới (Ctrl S)"
          >
            {p.exportStatus.kind === 'working' ? <Loader2 className="animate-spin" /> : <Download />}
            {p.compact ? 'Xuất' : 'Xuất PDF'}
          </Button>
        </>
      )}
    </header>
  );
}

/** Phone layout: which page is "this page" for the rotate button, without the page box. */
function CompactPage({ documentId }: { documentId: string }) {
  const { state } = useScroll(documentId);
  // the scroll state counts pages only once it has laid them out
  const total = useDocumentState(documentId)?.document?.pageCount || state.totalPages;
  return (
    <span
      className="ml-1 shrink-0 text-[13px] text-muted-foreground tabular-nums"
      data-testid="page-compact"
      aria-label={`Đang xem trang ${state.currentPage} trên ${total}`}
    >
      {state.currentPage}/{total}
    </span>
  );
}

/** Phone layout: the editing tools sit under the thumb, above the page. */
export function BottomBar({ documentId }: { documentId: string }) {
  return (
    <nav
      aria-label="Công cụ"
      className="flex h-12 shrink-0 items-center justify-between gap-0 overflow-x-auto border-t bg-background px-1 [scrollbar-width:none]"
    >
      <DocumentTools documentId={documentId} variant="bottom" />
    </nav>
  );
}

function DocumentTools({
  documentId,
  onSearch,
  variant = 'full',
}: {
  documentId: string;
  onSearch?: () => void;
  variant?: 'full' | 'bottom';
}) {
  const full = variant === 'full';
  const { state: zoom, provides: zoomApi } = useZoom(documentId);
  const { state: annot, provides: annotApi } = useAnnotation(documentId);
  const pictures = usePictures();
  const placement = usePlacement();
  const rotatePages = usePageRotation(documentId);
  const { provides: history } = useHistoryCapability();
  const { state: scroll, provides: scrollApi } = useScroll(documentId);
  const pageCount = useDocumentState(documentId)?.document?.pageCount ?? scroll.totalPages;
  const [, rerender] = useState(0);
  useEffect(() => history?.onHistoryChange(() => rerender((n) => n + 1)), [history]);
  const scope = history?.forDocument(documentId);
  const tool = annot.activeToolId;
  const textEdit = useTextEdit();
  const editing = !!textEdit?.active;
  const content = textEdit?.contentUndo;

  return (
    <>
      {full && <BarDivider />}
      {TOOLS.map((t) => (
        <ToolToggle
          key={t.testId}
          label={t.label}
          shortcut={t.shortcut}
          testId={t.testId}
          pressed={tool === t.id && !placement?.placing && !editing}
          onPressedChange={(on) => {
            placement?.cancel();
            textEdit?.setActive(false);
            annotApi?.setActiveTool(on ? t.id : null);
          }}
        >
          <t.icon />
        </ToolToggle>
      ))}
      <ToolToggle
        label="Sửa chữ có sẵn trong tệp"
        shortcut="E"
        testId="tool-edit-text"
        pressed={editing}
        onPressedChange={(on) => textEdit?.setActive(on)}
      >
        <TextCursorInput />
      </ToolToggle>
      <ToolToggle
        label="Thêm ảnh (PNG, JPG)"
        shortcut="I"
        testId="tool-image"
        pressed={placement?.placing?.kind === 'image'}
        onPressedChange={(on) => (on ? pictures?.pickImage() : placement?.cancel())}
      >
        <ImagePlus />
      </ToolToggle>
      <ToolToggle
        label="Chữ ký"
        shortcut="K"
        testId="tool-signature"
        pressed={placement?.placing?.kind === 'signature' || !!pictures?.signatureOpen}
        onPressedChange={(on) => (on ? pictures?.openSignature() : placement?.cancel())}
      >
        <Signature />
      </ToolToggle>
      {full && <BarDivider />}
      <IconAction
        label="Hoàn tác"
        shortcut="Ctrl Z"
        onClick={() => (scope?.canUndo() ? scope.undo() : content?.canUndo && void content.undo())}
        disabled={!scope?.canUndo() && !content?.canUndo}
        testId="btn-undo"
      >
        <Undo2 />
      </IconAction>
      <IconAction
        label="Làm lại"
        shortcut="Ctrl Y"
        onClick={() => (scope?.canRedo() ? scope.redo() : content?.canRedo && void content.redo())}
        disabled={!scope?.canRedo() && !content?.canRedo}
        testId="btn-redo"
      >
        <Redo2 />
      </IconAction>
      {full && (
        <>
          <BarDivider />
          <IconAction
            label="Trang trước"
            onClick={() => scrollApi?.scrollToPreviousPage()}
            disabled={scroll.currentPage <= 1}
            testId="btn-page-prev"
          >
            <ChevronLeft />
          </IconAction>
          <PageInput
            current={scroll.currentPage}
            total={pageCount}
            onGo={(n) => scrollApi?.scrollToPage({ pageNumber: n })}
          />
          <IconAction
            label="Trang sau"
            onClick={() => scrollApi?.scrollToNextPage()}
            disabled={scroll.currentPage >= pageCount}
            testId="btn-page-next"
          >
            <ChevronRight />
          </IconAction>
        </>
      )}
      {full && <BarDivider />}
      {full && (
        <IconAction label="Thu nhỏ" shortcut="Ctrl −" onClick={() => zoomApi?.zoomOut()} testId="btn-zoom-out">
          <ZoomOut />
        </IconAction>
      )}
      {full && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-[72px] shrink-0 gap-0.5 px-1.5 tabular-nums"
              data-testid="zoom-menu"
              aria-label="Mức phóng"
            >
              <span data-testid="zoom-level">{Math.round((zoom.currentZoomLevel ?? 1) * 100)}%</span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="min-w-40">
            <DropdownMenuItem data-testid="zoom-fit-width" onSelect={() => zoomApi?.requestZoom(ZoomMode.FitWidth)}>
              Vừa chiều rộng
            </DropdownMenuItem>
            <DropdownMenuItem data-testid="zoom-fit-page" onSelect={() => zoomApi?.requestZoom(ZoomMode.FitPage)}>
              Vừa cả trang
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {ZOOM_STEPS.map((z) => (
              <DropdownMenuItem
                key={z}
                data-testid={`zoom-${Math.round(z * 100)}`}
                onSelect={() => zoomApi?.requestZoom(z)}
              >
                {Math.round(z * 100)}%
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {full && (
        <IconAction label="Phóng to" shortcut="Ctrl +" onClick={() => zoomApi?.zoomIn()} testId="btn-zoom-in">
          <ZoomIn />
        </IconAction>
      )}
      <span className="flex shrink-0 items-center">
        <IconAction
          label={`Xoay trang ${scroll.currentPage} sang phải`}
          shortcut="R"
          onClick={() => rotatePages([scroll.currentPage - 1], 1)}
          testId="btn-rotate-page"
        >
          <RotateCw />
        </IconAction>
        {full && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="w-5 text-muted-foreground" data-testid="rotate-menu" aria-label="Các cách xoay trang">
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="min-w-52">
              <DropdownMenuItem data-testid="rotate-page-right" onSelect={() => rotatePages([scroll.currentPage - 1], 1)}>
                <RotateCw /> Xoay trang này sang phải
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="rotate-page-left" onSelect={() => rotatePages([scroll.currentPage - 1], -1)}>
                <RotateCcw /> Xoay trang này sang trái
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-testid="rotate-all-right" onSelect={() => rotatePages(Array.from({ length: pageCount }, (_, i) => i), 1)}>
                <RotateCw /> Xoay mọi trang sang phải
              </DropdownMenuItem>
              <DropdownMenuItem data-testid="rotate-all-left" onSelect={() => rotatePages(Array.from({ length: pageCount }, (_, i) => i), -1)}>
                <RotateCcw /> Xoay mọi trang sang trái
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </span>
      {onSearch && (
        <IconAction label="Tìm trong tài liệu" shortcut="Ctrl F" onClick={onSearch} testId="btn-search">
          <Search />
        </IconAction>
      )}
    </>
  );
}

function PageInput({ current, total, onGo }: { current: number; total: number; onGo: (n: number) => void }) {
  const [value, setValue] = useState(String(current));
  useEffect(() => setValue(String(current)), [current]);
  const go = () => {
    const n = Math.min(total, Math.max(1, parseInt(value, 10) || current));
    setValue(String(n));
    if (n !== current) onGo(n);
  };
  return (
    <span className="flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground tabular-nums">
      <input
        aria-label="Số trang"
        data-testid="page-input"
        inputMode="numeric"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => e.key === 'Enter' && go()}
        onBlur={go}
        className="h-7 w-10 rounded-md border bg-white text-center text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <span data-testid="page-total">/ {total}</span>
    </span>
  );
}

const hhmm = (t: number) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

/**
 * Where the work stands: exported or not (amber dot = not yet in an exported
 * file), and whether the latest change is safe in the draft on this device.
 */
function SaveState({
  dirty,
  status,
  draft,
  compact,
}: {
  dirty: boolean;
  status: ExportStatus;
  draft: DraftStatus;
  compact?: boolean;
}) {
  if (status.kind === 'error')
    return (
      <span className="max-w-56 truncate text-xs text-destructive" title={status.message} data-testid="export-error">
        Xuất lỗi: {status.message}
      </span>
    );
  if (status.kind === 'working') return <span className="text-xs text-muted-foreground">Đang xuất…</span>;
  if (draft.kind === 'error')
    return (
      <span className="inline-flex max-w-60 items-center gap-1.5 truncate text-xs text-destructive" title={draft.message} data-testid="state-draft-error">
        <span className="size-1.5 shrink-0 rounded-full bg-destructive" />
        {!compact && `Chưa lưu được nháp: ${draft.message}`}
      </span>
    );
  if (dirty) {
    const text =
      draft.kind === 'saved' ? `Nháp đã lưu ${hhmm(draft.at)} · chưa xuất` : draft.kind === 'none' ? 'Có thay đổi chưa xuất' : 'Đang lưu nháp…';
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-warning"
        data-testid="state-dirty"
        data-draft={draft.kind}
        title={draft.kind === 'saved' ? 'Thay đổi đã lưu trên máy này, chưa có trong tệp xuất' : 'Có thay đổi chưa xuất'}
      >
        <span className="size-1.5 rounded-full bg-warning" />
        {!compact && <span data-testid={draft.kind === 'saved' ? 'state-draft-saved' : undefined}>{text}</span>}
      </span>
    );
  }
  if (status.kind === 'done')
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-success"
        title={[status.folder ? `${status.folder} / ${status.fileName}` : status.fileName, ...status.warnings].join('\n')}
        data-testid="state-exported"
      >
        <Check className="size-3.5" />
        {!compact && (status.warnings.length ? `Đã xuất, ${status.warnings.length} cảnh báo` : 'Đã xuất')}
      </span>
    );
  return null;
}
