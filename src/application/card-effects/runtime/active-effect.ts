import {
  addAction,
  getPlayerById,
  type GameState,
} from '../../../domain/entities/game.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export interface FinishSkippedActiveEffectOptions {
  readonly step?: string;
}

export function finishSkippedActiveEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  options: FinishSkippedActiveEffectOptions = {}
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const state = { ...game, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: options.step ?? 'SKIP',
    }),
    effect.metadata?.orderedResolution === true
  );
}
