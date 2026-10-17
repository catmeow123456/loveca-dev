import type { CardInstance } from '../../domain/entities/card.js';
import { isMemberCardData } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import { getCardById, getPlayerById } from '../../domain/entities/game.js';
import { getMemberOriginalHeartCount } from '../../domain/rules/live-modifiers.js';
import { findMemberSlot } from '../../domain/entities/player.js';
import { OrientationState, SlotPosition } from '../../shared/types/enums.js';
import type { CardSelector } from './card-selectors.js';

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

export type StageMemberStatePredicate = (
  game: GameState,
  playerId: string,
  cardId: string
) => boolean;

export function memberOriginalHeartLte(maxHeart: number): StageMemberStatePredicate {
  return (game, playerId, cardId) =>
    getMemberOriginalHeartCount(game, playerId, cardId) <= maxHeart;
}

/** Counts a member once, regardless of how many energy cards are below it. */
export const memberHasEnergyBelow: StageMemberStatePredicate = (game, playerId, cardId) => {
  const player = getPlayerById(game, playerId);
  const slot = player ? findMemberSlot(player, cardId) : null;
  return (
    player !== null && slot !== null && (player.memberSlots.energyBelow[slot] ?? []).length > 0
  );
};

export function getStageMemberCardIdsMatching(
  game: GameState,
  playerId: string,
  selector: CardSelector,
  statePredicate?: StageMemberStatePredicate
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
    return isSelectableStageMember(card, selector) &&
      (statePredicate === undefined || statePredicate(game, playerId, cardId))
      ? [cardId]
      : [];
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
