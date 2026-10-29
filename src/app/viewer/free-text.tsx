import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PdfAnnotationSubtype, type PdfAnnotationObject, type PdfFreeTextAnnoObject } from '@embedpdf/models';
import {
  createRenderer,
  useAnnotationCapability,
  type AnnotationRendererProps,
} from '@embedpdf/plugin-annotation/react';
import { layoutFreeText, normalizeFreeText, FREETEXT_LINE_HEIGHT } from '@/engine/text-layout';
import type { FontMetrics } from '@/engine/font-metrics';
import { resizeKeepingTop } from '@/engine/geometry';
import { EZ_MARK } from '@/engine/vn-freetext-export';
import { TEXT_FONT_FAMILY, useTextFont } from '../text-font';

/** Default contents of a new text box (selected on first edit so typing replaces it). */
export const FREETEXT_PLACEHOLDER = 'Nhập chữ';

const textAlignCss = ['left', 'center', 'right'] as const;

/**
 * EmbedPDF keeps "which annotation is being edited" as private state of the
 * page's annotation layer and only clears it on the next click on the page,
 * which that click is then spent on. When the user finishes with Esc or
 * Ctrl+Enter, the viewer remounts that page's layer instead (selection and
 * cached appearances live in the plugin, so nothing is lost).
 */
export const EndEditingContext = createContext<(pageIndex: number) => void>(() => {});
const fill = (c?: string) => (c && c !== 'transparent' ? c : 'transparent');

/**
 * FreeText on screen, drawn with the exporter's own layout (text-layout.ts):
 * the same lines, x positions and baselines as the exported appearance, at
 * every zoom. While editing, a textarea takes over; committing writes the
 * text, grows the box so nothing is clipped, and marks the annotation as
 * ezPDF's so the exporter re-draws it with the embedded Vietnamese font.
 */
function EzFreeText({
  annotation,
  currentObject: obj,
  isSelected,
  isEditing,
  scale,
  pageIndex,
  documentId,
  onClick,
  appearanceActive,
}: AnnotationRendererProps<PdfFreeTextAnnoObject>) {
  const { metrics } = useTextFont();
  const { provides } = useAnnotationCapability();
  const [active, setActive] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const committing = useRef(false);
  const finishByKey = useRef(false);
  const endEditing = useContext(EndEditingContext);

  useEffect(() => setActive(isEditing), [isEditing]);

  const width = obj.rect.size.width;
  const height = obj.rect.size.height;
  const border = obj.strokeWidth ?? 0;
  const layout = useMemo(
    () =>
      metrics
        ? layoutFreeText(metrics, {
            text: obj.contents ?? '',
            fontSize: obj.fontSize,
            align: obj.textAlign,
            valign: obj.verticalAlign,
            width,
            height,
            borderWidth: border,
          })
        : null,
    [metrics, obj.contents, obj.fontSize, obj.textAlign, obj.verticalAlign, width, height, border],
  );

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!active || !el) return;
    el.focus({ preventScroll: true });
    if (el.value === FREETEXT_PLACEHOLDER) el.select();
    else el.setSelectionRange(el.value.length, el.value.length);
    fitEditor(el);
  }, [active]);

  const commit = () => {
    const el = editorRef.current;
    if (!el || committing.current) return;
    committing.current = true;
    setActive(false);
    queueMicrotask(() => (committing.current = false));
    const byKey = finishByKey.current;
    finishByKey.current = false;
    if (byKey) queueMicrotask(() => endEditing(pageIndex));
    if (!metrics || !provides) return;
    const text = normalizeFreeText(el.value);
    const tracked = annotation.object;
    const patch: Partial<PdfFreeTextAnnoObject> = { ...growToFit(metrics, tracked, { contents: text }) };
    if (text !== (tracked.contents ?? '')) patch.contents = text;
    if (Object.keys(patch).length === 0) return;
    patch.custom = { ...(tracked.custom ?? {}), [EZ_MARK]: 1 };
    provides.forDocument(documentId).updateAnnotation(pageIndex, tracked.id, patch as Partial<PdfAnnotationObject>);
  };

  const fontPx = obj.fontSize * scale;
  const boxStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: fill(obj.color ?? obj.backgroundColor),
    opacity: appearanceActive ? 0 : obj.opacity,
    boxSizing: 'border-box',
    border: border ? `${border * scale}px solid ${obj.fontColor}` : undefined,
  };

  if (active) {
    return (
      <textarea
        ref={editorRef}
        data-testid="freetext-editor"
        defaultValue={obj.contents ?? ''}
        spellCheck={false}
        onBlur={commit}
        onInput={(e) => fitEditor(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
            e.preventDefault();
            e.stopPropagation();
            finishByKey.current = true;
            e.currentTarget.blur();
          }
        }}
        style={{
          ...boxStyle,
          opacity: obj.opacity,
          zIndex: 3,
          width: '100%',
          minHeight: '100%',
          margin: 0,
          padding: border * scale,
          color: obj.fontColor,
          fontFamily: TEXT_FONT_FAMILY,
          fontSize: fontPx,
          lineHeight: FREETEXT_LINE_HEIGHT,
          textAlign: textAlignCss[obj.textAlign] ?? 'left',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          overflow: 'hidden',
          resize: 'none',
          outline: '1px dashed var(--color-primary)',
          outlineOffset: 0,
          pointerEvents: 'auto',
        }}
      />
    );
  }

  return (
    <div
      data-testid="freetext"
      data-annotation-id={obj.id}
      onPointerDown={onClick}
      onDoubleClick={() => isEditing && setActive(true)}
      style={{
        ...boxStyle,
        overflow: 'hidden',
        zIndex: 2,
        cursor: isSelected && !isEditing ? 'move' : 'default',
        pointerEvents: !onClick ? 'none' : isSelected && !isEditing ? 'none' : 'auto',
      }}
    >
      {layout && <FreeTextLines obj={obj} layout={layout} scale={scale} />}
    </div>
  );
}

/** The laid-out lines of a FreeText, absolutely positioned in its box (screen and thumbnails). */
export function FreeTextLines({
  obj,
  layout,
  scale,
}: {
  obj: PdfFreeTextAnnoObject;
  layout: ReturnType<typeof layoutFreeText>;
  scale: number;
}) {
  const fontPx = obj.fontSize * scale;
  return (
    <>
      {layout.lines.map((line, i) =>
        line.text ? (
          <span
            key={i}
            data-ez-line={i}
            style={{
              position: 'absolute',
              left: line.x * scale,
              top: (line.baselineFromTop - layout.ascent) * scale,
              fontFamily: TEXT_FONT_FAMILY,
              fontSize: fontPx,
              lineHeight: `${layout.contentArea * scale}px`,
              whiteSpace: 'pre',
              color: obj.fontColor,
              userSelect: 'none',
            }}
          >
            {line.text}
          </span>
        ) : null,
      )}
    </>
  );
}

/**
 * Patch that grows a FreeText box (never shrinks it) so `next` text or size
 * fits without clipping. Keeps the box's visual top edge in place, also when
 * the box is rotated. Returns {} when nothing has to change.
 */
export function growToFit(
  metrics: FontMetrics,
  tracked: PdfFreeTextAnnoObject,
  next: Partial<Pick<PdfFreeTextAnnoObject, 'contents' | 'fontSize' | 'textAlign' | 'strokeWidth'>>,
): Partial<PdfFreeTextAnnoObject> {
  const local = tracked.unrotatedRect ?? tracked.rect;
  const rotation = tracked.rotation ?? 0;
  if (rotation && !tracked.unrotatedRect) return {};
  const need = layoutFreeText(metrics, {
    text: next.contents ?? tracked.contents ?? '',
    fontSize: next.fontSize ?? tracked.fontSize,
    align: next.textAlign ?? tracked.textAlign,
    valign: tracked.verticalAlign,
    width: local.size.width,
    height: local.size.height,
    borderWidth: next.strokeWidth ?? tracked.strokeWidth ?? 0,
  }).contentHeight;
  if (need <= local.size.height + 0.25) return {};
  const grown = resizeKeepingTop(local, rotation, Math.ceil(need * 4) / 4);
  return tracked.unrotatedRect ? { rect: grown.rect, unrotatedRect: grown.local } : { rect: grown.rect };
}

/** Let the editor grow with its content so nothing is hidden while typing. */
function fitEditor(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${Math.max(el.scrollHeight, el.parentElement?.clientHeight ?? 0)}px`;
}

/**
 * ezPDF's own FreeText always shows through the renderer above, never as the
 * stored appearance image: a draft holds PDFium's appearance, which lacks
 * Vietnamese marks until export (G1). The tool is the plugin's freeText tool
 * (same interaction and transform) with appearance streams off, matched only
 * for annotations marked as ezPDF's. Text boxes from other software keep their
 * own appearance until they are edited here.
 */
export function useEzFreeTextTool() {
  const { provides } = useAnnotationCapability();
  useEffect(() => {
    if (!provides || provides.getTools().some((t) => t.id === 'ezFreeText')) return;
    const base = provides.getTools().find((t) => t.id === 'freeText');
    if (!base) return;
    provides.addTool({
      ...base,
      id: 'ezFreeText',
      matchScore: (a: PdfAnnotationObject) =>
        a.type === PdfAnnotationSubtype.FREETEXT &&
        (a as PdfFreeTextAnnoObject).intent !== 'FreeTextCallout' &&
        (a.custom as Record<string, unknown> | undefined)?.[EZ_MARK]
          ? 5
          : 0,
      behavior: { ...base.behavior, useAppearanceStream: false },
    } as typeof base);
  }, [provides]);
}

export const ezFreeTextRenderer = createRenderer<PdfFreeTextAnnoObject, { rect: unknown; calloutLine?: unknown }>({
  id: 'freeText',
  matches: (a): a is PdfFreeTextAnnoObject =>
    a.type === PdfAnnotationSubtype.FREETEXT && a.intent !== 'FreeTextCallout',
  matchesPreview: (p) => p.type === PdfAnnotationSubtype.FREETEXT && !(p.data as { calloutLine?: unknown }).calloutLine,
  render: (props) => <EzFreeText {...props} />,
  renderPreview: () => (
    <div
      style={{ width: '100%', height: '100%', border: '1px dashed var(--color-primary)', background: 'transparent' }}
    />
  ),
  interactionDefaults: { isDraggable: true, isResizable: true, isRotatable: true },
  isDraggable: (toolDraggable, { isEditing }) => toolDraggable && !isEditing,
  onDoubleClick: (id, setEditingId) => setEditingId(id),
});
