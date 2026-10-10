import { isLiveCardData, isMemberCardData } from '../entities/card.js';
import type { GameState } from '../entities/game.js';
import { getCardById, getPlayerById } from '../entities/game.js';
import { cardCodeMatchesBase } from '../../shared/utils/card-code.js';
import { cardBelongsToGroup } from '../../shared/utils/card-identity.js';

const BP4_019_ANGELIC_ANGEL_BASE_CARD_CODE = 'PL!-bp4-019';
const BP4_019_ANGELIC_ANGEL_SUCCESS_SCORE_BONUS = 5;
const BP8_013_UMI_BASE_CARD_CODE = 'PL!-bp8-013';

export function getSuccessfulLiveEffectiveScore(
  game: GameState,
  playerId: string,
  liveCardId: string
): number {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, liveCardId);
  if (
    !player ||
    !player.successZone.cardIds.includes(liveCardId) ||
    !card ||
    card.ownerId !== playerId ||
    !isLiveCardData(card.data)
  ) {
    return 0;
  }

  return card.data.score + getSuccessfulLiveScoreBonus(game, playerId, liveCardId);
}

export function sumSuccessfulLiveScore(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return 0;
  }

  return [...new Set(player.successZone.cardIds)].reduce(
    (sum, cardId) => sum + getSuccessfulLiveEffectiveScore(game, playerId, cardId),
    0
  );
}

export function successLiveScoreAtLeast(
  game: GameState,
  playerId: string,
  minScore: number
): boolean {
  return sumSuccessfulLiveScore(game, playerId) >= minScore;
}

/**
 * Reads one successful-LIVE score total for a card effect. The controller comes
 * from that effect, including when its source has already paid to leave stage.
 * A combined reference gets Umi's bonus once; separate references are separate
 * totals. This never changes any LIVE's effective score or rule score total.
 */
export function sumSuccessfulLiveScoreForCardEffect(
  game: GameState,
  controllerId: string,
  sourceCardId: string,
  referencedPlayerIds: readonly string[]
): number {
  const referencedPlayers = [...new Set(referencedPlayerIds)].filter(
    (playerId) => getPlayerById(game, playerId) !== null
  );
  const total = referencedPlayers.reduce(
    (sum, playerId) => sum + sumSuccessfulLiveScore(game, playerId),
    0
  );
  const controller = getPlayerById(game, controllerId);
  if (
    referencedPlayers.length === 0 ||
    !controller ||
    !getCardById(game, sourceCardId) ||
    !controller.successZone.cardIds.some(
      (cardId) => getCardById(game, cardId)?.ownerId === controllerId
    )
  ) {
    return total;
  }

  const umiCount = [...new Set(Object.values(controller.memberSlots.slots))].filter((cardId) => {
    const card = cardId === null ? null : getCardById(game, cardId);
    return (
      card !== null &&
      card.ownerId === controllerId &&
      isMemberCardData(card.data) &&
      cardCodeMatchesBase(card.data.cardCode, BP8_013_UMI_BASE_CARD_CODE)
    );
  }).length;
  return total + 2 * umiCount;
}

export function successLiveScoreForCardEffectAtLeast(
  game: GameState,
  controllerId: string,
  sourceCardId: string,
  referencedPlayerIds: readonly string[],
  minScore: number
): boolean {
  return (
    sumSuccessfulLiveScoreForCardEffect(game, controllerId, sourceCardId, referencedPlayerIds) >=
    minScore
  );
}

function getSuccessfulLiveScoreBonus(
  game: GameState,
  playerId: string,
  liveCardId: string
): number {
  const card = getCardById(game, liveCardId);
  if (
    !card ||
    !isLiveCardData(card.data) ||
    !cardCodeMatchesBase(card.data.cardCode, BP4_019_ANGELIC_ANGEL_BASE_CARD_CODE)
  ) {
    return 0;
  }

  return hasMainStageMemberBelongingToGroup(game, playerId, "μ's")
    ? BP4_019_ANGELIC_ANGEL_SUCCESS_SCORE_BONUS
    : 0;
}

function hasMainStageMemberBelongingToGroup(
  game: GameState,
  playerId: string,
  groupName: string
): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return false;
  }

  return Object.values(player.memberSlots.slots).some((memberCardId) => {
    if (memberCardId === null) {
      return false;
    }
    const memberCard = getCardById(game, memberCardId);
    return (
      memberCard !== null &&
      memberCard.ownerId === playerId &&
      isMemberCardData(memberCard.data) &&
      cardBelongsToGroup(memberCard.data, groupName)
    );
  });
}
