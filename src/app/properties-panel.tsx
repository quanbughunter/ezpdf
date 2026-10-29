import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Minus, Plus, Trash2 } from 'lucide-react';
import {
  PdfAnnotationSubtype,
  PdfTextAlignment,
  type PdfAnnotationObject,
  type PdfFreeTextAnnoObject,
} from '@embedpdf/models';
import { useAnnotation } from '@embedpdf/plugin-annotation/react';
import type { TrackedAnnotation } from '@embedpdf/plugin-annotation';
import { useScroll } from '@embedpdf/plugin-scroll/react';
import { useDocumentState } from '@embedpdf/core/react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { EZ_MARK } from '@/engine/vn-freetext-export';
import { Swatch } from './controls';
import { BACKGROUND_COLORS, HIGHLIGHT_COLORS, NOTE_COLORS, TEXT_COLORS } from './palette';
import { useTextFont } from './text-font';
import { growToFit } from './viewer/free-text';
import { isEzImage, isLockedForeignStamp } from './images/stamp-guard';
import type { DocumentSession } from './use-document-session';
import { formatWhen } from './draft-list';

const KIND: Record<number, string> = {
  [PdfAnnotationSubtype.FREETEXT]: 'Ô chữ',
  [PdfAnnotationSubtype.HIGHLIGHT]: 'Tô sáng',
  [PdfAnnotationSubtype.TEXT]: 'Ghi chú dán',
  [PdfAnnotationSubtype.STAMP]: 'Ảnh',
  [PdfAnnotationSubtype.INK]: 'Nét vẽ',
};

export const SHORTCUTS: [string, string][] = [
  ['V', 'Chọn và di chuyển'],
  ['T', 'Thêm chữ'],
  ['H', 'Tô sáng chữ'],
  ['N', 'Ghi chú dán'],
  ['I', 'Thêm ảnh'],
  ['K', 'Chữ ký'],
  ['E', 'Sửa chữ có sẵn trong tệp'],
  ['R / Shift R', 'Xoay trang này phải / trái'],
  ['Enter', 'Đặt ảnh, chữ ký vào giữa trang'],
  ['Esc', 'Hủy đặt ảnh hay sửa chữ, về công cụ chọn, bỏ chọn'],
  ['Delete', 'Xóa đối tượng đang chọn'],
  ['Ctrl Z / Ctrl Y', 'Hoàn tác / làm lại'],
  ['Ctrl F', 'Tìm trong tài liệu'],
  ['Ctrl + / Ctrl −', 'Phóng to / thu nhỏ'],
  ['Ctrl O', 'Mở tệp'],
  ['Ctrl S', 'Xuất PDF'],
];

export function PropertiesPanel({
  documentId,
  fileName,
  session,
}: {
  documentId: string;
  fileName: string;
  session: DocumentSession;
}) {
  const { state, provides } = useAnnotation(documentId);
  const selected = state.selectedUids.map((id) => state.byUid[id]).filter(Boolean) as TrackedAnnotation[];

  if (selected.length === 0) return <DocumentInfo documentId={documentId} fileName={fileName} session={session} />;

  const remove = () => provides?.deleteAnnotations(selected.map((t) => ({ pageIndex: t.object.pageIndex, id: t.object.id })));
  if (selected.length > 1) {
    return (
      <Panel title={`${selected.length} đối tượng`}>
        <DeleteButton onClick={remove} />
      </Panel>
    );
  }

  const t = selected[0];
  const obj = t.object;
  const update = (patch: Partial<PdfAnnotationObject>) =>
    provides?.updateAnnotation(obj.pageIndex, obj.id, { ...patch, custom: { ...(obj.custom ?? {}), [EZ_MARK]: 1 } });

  const title =
    obj.type === PdfAnnotationSubtype.STAMP
      ? isEzImage(obj)
        ? (obj.custom as { kind?: string } | undefined)?.kind === 'signature'
          ? 'Chữ ký'
          : 'Ảnh'
        : 'Dấu có sẵn trong tệp'
      : (KIND[obj.type] ?? 'Đối tượng');

  return (
    <Panel title={title} subtitle={`Trang ${obj.pageIndex + 1}`}>
      {obj.type === PdfAnnotationSubtype.STAMP && (
        <>
          <Field label="Kích thước trên trang">
            <p className="text-[13px] tabular-nums" data-testid="stamp-size">
              {Math.round(obj.rect.size.width)} × {Math.round(obj.rect.size.height)} pt
            </p>
          </Field>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {isLockedForeignStamp(obj)
              ? 'Dấu này có sẵn trong tệp và không có tên loại. Chỉ xóa được, không di chuyển hay đổi cỡ: EmbedPDF 2.15.1 làm mất hình của loại dấu này khi sửa.'
              : isEzImage(obj)
                ? 'Kéo để di chuyển, kéo góc để đổi cỡ (giữ nguyên tỉ lệ). Ảnh luôn nằm thẳng theo trang.'
                : 'Dấu này có sẵn trong tệp. Kéo để di chuyển, kéo góc để đổi cỡ.'}
          </p>
        </>
      )}
      {obj.type === PdfAnnotationSubtype.FREETEXT && <FreeTextProps obj={obj as PdfFreeTextAnnoObject} update={update} />}
      {obj.type === PdfAnnotationSubtype.HIGHLIGHT && (
        <>
          <Field label="Màu">
            <SwatchRow
              colors={HIGHLIGHT_COLORS}
              value={(obj as { strokeColor?: string; color?: string }).strokeColor ?? (obj as { color?: string }).color}
              onChange={(c) => update({ strokeColor: c, color: c } as Partial<PdfAnnotationObject>)}
              testPrefix="hl-color"
            />
          </Field>
          <ContentsField key={obj.id} label="Lời nhắn kèm" value={obj.contents ?? ''} onCommit={(v) => update({ contents: v })} />
        </>
      )}
      {obj.type === PdfAnnotationSubtype.TEXT && (
        <>
          <ContentsField key={obj.id} label="Nội dung ghi chú" value={obj.contents ?? ''} onCommit={(v) => update({ contents: v })} autoFocus={!obj.contents} />
          <Field label="Màu">
            <SwatchRow
              colors={NOTE_COLORS}
              value={(obj as { strokeColor?: string; color?: string }).strokeColor ?? (obj as { color?: string }).color}
              onChange={(c) => update({ strokeColor: c, color: c } as Partial<PdfAnnotationObject>)}
              testPrefix="note-color"
            />
          </Field>
        </>
      )}
      <DeleteButton onClick={remove} />
    </Panel>
  );
}

function FreeTextProps({ obj, update }: { obj: PdfFreeTextAnnoObject; update: (p: Partial<PdfAnnotationObject>) => void }) {
  const { metrics } = useTextFont();
  const setSize = (size: number) => {
    const fontSize = Math.min(96, Math.max(6, Math.round(size)));
    if (fontSize === obj.fontSize) return;
    update({ fontSize, ...(metrics ? growToFit(metrics, obj, { fontSize }) : {}) } as Partial<PdfAnnotationObject>);
  };
  const [sizeText, setSizeText] = useState(String(obj.fontSize));
  useEffect(() => setSizeText(String(obj.fontSize)), [obj.fontSize]);
  return (
    <>
      <Field label="Cỡ chữ">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Giảm cỡ chữ" data-testid="ft-size-down" onClick={() => setSize(obj.fontSize - 1)}>
            <Minus />
          </Button>
          <input
            aria-label="Cỡ chữ (pt)"
            data-testid="ft-size"
            inputMode="numeric"
            value={sizeText}
            onChange={(e) => setSizeText(e.target.value.replace(/[^\d]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && setSize(parseInt(sizeText, 10) || obj.fontSize)}
            onBlur={() => setSize(parseInt(sizeText, 10) || obj.fontSize)}
            className="h-8 w-14 rounded-md border bg-white text-center tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button variant="outline" size="icon-sm" aria-label="Tăng cỡ chữ" data-testid="ft-size-up" onClick={() => setSize(obj.fontSize + 1)}>
            <Plus />
          </Button>
          <span className="ml-1 text-xs text-muted-foreground">pt</span>
        </div>
      </Field>
      <Field label="Màu chữ">
        <SwatchRow colors={TEXT_COLORS} value={obj.fontColor} onChange={(c) => update({ fontColor: c } as Partial<PdfAnnotationObject>)} testPrefix="ft-color" />
      </Field>
      <Field label="Căn lề">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={String(obj.textAlign)}
          onValueChange={(v) => v && update({ textAlign: Number(v) as PdfTextAlignment } as Partial<PdfAnnotationObject>)}
        >
          <ToggleGroupItem value={String(PdfTextAlignment.Left)} aria-label="Căn trái" data-testid="ft-align-left">
            <AlignLeft />
          </ToggleGroupItem>
          <ToggleGroupItem value={String(PdfTextAlignment.Center)} aria-label="Căn giữa" data-testid="ft-align-center">
            <AlignCenter />
          </ToggleGroupItem>
          <ToggleGroupItem value={String(PdfTextAlignment.Right)} aria-label="Căn phải" data-testid="ft-align-right">
            <AlignRight />
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>
      <Field label="Nền">
        <SwatchRow
          colors={BACKGROUND_COLORS}
          value={obj.color ?? obj.backgroundColor ?? 'transparent'}
          onChange={(c) => update({ color: c, backgroundColor: c } as Partial<PdfAnnotationObject>)}
          testPrefix="ft-bg"
        />
      </Field>
      <p className="text-xs leading-relaxed text-muted-foreground">Bấm đúp vào ô để sửa chữ. Ô tự cao thêm khi chữ dài ra.</p>
    </>
  );
}

function DocumentInfo({ documentId, fileName, session }: { documentId: string; fileName: string; session: DocumentSession }) {
  const { state } = useScroll(documentId);
  const pageCount = useDocumentState(documentId)?.document?.pageCount ?? state.totalPages;
  const d = session.draftStatus;
  const draftText =
    d.kind === 'saved'
      ? `Đã lưu ${formatWhen(d.at)}`
      : d.kind === 'pending' || d.kind === 'saving'
        ? 'Đang lưu…'
        : d.kind === 'error'
          ? `Lỗi: ${d.message}`
          : 'Chưa có thay đổi';
  const exportText =
    session.exportStatus.kind === 'done' ? 'Đã xuất bản mới nhất' : session.dirty ? 'Có thay đổi chưa xuất' : 'Không có thay đổi';
  return (
    <Panel title="Tài liệu">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-muted-foreground">Tệp gốc</dt>
        <dd className="truncate" title={fileName}>
          {fileName}
        </dd>
        <dt className="text-muted-foreground">Số trang</dt>
        <dd data-testid="info-pages">{pageCount}</dd>
        <dt className="text-muted-foreground">Đang xem</dt>
        <dd>Trang {state.currentPage}</dd>
        <dt className="text-muted-foreground">Bản nháp</dt>
        <dd data-testid="info-draft" className={d.kind === 'error' ? 'text-destructive' : undefined}>
          {draftText}
        </dd>
        <dt className="text-muted-foreground">Xuất</dt>
        <dd>{exportText}</dd>
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Tệp gốc không bao giờ bị ghi đè. Mọi thay đổi tự lưu thành bản nháp trên máy này; “Xuất PDF” tạo một tệp mới.
      </p>
      <div>
        <h3 className="mb-2 text-[13px] font-bold">Phím tắt</h3>
        <ul className="space-y-1.5 text-[13px]">
          {SHORTCUTS.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{v}</span>
              <Kbd>{k}</Kbd>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto" data-testid="properties">
      <div className="flex h-12 shrink-0 items-baseline justify-between border-b px-4 pt-3.5">
        <h2 className="text-[14px] font-bold" data-testid="properties-title">
          {title}
        </h2>
        {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
      </div>
      <div className="space-y-5 px-4 py-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-[13px] font-normal text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SwatchRow(props: {
  colors: { name: string; value: string }[];
  value: string | undefined;
  onChange: (c: string) => void;
  testPrefix: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {props.colors.map((c, i) => (
        <Swatch
          key={c.value}
          color={c.value}
          name={c.name}
          selected={(props.value ?? '').toLowerCase() === c.value.toLowerCase()}
          onClick={() => props.onChange(c.value)}
          testId={`${props.testPrefix}-${i}`}
        />
      ))}
    </div>
  );
}

function ContentsField(props: { label: string; value: string; onCommit: (v: string) => void; autoFocus?: boolean }) {
  const [text, setText] = useState(props.value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(props.value), [props.value]);
  // A just-placed note wants its text; focus after the page has finished handling the click.
  useEffect(() => {
    if (!props.autoFocus) return;
    const t = setTimeout(() => ref.current?.focus(), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const commit = () => {
    const v = text.normalize('NFC');
    if (v !== props.value) props.onCommit(v);
  };
  return (
    <Field label={props.label}>
      <Textarea
        ref={ref}
        data-testid="contents-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            commit();
          }
        }}
        placeholder="Viết nội dung…"
        className="min-h-24 bg-white text-[13px]"
      />
      <p className="text-xs text-muted-foreground">Lưu khi rời ô hoặc Ctrl Enter.</p>
    </Field>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="outline" size="sm" className="w-full text-destructive hover:text-destructive" onClick={onClick} data-testid="btn-delete">
      <Trash2 /> Xóa
    </Button>
  );
}
