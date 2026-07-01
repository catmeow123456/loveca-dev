import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID,
  SP_BP2_009_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
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
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createNatsumi(cardCode = 'PL!SP-bp2-009-SEC'): MemberCardData {
  return {
    cardCode,
    name: '鬼塚夏美',
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 13,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(): LiveCardData {
  return {
    cardCode: 'PL!SP-test-live',
    name: 'Test Live',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function setupNatsumiState(options: {
  readonly handCount: number;
  readonly mainDeckCount?: number;
  readonly sourceCardCode?: string;
}): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly handCards: readonly ReturnType<typeof createCardInstance>[];
  readonly deckCards: readonly ReturnType<typeof createCardInstance>[];
  readonly live: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(
    createNatsumi(options.sourceCardCode),
    PLAYER1,
    'natsumi-source'
  );
  const live = createCardInstance(createLive(), PLAYER1, 'natsumi-live');
  const handCards = Array.from({ length: options.handCount }, (_, index) =>
    createCardInstance(createMember(`HAND-${index}`), PLAYER1, `hand-${index}`)
  );
  const deckCards = Array.from({ length: options.mainDeckCount ?? 0 }, (_, index) =>
    createCardInstance(createMember(`DECK-${index}`), PLAYER1, `deck-${index}`)
  );

  let game = createGameState('sp-bp2-009-natsumi', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, live, ...handCards, ...deckCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
  }));

  return { game, source, handCards, deckCards, live };
}

function runLiveStart(options: { readonly handCount: number }) {
  const { game, source, handCards } = setupNatsumiState({
    handCount: options.handCount,
    mainDeckCount: 0,
  });
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return { state: confirmIfConfirmOnly(result.gameState, PLAYER1), source, handCards };
}

function runLiveSuccessStart(options: {
  readonly handCount: number;
  readonly mainDeckCount: number;
}) {
  const { game, source, handCards, deckCards, live } = setupNatsumiState(options);
  const liveSuccessState = {
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
  const result = new GameService().executeCheckTiming(liveSuccessState, [
    TriggerCondition.ON_LIVE_SUCCESS,
  ]);
  expect(result.success).toBe(true);

  const session = createGameSession();
  session.createGame('sp-bp2-009-natsumi-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = confirmIfConfirmOnly(
    result.gameState,
    PLAYER1
  );
  return { session, source, handCards, deckCards };
}

describe('PL!SP-bp2-009 Natsumi workflow', () => {
  it('gains BLADE +2 at LIVE start with five hand cards and records the locked count', () => {
    const { state, source } = runLiveStart({ handCount: 5 });

    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: source.instanceId,
      abilityId: SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID,
    });
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID &&
          action.payload.handCount === 5 &&
          action.payload.bladeBonus === 2
      )
    ).toBe(true);
  });

  it('does not write a modifier at LIVE start with one hand card but still consumes pending', () => {
    const { state } = runLiveStart({ handCount: 1 });

    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID &&
          action.payload.handCount === 1 &&
          action.payload.bladeBonus === 0
      )
    ).toBe(true);
  });

  it('keeps the BLADE amount locked after LIVE start even if hand count changes later', () => {
    const { state, source } = runLiveStart({ handCount: 5 });
    const changedHandState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
    }));

    expect(changedHandState.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: source.instanceId,
      abilityId: SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID,
    });
  });

  it('draws two at LIVE success, opens discard selection, and discards through the shared workflow', () => {
    const { session, handCards, deckCards } = runLiveSuccessStart({
      handCount: 1,
      mainDeckCount: 2,
    });

    expect(session.state?.activeEffect?.abilityId).toBe(
      SP_BP2_009_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.drawCount).toBe(2);
    expect(session.state?.activeEffect?.metadata?.discardCount).toBe(1);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      handCards[0]!.instanceId,
      deckCards[0]!.instanceId,
      deckCards[1]!.instanceId,
    ]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        deckCards[0]!.instanceId
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([
      handCards[0]!.instanceId,
      deckCards[1]!.instanceId,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([deckCards[0]!.instanceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP2_009_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID &&
          action.payload.step === 'DISCARD_HAND_CARD' &&
          action.payload.discardedCardId === deckCards[0]!.instanceId
      )
    ).toBe(true);
  });

  it('uses the shared confirmation path when LIVE success cannot draw and has no hand to discard', () => {
    const { session } = runLiveSuccessStart({
      handCount: 0,
      mainDeckCount: 0,
    });

    expect(session.state?.activeEffect?.abilityId).toBe(
      SP_BP2_009_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP2_009_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID &&
          action.payload.step === 'FINISH' &&
          Array.isArray(action.payload.discardedCardIds) &&
          action.payload.discardedCardIds.length === 0
      )
    ).toBe(true);
  });
});
