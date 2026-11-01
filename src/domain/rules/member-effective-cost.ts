import { isMemberCardData } from '../entities/card.js';
import {
  getCardById,
  getPlayerById,
  type GameState,
  type LiveModifierState,
} from '../entities/game.js';
import { SlotPosition } from '../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../shared/utils/card-code.js';
import { cardBelongsToGroup } from '../../shared/utils/card-identity.js';
import { successLiveScoreForCardEffectAtLeast } from './success-live-score.js';
import { getCardsBelowSourceMember } from './member-below-queries.js';

const BP4_008_HANAYO_BASE_CARD_CODE = 'PL!-bp4-008';
const BP4_008_SUCCESS_SCORE_COST_BONUS = 3;
const SP_PB2_006_KINAKO_BASE_CARD_CODE = 'PL!SP-pb2-006';
const SP_PB1_010_MARGARETE_BASE_CARD_CODE = 'PL!SP-pb1-010';
const SP_PB1_010_ENERGY_THRESHOLD = 10;
const SP_PB1_010_STAGE_COST_BONUS = 4;
const SP_BP7_002_KEKE_BASE_CARD_CODE = 'PL!SP-bp7-002';
const SP_BP7_002_ENERGY_THRESHOLD = 7;
const SP_BP7_002_STAGE_COST_BONUS = 2;
const S_BP3_016_HANAMARU_BASE_CARD_CODE = 'PL!S-bp3-016';

export function getMemberEffectiveCost(
  game: GameState,
  playerId: string,
  memberCardId: string,
  liveModifiers: readonly LiveModifierState[] = game.liveResolution.liveModifiers
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
  if (
    card.ownerId === playerId &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!-bp8-009') &&
    isMemberOnPlayerStage(game, playerId, memberCardId)
  ) {
    effectiveCost +=
      2 *
      countDistinctMemberEffectiveCostsBelowSourceMember(
        game,
        playerId,
        memberCardId,
        liveModifiers
      );
  }
  effectiveCost += getSpPb1010StageEnergyCostBonus(game, playerId, memberCardId);
  effectiveCost += getSpBp7002StageEnergyLeadCostBonus(game, playerId, memberCardId);
  effectiveCost += getSBp3016SuccessLiveCountStageCostBonus(game, playerId, memberCardId);
  effectiveCost += getLiveMemberCostModifier(liveModifiers, playerId, memberCardId);
  effectiveCost = getLiveMemberCostSetValue(liveModifiers, playerId, memberCardId) ?? effectiveCost;
  return effectiveCost;
}

function getSpBp7002StageEnergyLeadCostBonus(
  game: GameState,
  playerId: string,
  memberCardId: string
): number {
  const card = getCardById(game, memberCardId);
  const player = getPlayerById(game, playerId);
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  return card !== null &&
    player !== null &&
    opponent !== undefined &&
    card.ownerId === playerId &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, SP_BP7_002_KEKE_BASE_CARD_CODE) &&
    isMemberOnPlayerStage(game, playerId, memberCardId) &&
    player.energyZone.cardIds.length >= SP_BP7_002_ENERGY_THRESHOLD &&
    player.energyZone.cardIds.length > opponent.energyZone.cardIds.length
    ? SP_BP7_002_STAGE_COST_BONUS
    : 0;
}

function getSBp3016SuccessLiveCountStageCostBonus(
  game: GameState,
  playerId: string,
  memberCardId: string
): number {
  const card = getCardById(game, memberCardId);
  const player = getPlayerById(game, playerId);
  return card !== null &&
    player !== null &&
    isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, S_BP3_016_HANAMARU_BASE_CARD_CODE) &&
    isMemberOnPlayerStage(game, playerId, memberCardId)
    ? player.successZone.cardIds.length
    : 0;
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
  liveModifiers: readonly LiveModifierState[],
  playerId: string,
  memberCardId: string
): number {
  let total = 0;
  for (const modifier of liveModifiers) {
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
  liveModifiers: readonly LiveModifierState[],
  playerId: string,
  memberCardId: string
): number | null {
  let setTo: number | null = null;
  for (const modifier of liveModifiers) {
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
  return successLiveScoreForCardEffectAtLeast(game, playerId, memberCardId, [playerId], 6);
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

/** Counts each current owned MEMBER cost value below this top-level host once. */
export function countDistinctMemberEffectiveCostsBelowSourceMember(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  liveModifiers: readonly LiveModifierState[] = game.liveResolution.liveModifiers
): number {
  const costs = new Set<number>();
  for (const cardId of getCardsBelowSourceMember(game, playerId, sourceCardId)) {
    const card = getCardById(game, cardId);
    if (card?.ownerId === playerId && isMemberCardData(card.data)) {
      costs.add(getMemberEffectiveCost(game, playerId, cardId, liveModifiers));
    }
  }
  return costs.size;
}
