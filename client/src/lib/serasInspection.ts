import type { ActiveEffectViewState } from '@game/online/types';
import { HS_BP8_007_ON_ENTER_LOOK_TOP_FIVE_PURPLE_REQUIREMENT_LIVE_ABILITY_ID } from '@game/application/card-effects/ability-ids';
import { isPublicRevealAutoAdvanceView } from './publicRevealAutoAdvance';
import { PUBLIC_REVEAL_BASE_DISPLAY_DURATION_MS } from '@game/application/card-effects/runtime/public-reveal-dwell';
import { getBaseCardCode } from '@game/shared/utils/card-code';

export type SerasInspectionPhase = 'inspection' | 'reveal';

/** Presentation only: candidate legality and visibility still come from the player view. */
export function getSerasInspectionPhase(
  effect: ActiveEffectViewState | null | undefined,
  sourceCode: string | undefined,
  enabled: boolean
): SerasInspectionPhase | null {
  if (
    !enabled ||
    !effect ||
    effect.abilityId !== HS_BP8_007_ON_ENTER_LOOK_TOP_FIVE_PURPLE_REQUIREMENT_LIVE_ABILITY_ID ||
    getBaseCardCode(sourceCode ?? '') !== 'PL!HS-bp8-007'
  )
    return null;
  if (effect.stepId === 'HS_BP8_007_SELECT_PURPLE_REQUIREMENT_LIVE') return 'inspection';
  if (isPublicRevealAutoAdvanceView(effect) && effect.revealedObjectIds?.length) return 'reveal';
  return null;
}

// Join a late public reveal at its current pose; never extend the authority's dwell.
export function getSerasRevealElapsed(remainingMs: number | undefined): number {
  return Math.min(
    800,
    Math.max(0, PUBLIC_REVEAL_BASE_DISPLAY_DURATION_MS - Math.max(0, remainingMs ?? 0))
  );
}
