import { describe, expect, it } from 'vitest';
import {
  enqueueResolvedAbilityObserverCardEffects,
  registerResolvedAbilityObserver,
} from '../../src/application/card-effects/runtime/resolved-ability-observers';
import { addAction, createGameState } from '../../src/domain/entities/game';
import { TriggerCondition } from '../../src/shared/types/enums';

describe('resolved ability observers', () => {
  it('still observes the latest resolution when a trigger dispatch audit is the tail action', () => {
    const abilityId = 'test:resolved-before-dispatch-audit';
    let invocationCount = 0;
    registerResolvedAbilityObserver((game, { resolvedAction }) => {
      if (resolvedAction.payload.abilityId !== abilityId) {
        return game;
      }
      invocationCount += 1;
      return addAction(game, 'RULE_ACTION', 'p1', {
        step: 'TEST_RESOLVED_ABILITY_OBSERVED',
        abilityId,
      });
    });

    let game = createGameState('resolved-observer-dispatch', 'p1', 'P1', 'p2', 'P2');
    game = addAction(game, 'RESOLVE_ABILITY', 'p1', {
      abilityId,
      sourceCardId: 'source',
      step: 'TEST_RESOLUTION',
    });
    game = addAction(game, 'DISPATCH_TRIGGER_EVENT', 'p1', {
      eventId: 'energy-event',
      triggerCondition: TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
    });

    const observed = enqueueResolvedAbilityObserverCardEffects(game);

    expect(observed.actionHistory.at(-1)).toMatchObject({
      type: 'RULE_ACTION',
      payload: {
        step: 'TEST_RESOLVED_ABILITY_OBSERVED',
        abilityId,
      },
    });

    const laterDispatch = addAction(observed, 'DISPATCH_TRIGGER_EVENT', 'p1', {
      eventId: 'later-energy-event',
      triggerCondition: TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
    });
    const notRepeated = enqueueResolvedAbilityObserverCardEffects(laterDispatch);

    expect(notRepeated).toBe(laterDispatch);
    expect(invocationCount).toBe(1);
  });
});
