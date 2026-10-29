import { Viewport } from '@embedpdf/plugin-viewport/react';
import { Scroller } from '@embedpdf/plugin-scroll/react';
import { GlobalPointerProvider, PagePointerProvider } from '@embedpdf/plugin-interaction-manager/react';
import { Rotate } from '@embedpdf/plugin-rotate/react';
import { RenderLayer } from '@embedpdf/plugin-render/react';
import { TilingLayer } from '@embedpdf/plugin-tiling/react';
import { SelectionLayer } from '@embedpdf/plugin-selection/react';
import { SearchLayer } from '@embedpdf/plugin-search/react';
import { AnnotationLayer } from '@embedpdf/plugin-annotation/react';
import { ZoomGestureWrapper } from '@embedpdf/plugin-zoom/react';
import { useCallback, useRef, useState } from 'react';
import { useTouchGuard } from './touch-guard';
import { EndEditingContext, ezFreeTextRenderer } from './free-text';
import { PlacementLayer } from '../images/placement';
import { TextEditLayer } from '../text-edit';

const ACCENT = '#0b6e69';
const renderers = [ezFreeTextRenderer];

/**
 * Pages are virtualised by the scroll plugin; each visible page gets a
 * low-res base render plus tiles at the current zoom. Annotations live in
 * page space (PDF points, unrotated); the Rotate wrapper turns the view.
 */
export function Viewer({ documentId }: { documentId: string }) {
  const [epochs, setEpochs] = useState<Record<number, number>>({});
  const endEditing = useCallback((pageIndex: number) => setEpochs((e) => ({ ...e, [pageIndex]: (e[pageIndex] ?? 0) + 1 })), []);
  const rootRef = useRef<HTMLDivElement>(null);
  useTouchGuard(rootRef, documentId);
  return (
    <EndEditingContext.Provider value={endEditing}>
      {/* pan-x pan-y: one finger scrolls, two fingers reach ZoomGestureWrapper (pinch to
          zoom the document) instead of zooming the whole app */}
      <div ref={rootRef} className="absolute inset-0 touch-pan-x touch-pan-y" data-testid="viewer">
        <GlobalPointerProvider documentId={documentId}>
          <Viewport documentId={documentId} className="h-full w-full bg-canvas">
            <ZoomGestureWrapper documentId={documentId}>
              <Scroller
                documentId={documentId}
                renderPage={({ pageIndex }) => (
                  <Rotate documentId={documentId} pageIndex={pageIndex} style={{ backgroundColor: '#fff' }}>
                    <div
                      data-testid={`page-${pageIndex}`}
                      className="shadow-[0_1px_2px_rgba(0,0,0,0.10),0_2px_8px_rgba(0,0,0,0.06)]"
                      style={{ position: 'absolute', inset: 0 }}
                    />
                    <PagePointerProvider documentId={documentId} pageIndex={pageIndex}>
                      <RenderLayer documentId={documentId} pageIndex={pageIndex} scale={1} style={{ pointerEvents: 'none' }} />
                      <TilingLayer documentId={documentId} pageIndex={pageIndex} style={{ pointerEvents: 'none' }} />
                      <SearchLayer
                        documentId={documentId}
                        pageIndex={pageIndex}
                        highlightColor="rgba(255, 212, 59, 0.45)"
                        activeHighlightColor="rgba(11, 110, 105, 0.35)"
                      />
                      <SelectionLayer documentId={documentId} pageIndex={pageIndex} />
                      <AnnotationLayer
                        key={epochs[pageIndex] ?? 0}
                        documentId={documentId}
                        pageIndex={pageIndex}
                        annotationRenderers={renderers}
                        selectionOutline={{ color: ACCENT, width: 1.5, offset: 1 }}
                        resizeUI={{ color: ACCENT, size: 10 }}
                        rotationUI={{ connectorColor: ACCENT, iconColor: ACCENT, border: { color: ACCENT } }}
                      />
                    </PagePointerProvider>
                    <PlacementLayer documentId={documentId} pageIndex={pageIndex} />
                    <TextEditLayer documentId={documentId} pageIndex={pageIndex} />
                  </Rotate>
                )}
              />
            </ZoomGestureWrapper>
          </Viewport>
        </GlobalPointerProvider>
      </div>
    </EndEditingContext.Provider>
  );
}
