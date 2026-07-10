import { describe, expect, it } from 'vitest';
import { createGameState } from '../../src/domain/entities/game';
import { CardAbilityCategory, CardAbilitySourceZone } from '../../src/application/card-effects/ability-definition-types';
import {
  isLiveSuccessAbilityAvailable,
  registerLiveSuccessAbilityAvailabilityGate,
} from '../../src/application/card-effects/runtime/live-success-ability-availability-gates';

const BASE_CONTEXT = {
  game: createGameState('live-success-gate', 'p1', 'P1', 'p2', 'P2'),
  controllerId: 'p1',
  sourceCardId: 'source',
  sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
  abilityDefinition: {
    abilityId: 'test:unregistered',
    category: CardAbilityCategory.LIVE_SUCCESS,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: true,
    implemented: true,
    effectText: 'test',
  },
} as const;

describe('LIVE_SUCCESS ability availability gates', () => {
  it('defaults to allowing unregistered abilities and obeys the registered predicate', () => {
    expect(isLiveSuccessAbilityAvailable(BASE_CONTEXT)).toBe(true);

    registerLiveSuccessAbilityAvailabilityGate('test:allows', () => true);
    registerLiveSuccessAbilityAvailabilityGate('test:blocks', () => false);

    expect(
      isLiveSuccessAbilityAvailable({
        ...BASE_CONTEXT,
        abilityDefinition: { ...BASE_CONTEXT.abilityDefinition, abilityId: 'test:allows' },
      })
    ).toBe(true);
    expect(
      isLiveSuccessAbilityAvailable({
        ...BASE_CONTEXT,
        abilityDefinition: { ...BASE_CONTEXT.abilityDefinition, abilityId: 'test:blocks' },
      })
    ).toBe(false);
  });
});
