import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCardInstance, createHeartIcon, type MemberCardData } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import {
  moveBottomDeckCardsToWaitingRoom,
  moveBottomDeckCardsToWaitingRoomWithRefresh,
} from '../../src/application/effects/look-top';
import {
  moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers,
} from '../../src/application/card-effects/runtime/main-deck-waiting-room-triggers';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../src/application/card-effects/runtime/enter-waiting-room-triggers';
import { CardType, HeartColor, TriggerCondition, ZoneType } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

afterEach(() => {
  vi.restoreAllMocks();
});

function member(id: string) {
  const data: MemberCardData = {
    cardCode: id,
    name: id,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
  return createCardInstance(data, P1, id);
}

function setup(mainDeckIds: readonly string[], waitingRoomIds: readonly string[] = []) {
  const ids = [...new Set([...mainDeckIds, ...waitingRoomIds])];
  let game = registerCards(
    createGameState('bottom-deck-waiting-room', P1, 'P1', P2, 'P2'),
    ids.map(member)
  );
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [...mainDeckIds] },
    waitingRoom: { ...player.waitingRoom, cardIds: [...waitingRoomIds] },
  }));
  return game;
}

describe('bottom-deck direct mill helper', () => {
  it.each([0, -2])('keeps a non-empty deck unchanged when primitive count is %i', (count) => {
    const game = setup(['top', 'middle', 'bottom'], ['waiting']);
    const result = moveBottomDeckCardsToWaitingRoom(game, P1, count);
    expect(result).toEqual({ gameState: game, movedCardIds: [] });
    expect(result?.gameState).toBe(game);
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual(['top', 'middle', 'bottom']);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual(['waiting']);
    expect(result?.gameState.eventLog).toEqual([]);
    expect(result?.gameState.actionHistory).toEqual([]);
  });

  it('moves positive primitive counts from the array tail with the lowest card first', () => {
    const game = setup(['top', 'a', 'b', 'bottom']);
    const result = moveBottomDeckCardsToWaitingRoom(game, P1, 3);
    expect(result?.movedCardIds).toEqual(['bottom', 'b', 'a']);
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual(['top']);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual(['bottom', 'b', 'a']);
  });

  it('treats index 0 as deck top and returns one bottom card exactly', () => {
    const game = setup(['top', 'middle', 'bottom']);
    const result = moveBottomDeckCardsToWaitingRoomWithRefresh(game, P1, 1);
    expect(result?.movedCardIds).toEqual(['bottom']);
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual(['top', 'middle']);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual(['bottom']);
  });

  it('returns three cards in their real bottom-removal order', () => {
    const game = setup(['top', 'a', 'b', 'bottom']);
    const result = moveBottomDeckCardsToWaitingRoomWithRefresh(game, P1, 3);
    expect(result?.movedCardIds).toEqual(['bottom', 'b', 'a']);
  });

  it('handles a deck whose size exactly equals the requested count with top-helper refresh semantics', () => {
    const game = setup(['top', 'middle', 'bottom']);
    const result = moveBottomDeckCardsToWaitingRoomWithRefresh(game, P1, 3);
    expect(result?.movedCardIds).toEqual(['bottom', 'middle', 'top']);
    expect(result?.refreshCount).toBe(1);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([]);
    expect(result?.gameState.players[0].mainDeck.cardIds).toHaveLength(3);
  });

  it('continues from the refreshed deck bottom without counting refresh-only cards as moved', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: Uint32Array) => {
      array[0] = 0;
      return array;
    }) as typeof globalThis.crypto.getRandomValues);
    const game = setup(['initial-bottom'], ['refresh-a', 'refresh-b', 'refresh-c']);
    const result = moveBottomDeckCardsToWaitingRoomWithRefresh(game, P1, 3);
    expect(result?.refreshCount).toBe(1);
    expect(result?.movedCardIds).toEqual(['initial-bottom', 'refresh-a', 'initial-bottom']);
    expect(result?.gameState.players[0].mainDeck.cardIds).toEqual(['refresh-b', 'refresh-c']);
    expect(result?.gameState.players[0].waitingRoom.cardIds).toEqual([
      'refresh-a',
      'initial-bottom',
    ]);
    expect(result?.movedCardIds).not.toContain('refresh-b');
    expect(result?.movedCardIds).not.toContain('refresh-c');
  });

  it('returns zero without an event or trigger when neither deck nor waiting room can provide cards', () => {
    const game = setup([]);
    let calls = 0;
    const enqueue: EnqueueTriggeredCardEffectsForEnterWaitingRoom = (state) => {
      calls += 1;
      return state;
    };
    const result = moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
      game,
      P1,
      3,
      enqueue
    );
    expect(result?.movedCardIds).toEqual([]);
    expect(result?.gameState.eventLog).toEqual([]);
    expect(calls).toBe(0);
  });

  it('emits and enqueues one grouped standard event with exact card-effect cause', () => {
    const game = setup(['top', 'a', 'b', 'bottom']);
    const calls: unknown[] = [];
    const enqueue: EnqueueTriggeredCardEffectsForEnterWaitingRoom = (
      state,
      triggerConditions,
      options
    ) => {
      calls.push({ triggerConditions, events: options?.enterWaitingRoomEvents });
      return state;
    };
    const cause = {
      kind: 'CARD_EFFECT' as const,
      playerId: P1,
      sourceCardId: 'source',
      abilityId: 'ability',
      pendingAbilityId: 'pending',
    };
    const result = moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
      game,
      P1,
      3,
      enqueue,
      { cause }
    );
    expect(result?.movedCardIds).toEqual(['bottom', 'b', 'a']);
    expect(calls).toHaveLength(1);
    const event = result?.gameState.eventLog.at(-1)?.event;
    expect(event).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
      cardInstanceId: 'bottom',
      cardInstanceIds: ['bottom', 'b', 'a'],
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
      ownerId: P1,
      controllerId: P1,
      cause,
    });
    expect(calls).toEqual([
      {
        triggerConditions: [TriggerCondition.ON_ENTER_WAITING_ROOM],
        events: [event],
      },
    ]);
  });
});
