import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import type { EnergyPlacedByCardEffectEvent } from '../../../domain/events/game-events.js';
import { SlotPosition, TriggerCondition } from '../../../shared/types/enums.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';
import { hasAbilityInstance } from './ability-instance.js';
import { canUseAbilityThisTurn } from './ability-turn-limit.js';
import {
  getDispatchedTriggerEventIds,
  markTriggerEventDispatched,
} from './trigger-event-dispatch.js';

const MEMBER_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

export function getEnergyPlacedByCardEffectEventsFromLog(
  game: GameState
): readonly EnergyPlacedByCardEffectEvent[] {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is EnergyPlacedByCardEffectEvent =>
        event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
    );
}

export function getLatestEnergyPlacedByCardEffectEventsFromLog(
  game: GameState
): readonly EnergyPlacedByCardEffectEvent[] {
  const events = getEnergyPlacedByCardEffectEventsFromLog(game);
  const latestEvent = events.at(-1);
  return latestEvent ? [latestEvent] : [];
}

export function enqueueUntriggeredEnergyPlacedByCardEffectCardEffects(
  game: GameState,
  predicate: (event: EnergyPlacedByCardEffectEvent) => boolean = () => true
): GameState {
  const dispatchedEventIds = getDispatchedTriggerEventIds(
    game,
    TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
  );
  return enqueueEnergyPlacedByCardEffectCardEffects(
    game,
    getEnergyPlacedByCardEffectEventsFromLog(game).filter(
      (event) => predicate(event) && !dispatchedEventIds.has(event.eventId)
    )
  );
}

export function enqueueEnergyPlacedByCardEffectCardEffects(
  game: GameState,
  events: readonly EnergyPlacedByCardEffectEvent[]
): GameState {
  let state = game;
  const dispatchedEventIds = getDispatchedTriggerEventIds(
    game,
    TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
  );

  for (const event of events) {
    if (dispatchedEventIds.has(event.eventId)) {
      continue;
    }

    const player = getPlayerById(state, event.targetPlayerId);
    if (player && event.placedEnergyCardIds.length > 0) {
      for (const sourceSlot of MEMBER_SLOTS) {
        const sourceCardId = player.memberSlots.slots[sourceSlot];
        if (!sourceCardId) {
          continue;
        }
        state = enqueueSingleEnergyPlacedByCardEffectCardEffect(state, {
          sourceCardId,
          controllerId: player.id,
          sourceSlot,
          event,
        });
      }
    }

    state = markTriggerEventDispatched(state, {
      eventId: event.eventId,
      triggerCondition: TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
      playerId: event.targetPlayerId,
    });
    dispatchedEventIds.add(event.eventId);
  }

  return state;
}

interface EnergyPlacedByCardEffectAbilitySource {
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition;
  readonly event: EnergyPlacedByCardEffectEvent;
}

function enqueueSingleEnergyPlacedByCardEffectCardEffect(
  game: GameState,
  source: EnergyPlacedByCardEffectAbilitySource
): GameState {
  const player = getPlayerById(game, source.controllerId);
  const sourceCard = getCardById(game, source.sourceCardId);
  if (
    !player ||
    !sourceCard ||
    player.memberSlots.slots[source.sourceSlot] !== source.sourceCardId ||
    !source.event.placedEnergyCardIds.every((cardId) => player.energyZone.cardIds.includes(cardId))
  ) {
    return game;
  }

  const abilityDefinitions = getCardAbilityDefinitionsForCardCode(sourceCard.data.cardCode).filter(
    (ability) =>
      ability.category === CardAbilityCategory.AUTO &&
      ability.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
      ability.queued &&
      ability.implemented &&
      ability.triggerCondition === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT &&
      (!ability.requiredSourceSlots ||
        ability.requiredSourceSlots.length === 0 ||
        ability.requiredSourceSlots.includes(source.sourceSlot)) &&
      doesEnergyPlacedByCardEffectEventSatisfyAbilityDefinition(ability, source.event)
  );

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (
      abilityDefinition.skipQueueWhenTurnLimitReached === true &&
      !canUseAbilityThisTurn(state, source.controllerId, abilityId, source.sourceCardId)
    ) {
      continue;
    }

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
      timingId: TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
      eventIds: [source.event.eventId],
      sourceSlot: source.sourceSlot,
      metadata: {
        triggerKind: 'ENERGY_PLACED_BY_CARD_EFFECT',
        eventId: source.event.eventId,
        targetPlayerId: source.event.targetPlayerId,
        placedEnergyCardIds: source.event.placedEnergyCardIds,
        orientation: source.event.orientation,
        causedByKind: source.event.cause.kind,
        causedByPlayerId: source.event.cause.playerId,
        causedBySourceCardId: source.event.cause.sourceCardId,
        causedByAbilityId: source.event.cause.abilityId ?? null,
        causedByPendingAbilityId: source.event.cause.pendingAbilityId ?? null,
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
        sourceSlot: source.sourceSlot,
        eventId: source.event.eventId,
        targetPlayerId: source.event.targetPlayerId,
        placedEnergyCardIds: source.event.placedEnergyCardIds,
        orientation: source.event.orientation,
        causedByPlayerId: source.event.cause.playerId,
        causedBySourceCardId: source.event.cause.sourceCardId,
        causedByAbilityId: source.event.cause.abilityId ?? null,
      }
    );
  }

  return state;
}

function doesEnergyPlacedByCardEffectEventSatisfyAbilityDefinition(
  ability: CardAbilityDefinition,
  event: EnergyPlacedByCardEffectEvent
): boolean {
  if (ability.energyPlacementCause === 'OWN_CARD_EFFECT') {
    return event.cause.playerId === event.targetPlayerId;
  }
  return true;
}
