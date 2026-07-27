import {
  addAction,
  emitGameEvent,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import {
  createEnergyPlacedBelowMemberEvent,
  type CardEffectCause,
  type EnergyPlacedBelowMemberEvent,
} from '../../../domain/events/game-events.js';
import { SlotPosition, TriggerCondition } from '../../../shared/types/enums.js';
import {
  stackEnergyFromEnergyZoneBelowMember,
  type StackEnergyBelowResult,
} from '../../effects/energy-below.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';
import { capturePendingAbilitySourceLifecycles } from './ability-source-lifecycle.js';
import { hasAbilityInstance } from './ability-instance.js';
import { canUseAbilityThisTurn } from './ability-turn-limit.js';
import { getDispatchedTriggerEventIds, markTriggerEventDispatched } from './trigger-event-dispatch.js';

const MEMBER_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

export interface StackEnergyBelowAndEnqueueResult extends StackEnergyBelowResult {
  readonly energyPlacedBelowMemberEvent: EnergyPlacedBelowMemberEvent;
}

export function stackEnergyFromEnergyZoneBelowMemberAndEnqueueTriggers(
  game: GameState,
  playerId: string,
  targetSlot: SlotPosition,
  count: number,
  cause: CardEffectCause
): StackEnergyBelowAndEnqueueResult | null {
  const targetMemberCardId = getPlayerById(game, playerId)?.memberSlots.slots[targetSlot] ?? null;
  if (!targetMemberCardId || count <= 0) return null;
  const stacked = stackEnergyFromEnergyZoneBelowMember(game, playerId, targetSlot, count);
  if (!stacked || stacked.stackedEnergyCardIds.length === 0) return null;
  const event = createEnergyPlacedBelowMemberEvent(
    playerId,
    stacked.stackedEnergyCardIds,
    targetMemberCardId,
    targetSlot,
    cause
  );
  const emitted = emitGameEvent(stacked.gameState, event);
  const enqueued = enqueueEnergyPlacedBelowMemberCardEffects(emitted, [event]);
  return {
    gameState: capturePendingAbilitySourceLifecycles(enqueued),
    stackedEnergyCardIds: stacked.stackedEnergyCardIds,
    energyPlacedBelowMemberEvent: event,
  };
}

export function getEnergyPlacedBelowMemberEventsFromLog(
  game: GameState
): readonly EnergyPlacedBelowMemberEvent[] {
  return game.eventLog.map((entry) => entry.event).filter(
    (event): event is EnergyPlacedBelowMemberEvent =>
      event.eventType === TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER
  );
}

export function enqueueUntriggeredEnergyPlacedBelowMemberCardEffects(game: GameState): GameState {
  const dispatched = getDispatchedTriggerEventIds(
    game,
    TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER
  );
  return enqueueEnergyPlacedBelowMemberCardEffects(
    game,
    getEnergyPlacedBelowMemberEventsFromLog(game).filter((event) => !dispatched.has(event.eventId))
  );
}

export function enqueueEnergyPlacedBelowMemberCardEffects(
  game: GameState,
  events: readonly EnergyPlacedBelowMemberEvent[]
): GameState {
  let state = game;
  const dispatched = getDispatchedTriggerEventIds(
    game,
    TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER
  );
  for (const event of events) {
    if (dispatched.has(event.eventId)) continue;
    const player = getPlayerById(state, event.playerId);
    if (player && event.energyCardIds.length > 0) {
      for (const sourceSlot of MEMBER_SLOTS) {
        const sourceCardId = player.memberSlots.slots[sourceSlot];
        if (!sourceCardId) continue;
        const sourceCard = getCardById(state, sourceCardId);
        if (!sourceCard) continue;
        const definitions = getCardAbilityDefinitionsForCardCode(sourceCard.data.cardCode).filter(
          (ability) =>
            ability.category === CardAbilityCategory.AUTO &&
            ability.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
            ability.queued &&
            ability.implemented &&
            ability.triggerCondition === TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER &&
            (!ability.requiredSourceSlots ||
              ability.requiredSourceSlots.length === 0 ||
              ability.requiredSourceSlots.includes(sourceSlot))
        );
        for (const ability of definitions) {
          if (
            ability.skipQueueWhenTurnLimitReached === true &&
            !canUseAbilityThisTurn(state, player.id, ability.abilityId, sourceCardId)
          ) continue;
          const pendingAbilityId = `${ability.abilityId}:${sourceCardId}:${event.eventId}`;
          if (hasAbilityInstance(state, pendingAbilityId)) continue;
          const pending: PendingAbilityState = {
            id: pendingAbilityId,
            abilityId: ability.abilityId,
            sourceCardId,
            controllerId: player.id,
            mandatory: true,
            timingId: TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER,
            eventIds: [event.eventId],
            sourceSlot,
            metadata: {
              triggerKind: 'ENERGY_PLACED_BELOW_MEMBER',
              eventId: event.eventId,
              energyCardIds: event.energyCardIds,
              targetMemberCardId: event.targetMemberCardId,
              targetSlot: event.targetSlot,
              fromZone: event.fromZone,
              toZone: event.toZone,
              cause: event.cause,
            },
          };
          state = addAction(
            { ...state, pendingAbilities: [...state.pendingAbilities, pending] },
            'TRIGGER_ABILITY',
            player.id,
            {
              pendingAbilityId,
              abilityId: ability.abilityId,
              sourceCardId,
              timingId: pending.timingId,
              eventId: event.eventId,
            }
          );
        }
      }
    }
    state = markTriggerEventDispatched(state, {
      eventId: event.eventId,
      triggerCondition: TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER,
      playerId: event.playerId,
    });
    dispatched.add(event.eventId);
  }
  return state;
}
