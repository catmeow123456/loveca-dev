import type { GameState } from '../entities/game.js';

export function getOwnedInspectionCardIds(state: GameState, playerId: string): readonly string[] {
  return state.inspectionZone.cardIds.filter(
    (cardId) => state.cardRegistry.get(cardId)?.ownerId === playerId
  );
}

export function isActiveEffectControlledInspection(state: GameState, playerId: string): boolean {
  const effect = state.activeEffect;
  const inspectionContext = state.inspectionContext;
  if (
    !effect ||
    !inspectionContext ||
    inspectionContext.ownerPlayerId !== playerId ||
    effect.awaitingPlayerId !== playerId
  ) {
    return false;
  }

  const effectInspectionCardIds = effect.inspectionCardIds ?? [];
  const effectSelectableCardIds = effect.selectableCardIds ?? [];
  if (effectInspectionCardIds.length === 0 && effectSelectableCardIds.length === 0) {
    return false;
  }

  const ownedInspectionCardIds = getOwnedInspectionCardIds(state, playerId);
  return [...effectInspectionCardIds, ...effectSelectableCardIds].some((cardId) =>
    ownedInspectionCardIds.includes(cardId)
  );
}
