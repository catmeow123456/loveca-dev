import { isMemberCardData } from '../../../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../../../domain/entities/game.js';
import { findMemberSlot } from '../../../domain/entities/player.js';
import { cardCodeMatchesBase } from '../../../shared/utils/card-code.js';
import { groupAliasIs } from '../../effects/card-selectors.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type ActivatedAbilityUiConfig,
  type CardAbilityDefinition,
} from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';

const REN_BASE_CARD_CODE = 'PL!SP-pb2-005';

export interface GrantedActivatedAbilityDefinition {
  readonly definition: CardAbilityDefinition;
  readonly grantingMemberBelowCardId: string;
}

export function getRenGrantedActivatedAbilityDefinitions(
  game: GameState,
  playerId: string,
  hostCardId: string
): readonly GrantedActivatedAbilityDefinition[] {
  const player = getPlayerById(game, playerId);
  const hostCard = getCardById(game, hostCardId);
  if (
    !player ||
    !hostCard ||
    hostCard.ownerId !== playerId ||
    !isMemberCardData(hostCard.data) ||
    !cardCodeMatchesBase(hostCard.data.cardCode, REN_BASE_CARD_CODE)
  ) {
    return [];
  }

  const hostSlot = findMemberSlot(player, hostCardId);
  if (!hostSlot) {
    return [];
  }

  const isLiella = groupAliasIs('Liella!');
  return (player.memberSlots.memberBelow[hostSlot] ?? []).flatMap((memberBelowCardId) => {
    const memberBelowCard = getCardById(game, memberBelowCardId);
    if (
      !memberBelowCard ||
      memberBelowCard.ownerId !== playerId ||
      !isMemberCardData(memberBelowCard.data) ||
      !isLiella(memberBelowCard)
    ) {
      return [];
    }

    return getCardAbilityDefinitionsForCardCode(memberBelowCard.data.cardCode).flatMap(
      (definition): readonly GrantedActivatedAbilityDefinition[] => {
        if (
          !definition.implemented ||
          definition.category !== CardAbilityCategory.ACTIVATED ||
          definition.sourceZone !== CardAbilitySourceZone.STAGE_MEMBER
        ) {
          return [];
        }
        if (
          definition.requiredSourceSlots !== undefined &&
          definition.requiredSourceSlots.length > 0 &&
          !definition.requiredSourceSlots.includes(hostSlot)
        ) {
          return [];
        }
        return [{ definition, grantingMemberBelowCardId: memberBelowCardId }];
      }
    );
  });
}

export function getRenGrantedActivatedAbilityDefinition(
  game: GameState,
  playerId: string,
  hostCardId: string,
  abilityId: string
): GrantedActivatedAbilityDefinition | null {
  return (
    getRenGrantedActivatedAbilityDefinitions(game, playerId, hostCardId).find(
      (candidate) => candidate.definition.abilityId === abilityId
    ) ?? null
  );
}

export function getRenGrantedActivatedAbilityUiConfig(
  game: GameState,
  playerId: string,
  hostCardId: string
): ActivatedAbilityUiConfig | null {
  return (
    getRenGrantedActivatedAbilityDefinitions(game, playerId, hostCardId).find(
      (candidate) => candidate.definition.activatedUi
    )?.definition.activatedUi ?? null
  );
}

export function isRenGrantedActivatedAbility(
  game: GameState,
  playerId: string,
  hostCardId: string,
  abilityId: string
): boolean {
  return getRenGrantedActivatedAbilityDefinition(game, playerId, hostCardId, abilityId) !== null;
}

export function isDirectOrRenGrantedActivatedAbilitySource(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  abilityId: string,
  directBaseCardCodes: readonly string[]
): boolean {
  const sourceCard = getCardById(game, sourceCardId);
  if (!sourceCard || sourceCard.ownerId !== playerId || !isMemberCardData(sourceCard.data)) {
    return false;
  }
  if (
    directBaseCardCodes.some((baseCardCode) =>
      cardCodeMatchesBase(sourceCard.data.cardCode, baseCardCode)
    )
  ) {
    return true;
  }
  return isRenGrantedActivatedAbility(game, playerId, sourceCardId, abilityId);
}
