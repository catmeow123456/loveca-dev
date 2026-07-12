import { describe, expect, it } from 'vitest';
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
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  BP6_011_LIVE_SUCCESS_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  BP6_016_LIVE_SUCCESS_LOOK_TOP_THREE_ARRANGE_ALL_TO_TOP_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMuseMember(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(): LiveCardData {
  return {
    cardCode: 'PL!-bp6-test-live',
    name: 'Test Live',
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function setupLiveSuccessScenario(options: {
  readonly sourceCardCode: string;
  readonly sourceName: string;
  readonly sourceCost: number;
  readonly handCount: number;
  readonly mainDeckCount: number;
}) {
  const source = createCardInstance(
    createMuseMember(options.sourceCardCode, options.sourceName, options.sourceCost),
    PLAYER1,
    'bp6-live-success-source'
  );
  const live = createCardInstance(createLive(), PLAYER1, 'bp6-live-success-live');
  const handCards = Array.from({ length: options.handCount }, (_, index) =>
    createCardInstance(
      createMuseMember(`PL!-bp6-hand-${index}`, `Hand ${index}`),
      PLAYER1,
      `bp6-hand-${index}`
    )
  );
  const deckCards = Array.from({ length: options.mainDeckCount }, (_, index) =>
    createCardInstance(
      createMuseMember(`PL!-bp6-deck-${index}`, `Deck ${index}`),
      PLAYER1,
      `bp6-deck-${index}`
    )
  );
  const ruleSentinel = createCardInstance(
    createMuseMember('PL!-bp6-rule-sentinel', 'Rule sentinel'),
    PLAYER1,
    'bp6-rule-sentinel'
  );

  let game = createGameState('pl-bp6-011-016-live-success', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, live, ...handCards, ...deckCards, ruleSentinel]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
    mainDeck: {
      ...player.mainDeck,
      cardIds:
        options.sourceCardCode.startsWith('PL!-bp6-011') && options.mainDeckCount >= 2
        ? [...deckCards.map((card) => card.instanceId), ruleSentinel.instanceId]
        : deckCards.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    liveZone: { ...player.liveZone, cardIds: [live.instanceId] },
  }));

  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[live.instanceId, true]]),
      playerScores: new Map([[PLAYER1, 3]]),
      performingPlayerId: PLAYER1,
    },
  };

  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);

  const session = createGameSession();
  session.createGame('pl-bp6-011-016-live-success-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = result.gameState;

  return { session, handCards, deckCards };
}

describe('PL!-bp6-011/016 LIVE success workflows', () => {
  it('draws two and discards two for PL!-bp6-011-N Eli', () => {
    const { session, handCards, deckCards } = setupLiveSuccessScenario({
      sourceCardCode: 'PL!-bp6-011-N',
      sourceName: '絢瀬絵里',
      sourceCost: 11,
      handCount: 1,
      mainDeckCount: 2,
    });

    expect(session.state?.activeEffect?.abilityId).toBe(
      BP6_011_LIVE_SUCCESS_DRAW_TWO_DISCARD_TWO_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.drawCount).toBe(2);
    expect(session.state?.activeEffect?.metadata?.discardCount).toBe(2);
    expect(session.state?.activeEffect?.minSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);

    const selectedDiscardIds = [handCards[0]!.instanceId, deckCards[0]!.instanceId];
    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        selectedDiscardIds
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(selectedDiscardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([deckCards[1]!.instanceId]);
  });

  it('discards only available cards for PL!-bp6-011-N when hand is short after drawing', () => {
    const { session, deckCards } = setupLiveSuccessScenario({
      sourceCardCode: 'PL!-bp6-011-N',
      sourceName: '絢瀬絵里',
      sourceCost: 11,
      handCount: 0,
      mainDeckCount: 1,
    });

    expect(session.state?.activeEffect?.abilityId).toBe(
      BP6_011_LIVE_SUCCESS_DRAW_TWO_DISCARD_TWO_ABILITY_ID
    );
    expect(session.state?.activeEffect?.minSelectableCards).toBe(1);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(1);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [deckCards[0]!.instanceId]
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckCards[0]!.instanceId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
  });

  it('arranges all inspected top three cards for PL!-bp6-016-N Nozomi', () => {
    const { session, deckCards } = setupLiveSuccessScenario({
      sourceCardCode: 'PL!-bp6-016-N',
      sourceName: '東條 希',
      sourceCost: 2,
      handCount: 0,
      mainDeckCount: 4,
    });

    expect(session.state?.activeEffect?.abilityId).toBe(
      BP6_016_LIVE_SUCCESS_LOOK_TOP_THREE_ARRANGE_ALL_TO_TOP_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.minSelectableCards).toBe(3);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(3);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(
      deckCards.slice(0, 3).map((card) => card.instanceId)
    );
    expect(
      session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            BP6_016_LIVE_SUCCESS_LOOK_TOP_THREE_ARRANGE_ALL_TO_TOP_ABILITY_ID &&
          action.payload.step === 'START_INSPECTION'
      )?.payload.publicEffectSummary
    ).toMatchObject({
      effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
      summaryStatus: 'STARTED',
      sourceActionLabel: 'LIVE成功',
      requestedInspectCount: 3,
      actualInspectedCount: 3,
      selectedCardIds: [],
      waitingRoomCardIds: [],
    });

    const selectedTopOrder = [
      deckCards[2]!.instanceId,
      deckCards[0]!.instanceId,
      deckCards[1]!.instanceId,
    ];
    const arrangeResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        selectedTopOrder
      )
    );

    expect(arrangeResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      ...selectedTopOrder,
      deckCards[3]!.instanceId,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            BP6_016_LIVE_SUCCESS_LOOK_TOP_THREE_ARRANGE_ALL_TO_TOP_ABILITY_ID &&
          action.payload.step === 'FINISH'
      )?.payload.publicEffectSummary
    ).toMatchObject({
      effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
      summaryStatus: 'COMPLETED',
      sourceActionLabel: 'LIVE成功',
      actualInspectedCount: 3,
      selectedCardIds: selectedTopOrder,
      waitingRoomCardIds: [],
    });
  });

  it('arranges all available cards when PL!-bp6-016-N sees fewer than three', () => {
    const { session, deckCards } = setupLiveSuccessScenario({
      sourceCardCode: 'PL!-bp6-016-N',
      sourceName: '東條 希',
      sourceCost: 2,
      handCount: 0,
      mainDeckCount: 2,
    });

    expect(session.state?.activeEffect?.abilityId).toBe(
      BP6_016_LIVE_SUCCESS_LOOK_TOP_THREE_ARRANGE_ALL_TO_TOP_ABILITY_ID
    );
    expect(session.state?.activeEffect?.minSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);

    const reversed = [deckCards[1]!.instanceId, deckCards[0]!.instanceId];
    const arrangeResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        reversed
      )
    );

    expect(arrangeResult.success).toBe(true);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(reversed);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('consumes PL!-bp6-016-N pending normally when the deck is empty', () => {
    const { session } = setupLiveSuccessScenario({
      sourceCardCode: 'PL!-bp6-016-N',
      sourceName: '東條 希',
      sourceCost: 2,
      handCount: 0,
      mainDeckCount: 0,
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            BP6_016_LIVE_SUCCESS_LOOK_TOP_THREE_ARRANGE_ALL_TO_TOP_ABILITY_ID &&
          action.payload.step === 'FINISH' &&
          Array.isArray(action.payload.inspectedCardIds) &&
          action.payload.inspectedCardIds.length === 0
      )
    ).toBe(true);
  });
});
