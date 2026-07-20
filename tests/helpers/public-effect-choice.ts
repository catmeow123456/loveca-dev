import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
import type { GameState } from '../../src/domain/entities/game';

/**
 * Focused workflow tests usually care about the state after the public choice display.
 * Keep the first submit visible to the real resolver, then explicitly continue that
 * public window instead of restoring the old immediate-resolution assumption.
 */
export function continuePublicEffectChoiceForTest(
  game: GameState,
  playerId: string
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID) {
    return game;
  }
  return confirmActiveEffectStep(game, playerId, effect.id);
}
