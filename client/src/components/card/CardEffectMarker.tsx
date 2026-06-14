import { cn } from '@/lib/utils';
import type { CardEffectVisualState } from '@/lib/cardEffectAutomationVisuals';

interface CardEffectMarkerProps {
  readonly state: Exclude<CardEffectVisualState, 'none'>;
}

export function CardEffectMarker({ state }: CardEffectMarkerProps) {
  const actionable = state === 'actionable';

  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute left-1/2 top-[3px] z-30 -translate-x-1/2 rounded-full',
        actionable
          ? 'h-[5px] w-[5px] bg-white ring-1 ring-sky-300 shadow-[0_0_8px_rgba(56,189,248,1),0_0_2px_rgba(15,23,42,0.9)]'
          : 'h-[4px] w-[4px] bg-sky-300 ring-1 ring-slate-950/80 shadow-[0_0_6px_rgba(56,189,248,0.9)]'
      )}
    />
  );
}
