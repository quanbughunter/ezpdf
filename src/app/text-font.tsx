import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { readFontMetrics, type FontMetrics } from '@/engine/font-metrics';
import { VN_FONT_URL } from '@/engine/config';

/** CSS family of the font that is embedded on export (see styles.css @font-face). */
export const TEXT_FONT_FAMILY = "'ezPDF Sans VN'";

type FontState = { metrics: FontMetrics | null; error: string | null };
const FontContext = createContext<FontState>({ metrics: null, error: null });

/**
 * Loads the export font once on the main thread: its metrics drive FreeText
 * layout on screen, and the webfont must be ready before any line is drawn.
 */
export function TextFontProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FontState>({ metrics: null, error: null });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(VN_FONT_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const metrics = readFontMetrics(new Uint8Array(await res.arrayBuffer()));
        await document.fonts.load(`16px ${TEXT_FONT_FAMILY}`, 'Tiếng Việt');
        if (alive) setState({ metrics, error: null });
      } catch (e) {
        if (alive) setState({ metrics: null, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return <FontContext.Provider value={state}>{children}</FontContext.Provider>;
}

export const useTextFont = () => useContext(FontContext);
