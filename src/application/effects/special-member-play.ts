import { isMemberCardData } from '../../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../../domain/entities/game.js';
import { canMemberBeRelayedAway, costCalculator } from '../../domain/rules/cost-calculator.js';
import { OrientationState, SlotPosition } from '../../shared/types/enums.js';
import {
  assignCardsToRequiredNames,
  cardNameMatchesAnyAlias,
} from '../../shared/utils/card-identity.js';

export const LL_BP7_001_SPECIAL_PLAY_CARD_CODE = 'LL-bp7-001-R+';
export const LL_BP7_001_SPECIAL_PLAY_PRINTED_COST = 15;
export const LL_BP7_001_SPECIAL_PLAY_COST = 10;
export const LL_BP7_001_SPECIAL_PLAY_REQUIRED_NAMES = [
  '国木田花丸',
  '優木せつ菜',
  '嵐千砂都',
] as const;

export interface SpecialPlayNameAssignment {
  readonly cardId: string;
  readonly requiredName: (typeof LL_BP7_001_SPECIAL_PLAY_REQUIRED_NAMES)[number];
}

export function isLlBp7001SpecialPlaySource(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === playerId &&
    source.data.cardCode === LL_BP7_001_SPECIAL_PLAY_CARD_CODE &&
    isMemberCardData(source.data) &&
    player.hand.cardIds.includes(sourceCardId)
  );
}

export function getLlBp7001SpecialPlayHandCandidateIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player || !isLlBp7001SpecialPlaySource(game, playerId, sourceCardId)) {
    return [];
  }

  return player.hand.cardIds.filter((cardId) => {
    if (cardId === sourceCardId) {
      return false;
    }
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      card.ownerId === playerId &&
      isMemberCardData(card.data) &&
      cardNameMatchesAnyAlias(card.data, LL_BP7_001_SPECIAL_PLAY_REQUIRED_NAMES)
    );
  });
}

export function assignLlBp7001SpecialPlayPayment(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  selectedCardIds: readonly string[]
): readonly SpecialPlayNameAssignment[] {
  if (
    selectedCardIds.length !== LL_BP7_001_SPECIAL_PLAY_REQUIRED_NAMES.length ||
    new Set(selectedCardIds).size !== selectedCardIds.length
  ) {
    return [];
  }
  const candidateIds = new Set(
    getLlBp7001SpecialPlayHandCandidateIds(game, playerId, sourceCardId)
  );
  if (selectedCardIds.some((cardId) => !candidateIds.has(cardId))) {
    return [];
  }

  return assignCardsToRequiredNames(
    selectedCardIds,
    LL_BP7_001_SPECIAL_PLAY_REQUIRED_NAMES,
    (cardId) => getCardById(game, cardId)?.data
  ).map(({ item, requiredName }) => ({
    cardId: item,
    requiredName: requiredName as SpecialPlayNameAssignment['requiredName'],
  }));
}

export function canAssignLlBp7001SpecialPlayPayment(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const candidateIds = getLlBp7001SpecialPlayHandCandidateIds(game, playerId, sourceCardId);
  return (
    assignCardsToRequiredNames(
      candidateIds,
      LL_BP7_001_SPECIAL_PLAY_REQUIRED_NAMES,
      (cardId) => getCardById(game, cardId)?.data
    ).length === LL_BP7_001_SPECIAL_PLAY_REQUIRED_NAMES.length
  );
}

export function getLlBp7001SpecialPlayTargetSlots(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  if (
    !player ||
    !source ||
    !isMemberCardData(source.data) ||
    !isLlBp7001SpecialPlaySource(game, playerId, sourceCardId)
  ) {
    return [];
  }
  const sourceMemberData = source.data;

  return [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].filter((slot) => {
    const occupantId = player.memberSlots.slots[slot];
    if (!occupantId) {
      return true;
    }
    if (player.movedToStageThisTurn.includes(occupantId)) {
      return false;
    }
    const occupant = getCardById(game, occupantId);
    return (
      occupant !== null &&
      isMemberCardData(occupant.data) &&
      canMemberBeRelayedAway(occupant.data, sourceMemberData) &&
      costCalculator.canPlayInSlot(slot, player.movedToStageThisTurn, [
        {
          cardId: occupantId,
          data: occupant.data,
          position: slot,
          orientation:
            player.memberSlots.cardStates.get(occupantId)?.orientation ?? OrientationState.ACTIVE,
        },
      ])
    );
  });
}
