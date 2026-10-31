/**
 * The Word screen's font, size and zoom controls.
 *
 *  - FontPicker: the fonts the document uses first, then common fonts with
 *    Vietnamese letters; each name shown in its own font. A font this device
 *    lacks can still be chosen (Word on the reader's computer will have it);
 *    the list says so.
 *  - SizePicker: type a size (10,5 or 10.5 both work) or pick one.
 *  - ZoomControl: − / percentage / +; the percentage opens fit-width and
 *    fixed steps. Percentages are of the text's real size, as in Word.
 *
 * `refocus` puts the focus back in the document once a menu has closed: a
 * menu keeps the focus inside itself while it is open, so focusing the text
 * from a pick would be undone.
 */
import { Check, ChevronDown, Minus, Plus } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useDraftText } from '../use-draft-text';
import { Tip } from '../controls';

/** common fonts that have Vietnamese letters, offered after the document's own */
export const COMMON_FONTS = ['Times New Roman', 'Arial', 'Calibri', 'Cambria', 'Aptos', 'Tahoma', 'Verdana', 'Segoe UI', 'Georgia', 'Courier New', 'Roboto', 'Noto Sans', 'Noto Serif'];

export const SIZES = [8, 9, 10, 10.5, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

const installedCache = new Map<string, boolean>();
/**
 * Does this device have the font? Text is measured in it against three
 * generic fonts: if the width never changes, the browser fell back.
 */
export function fontInstalled(name: string): boolean {
  const known = installedCache.get(name);
  if (known !== undefined) return known;
  let ok = true;
  try {
    const c = document.createElement('canvas').getContext('2d');
    if (c) {
      const text = 'mmmmmmmmmmlliWWW ăâđêôơư 0123';
      const width = (font: string) => {
        c.font = `32px ${font}`;
        return c.measureText(text).width;
      };
      ok = ['monospace', 'serif', 'sans-serif'].some((g) => width(`"${name}", ${g}`) !== width(g));
    }
  } catch {
    ok = true;
  }
  installedCache.set(name, ok);
  return ok;
}

/** a font name for an inline style (the names come from the document and the list above, already checked) */
const familyCss = (name: string) => `"${name.replace(/["\\]/g, '')}", var(--font-sans)`;

export function FontPicker({
  value,
  fonts,
  onPick,
  refocus,
  className,
}: {
  value: string;
  fonts: string[];
  onPick: (name: string) => void;
  refocus: () => void;
  className?: string;
}) {
  const common = useMemo(() => COMMON_FONTS.filter((f) => !fonts.includes(f)), [fonts]);
  const item = (name: string) => {
    const here = fontInstalled(name);
    return (
      <DropdownMenuItem key={name} data-testid="word-font-item" data-font={name} onSelect={() => onPick(name)} className="gap-2">
        <Check className={cn('size-3.5 shrink-0', name === value ? 'opacity-100' : 'opacity-0')} />
        <span className="min-w-0 flex-1 truncate" style={{ fontFamily: familyCss(name) }}>
          {name}
        </span>
        {!here && <span className="shrink-0 text-[11px] text-muted-foreground">không có trên máy này</span>}
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <Tip label="Phông chữ">
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-testid="word-font"
            aria-label={`Phông chữ: ${value || 'mặc định'}`}
            onMouseDown={(e) => e.preventDefault()}
            className={cn('h-8 min-w-0 shrink justify-between gap-1 px-2 font-normal', className)}
          >
            <span className="min-w-0 truncate text-[13px]" style={value ? { fontFamily: familyCss(value) } : undefined}>
              {value || 'Phông chữ'}
            </span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="start" className="max-h-[min(60vh,420px)] w-64 overflow-y-auto" onCloseAutoFocus={(e) => (e.preventDefault(), refocus())}>
        {fonts.length > 0 && <DropdownMenuLabel className="text-xs text-muted-foreground">Trong tài liệu</DropdownMenuLabel>}
        {fonts.map(item)}
        {fonts.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuLabel className="text-xs text-muted-foreground">Phông thông dụng</DropdownMenuLabel>
        {common.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const fmtSize = (pt: number) => String(Math.round(pt * 2) / 2).replace('.', ',');

export function SizePicker({ value, onPick, refocus }: { value: number; onPick: (pt: number) => void; refocus: () => void }) {
  const draft = useDraftText(value ? fmtSize(value) : '');
  /** what was typed and not yet applied (a ref: Enter applies it, moves the focus back to the text, and the blur that follows must not apply it again) */
  const typed = useRef<string | null>(null);
  const commit = () => {
    const t = typed.current;
    typed.current = null;
    draft.reset();
    if (t === null) return;
    const v = Number(t.replace(',', '.').trim());
    if (t.trim() && Number.isFinite(v) && v >= 1 && v <= 1638) onPick(Math.round(v * 2) / 2);
  };
  return (
    <div className="flex h-8 shrink-0 items-center rounded-md border bg-background">
      <Tip label="Cỡ chữ (pt)">
        <input
          data-testid="word-size"
          aria-label="Cỡ chữ"
          inputMode="decimal"
          className="h-full w-10 min-w-0 bg-transparent px-1.5 text-center text-[13px] outline-none"
          value={draft.text}
          onChange={(e) => {
            typed.current = e.target.value;
            draft.setText(e.target.value);
          }}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              typed.current = null;
              draft.reset();
            }
          }}
          onBlur={commit}
        />
      </Tip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="word-size-menu"
            aria-label="Chọn cỡ chữ"
            onMouseDown={(e) => e.preventDefault()}
            className="flex h-full items-center border-l px-1 text-foreground/70 hover:text-foreground"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[min(60vh,420px)] w-20 min-w-0 overflow-y-auto" onCloseAutoFocus={(e) => (e.preventDefault(), refocus())}>
          {SIZES.map((s) => (
            <DropdownMenuItem key={s} data-testid="word-size-item" data-size={s} onSelect={() => onPick(s)} className={cn('justify-center', s === value && 'font-semibold text-primary')}>
              {fmtSize(s)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export const ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 300];

export function ZoomControl({
  percent,
  fit,
  onIn,
  onOut,
  onPercent,
  onFit,
  refocus,
  compact,
}: {
  percent: number;
  fit: boolean;
  onIn: () => void;
  onOut: () => void;
  onPercent: (p: number) => void;
  onFit: () => void;
  refocus: () => void;
  compact?: boolean;
}) {
  const menu = (
    <DropdownMenu>
      <Tip label="Mức phóng to">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" data-testid="word-zoom-level" aria-label={`Phóng to ${percent}%`} onMouseDown={(e) => e.preventDefault()} className="h-8 w-14 shrink-0 px-1 text-[13px] tabular-nums">
            {percent}%
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="center" className="w-40" onCloseAutoFocus={(e) => (e.preventDefault(), refocus())}>
        <DropdownMenuItem data-testid="word-zoom-fit" onSelect={onFit} className="gap-2">
          <Check className={cn('size-3.5', fit ? 'opacity-100' : 'opacity-0')} />
          Vừa chiều rộng
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {ZOOM_STEPS.map((p) => (
          <DropdownMenuItem key={p} data-testid={`word-zoom-${p}`} onSelect={() => onPercent(p)} className="gap-2">
            <Check className={cn('size-3.5', !fit && p === percent ? 'opacity-100' : 'opacity-0')} />
            {p}%
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  if (compact) return menu;
  return (
    <div className="flex shrink-0 items-center">
      <Tip label="Thu nhỏ" shortcut="Ctrl −">
        <Button variant="ghost" size="icon-sm" data-testid="word-zoom-out" aria-label="Thu nhỏ" onMouseDown={(e) => e.preventDefault()} onClick={onOut} className="hidden text-foreground/80 hover:text-foreground lg:inline-flex">
          <Minus />
        </Button>
      </Tip>
      {menu}
      <Tip label="Phóng to" shortcut="Ctrl +">
        <Button variant="ghost" size="icon-sm" data-testid="word-zoom-in" aria-label="Phóng to" onMouseDown={(e) => e.preventDefault()} onClick={onIn} className="hidden text-foreground/80 hover:text-foreground lg:inline-flex">
          <Plus />
        </Button>
      </Tip>
    </div>
  );
}
