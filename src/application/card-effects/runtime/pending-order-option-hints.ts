import type { GameState, PendingAbilityState } from '../../../domain/entities/game.js';

export type PendingOrderOptionHintHandler = (
  game: GameState,
  ability: PendingAbilityState
) => string | null;

const pendingOrderOptionHintHandlers = new Map<string, PendingOrderOptionHintHandler>();

export function registerPendingOrderOptionHintHandler(
  abilityId: string,
  handler: PendingOrderOptionHintHandler
): void {
  pendingOrderOptionHintHandlers.set(abilityId, handler);
}

export function getPendingOrderOptionHintWithRegistry(
  game: GameState,
  ability: PendingAbilityState
): string | null {
  return pendingOrderOptionHintHandlers.get(ability.abilityId)?.(game, ability) ?? null;
}
