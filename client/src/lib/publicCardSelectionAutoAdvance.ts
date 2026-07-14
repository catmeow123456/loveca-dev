import type { ActiveEffectViewState } from '@game/online/types';

export const PUBLIC_CARD_SELECTION_FALLBACK_DELAY_MS = 5_000;

export interface PublicCardSelectionDisplayEntry {
  readonly cardId: string;
  readonly order: number | null;
}

export function isPublicCardSelectionAutoAdvanceView(
  effect: ActiveEffectViewState | null | undefined
): effect is ActiveEffectViewState & {
  readonly publicCardSelectionAutoAdvanceAt: number;
  readonly publicCardSelectionAutoAdvanceAfterMs: number;
} {
  return (
    typeof effect?.publicCardSelectionAutoAdvanceAt === 'number' &&
    typeof effect.publicCardSelectionAutoAdvanceAfterMs === 'number'
  );
}

export function buildPublicCardSelectionDisplayEntries(
  effect: ActiveEffectViewState
): readonly PublicCardSelectionDisplayEntry[] {
  return (effect.revealedObjectIds ?? []).map((objectId, index) => ({
    cardId: objectId.replace(/^obj_/, ''),
    order: effect.publicCardSelectionOrdered === true ? index + 1 : null,
  }));
}

export function schedulePublicCardSelectionAutoAdvance(
  delayMs: number,
  onAdvance: () => void,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout
): () => void {
  let active = true;
  const timer = schedule(
    () => {
      if (!active) return;
      active = false;
      onAdvance();
    },
    Math.max(0, delayMs)
  );
  return () => {
    active = false;
    cancel(timer);
  };
}
