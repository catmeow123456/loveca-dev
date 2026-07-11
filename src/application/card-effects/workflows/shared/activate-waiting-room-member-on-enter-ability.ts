import { getCardById, getPlayerById, addAction, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { ZoneType, TriggerCondition } from '../../../../shared/types/enums.js';
import type { CardAbilityDefinition } from '../../ability-definition-types.js';
import { getWaitingRoomDelegatableOnEnterDefinitions } from '../../runtime/delegatable-definitions.js';
import type { DelegatePendingAbility } from '../../runtime/starter-registry.js';

export interface WaitingRoomOnEnterTarget {
  readonly cardId: string;
  readonly definitions: readonly CardAbilityDefinition[];
}

export function getWaitingRoomOnEnterTarget(
  game: GameState,
  playerId: string,
  cardId: string
): WaitingRoomOnEnterTarget | null {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  if (!player || !card || !player.waitingRoom.cardIds.includes(cardId)) return null;
  const definitions = getWaitingRoomDelegatableOnEnterDefinitions(card.data.cardCode);
  return definitions.length > 0 ? { cardId, definitions } : null;
}

export function delegateWaitingRoomMemberOnEnterAbility(
  game: GameState,
  params: {
    readonly controllerId: string;
    readonly parentAbilityId: string;
    readonly parentSourceCardId: string;
    readonly parentEffectId: string;
    readonly targetCardId: string;
    readonly delegatedAbilityId: string;
    readonly orderedResolution: boolean;
  },
  delegatePendingAbility: DelegatePendingAbility
): GameState {
  const target = getWaitingRoomOnEnterTarget(game, params.controllerId, params.targetCardId);
  const definition = target?.definitions.find((item) => item.abilityId === params.delegatedAbilityId);
  if (!target || !definition) return game;

  const syntheticEventId = `waiting-room-on-enter:${params.parentEffectId}:${target.cardId}:${definition.abilityId}`;
  const syntheticAbility: PendingAbilityState = {
    id: `${syntheticEventId}:pending`,
    abilityId: definition.abilityId,
    sourceCardId: target.cardId,
    controllerId: params.controllerId,
    mandatory: false,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [syntheticEventId],
    metadata: {
      delegatedByAbilityId: params.parentAbilityId,
      delegatedBySourceCardId: params.parentSourceCardId,
      delegatedTargetCardId: target.cardId,
      delegatedOnEnterFromWaitingRoom: true,
      originalSourceZone: ZoneType.WAITING_ROOM,
      syntheticEventId,
    },
  };
  const state = addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', params.controllerId, {
    pendingAbilityId: params.parentEffectId,
    abilityId: params.parentAbilityId,
    sourceCardId: params.parentSourceCardId,
    step: 'DELEGATE_WAITING_ROOM_MEMBER_ON_ENTER_ABILITY',
    delegatedTargetCardId: target.cardId,
    delegatedAbilityId: definition.abilityId,
    syntheticPendingAbilityId: syntheticAbility.id,
    delegatedOnEnterFromWaitingRoom: true,
    originalSourceZone: ZoneType.WAITING_ROOM,
  });
  return delegatePendingAbility(state, syntheticAbility, {
    orderedResolution: params.orderedResolution,
    skipManualConfirmation: true,
  });
}
