import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { MatchFlag, type SearchResult } from '@embedpdf/models';
import { ThumbnailsPane, ThumbImg } from '@embedpdf/plugin-thumbnail/react';
import { useScroll, useScrollCapability } from '@embedpdf/plugin-scroll/react';
import { useSearch } from '@embedpdf/plugin-search/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import { IconAction } from './controls';
import { ThumbOverlay } from './thumb-overlay';

export type LeftTab = 'pages' | 'search';

export function LeftPanel(props: {
  documentId: string;
  tab: LeftTab;
  onTab: (t: LeftTab) => void;
  searchFocusKey: number;
  onNavigate?: () => void;
}) {
  return (
    <Tabs value={props.tab} onValueChange={(v) => props.onTab(v as LeftTab)} className="flex h-full flex-col gap-0">
      <div className="border-b px-2 py-2">
        <TabsList className="grid h-8 w-full grid-cols-2">
          <TabsTrigger value="pages" data-testid="tab-pages" className="text-[13px]">
            Trang
          </TabsTrigger>
          <TabsTrigger value="search" data-testid="tab-search" className="text-[13px]">
            Tìm kiếm
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="pages" className="min-h-0 flex-1">
        <Thumbnails documentId={props.documentId} onNavigate={props.onNavigate} />
      </TabsContent>
      <TabsContent value="search" className="min-h-0 flex-1">
        <SearchPanel documentId={props.documentId} focusKey={props.searchFocusKey} onNavigate={props.onNavigate} />
      </TabsContent>
    </Tabs>
  );
}

function Thumbnails({ documentId, onNavigate }: { documentId: string; onNavigate?: () => void }) {
  const { state, provides } = useScroll(documentId);
  return (
    <ThumbnailsPane documentId={documentId} style={{ width: '100%', height: '100%' }} data-testid="thumbnails">
      {(m) => {
        const current = state.currentPage === m.pageIndex + 1;
        return (
          <button
            key={m.pageIndex}
            type="button"
            data-testid={`thumb-${m.pageIndex}`}
            aria-label={`Trang ${m.pageIndex + 1}`}
            aria-current={current ? 'page' : undefined}
            onClick={() => {
              provides?.scrollToPage({ pageNumber: m.pageIndex + 1 });
              onNavigate?.();
            }}
            className="absolute flex w-full flex-col items-center outline-none"
            style={{ height: m.wrapperHeight, top: m.top, paddingTop: 6 }}
          >
            <span
              className={cn(
                'relative block overflow-hidden rounded-sm bg-white ring-1 ring-black/10',
                current && 'ring-2 ring-primary',
              )}
              style={{ width: m.width, height: m.height }}
            >
              <ThumbImg
                documentId={documentId}
                meta={m}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
              <ThumbOverlay documentId={documentId} pageIndex={m.pageIndex} width={m.width} />
            </span>
            <span
              className={cn('mt-1 text-xs tabular-nums', current ? 'font-bold text-primary' : 'text-muted-foreground')}
              style={{ height: m.labelHeight }}
            >
              {m.pageIndex + 1}
            </span>
          </button>
        );
      }}
    </ThumbnailsPane>
  );
}

function SearchPanel({
  documentId,
  focusKey,
  onNavigate,
}: {
  documentId: string;
  focusKey: number;
  onNavigate?: () => void;
}) {
  const { state, provides } = useSearch(documentId);
  const { provides: scroll } = useScrollCapability();
  const [value, setValue] = useState(state.query ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusKey]);

  // Bring the active hit into view, on the page and in the list.
  useEffect(() => {
    const hit = state.results[state.activeResultIndex];
    if (!hit || state.loading) return;
    const top = hit.rects.reduce((m, r) => Math.min(m, r.origin.y), Infinity);
    const left = hit.rects.reduce((m, r) => Math.min(m, r.origin.x), Infinity);
    scroll
      ?.forDocument(documentId)
      .scrollToPage({ pageNumber: hit.pageIndex + 1, pageCoordinates: { x: left, y: top }, alignX: 50, alignY: 35 });
    listRef.current?.querySelector(`[data-result="${state.activeResultIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [state.activeResultIndex, state.loading, state.results, scroll, documentId]);

  // EmbedPDF 2.15.1 logs an error and drops results when a running search is
  // aborted by the next one, so searches never overlap here: input is
  // debounced, and a request made while one is running waits for it to end.
  const queue = useRef<Array<{ q: string } | { flags: MatchFlag[] }>>([]);
  const loading = useRef(state.loading);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  loading.current = state.loading;
  const pump = () => {
    if (loading.current || !provides) return;
    const job = queue.current.shift();
    if (!job) return;
    if ('flags' in job) provides.setFlags(job.flags);
    else if (!job.q.trim()) provides.stopSearch();
    else provides.searchAllPages(job.q);
  };
  const enqueue = (job: { q: string } | { flags: MatchFlag[] }) => {
    if ('q' in job) queue.current = queue.current.filter((j) => !('q' in j));
    queue.current.push(job);
    pump();
  };
  useEffect(() => {
    if (!state.loading) pump();
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  const run = (q: string, now = false) => {
    setValue(q);
    clearTimeout(timer.current);
    if (now) enqueue({ q });
    else timer.current = setTimeout(() => enqueue({ q }), 280);
  };
  const toggleFlag = (flag: MatchFlag, on: boolean) =>
    enqueue({ flags: on ? [...state.flags, flag] : state.flags.filter((f) => f !== flag) });
  const groups = useMemo(() => {
    const map = new Map<number, { hit: SearchResult; index: number }[]>();
    state.results.forEach((hit, index) => {
      if (!map.has(hit.pageIndex)) map.set(hit.pageIndex, []);
      map.get(hit.pageIndex)!.push({ hit, index });
    });
    return [...map.entries()];
  }, [state.results]);
  const has = state.results.length > 0 && !!value.trim();

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b px-2 pt-2 pb-2">
        <div className="relative">
          <Input
            ref={inputRef}
            data-testid="search-input"
            value={value}
            placeholder="Tìm chữ trong tài liệu"
            onChange={(e) => run(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && has) {
                e.preventDefault();
                if (e.shiftKey) provides?.previousResult();
                else provides?.nextResult();
                onNavigate?.();
              }
            }}
            className="h-8 bg-white pr-8 text-[13px]"
          />
          {value && (
            <button
              type="button"
              aria-label="Xóa từ khóa"
              data-testid="search-clear"
              onClick={() => {
                run('', true);
                inputRef.current?.focus();
              }}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Toggle
            size="sm"
            variant="outline"
            data-testid="search-match-case"
            pressed={state.flags.includes(MatchFlag.MatchCase)}
            onPressedChange={(on) => toggleFlag(MatchFlag.MatchCase, on)}
            className="h-7 bg-white px-2 text-xs font-normal data-[state=on]:border-primary/50 data-[state=on]:bg-primary-soft data-[state=on]:text-primary"
          >
            Đúng hoa/thường
          </Toggle>
          <Toggle
            size="sm"
            variant="outline"
            data-testid="search-whole-word"
            pressed={state.flags.includes(MatchFlag.MatchWholeWord)}
            onPressedChange={(on) => toggleFlag(MatchFlag.MatchWholeWord, on)}
            className="h-7 bg-white px-2 text-xs font-normal data-[state=on]:border-primary/50 data-[state=on]:bg-primary-soft data-[state=on]:text-primary"
          >
            Nguyên từ
          </Toggle>
        </div>
        <div className="flex h-7 items-center justify-between text-xs text-muted-foreground" aria-live="polite">
          <span data-testid="search-status">
            {!value.trim()
              ? 'Gõ từ cần tìm. Có phân biệt dấu.'
              : state.loading
                ? 'Đang tìm…'
                : has
                  ? `${state.activeResultIndex + 1} / ${state.total} kết quả`
                  : 'Không thấy kết quả.'}
          </span>
          <span className="flex">
            <IconAction
              label="Kết quả trước"
              shortcut="Shift Enter"
              onClick={() => provides?.previousResult()}
              disabled={!has}
              testId="search-prev"
            >
              <ChevronUp />
            </IconAction>
            <IconAction
              label="Kết quả sau"
              shortcut="Enter"
              onClick={() => provides?.nextResult()}
              disabled={!has}
              testId="search-next"
            >
              <ChevronDown />
            </IconAction>
          </span>
        </div>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-1 py-1" data-testid="search-results">
        {has &&
          groups.map(([pageIndex, items]) => (
            <div key={pageIndex} className="mb-1">
              <div className="px-2 pt-2 pb-1 text-xs font-bold text-muted-foreground">Trang {pageIndex + 1}</div>
              {items.map(({ hit, index }) => (
                <button
                  key={index}
                  type="button"
                  data-result={index}
                  data-testid={`search-result-${index}`}
                  onClick={() => {
                    provides?.goToResult(index);
                    onNavigate?.();
                  }}
                  className={cn(
                    'block w-full rounded-md px-2 py-1.5 text-left text-[13px] leading-snug hover:bg-accent',
                    index === state.activeResultIndex && 'bg-primary-soft hover:bg-primary-soft',
                  )}
                >
                  {hit.context.truncatedLeft && '… '}
                  {hit.context.before}
                  <mark className="rounded-sm bg-[#ffe066] px-0.5 text-foreground">{hit.context.match}</mark>
                  {hit.context.after}
                  {hit.context.truncatedRight && ' …'}
                </button>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
