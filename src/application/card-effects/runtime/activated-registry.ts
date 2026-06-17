import type { GameState } from '../../../domain/entities/game.js';

export type ActivatedAbilityHandler = (
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string
) => GameState;

const activatedAbilityHandlers = new Map<string, ActivatedAbilityHandler>();

export function registerActivatedAbilityHandler(
  abilityId: string,
  handler: ActivatedAbilityHandler
): void {
  activatedAbilityHandlers.set(abilityId, handler);
}

export function resolveActivatedAbilityWithRegistry(
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string
): GameState | null {
  const handler = activatedAbilityHandlers.get(abilityId);
  return handler ? handler(game, playerId, cardId, abilityId) : null;
}
