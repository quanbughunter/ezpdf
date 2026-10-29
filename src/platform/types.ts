import type { StorageBackend } from './storage/backend';

export type PlatformKind = 'web' | 'desktop' | 'android';

export type SaveResult =
  /** handed to the browser as a download */
  | { how: 'download'; name: string }
  /** written to a file the user picked in the system dialog */
  | { how: 'file'; name: string; folder?: string };

/**
 * What differs between the browser, the desktop app and the Android app.
 * Everything else (engine, UI, tools) is the same code on all three.
 */
export interface Platform {
  readonly kind: PlatformKind;
  readonly storage: StorageBackend;
  /** the system's open dialog; null means the page's own file input is used */
  readonly pickPdf: (() => Promise<File | null>) | null;
  /** write an exported PDF; null when the user cancelled the save dialog */
  savePdf(bytes: Uint8Array, suggestedName: string): Promise<SaveResult | null>;
  /**
   * Files handed to ezPDF from outside: "Open with", a file given on the
   * command line, the Android share sheet, an installed web app's file
   * handler. Files that arrive before anyone listens are kept until then.
   */
  onIncomingFiles(cb: (files: File[]) => void): () => void;
  /**
   * The app window is about to close (desktop). The callback runs to the
   * end before the window goes, so pending draft changes can be saved.
   * The browser has beforeunload and Android pauses the page instead.
   */
  onCloseRequested?(cb: () => Promise<void>): () => void;
  /**
   * Photos the camera app wrote for a scan (Android: the camera saves into
   * the app's own folder and the copy would otherwise stay there). Called
   * when a scan ends and when the app starts.
   */
  clearCapturedPhotos?(): Promise<void>;
  /** true when a page's file input can open the camera itself (phones) */
  readonly canCapture: boolean;
}

/** Keeps incoming files until a listener is attached. */
export function incomingQueue() {
  let listener: ((files: File[]) => void) | null = null;
  const waiting: File[][] = [];
  return {
    push(files: File[]) {
      if (!files.length) return;
      if (listener) listener(files);
      else waiting.push(files);
    },
    subscribe(cb: (files: File[]) => void) {
      listener = cb;
      while (waiting.length && listener === cb) cb(waiting.shift()!);
      return () => {
        if (listener === cb) listener = null;
      };
    },
  };
}

export const baseName = (path: string) => path.split(/[\\/]/).pop() || path;

export const dirName = (path: string) => {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i > 0 ? path.slice(0, i) : undefined;
};

export const asPdfFile = (data: BlobPart, name: string) => new File([data], name, { type: 'application/pdf' });
