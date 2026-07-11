import type { GameState } from '../../../domain/entities/game.js';

export function hasAbilityInstance(game: GameState, pendingAbilityId: string): boolean {
  return (
    game.pendingAbilities.some((ability) => ability.id === pendingAbilityId) ||
    game.activeEffect?.id === pendingAbilityId ||
    game.actionHistory.some(
      (action) =>
        action.type === 'RESOLVE_ABILITY' && action.payload.pendingAbilityId === pendingAbilityId
    )
  );
}
