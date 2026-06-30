import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { SP_BP2_024_LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  GamePhase,
  HeartColor,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createVitaminSummer(cardCode = 'PL!SP-bp2-024-SECL'): LiveCardData {
  return {
    cardCode,
    name: 'ビタミンSUMMER!',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 3 }),
  };
}

function createOpponentLive(): LiveCardData {
  return {
    cardCode: 'PL!SP-test-opponent-live',
    name: 'Opponent Live',
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createTinyStarsLive(): LiveCardData {
  return {
    cardCode: 'PL!SP-bp1-024-L',
    name: 'Tiny Stars',
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createHandCard(cardCode: string): MemberCardData {
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

function setupVitaminSummerLiveSuccess(options: {
  readonly ownHandCount: number;
  readonly opponentHandCount: number;
  readonly ownScore?: number;
  readonly opponentScore?: number;
  readonly sourceCardCode?: string;
  readonly includeExtraLiveSuccess?: boolean;
}) {
  const sourceLive = createCardInstance(
    createVitaminSummer(options.sourceCardCode),
    PLAYER1,
    'vitamin-summer'
  );
  const extraLive = options.includeExtraLiveSuccess
    ? createCardInstance(createTinyStarsLive(), PLAYER1, 'tiny-stars-live')
    : null;
  const opponentLive = createCardInstance(createOpponentLive(), PLAYER2, 'opponent-live');
  const ownHandCards = Array.from({ length: options.ownHandCount }, (_, index) =>
    createCardInstance(createHandCard(`P1-HAND-${index}`), PLAYER1, `p1-hand-${index}`)
  );
  const opponentHandCards = Array.from({ length: options.opponentHandCount }, (_, index) =>
    createCardInstance(createHandCard(`P2-HAND-${index}`), PLAYER2, `p2-hand-${index}`)
  );

  let game = createGameState('sp-bp2-024-vitamin-summer', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    sourceLive,
    ...(extraLive ? [extraLive] : []),
    opponentLive,
    ...ownHandCards,
    ...opponentHandCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: ownHandCards.map((card) => card.instanceId) },
    liveZone: extraLive
      ? addCardToStatefulZone(
          addCardToStatefulZone(player.liveZone, sourceLive.instanceId),
          extraLive.instanceId
        )
      : addCardToStatefulZone(player.liveZone, sourceLive.instanceId),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: opponentHandCards.map((card) => card.instanceId) },
    liveZone: addCardToStatefulZone(player.liveZone, opponentLive.instanceId),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([
        [sourceLive.instanceId, true],
        ...(extraLive ? ([[extraLive.instanceId, true]] as const) : []),
        [opponentLive.instanceId, true],
      ]),
      playerScores: new Map([
        [PLAYER1, options.ownScore ?? 5],
        [PLAYER2, options.opponentScore ?? 5],
      ]),
      performingPlayerId: PLAYER1,
    },
  };

  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);
  return {
    state: result.gameState,
    sourceLive,
    extraLive,
    opponentLive,
    ownHandCards,
    opponentHandCards,
  };
}

function confirmEffectStep(state: ReturnType<typeof setupVitaminSummerLiveSuccess>['state']) {
  const session = createGameSession();
  session.createGame('sp-bp2-024-vitamin-summer-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: typeof state }).authorityState = state;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, state.activeEffect!.id)
  );
  expect(result.success).toBe(true);
  return session.state!;
}

describe('PL!SP-bp2-024 Vitamin SUMMER! live success workflow', () => {
  it('adds this-live SCORE +1 and refreshes playerScores when own hand is larger', () => {
    const { state, sourceLive } = setupVitaminSummerLiveSuccess({
      ownHandCount: 3,
      opponentHandCount: 2,
    });

    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: sourceLive.instanceId,
      sourceCardId: sourceLive.instanceId,
      abilityId: SP_BP2_024_LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(state.liveResolution.playerScores.get(PLAYER2)).toBe(5);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP2_024_LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE_ABILITY_ID &&
          action.payload.ownHandCount === 3 &&
          action.payload.opponentHandCount === 2 &&
          action.payload.conditionMet === true &&
          action.payload.scoreBonus === 1
      )
    ).toBe(true);
  });

  it.each([
    { ownHandCount: 2, opponentHandCount: 2 },
    { ownHandCount: 1, opponentHandCount: 2 },
  ])(
    'does not add score when own hand count $ownHandCount is not greater than opponent $opponentHandCount',
    ({ ownHandCount, opponentHandCount }) => {
      const { state } = setupVitaminSummerLiveSuccess({
        ownHandCount,
        opponentHandCount,
      });

      expect(state.pendingAbilities).toEqual([]);
      expect(
        state.liveResolution.liveModifiers.some(
          (modifier) =>
            modifier.kind === 'SCORE' &&
            modifier.abilityId ===
              SP_BP2_024_LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE_ABILITY_ID
        )
      ).toBe(false);
      expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
      expect(
        state.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId ===
              SP_BP2_024_LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE_ABILITY_ID &&
            action.payload.ownHandCount === ownHandCount &&
            action.payload.opponentHandCount === opponentHandCount &&
            action.payload.conditionMet === false &&
            action.payload.scoreBonus === 0
        )
      ).toBe(true);
    }
  );

  it('uses the base-code definition for L rarity too', () => {
    const { state, sourceLive } = setupVitaminSummerLiveSuccess({
      sourceCardCode: 'PL!SP-bp2-024-L',
      ownHandCount: 4,
      opponentHandCount: 2,
    });

    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: sourceLive.instanceId,
      sourceCardId: sourceLive.instanceId,
      abilityId: SP_BP2_024_LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE_ABILITY_ID,
    });
  });

  it('keeps the resolved score bonus locked for later winner judgment even if hand counts change', () => {
    const { state } = setupVitaminSummerLiveSuccess({
      ownHandCount: 3,
      opponentHandCount: 2,
    });
    const changedHandState = updatePlayer(
      updatePlayer(state, PLAYER1, (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: [] },
      })),
      PLAYER2,
      (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: ['virtual-opponent-hand-1', 'virtual-opponent-hand-2'] },
      })
    );
    const readyToResolveWinner = {
      ...changedHandState,
      liveResolution: {
        ...changedHandState.liveResolution,
        scoreConfirmedBy: [PLAYER1, PLAYER2],
        liveWinnerIds: [],
      },
    };

    const result = new GameService().resolveLiveWinner(readyToResolveWinner);

    expect(result.success).toBe(true);
    expect(result.gameState.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(result.gameState.liveResolution.playerScores.get(PLAYER2)).toBe(5);
    expect(result.gameState.liveResolution.liveWinnerIds).toEqual([PLAYER1]);
  });

  it('shows a condition summary before resolving when manually chosen from a live-success queue', () => {
    const { state, sourceLive } = setupVitaminSummerLiveSuccess({
      ownHandCount: 3,
      opponentHandCount: 2,
      includeExtraLiveSuccess: true,
    });

    expect(state.activeEffect?.canResolveInOrder).toBe(true);
    expect(state.activeEffect?.selectableCardIds).toContain(sourceLive.instanceId);

    const session = createGameSession();
    session.createGame('sp-bp2-024-vitamin-summer-order', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: typeof state }).authorityState = state;
    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, state.activeEffect!.id, sourceLive.instanceId)
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: SP_BP2_024_LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE_ABILITY_ID,
      sourceCardId: sourceLive.instanceId,
      stepId: 'CONFIRM_ONLY_EFFECT',
      stepText: '自己手牌 3 张，对方手牌 2 张，条件满足。确认后此 LIVE 分数 +1。',
    });

    const resolvedState = confirmEffectStep(session.state!);

    expect(resolvedState.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(
      resolvedState.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP2_024_LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE_ABILITY_ID &&
          action.payload.sourceCardId === sourceLive.instanceId &&
          action.payload.conditionMet === true &&
          action.payload.scoreBonus === 1
      )
    ).toBe(true);
  });

  it('shows a failed condition summary before resolving when manually chosen', () => {
    const { state, sourceLive } = setupVitaminSummerLiveSuccess({
      ownHandCount: 2,
      opponentHandCount: 2,
      includeExtraLiveSuccess: true,
    });

    const session = createGameSession();
    session.createGame('sp-bp2-024-vitamin-summer-order-false', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: typeof state }).authorityState = state;
    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, state.activeEffect!.id, sourceLive.instanceId)
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepText).toBe(
      '自己手牌 2 张，对方手牌 2 张，条件不满足。确认后不增加分数。'
    );

    const resolvedState = confirmEffectStep(session.state!);

    expect(resolvedState.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(
      resolvedState.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP2_024_LIVE_SUCCESS_HAND_ADVANTAGE_THIS_LIVE_SCORE_ABILITY_ID &&
          action.payload.sourceCardId === sourceLive.instanceId &&
          action.payload.conditionMet === false &&
          action.payload.scoreBonus === 0
      )
    ).toBe(true);
  });
});
