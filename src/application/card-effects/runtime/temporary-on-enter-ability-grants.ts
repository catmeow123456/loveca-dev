import { isMemberCardData } from '../../../domain/entities/card.js';
import {
  getCardById,
  getPlayerById,
  updateLiveResolution,
  type GameState,
  type PendingAbilityState,
  type TemporaryOnEnterAbilityGrant,
} from '../../../domain/entities/game.js';
import { findMemberSlot } from '../../../domain/entities/player.js';
import { TriggerCondition } from '../../../shared/types/enums.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';
import { getStageMemberLifecycleId } from './ability-source-lifecycle.js';

export function getCopyableOnEnterDefinitions(cardCode: string): readonly CardAbilityDefinition[] {
  return getCardAbilityDefinitionsForCardCode(cardCode).filter(
    (definition) =>
      definition.implemented &&
      definition.queued &&
      definition.category === CardAbilityCategory.ON_ENTER &&
      definition.triggerCondition === TriggerCondition.ON_ENTER_STAGE &&
      (definition.sourceZone === CardAbilitySourceZone.PLAYED_MEMBER ||
        definition.sourceZone === CardAbilitySourceZone.STAGE_MEMBER)
  );
}

export function getCurrentTemporaryOnEnterAbilityGrants(
  game: GameState,
  playerId: string,
  hostCardId: string
): readonly TemporaryOnEnterAbilityGrant[] {
  const player = getPlayerById(game, playerId);
  const host = getCardById(game, hostCardId);
  if (
    !player ||
    !host ||
    host.ownerId !== playerId ||
    !isMemberCardData(host.data) ||
    findMemberSlot(player, hostCardId) === null
  )
    return [];
  const lifecycle = getStageMemberLifecycleId(game, hostCardId);
  return game.liveResolution.liveModifiers.filter(
    (grant): grant is TemporaryOnEnterAbilityGrant =>
      grant.kind === 'ON_ENTER_ABILITY_GRANT' &&
      grant.controllerId === playerId &&
      grant.hostCardId === hostCardId &&
      grant.hostLifecycleId === lifecycle
  );
}

export function addTemporaryOnEnterAbilityGrant(
  game: GameState,
  grant: TemporaryOnEnterAbilityGrant
): GameState {
  const player = getPlayerById(game, grant.controllerId);
  if (
    !player ||
    findMemberSlot(player, grant.hostCardId) === null ||
    getStageMemberLifecycleId(game, grant.hostCardId) !== grant.hostLifecycleId ||
    !getCopyableOnEnterDefinitions(grant.definitionSourceCardCode).some(
      (definition) => definition.abilityId === grant.abilityId
    )
  )
    return game;
  return updateLiveResolution(game, (live) => ({
    ...live,
    liveModifiers: [...live.liveModifiers, grant],
  }));
}

/** Ordinary delegation retains the template but pays its own activation costs. */
export function getTemporaryOnEnterAbilityInvocation(
  game: GameState,
  playerId: string,
  hostCardId: string,
  abilityId: string
): PendingAbilityState['onEnterInvocation'] {
  const grant = getCurrentTemporaryOnEnterAbilityGrants(game, playerId, hostCardId).find(
    (item) => item.abilityId === abilityId
  );
  return grant
    ? {
        definitionSourceCardCode: grant.definitionSourceCardCode,
        waiveActivationCosts: false,
        grantId: grant.grantId,
      }
    : undefined;
}
