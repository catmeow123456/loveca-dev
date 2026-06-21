import type { CardInstance } from '../entities/card.js';
import type { GameState } from '../entities/game.js';
import { getCardById, getPlayerById } from '../entities/game.js';

type CardInstanceSelector = (card: CardInstance) => boolean;

export function hasMemberPositionMovedThisTurn(
  game: GameState,
  playerId: string,
  memberCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  return player?.positionMovedThisTurn.includes(memberCardId) === true;
}

export function getPositionMovedStageMemberIdsMatching(
  game: GameState,
  playerId: string,
  selector: CardInstanceSelector
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return Object.values(player.memberSlots.slots).filter((cardId): cardId is string => {
    if (cardId === null || !player.positionMovedThisTurn.includes(cardId)) {
      return false;
    }
    const card = getCardById(game, cardId);
    return card !== null && selector(card);
  });
}
