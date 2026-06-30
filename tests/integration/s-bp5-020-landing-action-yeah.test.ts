import { describe, expect, it } from 'vitest';
import type { HeartIcon, LiveCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { S_BP5_020_LIVE_SUCCESS_LOSE_REMAINING_HEARTS_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  GamePhase,
  HeartColor,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createLandingActionYeahLive(): LiveCardData {
  return {
    cardCode: 'PL!S-bp5-020-L',
    name: 'Landing action Yeah!!',
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({
      [HeartColor.GREEN]: 1,
      [HeartColor.RAINBOW]: 2,
    }),
  };
}

function prepareScenario(options: {
  readonly remainingHearts: readonly HeartIcon[];
  readonly liveCount?: number;
  readonly playerScore?: number;
}) {
  const liveCards = Array.from({ length: options.liveCount ?? 1 }, (_, index) =>
    createCardInstance(
      createLandingActionYeahLive(),
      PLAYER1,
      `landing-action-yeah-${index}`
    )
  );
  let game = createGameState('s-bp5-020-landing-action-yeah', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, liveCards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: liveCards.map((live) => live.instanceId),
    },
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map(liveCards.map((live) => [live.instanceId, true])),
      playerScores: new Map([[PLAYER1, options.playerScore ?? liveCards.length]]),
      playerRemainingHearts: new Map([[PLAYER1, options.remainingHearts]]),
      performingPlayerId: PLAYER1,
    },
  };

  return { game, liveCards };
}

function resolveLiveSuccess(game: ReturnType<typeof prepareScenario>['game']) {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function resolveLiveSuccessWithOrderSelection(game: ReturnType<typeof prepareScenario>['game']) {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);
  const session = createGameSession();
  session.createGame('s-bp5-020-two-pending', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: typeof game }).authorityState = result.gameState;

  if (session.state?.activeEffect) {
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state.activeEffect.id,
          undefined,
          null,
          true
        )
      ).success
    ).toBe(true);
  }

  return session.state!;
}

function abilityActions(game: ReturnType<typeof resolveLiveSuccess>) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        S_BP5_020_LIVE_SUCCESS_LOSE_REMAINING_HEARTS_SCORE_ABILITY_ID
  );
}

describe('PL!S-bp5-020-L Landing action Yeah!! live-success workflow', () => {
  it('loses all mixed remaining hearts, adds this-live SCORE +1, and refreshes playerScores', () => {
    const remainingHearts = [
      { color: HeartColor.GREEN, count: 1 },
      { color: HeartColor.PINK, count: 1 },
      { color: HeartColor.RAINBOW, count: 2 },
    ];
    const { game, liveCards } = prepareScenario({ remainingHearts, playerScore: 1 });

    const state = resolveLiveSuccess(game);

    expect(state.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual([]);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: liveCards[0]!.instanceId,
      sourceCardId: liveCards[0]!.instanceId,
      abilityId: S_BP5_020_LIVE_SUCCESS_LOSE_REMAINING_HEARTS_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(abilityActions(state)[0]?.payload).toMatchObject({
      conditionMet: true,
      remainingHeartTotalCount: 4,
      lostHearts: remainingHearts,
      lostTotalCount: 4,
      scoreBonus: 1,
    });
  });

  it('does not lose hearts or add score when remaining heart total is below three', () => {
    const remainingHearts = [
      { color: HeartColor.GREEN, count: 1 },
      { color: HeartColor.RAINBOW, count: 1 },
    ];
    const { game } = prepareScenario({ remainingHearts, playerScore: 1 });

    const state = resolveLiveSuccess(game);

    expect(state.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual(remainingHearts);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId === S_BP5_020_LIVE_SUCCESS_LOSE_REMAINING_HEARTS_SCORE_ABILITY_ID
      )
    ).toBe(false);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(abilityActions(state)[0]?.payload).toMatchObject({
      conditionMet: false,
      remainingHeartTotalCount: 2,
      lostHearts: [],
      lostTotalCount: 0,
      scoreBonus: 0,
    });
  });

  it('does not score twice when two pending abilities resolve after the first clears hearts', () => {
    const remainingHearts = [
      { color: HeartColor.GREEN, count: 1 },
      { color: HeartColor.BLUE, count: 1 },
      { color: HeartColor.RAINBOW, count: 1 },
    ];
    const { game, liveCards } = prepareScenario({
      remainingHearts,
      liveCount: 2,
      playerScore: 2,
    });

    const state = resolveLiveSuccessWithOrderSelection(game);
    const actions = abilityActions(state);

    expect(actions).toHaveLength(2);
    expect(actions[0]?.payload).toMatchObject({
      sourceCardId: liveCards[0]!.instanceId,
      conditionMet: true,
      remainingHeartTotalCount: 3,
      lostTotalCount: 3,
      scoreBonus: 1,
    });
    expect(actions[1]?.payload).toMatchObject({
      sourceCardId: liveCards[1]!.instanceId,
      conditionMet: false,
      remainingHeartTotalCount: 0,
      lostTotalCount: 0,
      scoreBonus: 0,
    });
    expect(
      state.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId === S_BP5_020_LIVE_SUCCESS_LOSE_REMAINING_HEARTS_SCORE_ABILITY_ID
      )
    ).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: liveCards[0]!.instanceId,
        sourceCardId: liveCards[0]!.instanceId,
        abilityId: S_BP5_020_LIVE_SUCCESS_LOSE_REMAINING_HEARTS_SCORE_ABILITY_ID,
      },
    ]);
    expect(state.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(3);
  });
});
