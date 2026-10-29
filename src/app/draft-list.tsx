import { useEffect, useState } from 'react';
import { FileClock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deleteDraft, listDrafts, type DraftRecord } from './storage/drafts';
import { usePlatform } from '@/platform';

export function formatWhen(t: number) {
  const d = new Date(t);
  const now = new Date();
  const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `lúc ${time} hôm nay`;
  return `lúc ${time} ngày ${d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}

const mb = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

/** Drafts kept on this device, newest first: reopen or delete. */
export function DraftList({ onOpen }: { onOpen: (r: DraftRecord) => void }) {
  const { storage } = usePlatform();
  const [drafts, setDrafts] = useState<DraftRecord[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    listDrafts().then(setDrafts, (e) => {
      setDrafts([]);
      setError(e instanceof Error ? e.message : String(e));
    });
  useEffect(() => {
    void load();
  }, []);

  if (!drafts || (!drafts.length && !error)) return null;
  return (
    <section className="rounded-lg border bg-background" data-testid="draft-list">
      <header className="flex items-baseline justify-between border-b px-4 py-3">
        <h2 className="text-[14px] font-bold">Bản nháp trên máy này</h2>
        <span className="text-xs text-muted-foreground">Tự lưu khi bạn sửa</span>
      </header>
      {error && <p className="px-4 py-3 text-[13px] text-destructive">{error}</p>}
      <ul className="divide-y">
        {drafts.map((d, i) => (
          <li key={d.id} className="flex items-center gap-3 px-4 py-3" data-testid={`draft-${i}`}>
            <FileClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px]" title={d.name}>
                {d.name}
              </p>
              <p className="text-xs text-muted-foreground">
                Sửa {formatWhen(d.updatedAt)} · {d.pages} trang · {mb(d.draftSize)} ·{' '}
                <span className={d.exported ? 'text-success' : 'text-warning'}>{d.exported ? 'đã xuất' : 'chưa xuất'}</span>
              </p>
            </div>
            {confirm === d.id ? (
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  data-testid={`draft-delete-confirm-${i}`}
                  onClick={async () => {
                    await deleteDraft(d.id).catch((e) => setError(e instanceof Error ? e.message : String(e)));
                    setConfirm(null);
                    void load();
                  }}
                >
                  Xóa hẳn
                </Button>
                <Button size="xs" variant="ghost" data-testid={`draft-delete-cancel-${i}`} onClick={() => setConfirm(null)}>
                  Giữ
                </Button>
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-1">
                <Button size="xs" variant="outline" data-testid={`draft-open-${i}`} onClick={() => onOpen(d)}>
                  Mở
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Xóa bản nháp ${d.name}`}
                  data-testid={`draft-delete-${i}`}
                  onClick={() => setConfirm(d.id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="border-t px-4 py-2.5 text-xs leading-relaxed text-muted-foreground" title={storage.folder} data-testid="draft-where">
        Bản nháp gồm tệp gốc và các thay đổi, chỉ nằm trong {storage.where}. Muốn có tệp PDF, hãy mở bản nháp rồi bấm “Xuất PDF”.
      </p>
    </section>
  );
}
