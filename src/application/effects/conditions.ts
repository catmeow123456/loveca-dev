import type { CardInstance } from '../../domain/entities/card.js';
import { isMemberCardData } from '../../domain/entities/card.js';
import type { GameState } from '../../domain/entities/game.js';
import { getCardById, getPlayerById } from '../../domain/entities/game.js';
import { getMemberEffectiveBladeCount } from '../../domain/rules/live-modifiers.js';
import { getMemberEffectiveCost as getDomainMemberEffectiveCost } from '../../domain/rules/member-effective-cost.js';
export {
  sumSuccessfulLiveScore,
  successLiveScoreAtLeast,
} from '../../domain/rules/success-live-score.js';
export {
  getMovedToStageOrPositionMovedStageMemberIdsMatching,
  getPositionMovedStageMemberIdsMatching,
  hasMemberMovedToStageThisTurn,
  hasMemberPositionMovedThisTurn,
} from '../../domain/rules/member-turn-state.js';
import { ZoneType } from '../../shared/types/enums.js';
import type { CardSelector } from './card-selectors.js';

export type PlayerZoneQuery =
  | ZoneType.HAND
  | ZoneType.MAIN_DECK
  | ZoneType.ENERGY_DECK
  | ZoneType.ENERGY_ZONE
  | ZoneType.LIVE_ZONE
  | ZoneType.SUCCESS_ZONE
  | ZoneType.WAITING_ROOM
  | ZoneType.EXILE_ZONE;

export function countCardsInZone(
  game: GameState,
  playerId: string,
  zoneType: PlayerZoneQuery
): number {
  return getCardIdsInZone(game, playerId, zoneType).length;
}

export function countCardsMatchingSelector(
  game: GameState,
  cardIds: readonly string[],
  selector: CardSelector
): number {
  return getCardIdsMatchingSelector(game, cardIds, selector).length;
}

export function countCardIdsMatchingSelectors(
  game: GameState,
  cardIds: readonly string[],
  selectors: readonly CardSelector[]
): readonly number[] {
  return selectors.map((selector) => countCardsMatchingSelector(game, cardIds, selector));
}

export function getCardIdsInZoneMatching(
  game: GameState,
  playerId: string,
  zoneType: PlayerZoneQuery,
  selector: CardSelector
): readonly string[] {
  return getCardIdsMatchingSelector(game, getCardIdsInZone(game, playerId, zoneType), selector);
}

export function countCardsInZoneMatching(
  game: GameState,
  playerId: string,
  zoneType: PlayerZoneQuery,
  selector: CardSelector
): number {
  return getCardIdsInZoneMatching(game, playerId, zoneType, selector).length;
}

export function getCardIdsMatchingSelector(
  game: GameState,
  cardIds: readonly string[],
  selector: CardSelector
): readonly string[] {
  return cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && selector(card);
  });
}

export function hasCardIdsMatchingSelector(
  game: GameState,
  cardIds: readonly string[],
  selector: CardSelector
): boolean {
  return cardIds.some((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && selector(card);
  });
}

export function allCardIdsMatchingSelector(
  game: GameState,
  cardIds: readonly string[],
  selector: CardSelector
): boolean {
  return (
    cardIds.length > 0 &&
    cardIds.every((cardId) => {
      const card = getCardById(game, cardId);
      return card !== null && selector(card);
    })
  );
}

export function hasAtLeastCardsMatchingSelector(
  game: GameState,
  cardIds: readonly string[],
  selector: CardSelector,
  count: number
): boolean {
  return countCardsMatchingSelector(game, cardIds, selector) >= count;
}

export function hasCardInZoneMatching(
  game: GameState,
  playerId: string,
  zoneType: PlayerZoneQuery,
  selector: CardSelector
): boolean {
  return hasCardIdsMatchingSelector(game, getCardIdsInZone(game, playerId, zoneType), selector);
}

export function countSuccessfulLiveCards(game: GameState, playerId: string): number {
  return countCardsInZone(game, playerId, ZoneType.SUCCESS_ZONE);
}

export function countStageMembers(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return 0;
  }

  return Object.values(player.memberSlots.slots).filter((cardId) => cardId !== null).length;
}

export function sumStageMemberEffectiveCostMatching(
  game: GameState,
  playerId: string,
  selector?: CardSelector
): number {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return 0;
  }

  return Object.values(player.memberSlots.slots).reduce((total, cardId) => {
    if (cardId === null) {
      return total;
    }
    const card = getCardById(game, cardId);
    if (!card || !isMemberCardData(card.data) || (selector && !selector(card))) {
      return total;
    }
    return total + getMemberEffectiveCost(game, playerId, cardId);
  }, 0);
}

export function hasStageMemberMatching(
  game: GameState,
  playerId: string,
  selector: CardSelector,
  options: { readonly excludeCardId?: string } = {}
): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return false;
  }

  return Object.values(player.memberSlots.slots).some((cardId) => {
    if (cardId === null || cardId === options.excludeCardId) {
      return false;
    }
    const card = getCardById(game, cardId);
    return card !== null && selector(card);
  });
}

export function hasOtherStageMember(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return false;
  }

  return Object.values(player.memberSlots.slots).some(
    (cardId) => cardId !== null && cardId !== sourceCardId
  );
}

export function countOtherLiveZoneCardsMatching(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  selector: CardSelector
): number {
  return countCardsMatchingSelector(
    game,
    getCardIdsInZone(game, playerId, ZoneType.LIVE_ZONE).filter(
      (cardId) => cardId !== sourceCardId
    ),
    selector
  );
}

export function sourceHasBladeAtLeast(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  minBlade: number
): boolean {
  return getSourceEffectiveBladeCount(game, playerId, sourceCardId) >= minBlade;
}

export function getSourceEffectiveBladeCount(
  game: GameState,
  playerId: string,
  sourceCardId: string
): number {
  return getMemberEffectiveBladeCount(game, playerId, sourceCardId);
}

export function getMemberEffectiveCost(
  game: GameState,
  playerId: string,
  memberCardId: string
): number {
  return getDomainMemberEffectiveCost(game, playerId, memberCardId);
}

export function getCardIdsInZone(
  game: GameState,
  playerId: string,
  zoneType: PlayerZoneQuery
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  switch (zoneType) {
    case ZoneType.HAND:
      return player.hand.cardIds;
    case ZoneType.MAIN_DECK:
      return player.mainDeck.cardIds;
    case ZoneType.ENERGY_DECK:
      return player.energyDeck.cardIds;
    case ZoneType.ENERGY_ZONE:
      return player.energyZone.cardIds;
    case ZoneType.LIVE_ZONE:
      return player.liveZone.cardIds;
    case ZoneType.SUCCESS_ZONE:
      return player.successZone.cardIds;
    case ZoneType.WAITING_ROOM:
      return player.waitingRoom.cardIds;
    case ZoneType.EXILE_ZONE:
      return player.exileZone.cardIds;
  }
}

export function getCardsInZone(
  game: GameState,
  playerId: string,
  zoneType: PlayerZoneQuery
): readonly CardInstance[] {
  return getCardIdsInZone(game, playerId, zoneType)
    .map((cardId) => getCardById(game, cardId))
    .filter((card): card is CardInstance => card !== null);
}
