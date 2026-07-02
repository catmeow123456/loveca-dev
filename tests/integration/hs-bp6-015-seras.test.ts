import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { HS_BP6_015_ON_ENTER_FROM_NON_HAND_DRAW_TWO_DISCARD_TWO_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'EdelNote',
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function baseGame(testId: string): GameState {
  return createGameState(testId, PLAYER1, 'P1', PLAYER2, 'P2');
}

function setupSeras(options: { readonly handCount: number; readonly deckCount: number }): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly handCardIds: readonly string[];
  readonly deckCardIds: readonly string[];
} {
  const source = createCardInstance(
    createMember('PL!HS-bp6-015-R', 'セラス 柳田 リリエンフェルト'),
    PLAYER1,
    'bp6-015-source'
  );
  const handCards = Array.from({ length: options.handCount }, (_, index) =>
    createCardInstance(createMember(`BP6-015-HAND-${index}`), PLAYER1, `bp6-015-hand-${index}`)
  );
  const deckCards = Array.from({ length: options.deckCount }, (_, index) =>
    createCardInstance(createMember(`BP6-015-DECK-${index}`), PLAYER1, `bp6-015-deck-${index}`)
  );
  let game = registerCards(baseGame('bp6-015-seras'), [source, ...handCards, ...deckCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    mainDeck: deckCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.mainDeck
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));

  return {
    game,
    sourceId: source.instanceId,
    handCardIds: handCards.map((card) => card.instanceId),
    deckCardIds: deckCards.map((card) => card.instanceId),
  };
}

function withPending(game: GameState, sourceCardId: string, fromZone?: ZoneType): GameState {
  return {
    ...game,
    pendingAbilities: [
      {
        id: `${HS_BP6_015_ON_ENTER_FROM_NON_HAND_DRAW_TWO_DISCARD_TWO_ABILITY_ID}:${sourceCardId}:pending`,
        abilityId: HS_BP6_015_ON_ENTER_FROM_NON_HAND_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
        sourceCardId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_ENTER_STAGE,
        eventIds: ['manual-event'],
        sourceSlot: SlotPosition.CENTER,
        metadata: fromZone === undefined ? undefined : { fromZone },
      },
    ],
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirmDiscard(game: GameState, selectedCardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    null,
    null,
    undefined,
    null,
    selectedCardIds
  );
}

function enterWaitingRoomEventCards(game: GameState): readonly string[] {
  return game.eventLog.flatMap((entry) =>
    entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      ? (entry.event.cardInstanceIds ?? [entry.event.cardInstanceId])
      : []
  );
}

describe('PL!HS-bp6-015 Seras workflow', () => {
  it('consumes pending without drawing or discarding when entered from hand', () => {
    const scenario = setupSeras({ handCount: 1, deckCount: 2 });

    const state = resolve(withPending(scenario.game, scenario.sourceId, ZoneType.HAND));

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual(scenario.handCardIds);
    expect(state.players[0].mainDeck.cardIds).toEqual(scenario.deckCardIds);
    expect(state.actionHistory.at(-1)?.payload.step).toBe('SOURCE_FROM_HAND_OR_UNKNOWN');
  });

  it('treats missing fromZone metadata as an unknown source and no-ops', () => {
    const scenario = setupSeras({ handCount: 1, deckCount: 2 });

    const state = resolve(withPending(scenario.game, scenario.sourceId));

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual(scenario.handCardIds);
    expect(state.players[0].mainDeck.cardIds).toEqual(scenario.deckCardIds);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'SOURCE_FROM_HAND_OR_UNKNOWN',
      fromZone: null,
    });
  });

  it('draws two and discards two cards when entered from waiting room', () => {
    const scenario = setupSeras({ handCount: 2, deckCount: 2 });

    const state = resolve(withPending(scenario.game, scenario.sourceId, ZoneType.WAITING_ROOM));

    expect(state.activeEffect).toMatchObject({
      abilityId: HS_BP6_015_ON_ENTER_FROM_NON_HAND_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
      selectableCardIds: [
        scenario.handCardIds[0],
        scenario.handCardIds[1],
        scenario.deckCardIds[0],
        scenario.deckCardIds[1],
      ],
      minSelectableCards: 2,
      maxSelectableCards: 2,
    });
    expect(state.players[0].mainDeck.cardIds).toEqual([]);

    const finished = confirmDiscard(state, [scenario.handCardIds[0]!, scenario.deckCardIds[0]!]);

    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0].hand.cardIds).toEqual([
      scenario.handCardIds[1],
      scenario.deckCardIds[1],
    ]);
    expect(finished.players[0].waitingRoom.cardIds).toEqual([
      scenario.handCardIds[0],
      scenario.deckCardIds[0],
    ]);
    expect(enterWaitingRoomEventCards(finished)).toEqual([
      scenario.handCardIds[0],
      scenario.deckCardIds[0],
    ]);
  });

  it('copies EnterStageEvent.fromZone into ON_ENTER pending metadata', () => {
    const scenario = setupSeras({ handCount: 0, deckCount: 1 });
    const eventGame = emitGameEvent(
      scenario.game,
      createEnterStageEvent(
        scenario.sourceId,
        ZoneType.MAIN_DECK,
        SlotPosition.CENTER,
        PLAYER1,
        PLAYER1
      )
    );

    const queued = enqueueTriggeredCardEffects(eventGame, [TriggerCondition.ON_ENTER_STAGE]);

    expect(queued.pendingAbilities).toHaveLength(1);
    expect(queued.pendingAbilities[0]?.metadata?.fromZone).toBe(ZoneType.MAIN_DECK);

    const state = resolve(queued);

    expect(state.activeEffect).toMatchObject({
      abilityId: HS_BP6_015_ON_ENTER_FROM_NON_HAND_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
      selectableCardIds: [scenario.deckCardIds[0]],
      minSelectableCards: 1,
      maxSelectableCards: 1,
    });
  });

  it('clamps discard count to the available hand after drawing', () => {
    const scenario = setupSeras({ handCount: 0, deckCount: 1 });

    const state = resolve(withPending(scenario.game, scenario.sourceId, ZoneType.MAIN_DECK));

    expect(state.activeEffect).toMatchObject({
      selectableCardIds: [scenario.deckCardIds[0]],
      minSelectableCards: 1,
      maxSelectableCards: 1,
      stepText: '请选择1张手牌放置入休息室。',
    });

    const finished = confirmDiscard(state, [scenario.deckCardIds[0]!]);

    expect(finished.players[0].hand.cardIds).toEqual([]);
    expect(finished.players[0].waitingRoom.cardIds).toEqual([scenario.deckCardIds[0]]);
    expect(enterWaitingRoomEventCards(finished)).toEqual([scenario.deckCardIds[0]]);
  });
});
