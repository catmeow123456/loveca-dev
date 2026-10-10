import { isMemberCardData } from '../../../domain/entities/card.js';
import {
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
  type ActiveEffectState,
} from '../../../domain/entities/game.js';
import { findMemberSlot } from '../../../domain/entities/player.js';
import { cardCodeMatchesBase } from '../../../shared/utils/card-code.js';
import { cardNameAliasIs, groupAliasIs, or } from '../../effects/card-selectors.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type ActivatedAbilityUiConfig,
  type CardAbilityDefinition,
} from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';

const REN_BASE_CARD_CODE = 'PL!SP-pb2-005';
const MEMBER_BELOW_ABILITY_GRANTS = [
  {
    baseCardCode: REN_BASE_CARD_CODE,
    instancePrefix: 'ren-granted',
    selector: groupAliasIs('Liella!'),
    categories: [CardAbilityCategory.ACTIVATED],
  },
  {
    baseCardCode: 'LL-bp8-001',
    instancePrefix: 'member-below-granted',
    selector: or(
      cardNameAliasIs('矢澤にこ'),
      cardNameAliasIs('宮下愛'),
      cardNameAliasIs('セラス 柳田 リリエンフェルト')
    ),
    categories: [CardAbilityCategory.ACTIVATED, CardAbilityCategory.LIVE_START],
  },
] as const;

function createGrantedAbilityInstanceId(
  prefix: string,
  hostCardId: string,
  grantingMemberBelowCardId: string,
  abilityId: string
): string {
  return [prefix, hostCardId, grantingMemberBelowCardId, abilityId]
    .map((part) => encodeURIComponent(part))
    .join(':');
}

export interface GrantedMemberBelowAbilityDefinition {
  readonly definition: CardAbilityDefinition;
  readonly grantingMemberBelowCardId: string;
  readonly abilityInstanceId: string;
}

/** Current possession only. Already triggered invocations retain their captured identity. */
export function getGrantedMemberBelowAbilityDefinitions(
  game: GameState,
  playerId: string,
  hostCardId: string
): readonly GrantedMemberBelowAbilityDefinition[] {
  const player = getPlayerById(game, playerId);
  const hostCard = getCardById(game, hostCardId);
  if (!player || !hostCard || hostCard.ownerId !== playerId || !isMemberCardData(hostCard.data)) {
    return [];
  }

  const hostSlot = findMemberSlot(player, hostCardId);
  if (!hostSlot) {
    return [];
  }

  const grant = MEMBER_BELOW_ABILITY_GRANTS.find((candidate) =>
    cardCodeMatchesBase(hostCard.data.cardCode, candidate.baseCardCode)
  );
  if (!grant) return [];
  return (player.memberSlots.memberBelow[hostSlot] ?? []).flatMap((memberBelowCardId) => {
    const memberBelowCard = getCardById(game, memberBelowCardId);
    if (
      !memberBelowCard ||
      memberBelowCard.ownerId !== playerId ||
      !isMemberCardData(memberBelowCard.data) ||
      !grant.selector(memberBelowCard)
    ) {
      return [];
    }

    return getCardAbilityDefinitionsForCardCode(memberBelowCard.data.cardCode).flatMap(
      (definition): readonly GrantedMemberBelowAbilityDefinition[] => {
        if (
          !definition.implemented ||
          !grant.categories.some((category) => category === definition.category) ||
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
        return [
          {
            definition,
            grantingMemberBelowCardId: memberBelowCardId,
            abilityInstanceId: createGrantedAbilityInstanceId(
              grant.instancePrefix,
              hostCardId,
              memberBelowCardId,
              definition.abilityId
            ),
          },
        ];
      }
    );
  });
}

export function getGrantedActivatedAbilityDefinitions(
  game: GameState,
  playerId: string,
  hostCardId: string
): readonly GrantedMemberBelowAbilityDefinition[] {
  return getGrantedMemberBelowAbilityDefinitions(game, playerId, hostCardId).filter(
    (candidate) => candidate.definition.category === CardAbilityCategory.ACTIVATED
  );
}

export function getGrantedLiveStartAbilityDefinitions(
  game: GameState,
  playerId: string,
  hostCardId: string
): readonly GrantedMemberBelowAbilityDefinition[] {
  return getGrantedMemberBelowAbilityDefinitions(game, playerId, hostCardId).filter(
    (candidate) =>
      candidate.definition.category === CardAbilityCategory.LIVE_START &&
      candidate.definition.queued
  );
}

export function getGrantedActivatedAbilityDefinition(
  game: GameState,
  playerId: string,
  hostCardId: string,
  abilityId: string,
  abilityInstanceId?: string
): GrantedMemberBelowAbilityDefinition | null {
  return (
    getGrantedActivatedAbilityDefinitions(game, playerId, hostCardId).find(
      (candidate) =>
        candidate.definition.abilityId === abilityId &&
        (abilityInstanceId === undefined || candidate.abilityInstanceId === abilityInstanceId)
    ) ?? null
  );
}

export function getGrantedActivatedAbilityUiConfig(
  game: GameState,
  playerId: string,
  hostCardId: string
): ActivatedAbilityUiConfig | null {
  return getGrantedActivatedAbilityUiConfigs(game, playerId, hostCardId)[0] ?? null;
}

export function getGrantedActivatedAbilityUiConfigs(
  game: GameState,
  playerId: string,
  hostCardId: string
): readonly ActivatedAbilityUiConfig[] {
  return getGrantedActivatedAbilityDefinitions(game, playerId, hostCardId).flatMap((candidate) =>
    candidate.definition.activatedUi
      ? [
          {
            ...candidate.definition.activatedUi,
            abilityInstanceId: candidate.abilityInstanceId,
            requiredSourceOrientation: candidate.definition.requiredSourceOrientation,
          },
        ]
      : []
  );
}

export function isGrantedActivatedAbilityInstance(
  game: GameState,
  playerId: string,
  hostCardId: string,
  abilityId: string,
  abilityInstanceId: string
): boolean {
  return (
    getGrantedActivatedAbilityDefinition(
      game,
      playerId,
      hostCardId,
      abilityId,
      abilityInstanceId
    ) !== null
  );
}

export function isGrantedActivatedAbility(
  game: GameState,
  playerId: string,
  hostCardId: string,
  abilityId: string
): boolean {
  return getGrantedActivatedAbilityDefinition(game, playerId, hostCardId, abilityId) !== null;
}

export function isDirectOrGrantedActivatedAbilitySource(
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
  return isGrantedActivatedAbility(game, playerId, sourceCardId, abilityId);
}

/**
 * A server-created triggered invocation survives removal of the granting card.
 * Revalidate the captured copy's definition and host identity, not its current
 * below-zone membership. This is deliberately separate from current possession.
 */
export function isDirectOrGrantedTriggeredAbilitySource(
  game: GameState,
  context: Pick<
    PendingAbilityState | ActiveEffectState,
    'sourceCardId' | 'controllerId' | 'abilityId' | 'abilityInstanceId' | 'metadata'
  >,
  directBaseCardCodes: readonly string[]
): boolean {
  const sourceCard = getCardById(game, context.sourceCardId);
  if (
    !sourceCard ||
    sourceCard.ownerId !== context.controllerId ||
    !isMemberCardData(sourceCard.data)
  ) {
    return false;
  }
  if (directBaseCardCodes.some((code) => cardCodeMatchesBase(sourceCard.data.cardCode, code))) {
    return true;
  }
  const grantingCardId = context.metadata?.grantingMemberBelowCardId;
  if (!context.abilityInstanceId || typeof grantingCardId !== 'string') return false;
  const grant = MEMBER_BELOW_ABILITY_GRANTS.find((candidate) =>
    cardCodeMatchesBase(sourceCard.data.cardCode, candidate.baseCardCode)
  );
  const grantingCard = getCardById(game, grantingCardId);
  return !!(
    grant &&
    grantingCard &&
    grantingCard.ownerId === context.controllerId &&
    isMemberCardData(grantingCard.data) &&
    grant.selector(grantingCard) &&
    getCardAbilityDefinitionsForCardCode(grantingCard.data.cardCode).some(
      (definition) =>
        definition.implemented &&
        definition.queued &&
        definition.abilityId === context.abilityId &&
        definition.category === CardAbilityCategory.LIVE_START &&
        definition.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
        grant.categories.some((category) => category === definition.category)
    ) &&
    context.abilityInstanceId ===
      createGrantedAbilityInstanceId(
        grant.instancePrefix,
        context.sourceCardId,
        grantingCardId,
        context.abilityId
      )
  );
}
