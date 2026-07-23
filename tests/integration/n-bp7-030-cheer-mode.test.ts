import { beforeAll, describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP7_030_LIVE_SUCCESS_ARRANGE_TOP_THREE_ABILITY_ID,
  N_BP7_030_LIVE_SUCCESS_RETURN_SELF_TO_HAND_DISCARD_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { registerNBp7030CheerModeWorkflowHandlers } from '../../src/application/card-effects/workflows/cards/n-bp7-030-cheer-mode';
import { CardType, HeartColor, TriggerCondition, ZoneType } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

beforeAll(() => {
  registerNBp7030CheerModeWorkflowHandlers({ enqueueTriggeredCardEffects });
});

function live(cardCode = 'PL!N-bp7-030-L'): LiveCardData {
  return {
    cardCode,
    name: cardCode === 'PL!N-bp7-030-L' ? 'Cheer Mode' : cardCode,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 0,
    requirements: createHeartRequirement({ [HeartColor.GRAY]: 2 }),
  };
}

function member(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function pending(abilityId: string, sourceCardId: string): PendingAbilityState {
  return {
    id: `${abilityId}:test`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success:test'],
  };
}

function setup(
  abilityId: string,
  options: {
    readonly deckCount?: number;
    readonly handCount?: number;
    readonly sourceInLiveZone?: boolean;
  } = {}
) {
  const source = createCardInstance(live(), PLAYER1, 'cheer-mode-source');
  const deck = Array.from({ length: options.deckCount ?? 3 }, (_, index) =>
    createCardInstance(member(`DECK-${index}`), PLAYER1, `deck-${index}`)
  );
  const hand = Array.from({ length: options.handCount ?? 0 }, (_, index) =>
    createCardInstance(member(`HAND-${index}`), PLAYER1, `hand-${index}`)
  );
  let game = createGameState(`cheer-mode-${abilityId}`, PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...deck, ...hand]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: options.sourceInLiveZone === false ? [] : [source.instanceId],
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.sourceInLiveZone === false ? [source.instanceId] : [],
    },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
  }));
  game = {
    ...game,
    pendingAbilities: [pending(abilityId, source.instanceId)],
  };
  return {
    game,
    sourceId: source.instanceId,
    deckIds: deck.map((card) => card.instanceId),
    handIds: hand.map((card) => card.instanceId),
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function chooseCards(game: GameState, cardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    cardIds
  );
}

describe('PL!N-bp7-030-L 分数0「Cheer Mode」', () => {
  it('reuses ordered top-three arrange and emits one grouped event for the remainder', () => {
    const scenario = setup(N_BP7_030_LIVE_SUCCESS_ARRANGE_TOP_THREE_ABILITY_ID);
    const started = start(scenario.game);
    expect(started.activeEffect).toMatchObject({
      abilityId: N_BP7_030_LIVE_SUCCESS_ARRANGE_TOP_THREE_ABILITY_ID,
      stepId: 'N_BP7_030_ARRANGE_TOP_THREE',
      stepText: '请选择任意张数的卡片，按卡组顶从上到下的顺序排列；其余的卡片放置入休息室。',
      selectionLabel: '按放置顺序选择卡片',
      confirmSelectionLabel: '按此顺序放置于卡组顶',
      minSelectableCards: 0,
      maxSelectableCards: 3,
      selectableCardIds: scenario.deckIds,
    });

    const selected = [scenario.deckIds[1]!, scenario.deckIds[0]!];
    const done = chooseCards(started, selected);
    expect(done.players[0].mainDeck.cardIds).toEqual(selected);
    expect(done.players[0].waitingRoom.cardIds).toEqual([scenario.deckIds[2]]);
    expect(done.inspectionZone.cardIds).toEqual([]);
    const waitingEvents = done.eventLog
      .map((entry) => entry.event)
      .filter(
        (event) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK
      );
    expect(waitingEvents).toHaveLength(1);
    expect(waitingEvents[0]?.cardInstanceIds).toEqual([scenario.deckIds[2]]);
  });

  it('allows zero, all three, and the actually inspected short deck', () => {
    const none = setup(N_BP7_030_LIVE_SUCCESS_ARRANGE_TOP_THREE_ABILITY_ID);
    const noneDone = chooseCards(start(none.game), []);
    expect(noneDone.players[0].mainDeck.cardIds).toEqual([]);
    expect(noneDone.players[0].waitingRoom.cardIds).toEqual(none.deckIds);

    const all = setup(N_BP7_030_LIVE_SUCCESS_ARRANGE_TOP_THREE_ABILITY_ID);
    const reversed = [...all.deckIds].reverse();
    const allDone = chooseCards(start(all.game), reversed);
    expect(allDone.players[0].mainDeck.cardIds).toEqual(reversed);
    expect(allDone.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      allDone.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(0);

    const short = setup(N_BP7_030_LIVE_SUCCESS_ARRANGE_TOP_THREE_ABILITY_ID, {
      deckCount: 2,
    });
    const shortStarted = start(short.game);
    expect(shortStarted.activeEffect?.maxSelectableCards).toBe(2);
    const shortDone = chooseCards(shortStarted, [short.deckIds[1]!]);
    expect(shortDone.players[0].mainDeck.cardIds).toEqual([short.deckIds[1]]);
    expect(shortDone.players[0].waitingRoom.cardIds).toEqual([short.deckIds[0]]);
  });

  it('keeps the inspection window on duplicate, unrelated, or stale input', () => {
    const scenario = setup(N_BP7_030_LIVE_SUCCESS_ARRANGE_TOP_THREE_ABILITY_ID);
    const started = start(scenario.game);
    for (const cardIds of [
      [scenario.deckIds[0]!, scenario.deckIds[0]!],
      [scenario.deckIds[0]!, 'unrelated'],
    ]) {
      expect(chooseCards(started, cardIds)).toBe(started);
    }
  });

  it('records LIVE_ZONE -> HAND, then uses the post-resolution zone scan without a pseudo trigger when that source is discarded', () => {
    const scenario = setup(N_BP7_030_LIVE_SUCCESS_RETURN_SELF_TO_HAND_DISCARD_ONE_ABILITY_ID);
    const started = start(scenario.game);
    expect(started.players[0].liveZone.cardIds).toEqual([]);
    expect(started.players[0].hand.cardIds).toEqual([scenario.sourceId]);
    const enterHandEvent = started.eventLog
      .map((entry) => entry.event)
      .find(
        (event) =>
          event.eventType === TriggerCondition.ON_ENTER_HAND &&
          event.cardInstanceId === scenario.sourceId
      );
    expect(enterHandEvent).toMatchObject({
      fromZone: ZoneType.LIVE_ZONE,
      toZone: ZoneType.HAND,
      cardInstanceIds: [scenario.sourceId],
    });
    expect(
      started.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' && action.payload.eventId === enterHandEvent?.eventId
      )
    ).toBe(false);
    expect(started.activeEffect).toMatchObject({
      stepId: 'N_BP7_030_DISCARD_ONE_AFTER_RETURN',
      selectableCardIds: [scenario.sourceId],
      selectionLabel: '选择要放置入休息室的卡牌',
      confirmSelectionLabel: '放置入休息室',
    });

    const done = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.sourceId
    );
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].hand.cardIds).toEqual([]);
    expect(done.players[0].waitingRoom.cardIds).toEqual([scenario.sourceId]);
    const events = done.eventLog.map((entry) => entry.event);
    const enterHandIndex = events.findIndex((event) => event.eventId === enterHandEvent?.eventId);
    const enterWaitingIndex = events.findIndex(
      (event) =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        event.fromZone === ZoneType.HAND
    );
    expect(enterHandIndex).toBeGreaterThanOrEqual(0);
    expect(enterWaitingIndex).toBeGreaterThan(enterHandIndex);
    expect(
      done.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' && action.payload.eventId === enterHandEvent?.eventId
      )
    ).toBe(false);
  });

  it('can discard another current hand card after returning the source', () => {
    const scenario = setup(N_BP7_030_LIVE_SUCCESS_RETURN_SELF_TO_HAND_DISCARD_ONE_ABILITY_ID, {
      handCount: 1,
    });
    const started = start(scenario.game);
    expect(started.activeEffect?.selectableCardIds).toEqual([
      scenario.handIds[0],
      scenario.sourceId,
    ]);
    const done = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.handIds[0]
    );
    expect(done.players[0].hand.cardIds).toEqual([scenario.sourceId]);
    expect(done.players[0].waitingRoom.cardIds).toEqual([scenario.handIds[0]]);
  });

  it('consumes a stale source without returning or discarding any card', () => {
    const scenario = setup(N_BP7_030_LIVE_SUCCESS_RETURN_SELF_TO_HAND_DISCARD_ONE_ABILITY_ID, {
      handCount: 1,
      sourceInLiveZone: false,
    });
    const done = start(scenario.game);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.players[0].hand.cardIds).toEqual(scenario.handIds);
    expect(done.players[0].waitingRoom.cardIds).toEqual([scenario.sourceId]);
    expect(
      done.eventLog.some(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.HAND
      )
    ).toBe(false);
  });

  it('keeps the discard window on forged or stale hand selection', () => {
    const scenario = setup(N_BP7_030_LIVE_SUCCESS_RETURN_SELF_TO_HAND_DISCARD_ONE_ABILITY_ID, {
      handCount: 1,
    });
    const started = start(scenario.game);
    const forged = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, 'forged');
    expect(forged).toBe(started);

    const stale = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: player.hand.cardIds.filter((cardId) => cardId !== scenario.handIds[0]),
      },
    }));
    const staleResult = confirmActiveEffectStep(
      stale,
      PLAYER1,
      stale.activeEffect!.id,
      scenario.handIds[0]
    );
    expect(staleResult).toBe(stale);
  });
});
