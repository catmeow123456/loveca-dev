import type { ActiveEffectViewState } from '@game/online/types';

export const PUBLIC_REVEAL_FALLBACK_DELAY_MS = 5_000;
export const PUBLIC_REVEAL_DWELL_STEP_ID = 'COMMON_PUBLIC_REVEAL_DWELL';

export type PublicRevealAutoAdvanceView = ActiveEffectViewState & {
  readonly publicRevealAutoAdvanceAt: number;
  readonly publicRevealAutoAdvanceAfterMs: number;
  readonly publicRevealGeneration: string;
};

export interface PublicRevealDisplayEntry {
  readonly cardId: string;
  readonly entranceDelayMs: number;
}

export interface PublicRevealEntranceTiming {
  readonly shouldAnimate: boolean;
  readonly durationSeconds: number;
  readonly delaySeconds: number;
}

export function isPublicRevealAutoAdvanceView(
  effect: ActiveEffectViewState | null | undefined
): effect is PublicRevealAutoAdvanceView {
  if (!effect) return false;
  const candidate = effect as Partial<PublicRevealAutoAdvanceView>;
  return (
    candidate.stepId === PUBLIC_REVEAL_DWELL_STEP_ID &&
    typeof candidate.publicRevealAutoAdvanceAt === 'number' &&
    Number.isFinite(candidate.publicRevealAutoAdvanceAt) &&
    typeof candidate.publicRevealAutoAdvanceAfterMs === 'number' &&
    Number.isFinite(candidate.publicRevealAutoAdvanceAfterMs) &&
    typeof candidate.publicRevealGeneration === 'string' &&
    candidate.publicRevealGeneration.length > 0
  );
}

export function buildPublicRevealDisplayKey(effect: PublicRevealAutoAdvanceView): string {
  return `${effect.id}:${effect.publicRevealAutoAdvanceAt}:${effect.publicRevealGeneration}`;
}

export function getPublicRevealAutoAdvanceDelayMs(effect: PublicRevealAutoAdvanceView): number {
  return Math.max(0, effect.publicRevealAutoAdvanceAfterMs);
}

export function getPublicRevealFallbackDelayMs(effect: PublicRevealAutoAdvanceView): number {
  return getPublicRevealAutoAdvanceDelayMs(effect) + PUBLIC_REVEAL_FALLBACK_DELAY_MS;
}

export function buildPublicRevealDisplayEntries(
  effect: PublicRevealAutoAdvanceView
): readonly PublicRevealDisplayEntry[] {
  return [...new Set(effect.revealedObjectIds ?? [])].map((objectId, index) => ({
    cardId: objectId.replace(/^obj_/, ''),
    entranceDelayMs: Math.min(index * 45, 180),
  }));
}

export function getPublicRevealEntranceTiming(
  entry: PublicRevealDisplayEntry,
  prefersReducedMotion: boolean
): PublicRevealEntranceTiming {
  return prefersReducedMotion
    ? {
        shouldAnimate: false,
        durationSeconds: 0,
        delaySeconds: 0,
      }
    : {
        shouldAnimate: true,
        durationSeconds: 0.2,
        delaySeconds: entry.entranceDelayMs / 1_000,
      };
}

export function schedulePublicRevealAutoAdvance(
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
