import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { EmbedPDF, type PluginBatchRegistrations } from '@embedpdf/core/react';
import { createPluginRegistration } from '@embedpdf/core';
import { usePdfiumEngine } from '@embedpdf/engines/react';
import { DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/react';
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport/react';
import { ScrollPluginPackage, ScrollStrategy } from '@embedpdf/plugin-scroll/react';
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager/react';
import { ZoomMode, ZoomPluginPackage } from '@embedpdf/plugin-zoom/react';
import { RotatePluginPackage } from '@embedpdf/plugin-rotate/react';
import { RenderPluginPackage } from '@embedpdf/plugin-render/react';
import { TilingPluginPackage } from '@embedpdf/plugin-tiling/react';
import { SelectionPluginPackage } from '@embedpdf/plugin-selection/react';
import { HistoryPluginPackage } from '@embedpdf/plugin-history/react';
import { AnnotationPluginPackage } from '@embedpdf/plugin-annotation/react';
import { ExportPluginPackage } from '@embedpdf/plugin-export/react';
import { SearchPluginPackage } from '@embedpdf/plugin-search/react';
import { ThumbnailPluginPackage } from '@embedpdf/plugin-thumbnail/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FONT_FALLBACK, PDFIUM_WASM_URL } from '@/engine/config';
import { EZ_MARK } from '@/engine/vn-freetext-export';
import { FREETEXT_PLACEHOLDER } from './viewer/free-text';
import { TextFontProvider } from './text-font';
import { Workspace } from './Workspace';
import { HIGHLIGHT_COLORS, NOTE_COLORS, TEXT_COLORS } from './palette';
import { STAMP_TOOLS } from './images/stamp-guard';
import { loadPlatform, PlatformContext, type Platform } from '@/platform';

const ez = { [EZ_MARK]: 1 };

export function App() {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [platformError, setPlatformError] = useState<string | null>(null);
  useEffect(() => {
    loadPlatform().then(setPlatform, (e) => setPlatformError(e instanceof Error ? e.message : String(e)));
  }, []);
  const { engine, isLoading, error } = usePdfiumEngine({
    wasmUrl: PDFIUM_WASM_URL,
    worker: true,
    fontFallback: FONT_FALLBACK,
  });

  const plugins: PluginBatchRegistrations = useMemo(
    () => [
      createPluginRegistration(DocumentManagerPluginPackage, {}),
      createPluginRegistration(ViewportPluginPackage, { viewportGap: 16 }),
      createPluginRegistration(ScrollPluginPackage, { defaultStrategy: ScrollStrategy.Vertical }),
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitWidth }),
      createPluginRegistration(RotatePluginPackage),
      createPluginRegistration(RenderPluginPackage),
      createPluginRegistration(TilingPluginPackage, { tileSize: 768, overlapPx: 2.5, extraRings: 0 }),
      createPluginRegistration(SelectionPluginPackage),
      createPluginRegistration(SearchPluginPackage),
      createPluginRegistration(ThumbnailPluginPackage, { width: 136, paddingY: 12, gap: 14, labelHeight: 18, autoScroll: true }),
      createPluginRegistration(HistoryPluginPackage),
      createPluginRegistration(AnnotationPluginPackage, {
        selectAfterCreate: true,
        colorPresets: TEXT_COLORS.map((c) => c.value),
        tools: [
          {
            id: 'freeText',
            defaults: {
              contents: FREETEXT_PLACEHOLDER,
              fontSize: 14,
              fontColor: TEXT_COLORS[0].value,
              custom: ez,
            },
            clickBehavior: {
              enabled: true,
              defaultSize: { width: 180, height: 22 },
              defaultContent: FREETEXT_PLACEHOLDER,
            },
            behavior: { deactivateToolAfterCreate: true },
          },
          { id: 'highlight', defaults: { strokeColor: HIGHLIGHT_COLORS[0].value, opacity: 0.55, custom: ez } },
          {
            id: 'textComment',
            defaults: { strokeColor: NOTE_COLORS[0].value, contents: '', custom: ez },
            behavior: { deactivateToolAfterCreate: true, selectAfterCreate: true },
          },
          // G10: rotating a stamp crops its picture, so stamps never rotate.
          { id: 'stamp', interaction: { isRotatable: false } } as never,
          ...STAMP_TOOLS,
        ],
      }),
      createPluginRegistration(ExportPluginPackage),
    ],
    [],
  );

  if (error) {
    return (
      <FullScreenMessage tone="error" title="Không khởi động được bộ xử lý PDF">
        {error.message}. Tải lại trang để thử lại.
      </FullScreenMessage>
    );
  }
  if (platformError) {
    return (
      <FullScreenMessage tone="error" title="Không khởi động được ezPDF">
        {platformError}
      </FullScreenMessage>
    );
  }
  if (isLoading || !engine || !platform) return <FullScreenMessage tone="loading" title="Đang khởi động bộ xử lý PDF…" />;
  return (
    <PlatformContext.Provider value={platform}>
      <TooltipProvider delayDuration={350}>
        <TextFontProvider>
          <EmbedPDF engine={engine} plugins={plugins}>
            {({ pluginsReady, activeDocumentId }) =>
              pluginsReady ? <Workspace documentId={activeDocumentId} /> : <FullScreenMessage tone="loading" title="Đang chuẩn bị…" />
            }
          </EmbedPDF>
        </TextFontProvider>
      </TooltipProvider>
    </PlatformContext.Provider>
  );
}

export function FullScreenMessage({ tone, title, children }: { tone: 'loading' | 'error'; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-6" data-testid={`state-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        {tone === 'loading' ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <AlertTriangle className="size-5 text-destructive" aria-hidden />
        )}
        <p className="font-bold">{title}</p>
        {children && <p className="text-sm text-muted-foreground">{children}</p>}
      </div>
    </div>
  );
}
