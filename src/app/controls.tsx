import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

function Tip({ label, shortcut, children }: { label: string; shortcut?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-2">
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Icon-only action with tooltip; the label is also the accessible name. */
export function IconAction(props: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tip label={props.label} shortcut={props.shortcut}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={props.label}
        data-testid={props.testId}
        onClick={props.onClick}
        disabled={props.disabled}
        className={cn('text-foreground/80 hover:text-foreground', props.className)}
      >
        {props.children}
      </Button>
    </Tip>
  );
}

/** A tool that stays on until another is chosen: pressed = accent tint + ring. */
export function ToolToggle(props: {
  label: string;
  shortcut?: string;
  pressed: boolean;
  onPressedChange: (on: boolean) => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Tip label={props.label} shortcut={props.shortcut}>
      <Toggle
        size="sm"
        aria-label={props.label}
        data-testid={props.testId}
        pressed={props.pressed}
        onPressedChange={props.onPressedChange}
        className="text-foreground/80 hover:bg-accent hover:text-foreground data-[state=on]:bg-primary-soft data-[state=on]:text-primary data-[state=on]:ring-1 data-[state=on]:ring-primary/40"
      >
        {props.children}
      </Toggle>
    </Tip>
  );
}

export function BarDivider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />;
}

/** Round colour choice; `selected` draws the accent ring. */
export function Swatch(props: { color: string; name: string; selected: boolean; onClick: () => void; testId: string }) {
  const none = props.color === 'transparent';
  return (
    <Tip label={props.name}>
      <button
        type="button"
        aria-label={props.name}
        aria-pressed={props.selected}
        data-testid={props.testId}
        onClick={props.onClick}
        className={cn(
          'relative size-7 rounded-full border border-black/10 outline-none focus-visible:ring-2 focus-visible:ring-ring',
          props.selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        )}
        style={{
          background: none
            ? 'linear-gradient(135deg, transparent 45%, var(--destructive) 45%, var(--destructive) 55%, transparent 55%), #fff'
            : props.color,
        }}
      />
    </Tip>
  );
}
