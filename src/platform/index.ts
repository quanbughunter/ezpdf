/**
 * Picks the platform adapter once at start-up. The desktop and Android
 * adapters are separate chunks, loaded only inside their shells.
 */
import { createContext, useContext } from 'react';
import { createWebPlatform } from './web';
import type { Platform, PlatformKind } from './types';

export type { Platform, PlatformKind, SaveResult } from './types';

export function detectPlatform(): PlatformKind {
  if (typeof window === 'undefined') return 'web';
  if ('__TAURI_INTERNALS__' in window) return 'desktop';
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  if (cap?.isNativePlatform?.() && cap.getPlatform?.() === 'android') return 'android';
  return 'web';
}

let loading: Promise<Platform> | null = null;

export function loadPlatform(): Promise<Platform> {
  loading ??= (async () => {
    switch (detectPlatform()) {
      case 'desktop':
        return (await import('./tauri')).createTauriPlatform();
      case 'android':
        return (await import('./android')).createAndroidPlatform();
      default:
        return createWebPlatform();
    }
  })();
  return loading;
}

/** Storage of the current platform, for modules outside React. */
export async function storage() {
  return (await loadPlatform()).storage;
}

export const PlatformContext = createContext<Platform | null>(null);

export function usePlatform(): Platform {
  const p = useContext(PlatformContext);
  if (!p) throw new Error('usePlatform outside PlatformContext');
  return p;
}
