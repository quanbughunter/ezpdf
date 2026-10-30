import type { StorageBackend } from './storage/backend';

export type PlatformKind = 'web' | 'desktop' | 'android';

export type SaveResult =
  /** handed to the browser as a download */
  | { how: 'download'; name: string }
  /** written to a file the user picked in the system dialog */
  | { how: 'file'; name: string; folder?: string };

/**
 * Ways to hand a finished PDF to someone else, in the order the share button
 * offers them (the first is the main one).
 */
export type ShareWay =
  /** the system share sheet: Zalo, Telegram, Gmail, Bluetooth… (Android, Windows, phone browsers) */
  | 'sheet'
  /** the file on the clipboard, to paste with Ctrl V into a chat or an e-mail (Windows) */
  | 'copy'
  /** the file shown in its folder, to drag into a browser tab or an app (desktop) */
  | 'reveal'
  /** a browser without file sharing: the file is downloaded to send by hand */
  | 'download';

export type ShareOutcome = 'done' | 'cancelled' | 'copied' | 'downloaded';

/**
 * What differs between the browser, the desktop app and the Android app.
 * Everything else (engine, UI, tools) is the same code on all three.
 */
export interface Platform {
  readonly kind: PlatformKind;
  readonly storage: StorageBackend;
  /** the system's open dialog for PDFs; null means the page's own file input is used */
  readonly pickPdf: (() => Promise<File | null>) | null;
  /** the system's open dialog for a PDF or a Word (.docx) file: the Open button */
  readonly pickFile: (() => Promise<File | null>) | null;
  /** write an exported PDF; null when the user cancelled the save dialog */
  savePdf(bytes: Uint8Array, suggestedName: string): Promise<SaveResult | null>;
  /** write a Word file saved from the Word screen; null when the user cancelled */
  saveWord(bytes: Uint8Array, suggestedName: string): Promise<SaveResult | null>;
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
   * A check before the desktop window closes, run before the callbacks
   * above: resolving false keeps the window open (unsaved changes on the
   * Word screen, the user chose to stay).
   */
  guardClose?(check: () => Promise<boolean>): () => void;
  /**
   * Photos the camera app wrote for a scan (Android: the camera saves into
   * the app's own folder and the copy would otherwise stay there). Called
   * when a scan ends and when the app starts.
   */
  clearCapturedPhotos?(): Promise<void>;
  /** true when a page's file input can open the camera itself (phones) */
  readonly canCapture: boolean;
  /** how this platform can share a PDF; empty: no share button */
  readonly shareWays: readonly ShareWay[];
  /**
   * Hand `bytes` to another app as a file called `name` (a PDF, or a Word
   * file when the name ends in .docx). Only after the user asked for it:
   * ezPDF never sends a document anywhere by itself.
   */
  sharePdf(bytes: Uint8Array, name: string, way: ShareWay): Promise<ShareOutcome>;
  /**
   * The system's own printing of a PDF file (Android's print service, vector).
   * null: the page renders the pages and opens the print dialog itself
   * (browser, desktop app).
   */
  readonly printPdf: ((bytes: Uint8Array, name: string, pages: number) => Promise<void>) | null;
  /** said when printing starts, when printPdf needs a word of guidance (iPhone: "choose Print") */
  readonly printHint?: string;
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

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** the type of a file by its name: Word for .docx, PDF otherwise */
export const mimeOf = (name: string) => (/\.docx$/i.test(name) ? DOCX_MIME : 'application/pdf');

export const asDocFile = (data: BlobPart, name: string) => new File([data], name, { type: mimeOf(name) });
