import { describe, expect, it } from 'vitest';
import {
  getDispatchedTriggerEventIds,
  markTriggerEventDispatched,
} from '../../src/application/card-effects/runtime/trigger-event-dispatch';
import { createGameState } from '../../src/domain/entities/game';
import { TriggerCondition } from '../../src/shared/types/enums';

describe('trigger event dispatch ledger', () => {
  it('namespaces dispatch records by trigger condition and records each pair once', () => {
    const game = createGameState('trigger-event-dispatch', 'p1', 'P1', 'p2', 'P2');
    const energyDispatched = markTriggerEventDispatched(game, {
      eventId: 'shared-event-id',
      triggerCondition: TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
      playerId: 'p1',
    });
    const repeatedEnergyDispatch = markTriggerEventDispatched(energyDispatched, {
      eventId: 'shared-event-id',
      triggerCondition: TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
      playerId: 'p1',
    });
    const waitingRoomDispatched = markTriggerEventDispatched(repeatedEnergyDispatch, {
      eventId: 'shared-event-id',
      triggerCondition: TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK,
      playerId: 'p1',
    });

    expect(repeatedEnergyDispatch).toBe(energyDispatched);
    expect(
      getDispatchedTriggerEventIds(
        waitingRoomDispatched,
        TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )
    ).toEqual(new Set(['shared-event-id']));
    expect(
      getDispatchedTriggerEventIds(
        waitingRoomDispatched,
        TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      )
    ).toEqual(new Set(['shared-event-id']));
    expect(
      waitingRoomDispatched.actionHistory.filter(
        (action) => action.type === 'DISPATCH_TRIGGER_EVENT'
      )
    ).toHaveLength(2);
  });
});
