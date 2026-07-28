import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardAbilityDefinition } from '../../src/application/card-effects/ability-definition-types';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  enqueueEnergyPlacedByCardEffectCardEffects,
  enqueueUntriggeredEnergyPlacedByCardEffectCardEffects,
} from '../../src/application/card-effects/runtime/energy-placement-triggers';
import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createEnergyPlacedByCardEffectEvent } from '../../src/domain/events/game-events';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const definitionLookupMock = vi.hoisted(() => vi.fn());
const canUseAbilityThisTurnMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/application/card-effects/definitions/lookup', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../src/application/card-effects/definitions/lookup')
  >()),
  getCardAbilityDefinitionsForCardCode: definitionLookupMock,
}));

vi.mock(
  '../../src/application/card-effects/runtime/ability-turn-limit',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../src/application/card-effects/runtime/ability-turn-limit')
    >()),
    canUseAbilityThisTurn: canUseAbilityThisTurnMock,
  })
);

const P1 = 'p1';
const P2 = 'p2';

beforeEach(() => {
  definitionLookupMock.mockReset();
  definitionLookupMock.mockReturnValue([]);
  canUseAbilityThisTurnMock.mockReset();
  canUseAbilityThisTurnMock.mockReturnValue(true);
});

function listenerDefinition(abilityId: string): CardAbilityDefinition {
  return {
    abilityId,
    baseCardCodes: ['TEST-LISTENER'],
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT,
    queued: true,
    implemented: true,
    skipQueueWhenTurnLimitReached: true,
    perTurnLimit: 2,
    effectText: 'test',
  };
}

function member(cardCode: string, instanceId: string) {
  const data: MemberCardData = {
    cardCode,
    name: instanceId,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
  return createCardInstance(data, P1, instanceId);
}

function setup(
  listenerEntries: readonly { cardCode: string; id: string; slot: SlotPosition }[] = []
) {
  const energy = createCardInstance(
    { cardCode: 'TEST-E', name: 'energy', cardType: CardType.ENERGY },
    P1,
    'energy'
  );
  const listeners = listenerEntries.map((entry) => member(entry.cardCode, entry.id));
  let game = registerCards(createGameState('energy-dispatch', P1, 'P1', P2, 'P2'), [
    energy,
    ...listeners,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    for (const entry of listenerEntries) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.id, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      energyZone: addCardToStatefulZone(player.energyZone, energy.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
    };
  });
  const event = createEnergyPlacedByCardEffectEvent(
    P1,
    [energy.instanceId],
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: P1,
      sourceCardId: 'effect-source',
      abilityId: 'effect-ability',
    }
  );
  return { game: emitGameEvent(game, event), event };
}

function dispatchActions(game: GameState) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'DISPATCH_TRIGGER_EVENT' &&
      action.payload.triggerCondition === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
  );
}

describe('energy placement trigger dispatch ledger', () => {
  it('consumes a turn-limited event even when no pending ability can be queued', () => {
    const { game, event } = setup([
      { cardCode: 'LIMITED-LISTENER', id: 'limited', slot: SlotPosition.CENTER },
    ]);
    definitionLookupMock.mockReturnValue([listenerDefinition('test:limited')]);
    canUseAbilityThisTurnMock.mockReturnValue(false);

    const dispatched = enqueueEnergyPlacedByCardEffectCardEffects(game, [event]);

    expect(dispatched.pendingAbilities).toEqual([]);
    expect(dispatchActions(dispatched)).toHaveLength(1);
    expect(dispatchActions(dispatched)[0]?.payload.eventId).toBe(event.eventId);

    canUseAbilityThisTurnMock.mockReturnValue(true);
    const nextTurn = { ...dispatched, turnCount: dispatched.turnCount + 1 };
    const rescanned = enqueueUntriggeredEnergyPlacedByCardEffectCardEffects(nextTurn);

    expect(rescanned).toBe(nextTurn);
    expect(rescanned.pendingAbilities).toEqual([]);
    expect(dispatchActions(rescanned)).toHaveLength(1);
  });

  it('is idempotent across repeated exact dispatch and history fallback scans', () => {
    const { game, event } = setup([
      { cardCode: 'LISTENER', id: 'listener', slot: SlotPosition.CENTER },
    ]);
    definitionLookupMock.mockReturnValue([listenerDefinition('test:idempotent')]);

    const first = enqueueEnergyPlacedByCardEffectCardEffects(game, [event]);
    const repeatedExact = enqueueEnergyPlacedByCardEffectCardEffects(first, [event]);
    const rescanned = enqueueUntriggeredEnergyPlacedByCardEffectCardEffects(repeatedExact);

    expect(first.pendingAbilities).toHaveLength(1);
    expect(repeatedExact).toBe(first);
    expect(rescanned).toBe(first);
    expect(dispatchActions(rescanned)).toHaveLength(1);
  });

  it('marks an event with no listener so a later listener cannot consume history', () => {
    const { game, event } = setup();
    const dispatched = enqueueEnergyPlacedByCardEffectCardEffects(game, [event]);
    expect(dispatchActions(dispatched)).toHaveLength(1);

    const lateListener = member('LATE-LISTENER', 'late-listener');
    let withListener = registerCards(dispatched, [lateListener]);
    withListener = updatePlayer(withListener, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        lateListener.instanceId
      ),
    }));
    definitionLookupMock.mockReturnValue([listenerDefinition('test:late-listener')]);

    const rescanned = enqueueUntriggeredEnergyPlacedByCardEffectCardEffects(withListener);

    expect(rescanned).toBe(withListener);
    expect(rescanned.pendingAbilities).toEqual([]);
  });

  it('queues every legal listener before writing one dispatch action', () => {
    const { game, event } = setup([
      { cardCode: 'LEFT-LISTENER', id: 'left-listener', slot: SlotPosition.LEFT },
      { cardCode: 'RIGHT-LISTENER', id: 'right-listener', slot: SlotPosition.RIGHT },
    ]);
    definitionLookupMock.mockImplementation((cardCode: string) => [
      listenerDefinition(`test:${cardCode}`),
    ]);

    const dispatched = enqueueEnergyPlacedByCardEffectCardEffects(game, [event]);

    expect(dispatched.pendingAbilities.map((ability) => ability.sourceCardId)).toEqual([
      'left-listener',
      'right-listener',
    ]);
    expect(
      dispatched.actionHistory.filter((action) => action.type === 'TRIGGER_ABILITY')
    ).toHaveLength(2);
    expect(dispatchActions(dispatched)).toHaveLength(1);
    expect(dispatched.actionHistory.at(-1)?.type).toBe('DISPATCH_TRIGGER_EVENT');
  });

  it('marks empty and stale placement payloads dispatched', () => {
    const { game } = setup([
      { cardCode: 'STALE-LISTENER', id: 'stale-listener', slot: SlotPosition.CENTER },
    ]);
    definitionLookupMock.mockReturnValue([listenerDefinition('test:stale-listener')]);
    const emptyEvent = createEnergyPlacedByCardEffectEvent(P1, [], OrientationState.WAITING, {
      kind: 'CARD_EFFECT',
      playerId: P1,
      sourceCardId: 'effect-source',
      abilityId: 'effect-ability',
    });
    const staleEvent = createEnergyPlacedByCardEffectEvent(
      P1,
      ['missing-energy'],
      OrientationState.WAITING,
      {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: 'effect-source',
        abilityId: 'effect-ability',
      }
    );
    const withEvents = emitGameEvent(emitGameEvent(game, emptyEvent), staleEvent);

    const dispatched = enqueueEnergyPlacedByCardEffectCardEffects(withEvents, [
      emptyEvent,
      staleEvent,
    ]);

    expect(dispatched.pendingAbilities).toEqual([]);
    expect(dispatchActions(dispatched)).toHaveLength(2);
  });
});
