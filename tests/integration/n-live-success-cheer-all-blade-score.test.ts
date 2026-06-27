import { describe, expect, it } from 'vitest';
import type { BladeHearts, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { PL_N_BP3_030_LIVE_SUCCESS_CHEER_ALL_BLADE_THIS_LIVE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
  CardType,
  GamePhase,
  HeartColor,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createLoveUMyFriends(): LiveCardData {
  return {
    cardCode: 'PL!N-bp3-030-L',
    name: 'Love U my friends',
    groupName: '虹ヶ咲',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createDummyLive(cardCode: string, bladeHearts: BladeHearts = []): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: '虹ヶ咲',
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    bladeHearts,
  };
}

function createCheerMember(cardCode: string, bladeHearts: BladeHearts = []): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: '虹ヶ咲',
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts,
  };
}

function allBladeHeart(): BladeHearts {
  return [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }];
}

function setupLiveSuccess(options: {
  readonly sourceLives?: readonly ReturnType<typeof createCardInstance>[];
  readonly ownCheerCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly opponentCheerCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly resolutionOnlyCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly resolutionCardIds?: readonly string[];
  readonly revealedCardIds?: readonly string[];
  readonly initialScore?: number;
}): GameState {
  const sourceLives =
    options.sourceLives ?? [createCardInstance(createLoveUMyFriends(), PLAYER1, 'love-u-live')];
  const opponentLive = createCardInstance(createDummyLive('opponent-live'), PLAYER2, 'opponent-live');
  const ownCheerCards = options.ownCheerCards ?? [];
  const opponentCheerCards = options.opponentCheerCards ?? [];
  const resolutionOnlyCards = options.resolutionOnlyCards ?? [];
  const allCards = [
    ...sourceLives,
    opponentLive,
    ...ownCheerCards,
    ...opponentCheerCards,
    ...resolutionOnlyCards,
  ];
  const defaultResolutionCardIds = [
    ...ownCheerCards.map((card) => card.instanceId),
    ...opponentCheerCards.map((card) => card.instanceId),
    ...resolutionOnlyCards.map((card) => card.instanceId),
  ];
  const resolutionCardIds = options.resolutionCardIds ?? defaultResolutionCardIds;
  const revealedCardIds = options.revealedCardIds ?? resolutionCardIds;

  let game = createGameState('n-live-success-cheer-all-blade-score', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, allCards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: sourceLives.reduce(
      (zone, live) => addCardToStatefulZone(zone, live.instanceId),
      player.liveZone
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, opponentLive.instanceId),
  }));

  return {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: [...resolutionCardIds],
      revealedCardIds: [...revealedCardIds],
    },
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds: ownCheerCards.map((card) => card.instanceId),
      secondPlayerCheerCardIds: opponentCheerCards.map((card) => card.instanceId),
      liveResults: new Map([
        ...sourceLives.map((live) => [live.instanceId, true] as const),
        [opponentLive.instanceId, true],
      ]),
      playerScores: new Map([
        [PLAYER1, options.initialScore ?? sourceLives.length * 3],
        [PLAYER2, 1],
      ]),
      performingPlayerId: PLAYER1,
    },
  };
}

function resolveLiveSuccess(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success, result.error).toBe(true);
  if (!result.gameState.activeEffect?.canResolveInOrder) {
    expect(result.gameState.activeEffect).toBeNull();
    return result.gameState;
  }

  const session = createGameSession();
  session.createGame('n-live-success-cheer-all-blade-score-order', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = result.gameState;
  const orderResult = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      result.gameState.activeEffect.id,
      undefined,
      null,
      true
    )
  );
  expect(orderResult.success, orderResult.error).toBe(true);
  expect(session.state?.activeEffect).toBeNull();
  return session.state!;
}

function loveUScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        PL_N_BP3_030_LIVE_SUCCESS_CHEER_ALL_BLADE_THIS_LIVE_SCORE_ABILITY_ID
  );
}

function latestPayload(game: GameState) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          PL_N_BP3_030_LIVE_SUCCESS_CHEER_ALL_BLADE_THIS_LIVE_SCORE_ABILITY_ID
    )?.payload;
}

describe('PL!N-bp3-030 Love U my friends live success workflow', () => {
  it('adds this-live SCORE +1 and refreshes playerScores when own cheer reveals ALL BLADE', () => {
    const sourceLive = createCardInstance(createLoveUMyFriends(), PLAYER1, 'love-u-live');
    const allBladeCheer = createCardInstance(
      createCheerMember('PL!N-test-all-blade', allBladeHeart()),
      PLAYER1,
      'own-all-blade-cheer'
    );
    const game = setupLiveSuccess({
      sourceLives: [sourceLive],
      ownCheerCards: [allBladeCheer],
    });

    const state = resolveLiveSuccess(game);

    expect(loveUScoreModifiers(state)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: sourceLive.instanceId,
        sourceCardId: sourceLive.instanceId,
        abilityId: PL_N_BP3_030_LIVE_SUCCESS_CHEER_ALL_BLADE_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(latestPayload(state)).toMatchObject({
      allBladeCheerCardIds: [allBladeCheer.instanceId],
      conditionMet: true,
      scoreBonus: 1,
    });
  });

  it('does not trigger from DRAW, SCORE, or ordinary-color Heart blade hearts', () => {
    const ownCheerCards = [
      createCardInstance(
        createCheerMember('PL!N-test-draw', [{ effect: BladeHeartEffect.DRAW }]),
        PLAYER1,
        'draw-cheer'
      ),
      createCardInstance(
        createDummyLive('PL!N-test-score-live', [{ effect: BladeHeartEffect.SCORE }]),
        PLAYER1,
        'score-cheer'
      ),
      createCardInstance(
        createCheerMember('PL!N-test-pink-heart', [
          { effect: BladeHeartEffect.HEART, heartColor: HeartColor.PINK },
        ]),
        PLAYER1,
        'pink-heart-cheer'
      ),
    ];
    const game = setupLiveSuccess({ ownCheerCards });

    const state = resolveLiveSuccess(game);

    expect(loveUScoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(3);
    expect(latestPayload(state)).toMatchObject({
      allBladeCheerCardIds: [],
      conditionMet: false,
      scoreBonus: 0,
    });
  });

  it('does not count opponent cheer cards with ALL BLADE', () => {
    const opponentAllBlade = createCardInstance(
      createCheerMember('PL!N-test-opponent-all-blade', allBladeHeart()),
      PLAYER2,
      'opponent-all-blade-cheer'
    );
    const game = setupLiveSuccess({ opponentCheerCards: [opponentAllBlade] });

    const state = resolveLiveSuccess(game);

    expect(loveUScoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(3);
    expect(latestPayload(state)).toMatchObject({
      allBladeCheerCardIds: [],
      conditionMet: false,
    });
  });

  it('does not count revealed resolution cards that are not current cheer ids', () => {
    const staleAllBlade = createCardInstance(
      createCheerMember('PL!N-test-stale-all-blade', allBladeHeart()),
      PLAYER1,
      'stale-all-blade'
    );
    const game = setupLiveSuccess({ resolutionOnlyCards: [staleAllBlade] });

    const state = resolveLiveSuccess(game);

    expect(loveUScoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(3);
    expect(latestPayload(state)).toMatchObject({
      allBladeCheerCardIds: [],
      conditionMet: false,
    });
  });

  it('does not count current cheer cards that are no longer revealed in the resolution zone', () => {
    const allBladeCheer = createCardInstance(
      createCheerMember('PL!N-test-unrevealed-all-blade', allBladeHeart()),
      PLAYER1,
      'unrevealed-all-blade'
    );
    const game = setupLiveSuccess({
      ownCheerCards: [allBladeCheer],
      resolutionCardIds: [allBladeCheer.instanceId],
      revealedCardIds: [],
    });

    const state = resolveLiveSuccess(game);

    expect(loveUScoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(3);
    expect(latestPayload(state)).toMatchObject({
      allBladeCheerCardIds: [],
      conditionMet: false,
    });
  });

  it('counts additional cheer once it is appended to the current cheer ids', () => {
    const baseCheer = createCardInstance(
      createCheerMember('PL!N-test-base-draw', [{ effect: BladeHeartEffect.DRAW }]),
      PLAYER1,
      'base-cheer'
    );
    const additionalAllBlade = createCardInstance(
      createCheerMember('PL!N-test-additional-all-blade', allBladeHeart()),
      PLAYER1,
      'additional-all-blade'
    );
    const game = setupLiveSuccess({ ownCheerCards: [baseCheer, additionalAllBlade] });

    const state = resolveLiveSuccess(game);

    expect(loveUScoreModifiers(state)).toHaveLength(1);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(latestPayload(state)).toMatchObject({
      allBladeCheerCardIds: [additionalAllBlade.instanceId],
      conditionMet: true,
    });
  });

  it('continues pending live-success effects and binds each SCORE modifier to its source LIVE', () => {
    const firstLive = createCardInstance(createLoveUMyFriends(), PLAYER1, 'love-u-first');
    const secondLive = createCardInstance(createLoveUMyFriends(), PLAYER1, 'love-u-second');
    const allBladeCheer = createCardInstance(
      createCheerMember('PL!N-test-all-blade-order', allBladeHeart()),
      PLAYER1,
      'order-all-blade-cheer'
    );
    const game = setupLiveSuccess({
      sourceLives: [firstLive, secondLive],
      ownCheerCards: [allBladeCheer],
    });

    const state = resolveLiveSuccess(game);

    expect(state.pendingAbilities).toEqual([]);
    expect(loveUScoreModifiers(state)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: firstLive.instanceId,
        sourceCardId: firstLive.instanceId,
        abilityId: PL_N_BP3_030_LIVE_SUCCESS_CHEER_ALL_BLADE_THIS_LIVE_SCORE_ABILITY_ID,
      },
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: secondLive.instanceId,
        sourceCardId: secondLive.instanceId,
        abilityId: PL_N_BP3_030_LIVE_SUCCESS_CHEER_ALL_BLADE_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(8);
  });
});
