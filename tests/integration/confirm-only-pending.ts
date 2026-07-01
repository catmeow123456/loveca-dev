import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import type { GameState } from '../../src/domain/entities/game';

export function confirmIfConfirmOnly(game: GameState, playerId: string): GameState {
  const effect = game.activeEffect;
  if (effect?.metadata?.confirmOnlyPendingAbility !== true) {
    return game;
  }
  return confirmActiveEffectStep(game, playerId, effect.id);
}
