import { isLiveCardData, isMemberCardData } from '../../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../../domain/entities/game.js';
import { getActiveEnergyIds } from '../../domain/entities/zone.js';
import {
  costCalculator,
  type AvailableResources,
  type StageMemberInfo,
  type SuccessLiveCardInfo,
} from '../../domain/rules/cost-calculator.js';
import { OrientationState, SlotPosition } from '../../shared/types/enums.js';
import { getMemberEffectiveCost } from './conditions.js';

/**
 * Builds the authoritative resources used to evaluate a member card's current
 * play cost from one complete hand snapshot.
 */
export function buildPlayMemberCostResources(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  handCardIds: readonly string[] = getPlayerById(game, playerId)?.hand.cardIds ?? []
): AvailableResources | null {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !handCardIds.includes(sourceCardId)
  ) {
    return null;
  }

  const stageMembers: StageMemberInfo[] = [];
  for (const position of [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT]) {
    const cardId = player.memberSlots.slots[position];
    if (!cardId) continue;
    const card = getCardById(game, cardId);
    if (!card || !isMemberCardData(card.data)) continue;
    stageMembers.push({
      cardId,
      data: card.data,
      effectiveCost: getMemberEffectiveCost(game, playerId, cardId),
      position,
      orientation:
        player.memberSlots.cardStates.get(cardId)?.orientation ?? OrientationState.ACTIVE,
      positionMovedThisTurn: player.positionMovedThisTurn.includes(cardId),
    });
  }

  const successLiveCards: SuccessLiveCardInfo[] = [];
  for (const cardId of player.successZone.cardIds) {
    const card = getCardById(game, cardId);
    if (card && isLiveCardData(card.data)) {
      successLiveCards.push({ cardId, data: card.data });
    }
  }

  return {
    activeEnergyIds: getActiveEnergyIds(player.energyZone),
    stageMembers,
    sourceCardId,
    handCardIds: [...handCardIds],
    successLiveCards,
  };
}

/** Returns one hand member's current effective play cost from a fixed hand snapshot. */
export function getHandMemberEffectivePlayCost(
  game: GameState,
  playerId: string,
  memberCardId: string,
  handCardIds: readonly string[] = getPlayerById(game, playerId)?.hand.cardIds ?? []
): number | null {
  const member = getCardById(game, memberCardId);
  const resources = buildPlayMemberCostResources(game, playerId, memberCardId, handCardIds);
  if (!member || !isMemberCardData(member.data) || !resources) return null;
  return costCalculator.calculateModifiedPlayCost(member.data, resources).modifiedCost;
}
