import type { CardInstance } from '../../domain/entities/card.js';
import { isMemberCardData } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import { getCardById, getPlayerById } from '../../domain/entities/game.js';
import { OrientationState, SlotPosition } from '../../shared/types/enums.js';
import type { CardSelector } from './card-selectors.js';

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

export function getStageMemberCardIdsMatching(
  game: GameState,
  playerId: string,
  selector: CardSelector
): string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return MEMBER_SLOT_ORDER.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      return [];
    }
    const card = getCardById(game, cardId);
    return isSelectableStageMember(card, selector) ? [cardId] : [];
  });
}

export function getStageMemberCardIdsByOrientation(
  game: GameState,
  playerId: string,
  orientation: OrientationState
): string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return MEMBER_SLOT_ORDER.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      return [];
    }
    const cardState = player.memberSlots.cardStates.get(cardId);
    return cardState?.orientation === orientation ? [cardId] : [];
  });
}

function isSelectableStageMember(
  card: CardInstance | null,
  selector: CardSelector
): card is CardInstance {
  return card !== null && isMemberCardData(card.data) && selector(card);
}
