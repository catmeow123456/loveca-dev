import { isMemberCardData } from '../entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../entities/game.js';
import { cardCodeMatchesBase } from '../../shared/utils/card-code.js';
import { successLiveScoreAtLeast } from './success-live-score.js';

const BP4_008_HANAYO_BASE_CARD_CODE = 'PL!-bp4-008';
const BP4_008_SUCCESS_SCORE_COST_BONUS = 3;

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
  effectiveCost += getLiveMemberCostModifier(game, playerId, memberCardId);
  return effectiveCost;
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
