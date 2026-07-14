import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import type {
  EnterHandEvent,
  EnterLiveZoneEvent,
} from '../../../domain/events/game-events.js';
import { FaceState, TriggerCondition, ZoneType } from '../../../shared/types/enums.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';
import { hasAbilityInstance } from './ability-instance.js';

interface EnterHandAbilitySource {
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly event: EnterHandEvent;
}

interface EnterLiveZoneAbilitySource {
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly event: EnterLiveZoneEvent;
}

export function getEnterHandEventsFromLog(
  game: GameState,
  startIndex = 0
): readonly EnterHandEvent[] {
  return game.eventLog
    .slice(startIndex)
    .map((entry) => entry.event)
    .filter((event): event is EnterHandEvent => event.eventType === TriggerCondition.ON_ENTER_HAND);
}

export function getLatestEnterHandEventsFromLog(game: GameState): readonly EnterHandEvent[] {
  const events = getEnterHandEventsFromLog(game);
  const latestEvent = events.at(-1);
  return latestEvent ? [latestEvent] : [];
}

export function getEnterLiveZoneEventsFromLog(
  game: GameState,
  startIndex = 0
): readonly EnterLiveZoneEvent[] {
  return game.eventLog
    .slice(startIndex)
    .map((entry) => entry.event)
    .filter(
      (event): event is EnterLiveZoneEvent =>
        event.eventType === TriggerCondition.ON_ENTER_LIVE_ZONE
    );
}

export function getLatestEnterLiveZoneEventsFromLog(
  game: GameState
): readonly EnterLiveZoneEvent[] {
  const events = getEnterLiveZoneEventsFromLog(game);
  const latestEvent = events.at(-1);
  return latestEvent ? [latestEvent] : [];
}

export function enqueueEnterHandCardEffects(
  game: GameState,
  events: readonly EnterHandEvent[]
): GameState {
  let state = game;
  for (const event of events) {
    if (!doesCardMoveEventTargetAbilityZone(event, ZoneType.HAND)) {
      continue;
    }
    const movedCardIds = event.cardInstanceIds ?? [event.cardInstanceId];
    for (const sourceCardId of movedCardIds) {
      state = enqueueSingleEnterHandCardEffect(state, {
        sourceCardId,
        controllerId: event.controllerId,
        event,
      });
    }
  }
  return state;
}

export function enqueueEnterLiveZoneCardEffects(
  game: GameState,
  events: readonly EnterLiveZoneEvent[]
): GameState {
  let state = game;
  for (const event of events) {
    if (
      event.face !== FaceState.FACE_UP ||
      !doesCardMoveEventTargetAbilityZone(event, ZoneType.LIVE_ZONE)
    ) {
      continue;
    }
    state = enqueueSingleEnterLiveZoneCardEffect(state, {
      sourceCardId: event.cardInstanceId,
      controllerId: event.controllerId,
      event,
    });
  }
  return state;
}

export function enqueueUntriggeredEnterHandAndLiveZoneCardEffects(game: GameState): GameState {
  const alreadyTriggeredEventIds = getAlreadyTriggeredEventIds(game);
  const enterHandEvents = getEnterHandEventsFromLog(game).filter(
    (event) => !alreadyTriggeredEventIds.has(event.eventId)
  );
  const enterLiveZoneEvents = getEnterLiveZoneEventsFromLog(game).filter(
    (event) => !alreadyTriggeredEventIds.has(event.eventId)
  );
  if (enterHandEvents.length === 0 && enterLiveZoneEvents.length === 0) {
    return game;
  }

  return enqueueEnterLiveZoneCardEffects(
    enqueueEnterHandCardEffects(game, enterHandEvents),
    enterLiveZoneEvents
  );
}

function enqueueSingleEnterHandCardEffect(
  game: GameState,
  source: EnterHandAbilitySource
): GameState {
  const player = getPlayerById(game, source.controllerId);
  const sourceCard = getCardById(game, source.sourceCardId);
  if (!player || !sourceCard || !player.hand.cardIds.includes(source.sourceCardId)) {
    return game;
  }

  const abilityDefinitions = getQueuedMoveAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilitySourceZone.HAND,
    TriggerCondition.ON_ENTER_HAND,
    source.event
  );
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    const pendingAbilityId = `${abilityId}:${source.sourceCardId}:${source.event.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const movedCardIds = source.event.cardInstanceIds ?? [source.event.cardInstanceId];
    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.sourceCardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_HAND,
      eventIds: [source.event.eventId],
      metadata: {
        movedCardIds,
        fromZone: source.event.fromZone,
        toZone: source.event.toZone,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.sourceCardId,
        timingId: pendingAbility.timingId,
        eventId: source.event.eventId,
        movedCardIds,
      }
    );
  }

  return state;
}

function enqueueSingleEnterLiveZoneCardEffect(
  game: GameState,
  source: EnterLiveZoneAbilitySource
): GameState {
  const player = getPlayerById(game, source.controllerId);
  const sourceCard = getCardById(game, source.sourceCardId);
  const sourceCardState = player?.liveZone.cardStates.get(source.sourceCardId);
  if (
    !player ||
    !sourceCard ||
    !player.liveZone.cardIds.includes(source.sourceCardId) ||
    sourceCardState?.face !== FaceState.FACE_UP
  ) {
    return game;
  }

  const abilityDefinitions = getQueuedMoveAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilitySourceZone.LIVE_CARD,
    TriggerCondition.ON_ENTER_LIVE_ZONE,
    source.event
  );
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    const pendingAbilityId = `${abilityId}:${source.sourceCardId}:${source.event.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.sourceCardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_LIVE_ZONE,
      eventIds: [source.event.eventId],
      metadata: {
        movedCardIds: [source.event.cardInstanceId],
        fromZone: source.event.fromZone,
        toZone: source.event.toZone,
        face: source.event.face,
      },
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.sourceCardId,
        timingId: pendingAbility.timingId,
        eventId: source.event.eventId,
        movedCardIds: [source.event.cardInstanceId],
        face: source.event.face,
      }
    );
  }

  return state;
}

function getQueuedMoveAbilityDefinitionsForCard(
  cardCode: string | undefined,
  sourceZone: CardAbilitySourceZone,
  triggerCondition: TriggerCondition,
  event: EnterHandEvent | EnterLiveZoneEvent
): readonly CardAbilityDefinition[] {
  return getCardAbilityDefinitionsForCardCode(cardCode).filter(
    (ability) =>
      ability.category === CardAbilityCategory.AUTO &&
      ability.sourceZone === sourceZone &&
      ability.triggerCondition === triggerCondition &&
      ability.queued &&
      ability.implemented &&
      doesCardMoveEventSatisfyAbilityDefinition(ability, event)
  );
}

function doesCardMoveEventSatisfyAbilityDefinition(
  ability: CardAbilityDefinition,
  event: EnterHandEvent | EnterLiveZoneEvent
): boolean {
  const triggerFromZones = ability.triggerFromZones ?? [event.fromZone];
  const triggerToZones = ability.triggerToZones ?? [event.toZone];
  return triggerFromZones.includes(event.fromZone) && triggerToZones.includes(event.toZone);
}

function doesCardMoveEventTargetAbilityZone(
  event: EnterHandEvent | EnterLiveZoneEvent,
  toZone: ZoneType
): boolean {
  return event.toZone === toZone;
}

function getAlreadyTriggeredEventIds(game: GameState): ReadonlySet<string> {
  return new Set(
    game.actionHistory
      .filter((action) => action.type === 'TRIGGER_ABILITY')
      .map((action) => action.payload.eventId)
      .filter((eventId): eventId is string => typeof eventId === 'string')
  );
}
