import { isMemberCardData } from '../entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../entities/game.js';
import { SlotPosition } from '../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../shared/utils/card-code.js';
import { cardBelongsToGroup } from '../../shared/utils/card-identity.js';
import { successLiveScoreAtLeast } from './success-live-score.js';

const BP4_008_HANAYO_BASE_CARD_CODE = 'PL!-bp4-008';
const BP4_008_SUCCESS_SCORE_COST_BONUS = 3;
const SP_PB2_006_KINAKO_BASE_CARD_CODE = 'PL!SP-pb2-006';
const SP_PB1_010_MARGARETE_BASE_CARD_CODE = 'PL!SP-pb1-010';
const SP_PB1_010_ENERGY_THRESHOLD = 10;
const SP_PB1_010_STAGE_COST_BONUS = 4;

export function getMemberEffectiveCost(
  game: GameState,
  playerId: string,
  memberCardId: string
): number {
  const card = getCardById(game, memberCardId);
  if (!card || !isMemberCardData(card.data)) {
    return 0;
  }

  let effectiveCost = card.data.cost;
  if (isBp4008HanayoStageCostBonusActive(game, playerId, memberCardId)) {
    effectiveCost += BP4_008_SUCCESS_SCORE_COST_BONUS;
  }
  effectiveCost += getSpPb2006MemberBelowLiellaCostBonus(game, playerId, memberCardId);
  effectiveCost += getSpPb1010StageEnergyCostBonus(game, playerId, memberCardId);
  effectiveCost += getLiveMemberCostModifier(game, playerId, memberCardId);
  effectiveCost = getLiveMemberCostSetValue(game, playerId, memberCardId) ?? effectiveCost;
  return effectiveCost;
}

function getSpPb1010StageEnergyCostBonus(
  game: GameState,
  playerId: string,
  memberCardId: string
): number {
  const card = getCardById(game, memberCardId);
  const player = getPlayerById(game, playerId);
  return card !== null &&
    player !== null &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, SP_PB1_010_MARGARETE_BASE_CARD_CODE) &&
    isMemberOnPlayerStage(game, playerId, memberCardId) &&
    player.energyZone.cardIds.length >= SP_PB1_010_ENERGY_THRESHOLD
    ? SP_PB1_010_STAGE_COST_BONUS
    : 0;
}

function getLiveMemberCostModifier(
  game: GameState,
  playerId: string,
  memberCardId: string
): number {
  let total = 0;
  for (const modifier of game.liveResolution.liveModifiers) {
    if (
      modifier.kind === 'MEMBER_COST' &&
      modifier.playerId === playerId &&
      modifier.memberCardId === memberCardId
    ) {
      total += modifier.countDelta;
    }
  }
  return total;
}

function getLiveMemberCostSetValue(
  game: GameState,
  playerId: string,
  memberCardId: string
): number | null {
  let setTo: number | null = null;
  for (const modifier of game.liveResolution.liveModifiers) {
    if (
      modifier.kind === 'MEMBER_COST_SET' &&
      modifier.playerId === playerId &&
      modifier.memberCardId === memberCardId
    ) {
      setTo = modifier.setTo;
    }
  }
  return setTo;
}

function isBp4008HanayoStageCostBonusActive(
  game: GameState,
  playerId: string,
  memberCardId: string
): boolean {
  const card = getCardById(game, memberCardId);
  if (!card || !isMemberCardData(card.data)) {
    return false;
  }
  if (!cardCodeMatchesBase(card.data.cardCode, BP4_008_HANAYO_BASE_CARD_CODE)) {
    return false;
  }
  if (!isMemberOnPlayerStage(game, playerId, memberCardId)) {
    return false;
  }
  return successLiveScoreAtLeast(game, playerId, 6);
}

function isMemberOnPlayerStage(game: GameState, playerId: string, memberCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return false;
  }

  return Object.values(player.memberSlots.slots).includes(memberCardId);
}

function getSpPb2006MemberBelowLiellaCostBonus(
  game: GameState,
  playerId: string,
  memberCardId: string
): number {
  const card = getCardById(game, memberCardId);
  const player = getPlayerById(game, playerId);
  if (
    !card ||
    !player ||
    !isMemberCardData(card.data) ||
    !cardCodeMatchesBase(card.data.cardCode, SP_PB2_006_KINAKO_BASE_CARD_CODE)
  ) {
    return 0;
  }

  const sourceSlot = Object.values(SlotPosition).find(
    (slot) => player.memberSlots.slots[slot] === memberCardId
  );
  if (!sourceSlot) {
    return 0;
  }

  return (player.memberSlots.memberBelow[sourceSlot] ?? []).filter((belowCardId) => {
    const belowCard = getCardById(game, belowCardId);
    return (
      belowCard !== null &&
      isMemberCardData(belowCard.data) &&
      cardBelongsToGroup(belowCard.data, 'Liella!')
    );
  }).length;
}
