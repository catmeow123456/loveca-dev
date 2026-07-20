import type { ActiveEffectViewState } from '@game/online/types';

export const PUBLIC_EFFECT_CHOICE_FALLBACK_DELAY_MS = 5_000;

export function isPublicEffectChoiceAutoAdvanceView(
  effect: ActiveEffectViewState | null | undefined
): effect is ActiveEffectViewState & {
  readonly effectChoice: NonNullable<ActiveEffectViewState['effectChoice']> & {
    readonly selectedOptionIds: readonly string[];
  };
  readonly publicEffectChoiceAutoAdvanceAt: number;
  readonly publicEffectChoiceAutoAdvanceAfterMs: number;
} {
  return (
    Array.isArray(effect?.effectChoice?.selectedOptionIds) &&
    typeof effect?.publicEffectChoiceAutoAdvanceAt === 'number' &&
    typeof effect.publicEffectChoiceAutoAdvanceAfterMs === 'number'
  );
}

export function getSelectedEffectChoiceOptions(
  effectChoice: NonNullable<ActiveEffectViewState['effectChoice']>
): readonly NonNullable<ActiveEffectViewState['effectChoice']>['options'][number][] {
  const selectedOptionIds = new Set(effectChoice.selectedOptionIds ?? []);
  return effectChoice.options.filter((option) => selectedOptionIds.has(option.id));
}

export function normalizeEffectChoiceSelection(
  effectChoice: NonNullable<ActiveEffectViewState['effectChoice']>,
  selectedOptionIds: readonly string[]
): readonly string[] {
  const selectedOptionIdSet = new Set(selectedOptionIds);
  return effectChoice.options
    .filter((option) => option.selectable !== false && selectedOptionIdSet.has(option.id))
    .slice(0, effectChoice.maxSelections)
    .map((option) => option.id);
}

export function toggleEffectChoiceSelection(
  effectChoice: NonNullable<ActiveEffectViewState['effectChoice']>,
  selectedOptionIds: readonly string[],
  optionId: string
): readonly string[] {
  const normalized = normalizeEffectChoiceSelection(effectChoice, selectedOptionIds);
  const option = effectChoice.options.find((candidate) => candidate.id === optionId);
  if (!option || option.selectable === false) return normalized;
  if (normalized.includes(optionId)) {
    return normalized.filter((selectedOptionId) => selectedOptionId !== optionId);
  }
  if (normalized.length >= effectChoice.maxSelections) return normalized;
  return normalizeEffectChoiceSelection(effectChoice, [...normalized, optionId]);
}

export function canConfirmEffectChoiceSelection(
  effectChoice: NonNullable<ActiveEffectViewState['effectChoice']>,
  selectedOptionIds: readonly string[]
): boolean {
  const normalized = normalizeEffectChoiceSelection(effectChoice, selectedOptionIds);
  return (
    normalized.length === selectedOptionIds.length &&
    normalized.length >= effectChoice.minSelections &&
    normalized.length <= effectChoice.maxSelections
  );
}

export function schedulePublicEffectChoiceAutoAdvance(
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
