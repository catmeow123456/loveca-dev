import type { GameState, PendingAbilityState } from '../../../domain/entities/game.js';

export const ABILITY_ORDER_SELECTION_ID = 'system:select-pending-card-effect';

/** Preserve the pending instance, including multiple abilities from the same source. */
export function queryPendingAbilityOrder(
  game: GameState
): readonly PendingAbilityState[] | undefined {
  const effect = game.activeEffect;
  if (effect?.abilityId !== ABILITY_ORDER_SELECTION_ID) return undefined;
  const ids = Array.isArray(effect.metadata?.pendingAbilityIds)
    ? effect.metadata.pendingAbilityIds
    : [];
  return game.pendingAbilities.filter((ability) => ids.includes(ability.id));
}
