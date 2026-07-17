import { isLiveCardData } from '../entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../entities/game.js';
import { HeartColor } from '../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../shared/utils/card-identity.js';
import { applyHeartRequirementModifiers } from './live-requirement-modifiers.js';
import { collectLiveModifiers, getLiveCardRequirementModifiers } from './live-modifiers.js';

export interface ExactEffectiveRequiredHeartLiveQuery {
  readonly group: string;
  readonly heartColor: HeartColor;
  readonly exactCount: number;
}

export function findOwnSuccessOrCurrentLiveCardsWithExactEffectiveRequiredHeartCount(
  game: GameState,
  playerId: string,
  query: ExactEffectiveRequiredHeartLiveQuery
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player || !Number.isInteger(query.exactCount) || query.exactCount < 0) {
    return [];
  }

  const liveModifiers = collectLiveModifiers(game);
  return [...new Set([...player.successZone.cardIds, ...player.liveZone.cardIds])].filter(
    (liveCardId) => {
      const card = getCardById(game, liveCardId);
      if (
        !card ||
        card.ownerId !== playerId ||
        !isLiveCardData(card.data) ||
        !cardBelongsToGroup(card.data, query.group)
      ) {
        return false;
      }

      const effectiveRequirement = applyHeartRequirementModifiers(
        card.data.requirements,
        getLiveCardRequirementModifiers(game.liveResolution, liveCardId, liveModifiers)
      );
      return (
        (effectiveRequirement.colorRequirements.get(query.heartColor) ?? 0) === query.exactCount
      );
    }
  );
}

export function hasOwnSuccessOrCurrentLiveCardWithExactEffectiveRequiredHeartCount(
  game: GameState,
  playerId: string,
  query: ExactEffectiveRequiredHeartLiveQuery
): boolean {
  return (
    findOwnSuccessOrCurrentLiveCardsWithExactEffectiveRequiredHeartCount(game, playerId, query)
      .length > 0
  );
}
