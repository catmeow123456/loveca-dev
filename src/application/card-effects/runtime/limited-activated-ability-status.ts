import { isMemberCardData } from '../../../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../../../domain/entities/game.js';
import { findMemberSlot } from '../../../domain/entities/player.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';
import { getActivatedAbilityLimitStatus } from './ability-turn-limit.js';
import { isActivatedAbilityDefinitionAvailableForSource } from './activated-ability-availability.js';
import { getRenGrantedActivatedAbilityDefinitions } from './granted-activated-abilities.js';

interface LimitedActivatedAbilityCandidate {
  readonly definition: CardAbilityDefinition;
  readonly abilityInstanceId?: string;
}

export function hasRemainingLimitedActivatedAbilityForStageMember(
  game: GameState,
  playerId: string,
  sourceCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  const sourceSlot = player ? findMemberSlot(player, sourceCardId) : null;
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !sourceSlot ||
    !isMemberCardData(sourceCard.data)
  ) {
    return false;
  }

  const directCandidates: readonly LimitedActivatedAbilityCandidate[] =
    getCardAbilityDefinitionsForCardCode(sourceCard.data.cardCode).map((definition) => ({
      definition,
    }));
  const grantedCandidates: readonly LimitedActivatedAbilityCandidate[] =
    getRenGrantedActivatedAbilityDefinitions(game, playerId, sourceCardId).map((candidate) => ({
      definition: candidate.definition,
      abilityInstanceId: candidate.abilityInstanceId,
    }));

  return [...directCandidates, ...grantedCandidates].some(({ definition, abilityInstanceId }) => {
    if (
      !definition.implemented ||
      definition.category !== CardAbilityCategory.ACTIVATED ||
      definition.sourceZone !== CardAbilitySourceZone.STAGE_MEMBER ||
      definition.perTurnLimit === undefined ||
      (definition.requiredSourceSlots !== undefined &&
        !definition.requiredSourceSlots.includes(sourceSlot)) ||
      !isActivatedAbilityDefinitionAvailableForSource(game, playerId, sourceCardId, definition)
    ) {
      return false;
    }

    const status = getActivatedAbilityLimitStatus(
      game,
      playerId,
      definition.abilityId,
      sourceCardId,
      abilityInstanceId
    );
    return status !== null && status.remaining > 0;
  });
}
