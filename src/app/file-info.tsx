/**
 * What the information panels (PDF and Word) say about the opened file: its
 * full name and where it is, each with a copy button, its size and when it
 * last changed, then the document's own properties. Where the platform can
 * show the file's folder (Android: the system's file picker opened there),
 * the path is a link to it; another file picked there is opened.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { usePlatform } from '@/platform';
import type { FileSource, PlatformKind } from '@/platform/types';

export interface FileFactsInfo {
  name: string;
  size?: number;
  modified?: number;
  source?: FileSource;
}

/** `text` on the clipboard; older WebViews without the Clipboard API use a selected text area */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // refused (no permission, not a secure page): the old way below
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({ text, label, testId }: { text: string; label: string; testId: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={async () => {
        const ok = await copyText(text);
        setState(ok ? 'done' : 'failed');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), 1800);
      }}
      className="-my-1 inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-3.5"
    >
      {state === 'done' ? <Check className="text-primary" /> : <Copy />}
      <span aria-live="polite" className={state === 'idle' ? 'sr-only' : 'text-xs'}>
        {state === 'done' ? 'Đã chép' : state === 'failed' ? 'Không chép được' : ''}
      </span>
    </button>
  );
}

export const formatSize = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} byte`;

export const formatDate = (t: number) =>
  new Date(t).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

const NO_PATH: Record<PlatformKind, string> = {
  web: 'Trình duyệt không cho trang web biết tệp nằm ở thư mục nào.',
  android: 'Android không cho biết tệp này nằm ở đâu.',
  desktop: 'Không rõ.',
};

/** one row of a facts list: a label and its value */
export function Fact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]" data-testid={testId}>
        {children}
      </dd>
    </>
  );
}

/** labels in a column of their own width in every list, so the lists of a panel line up */
export function FactList({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">{children}</dl>;
}

/**
 * The file's name, place, size and date. `onOpenFile`: opens a file picked
 * in the folder the path link shows.
 */
export function FileFacts({ info, onOpenFile }: { info: FileFactsInfo; onOpenFile?: (file: File) => void }) {
  const platform = usePlatform();
  const [error, setError] = useState<string | null>(null);
  const src = info.source;
  const where = src?.path ?? src?.from;
  const showFolder = platform.showFolder;
  const live = !!(src?.uri && showFolder && onOpenFile);
  const open = async () => {
    if (!src || !showFolder || !onOpenFile) return;
    setError(null);
    try {
      const f = await showFolder(src);
      if (f) onOpenFile(f);
    } catch (e) {
      setError(`Không mở được thư mục: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return (
    <div className="space-y-1.5" data-testid="info-file">
      <FactList>
        <dt className="text-muted-foreground">Tên tệp</dt>
        <dd className="flex min-w-0 items-start gap-1">
          <span className="min-w-0 flex-1 [overflow-wrap:anywhere]" data-testid="info-name">
            {info.name}
          </span>
          <CopyButton text={info.name} label="Chép tên tệp" testId="info-copy-name" />
        </dd>
        <dt className="text-muted-foreground">{src?.path ? 'Đường dẫn' : 'Vị trí'}</dt>
        <dd className="flex min-w-0 items-start gap-1">
          {where && live ? (
            <button
              type="button"
              onClick={() => void open()}
              title="Mở thư mục chứa tệp"
              data-testid="info-path"
              className="min-w-0 flex-1 text-left text-primary underline decoration-primary/40 underline-offset-2 [overflow-wrap:anywhere] hover:decoration-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {where}
            </button>
          ) : (
            <span className={where ? 'min-w-0 flex-1 [overflow-wrap:anywhere]' : 'min-w-0 flex-1 text-muted-foreground'} data-testid="info-path">
              {where ?? NO_PATH[platform.kind]}
            </span>
          )}
          {src?.path && <CopyButton text={src.path} label="Chép đường dẫn" testId="info-copy-path" />}
        </dd>
        {info.size !== undefined && <Fact label="Dung lượng">{formatSize(info.size)}</Fact>}
        {info.modified !== undefined && <Fact label="Sửa lần cuối">{formatDate(info.modified)}</Fact>}
      </FactList>
      {live && <p className="text-xs text-muted-foreground">Bấm vào {src?.path ? 'đường dẫn' : 'vị trí'} để mở thư mục chứa tệp; chọn một tệp ở đó để mở nó.</p>}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
