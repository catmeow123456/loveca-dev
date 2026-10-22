import { isMemberCardData } from '../../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../../domain/entities/game.js';
import { canMemberBeRelayedAway, costCalculator } from '../../domain/rules/cost-calculator.js';
import { OrientationState, SlotPosition } from '../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../shared/utils/card-code.js';
import {
  assignCardsToRequiredNames,
  cardNameMatchesAnyAlias,
  hasAtLeastDifferentNamedCards,
} from '../../shared/utils/card-identity.js';
import { getManualOperationMode } from '../manual-operation-mode.js';
import { and, typeIs, unitAliasIs } from './card-selectors.js';
import { getStageMemberCardIdsMatching } from './stage-targets.js';
import { CardType } from '../../shared/types/enums.js';

export const LL_BP7_001_SPECIAL_PLAY_BASE_CARD_CODE = 'LL-bp7-001';
export const LL_BP7_001_SPECIAL_PLAY_PRINTED_COST = 15;
export const LL_BP7_001_SPECIAL_PLAY_COST = 10;
export const LL_BP7_001_SPECIAL_PLAY_REQUIRED_NAMES = [
  '国木田花丸',
  '優木せつ菜',
  '嵐千砂都',
] as const;
export const N_BP7_011_SPECIAL_PLAY_BASE_CARD_CODE = 'PL!N-bp7-011';
export const N_BP7_011_SPECIAL_PLAY_PRINTED_COST = 13;
export const N_BP7_011_SPECIAL_PLAY_COST = 11;

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
    cardCodeMatchesBase(source.data.cardCode, LL_BP7_001_SPECIAL_PLAY_BASE_CARD_CODE) &&
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
  return getStandardSpecialPlayTargetSlots(game, playerId, sourceCardId);
}

export function isNBp7011SpecialPlaySource(
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
    cardCodeMatchesBase(source.data.cardCode, N_BP7_011_SPECIAL_PLAY_BASE_CARD_CODE) &&
    isMemberCardData(source.data) &&
    source.data.cost === N_BP7_011_SPECIAL_PLAY_PRINTED_COST &&
    player.hand.cardIds.includes(sourceCardId)
  );
}

export function getNBp7011WaitingRoomMemberCardIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player || !isNBp7011SpecialPlaySource(game, playerId, sourceCardId)) {
    return [];
  }
  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === playerId && isMemberCardData(card.data);
  });
}

export function getNBp7011SpecialPlayTargetSlots(
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
    !isNBp7011SpecialPlaySource(game, playerId, sourceCardId) ||
    getNBp7011WaitingRoomMemberCardIds(game, playerId, sourceCardId).length === 0
  ) {
    return [];
  }
  return getStandardSpecialPlayTargetSlots(game, playerId, sourceCardId);
}

export const PL_PB2_012_SPECIAL_PLAY_MODE = 'PL_PB2_012_WAIT_PRINTEMPS_COST_MINUS_TWO' as const;

export function isPlPb2012SpecialPlaySource(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    !!player &&
    !!source &&
    source.ownerId === playerId &&
    isMemberCardData(source.data) &&
    source.data.cost === 13 &&
    cardCodeMatchesBase(source.data.cardCode, 'PL!-pb2-012') &&
    player.hand.cardIds.includes(sourceCardId)
  );
}

export function getActivePrintempsMemberCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    and(typeIs(CardType.MEMBER), unitAliasIs('Printemps'))
  ).filter((id) => player?.memberSlots.cardStates.get(id)?.orientation === OrientationState.ACTIVE);
}

export function isPlPb2012SpecialPlayMemberSelection(
  game: GameState,
  playerId: string,
  ids: readonly string[]
): boolean {
  const candidates = getActivePrintempsMemberCardIds(game, playerId);
  return (
    ids.length === 2 &&
    new Set(ids).size === 2 &&
    ids.every((id) => candidates.includes(id)) &&
    hasAtLeastDifferentNamedCards(ids, 2, (id) => getCardById(game, id)?.data, {
      nameComparison: 'MEMBER_IDENTITY',
    })
  );
}

export function getPlPb2012SpecialPlayTargetSlots(
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
    !isPlPb2012SpecialPlaySource(game, playerId, sourceCardId) ||
    !hasAtLeastDifferentNamedCards(
      getActivePrintempsMemberCardIds(game, playerId),
      2,
      (id) => getCardById(game, id)?.data,
      { nameComparison: 'MEMBER_IDENTITY' }
    )
  )
    return [];
  return getStandardSpecialPlayTargetSlots(game, playerId, sourceCardId);
}

function getStandardSpecialPlayTargetSlots(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  if (!player || !source || !isMemberCardData(source.data)) return [];
  const sourceMemberData = source.data;
  if (getManualOperationMode(game) === 'FREE') {
    return [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT];
  }

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
