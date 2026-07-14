import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../domain/entities/game.js';
import type { EnergyMovedToDeckEvent } from '../../../domain/events/game-events.js';
import { SlotPosition, TriggerCondition } from '../../../shared/types/enums.js';
import { CardAbilityCategory, CardAbilitySourceZone } from '../ability-definition-types.js';
import { getCardAbilityDefinitionsForCardCode } from '../definitions/lookup.js';
import { hasAbilityInstance } from './ability-instance.js';

const MEMBER_SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
export function getLatestEnergyMovedToDeckEvents(
  game: GameState
): readonly EnergyMovedToDeckEvent[] {
  const events = game.eventLog
    .map((x) => x.event)
    .filter(
      (e): e is EnergyMovedToDeckEvent =>
        e.eventType === TriggerCondition.ON_ENERGY_MOVED_TO_DECK && 'movedEnergyCardIds' in e
    );
  const latest = events.at(-1);
  return latest ? [latest] : [];
}
export function enqueueEnergyMovedToDeckCardEffects(
  game: GameState,
  events: readonly EnergyMovedToDeckEvent[]
): GameState {
  let state = game;
  for (const event of events) {
    const player = getPlayerById(state, event.playerId);
    if (!player || event.movedEnergyCardIds.length === 0) continue;
    for (const sourceSlot of MEMBER_SLOTS) {
      const sourceCardId = player.memberSlots.slots[sourceSlot];
      const source = sourceCardId ? getCardById(state, sourceCardId) : null;
      if (!sourceCardId || !source) continue;
      const definitions = getCardAbilityDefinitionsForCardCode(source.data.cardCode).filter(
        (d) =>
          d.category === CardAbilityCategory.AUTO &&
          d.sourceZone === CardAbilitySourceZone.STAGE_MEMBER &&
          d.queued &&
          d.implemented &&
          d.triggerCondition === TriggerCondition.ON_ENERGY_MOVED_TO_DECK &&
          (!d.requiredSourceSlots || d.requiredSourceSlots.includes(sourceSlot))
      );
      for (const definition of definitions) {
        const used = state.actionHistory.filter(
          (a) =>
            a.type === 'RESOLVE_ABILITY' &&
            a.playerId === player.id &&
            a.payload.abilityId === definition.abilityId &&
            a.payload.sourceCardId === sourceCardId &&
            a.payload.step === 'ABILITY_USE' &&
            a.payload.turnCount === state.turnCount
        ).length;
        if (
          definition.skipQueueWhenTurnLimitReached &&
          definition.perTurnLimit !== undefined &&
          used >= definition.perTurnLimit
        )
          continue;
        const id = `${definition.abilityId}:${sourceCardId}:${event.eventId}`;
        if (hasAbilityInstance(state, id)) continue;
        const pending: PendingAbilityState = {
          id,
          abilityId: definition.abilityId,
          sourceCardId,
          controllerId: player.id,
          mandatory: true,
          timingId: TriggerCondition.ON_ENERGY_MOVED_TO_DECK,
          eventIds: [event.eventId],
          sourceSlot,
          metadata: {
            triggerKind: 'ENERGY_MOVED_TO_DECK',
            eventId: event.eventId,
            movedEnergyCardIds: event.movedEnergyCardIds,
            causedByPlayerId: event.cause.playerId,
          },
        };
        state = addAction(
          { ...state, pendingAbilities: [...state.pendingAbilities, pending] },
          'TRIGGER_ABILITY',
          player.id,
          {
            pendingAbilityId: id,
            abilityId: definition.abilityId,
            sourceCardId,
            eventId: event.eventId,
            movedEnergyCardIds: event.movedEnergyCardIds,
          }
        );
      }
    }
  }
  return state;
}
