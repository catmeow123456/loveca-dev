import {
  addAction,
  emitGameEvent,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import { findCardZone } from '../../../domain/entities/player.js';
import { findEnergyBelowSlot, findMemberBelowSlot } from '../../../domain/entities/zone.js';
import {
  createEnterSuccessZoneEvent,
  type CardEffectCause,
  type EnterSuccessZoneEvent,
} from '../../../domain/events/game-events.js';
import { TriggerCondition, ZoneType } from '../../../shared/types/enums.js';
import { CardAbilityCategory, CardAbilitySourceZone } from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';
import { hasAbilityInstance } from './ability-instance.js';
import {
  getDispatchedTriggerEventIds,
  markTriggerEventDispatched,
} from './trigger-event-dispatch.js';

/** Record actual entry only. The common continuation dispatches after the current whole effect. */
export function recordSuccessZoneEntry(
  before: GameState,
  after: GameState,
  playerId: string,
  cardId: string,
  fromZone: ZoneType,
  cause?: CardEffectCause
): GameState {
  const previousPlayer = getPlayerById(before, playerId);
  const player = getPlayerById(after, playerId);
  const card = getCardById(before, cardId);
  const isInSource = (state: GameState): boolean => {
    const sourcePlayer = getPlayerById(state, playerId);
    if (fromZone === ZoneType.RESOLUTION_ZONE) return state.resolutionZone.cardIds.includes(cardId);
    if (fromZone === ZoneType.INSPECTION_ZONE) return state.inspectionZone.cardIds.includes(cardId);
    return (
      sourcePlayer !== null &&
      (findCardZone(sourcePlayer, cardId) === fromZone ||
        (fromZone === ZoneType.MEMBER_SLOT &&
          (findMemberBelowSlot(sourcePlayer.memberSlots, cardId) !== null ||
            findEnergyBelowSlot(sourcePlayer.memberSlots, cardId) !== null)))
    );
  };
  if (
    fromZone === ZoneType.SUCCESS_ZONE ||
    !isInSource(before) ||
    isInSource(after) ||
    !previousPlayer ||
    !player ||
    card?.ownerId !== playerId ||
    previousPlayer.successZone.cardIds.includes(cardId) ||
    !player.successZone.cardIds.includes(cardId)
  ) {
    return after;
  }
  return emitGameEvent(
    after,
    createEnterSuccessZoneEvent(
      cardId,
      fromZone,
      card.ownerId,
      playerId,
      player.successZone.cardIds.length,
      cause
    )
  );
}

export function getEnterSuccessZoneEventsFromLog(
  game: GameState
): readonly EnterSuccessZoneEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is EnterSuccessZoneEvent =>
        event.eventType === TriggerCondition.ON_ENTER_SUCCESS_ZONE
    );
}

export function enqueueUntriggeredEnterSuccessZoneCardEffects(game: GameState): GameState {
  return enqueueEnterSuccessZoneCardEffects(game, getEnterSuccessZoneEventsFromLog(game));
}

/** Entry abilities belong to the entering card, even if it has since left the zone. */
export function enqueueEnterSuccessZoneCardEffects(
  game: GameState,
  events: readonly EnterSuccessZoneEvent[]
): GameState {
  let state = game;
  const dispatched = getDispatchedTriggerEventIds(game, TriggerCondition.ON_ENTER_SUCCESS_ZONE);
  for (const event of events) {
    if (dispatched.has(event.eventId)) continue;
    const card = getCardById(state, event.cardInstanceId);
    const definitions = card
      ? getCardAbilityDefinitionsForCardCode(card.data.cardCode).filter(
          (definition) =>
            definition.category === CardAbilityCategory.AUTO &&
            definition.sourceZone === CardAbilitySourceZone.SUCCESS_LIVE_CARD &&
            definition.queued &&
            definition.implemented &&
            definition.triggerCondition === TriggerCondition.ON_ENTER_SUCCESS_ZONE &&
            (!definition.triggerFromZones ||
              definition.triggerFromZones.includes(event.fromZone)) &&
            (definition.enterSuccessZoneMaxCards === undefined ||
              event.successZoneCardCountAfter <= definition.enterSuccessZoneMaxCards)
        )
      : [];
    for (const definition of definitions) {
      const id = `${definition.abilityId}:${event.cardInstanceId}:${event.eventId}`;
      if (hasAbilityInstance(state, id)) continue;
      const sourceLifecycleId = `source-lifecycle:event:${event.eventId}`;
      const pending: PendingAbilityState = {
        id,
        abilityId: definition.abilityId,
        sourceCardId: event.cardInstanceId,
        sourceLifecycleId,
        controllerId: event.controllerId,
        mandatory: true,
        timingId: TriggerCondition.ON_ENTER_SUCCESS_ZONE,
        eventIds: [event.eventId],
        metadata: {
          triggerKind: 'ENTER_SUCCESS_ZONE',
          eventId: event.eventId,
          fromZone: event.fromZone,
          successZoneCardCountAfter: event.successZoneCardCountAfter,
        },
      };
      state = addAction(
        { ...state, pendingAbilities: [...state.pendingAbilities, pending] },
        'TRIGGER_ABILITY',
        event.controllerId,
        {
          pendingAbilityId: id,
          abilityId: definition.abilityId,
          sourceCardId: event.cardInstanceId,
          sourceLifecycleId,
          eventId: event.eventId,
          successZoneCardCountAfter: event.successZoneCardCountAfter,
        }
      );
    }
    state = markTriggerEventDispatched(state, {
      eventId: event.eventId,
      triggerCondition: TriggerCondition.ON_ENTER_SUCCESS_ZONE,
      playerId: event.controllerId,
    });
    dispatched.add(event.eventId);
  }
  return state;
}
