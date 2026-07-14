import type { EnergyActivePhaseSkipState, GameState } from '../entities/game.js';

export function addEnergyActivePhaseSkips(
  game: GameState,
  skips: readonly EnergyActivePhaseSkipState[]
): GameState {
  const next = [...(game.energyActivePhaseSkips ?? [])];
  for (const skip of skips) {
    if (
      !next.some(
        (candidate) =>
          candidate.playerId === skip.playerId &&
          candidate.energyCardId === skip.energyCardId &&
          candidate.sourceCardId === skip.sourceCardId &&
          candidate.abilityId === skip.abilityId
      )
    ) next.push(skip);
  }
  return { ...game, energyActivePhaseSkips: next };
}

export function consumeEnergyActivePhaseSkipsForPlayer(
  game: GameState,
  playerId: string
): { readonly gameState: GameState; readonly skippedEnergyCardIds: readonly string[] } {
  const skips = game.energyActivePhaseSkips ?? [];
  return {
    gameState: { ...game, energyActivePhaseSkips: skips.filter((skip) => skip.playerId !== playerId) },
    skippedEnergyCardIds: skips
      .filter((skip) => skip.playerId === playerId)
      .map((skip) => skip.energyCardId),
  };
}

export function hasEnergyActivePhaseSkip(game: GameState, energyCardId: string): boolean {
  return (game.energyActivePhaseSkips ?? []).some((skip) => skip.energyCardId === energyCardId);
}
