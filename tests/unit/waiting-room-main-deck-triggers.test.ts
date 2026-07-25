import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import type { CardAbilityDefinition } from '../../src/application/card-effects/ability-definition-types';
import {
  enqueueWaitingRoomCardsMovedToMainDeckCardEffects,
  enqueueUntriggeredWaitingRoomCardsMovedToMainDeckCardEffects,
  moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers,
  moveWaitingRoomCardsToDeckTopAndEnqueueTriggers,
  moveWaitingRoomCardToDeckPositionAndEnqueueTriggers,
  shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers,
} from '../../src/application/card-effects/runtime/waiting-room-main-deck-triggers';
import { processCheckTimingRuleActions } from '../../src/application/card-effects/runtime/check-timing-scheduler';
import { applyPendingRefreshForPlayer } from '../../src/application/effects/refresh';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const definitionLookupMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/application/card-effects/definitions/lookup', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../src/application/card-effects/definitions/lookup')
  >()),
  getCardAbilityDefinitionsForCardCode: definitionLookupMock,
}));

const cause = {
  kind: 'CARD_EFFECT' as const,
  playerId: 'p1',
  sourceCardId: 'source',
  abilityId: 'ability',
  pendingAbilityId: 'pending',
};

beforeEach(() => {
  definitionLookupMock.mockReset();
  definitionLookupMock.mockReturnValue([]);
});

function listenerDefinition(abilityId = 'test:waiting-room-main-deck-listener') {
  return {
    abilityId,
    baseCardCodes: ['TEST-LISTENER'],
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK,
    queued: true,
    implemented: true,
    effectText: 'test',
  } satisfies CardAbilityDefinition;
}

function listenerCard(cardCode: string, ownerId: string, instanceId: string) {
  const data: MemberCardData = {
    cardCode,
    name: instanceId,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, ownerId, instanceId);
}

function withZones(
  waitingRoomCardIds: readonly string[],
  mainDeckCardIds: readonly string[] = [],
  playerId = 'p1'
) {
  return updatePlayer(
    createGameState('waiting-room-main-deck', 'p1', 'P1', 'p2', 'P2'),
    playerId,
    (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [...waitingRoomCardIds] },
      mainDeck: { ...player.mainDeck, cardIds: [...mainDeckCardIds] },
    })
  );
}

function movementEvents(game: ReturnType<typeof createGameState>) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
}

describe('waiting-room to main-deck trigger boundary', () => {
  it('places an ordered batch on top and emits exactly one grouped event', () => {
    const result = moveWaitingRoomCardsToDeckTopAndEnqueueTriggers(
      withZones(['a', 'b', 'c'], ['deck']),
      'p1',
      ['b', 'a'],
      { candidateCardIds: ['a', 'b', 'c'], minCount: 2, maxCount: 2, cause }
    );

    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual(['b', 'a', 'deck']);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual(['c']);
    expect(movementEvents(result!.gameState)).toHaveLength(1);
    expect(result?.waitingRoomCardsMovedToMainDeckEvent).toMatchObject({
      playerId: 'p1',
      controllerId: 'p1',
      movedCardIds: ['b', 'a'],
      destination: { kind: 'TOP' },
      cause,
    });
  });

  it('preserves selected order at the bottom', () => {
    const result = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
      withZones(['a', 'b'], ['deck']),
      'p1',
      ['b', 'a'],
      { candidateCardIds: ['a', 'b'], minCount: 2, maxCount: 2, cause }
    );

    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual(['deck', 'b', 'a']);
    expect(result?.waitingRoomCardsMovedToMainDeckEvent?.destination).toEqual({
      kind: 'BOTTOM',
    });
  });

  it('records the requested and actual specific position', () => {
    const result = moveWaitingRoomCardToDeckPositionAndEnqueueTriggers(
      withZones(['wait'], ['d1', 'd2']),
      'p1',
      'wait',
      { candidateCardIds: ['wait'], positionFromTop: 4, cause }
    );

    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual(['d1', 'd2', 'wait']);
    expect(result?.waitingRoomCardsMovedToMainDeckEvent.destination).toEqual({
      kind: 'POSITION',
      positionFromTop: 4,
      insertIndex: 2,
    });
  });

  it('shuffles one batch to the bottom and reports the actual shuffled order', () => {
    const result = shuffleWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
      withZones(['a', 'b', 'c'], ['deck']),
      'p1',
      ['a', 'b', 'c'],
      cause
    );
    const moved = result?.movedCardIds ?? [];

    expect([...moved].sort()).toEqual(['a', 'b', 'c']);
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual(['deck', ...moved]);
    expect(result?.waitingRoomCardsMovedToMainDeckEvent?.destination).toEqual({
      kind: 'SHUFFLED_BOTTOM',
    });
    expect(movementEvents(result!.gameState)).toHaveLength(1);
  });

  it('does not emit for zero, duplicate, invalid, or stale selections', () => {
    const base = withZones(['a']);
    const zero = moveWaitingRoomCardsToDeckTopAndEnqueueTriggers(base, 'p1', [], {
      candidateCardIds: ['a'],
      minCount: 0,
      maxCount: 1,
      cause,
    });
    const duplicate = moveWaitingRoomCardsToDeckTopAndEnqueueTriggers(base, 'p1', ['a', 'a'], {
      candidateCardIds: ['a'],
      minCount: 2,
      maxCount: 2,
      cause,
    });
    const invalid = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(base, 'p1', ['x'], {
      candidateCardIds: ['a'],
      minCount: 1,
      maxCount: 1,
      cause,
    });
    const stale = moveWaitingRoomCardToDeckPositionAndEnqueueTriggers(base, 'p1', 'x', {
      candidateCardIds: ['x'],
      positionFromTop: 1,
      cause,
    });

    expect(zero?.gameState).toBe(base);
    expect(zero?.waitingRoomCardsMovedToMainDeckEvent).toBeUndefined();
    expect(duplicate).toBeNull();
    expect(invalid).toBeNull();
    expect(stale).toBeNull();
    expect(movementEvents(base)).toEqual([]);
  });

  it('uses the zone owner as trigger player while retaining the effect actor', () => {
    const result = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
      withZones(['opponent-card'], [], 'p2'),
      'p2',
      ['opponent-card'],
      {
        candidateCardIds: ['opponent-card'],
        minCount: 1,
        maxCount: 1,
        cause,
      }
    );

    expect(result?.waitingRoomCardsMovedToMainDeckEvent).toMatchObject({
      playerId: 'p2',
      controllerId: 'p1',
      triggerPlayerId: 'p2',
      cause,
    });
  });

  it('queues the owner listener, not the effect actor listener, for a cross-player move', () => {
    const actorListener = listenerCard('ACTOR-LISTENER', 'p1', 'actor-listener');
    const ownerListener = listenerCard('OWNER-LISTENER', 'p2', 'owner-listener');
    let game = registerCards(withZones(['opponent-card'], [], 'p2'), [
      actorListener,
      ownerListener,
    ]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        actorListener.instanceId
      ),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        ownerListener.instanceId
      ),
    }));
    definitionLookupMock.mockImplementation((cardCode: string) =>
      cardCode === 'ACTOR-LISTENER' || cardCode === 'OWNER-LISTENER'
        ? [listenerDefinition(`test:${cardCode}`)]
        : []
    );

    const result = moveWaitingRoomCardsToDeckBottomAndEnqueueTriggers(
      game,
      'p2',
      ['opponent-card'],
      {
        candidateCardIds: ['opponent-card'],
        minCount: 1,
        maxCount: 1,
        cause,
      }
    )!;

    expect(result.gameState.pendingAbilities).toHaveLength(1);
    expect(result.gameState.pendingAbilities[0]).toMatchObject({
      sourceCardId: ownerListener.instanceId,
      controllerId: 'p2',
    });
  });

  it('marks a no-listener event dispatched so a later listener cannot consume history', () => {
    const first = moveWaitingRoomCardsToDeckTopAndEnqueueTriggers(
      withZones(['wait']),
      'p1',
      ['wait'],
      { candidateCardIds: ['wait'], minCount: 1, maxCount: 1, cause }
    )!;
    expect(
      first.gameState.actionHistory.filter((action) => action.type === 'DISPATCH_TRIGGER_EVENT')
    ).toHaveLength(1);

    const listener = listenerCard('TEST-LISTENER', 'p1', 'listener');
    let withListener = registerCards(first.gameState, [listener]);
    withListener = updatePlayer(withListener, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, listener.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    definitionLookupMock.mockReturnValue([listenerDefinition('test:historical-listener')]);

    const rescanned = enqueueUntriggeredWaitingRoomCardsMovedToMainDeckCardEffects(withListener);
    expect(rescanned).toBe(withListener);
    expect(rescanned.pendingAbilities).toEqual([]);
  });

  it('dispatches one grouped refresh event to the owner listener exactly once', () => {
    const listener = listenerCard('TEST-LISTENER', 'p1', 'listener');
    let game = registerCards(withZones(['wait-a', 'wait-b']), [listener]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, listener.instanceId),
    }));
    definitionLookupMock.mockReturnValue([listenerDefinition()]);

    const ruleResult = processCheckTimingRuleActions(game);
    expect(ruleResult.waitingRoomCardsMovedToMainDeckEvents).toHaveLength(1);
    const firstDispatch = enqueueWaitingRoomCardsMovedToMainDeckCardEffects(
      ruleResult.gameState,
      ruleResult.waitingRoomCardsMovedToMainDeckEvents
    );
    const repeatedDispatch = enqueueWaitingRoomCardsMovedToMainDeckCardEffects(
      firstDispatch,
      ruleResult.waitingRoomCardsMovedToMainDeckEvents
    );

    expect(firstDispatch.pendingAbilities).toHaveLength(1);
    expect(repeatedDispatch.pendingAbilities).toHaveLength(1);
    expect(
      repeatedDispatch.actionHistory.filter((action) => action.type === 'DISPATCH_TRIGGER_EVENT')
    ).toHaveLength(1);
  });

  it('dispatches a refresh emitted inside an effect before a later scheduler log start', () => {
    const refreshed = applyPendingRefreshForPlayer(withZones(['wait']), 'p1');
    expect(movementEvents(refreshed)).toHaveLength(1);
    expect(refreshed.actionHistory.some((action) => action.type === 'DISPATCH_TRIGGER_EVENT')).toBe(
      false
    );

    const dispatched = resolvePendingCardEffects(refreshed).gameState;
    expect(
      dispatched.actionHistory.filter((action) => action.type === 'DISPATCH_TRIGGER_EVENT')
    ).toHaveLength(1);
  });
});
