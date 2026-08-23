import { type BladeHeartItem } from '../entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../entities/game.js';
import { BladeHeartEffect } from '../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../shared/utils/card-identity.js';

/**
 * Returns cards in this player's success zone that they still own, belong to the
 * requested group, and have a printed SCORE blade-heart icon.
 */
export function getOwnedSuccessfulGroupScoreCardIds(
  game: GameState,
  playerId: string,
  groupAlias: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return player.successZone.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      card.ownerId === player.id &&
      cardBelongsToGroup(card.data, groupAlias) &&
      (card.data as { readonly bladeHearts?: readonly BladeHeartItem[] }).bladeHearts?.some(
        (bladeHeart) => bladeHeart.effect === BladeHeartEffect.SCORE
      ) === true
    );
  });
}
