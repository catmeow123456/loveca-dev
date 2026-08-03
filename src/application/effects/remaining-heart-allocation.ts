import { getCardById, type GameState } from '../../domain/entities/game.js';
import type { RemainingHeartPreference } from '../../domain/value-objects/heart.js';
import { TriggerCondition } from '../../shared/types/enums.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../card-effects/ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../card-effects/definitions/lookup.js';
import { groupAliasIs } from './card-selectors.js';
import { hasStageMemberMatching } from './conditions.js';

export function collectRemainingHeartAllocationPreferences(
  game: GameState,
  playerId: string,
  liveCardIds: readonly string[]
): readonly RemainingHeartPreference[] {
  return liveCardIds.flatMap((cardId) => {
    const card = getCardById(game, cardId);
    if (!card) {
      return [];
    }

    return getCardAbilityDefinitionsForCardCode(card.data.cardCode).flatMap((definition) => {
      const preference = definition.remainingHeartAllocationPreference;
      if (
        !preference ||
        preference.minCount < 1 ||
        !definition.implemented ||
        definition.category !== CardAbilityCategory.LIVE_SUCCESS ||
        definition.sourceZone !== CardAbilitySourceZone.LIVE_CARD ||
        definition.triggerCondition !== TriggerCondition.ON_LIVE_SUCCESS
      ) {
        return [];
      }
      if (
        preference.requiredStageGroupAlias &&
        !hasStageMemberMatching(game, playerId, groupAliasIs(preference.requiredStageGroupAlias))
      ) {
        return [];
      }

      return [{ color: preference.color, minCount: preference.minCount }];
    });
  });
}
