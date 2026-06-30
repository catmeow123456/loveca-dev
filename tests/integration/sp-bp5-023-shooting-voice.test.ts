import { describe, expect, it } from 'vitest';
import type { LiveCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, addCardToZone } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_BP5_023_LIVE_SUCCESS_SUCCESS_ZONE_TWO_SCORE_CHEER_THIS_LIVE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
  CardType,
  HeartColor,
  OrientationState,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createLive(
  cardCode: string,
  options: {
    readonly score?: number;
    readonly hasScoreBladeHeart?: boolean;
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: options.score ?? 5,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
    bladeHearts: options.hasScoreBladeHeart ? [{ effect: BladeHeartEffect.SCORE }] : [],
  };
}

function createPendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: `pending-${sourceCardId}`,
    abilityId: SP_BP5_023_LIVE_SUCCESS_SUCCESS_ZONE_TWO_SCORE_CHEER_THIS_LIVE_SCORE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success-event'],
  };
}

function setupState(options: {
  readonly ownSuccessCount?: number;
  readonly opponentSuccessCount?: number;
  readonly cheerCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly firstPlayerCheerCardIds?: readonly string[];
  readonly secondPlayerCheerCardIds?: readonly string[];
  readonly resolutionCardIds?: readonly string[];
  readonly revealedCardIds?: readonly string[];
  readonly initialScore?: number;
} = {}): {
  readonly game: GameState;
  readonly sourceLiveId: string;
  readonly cheerCardIds: readonly string[];
} {
  const sourceLive = createCardInstance(
    createLive('PL!SP-bp5-023-L', { score: 5 }),
    PLAYER1,
    'shooting-voice'
  );
  const ownSuccessLives = Array.from({ length: options.ownSuccessCount ?? 0 }, (_, index) =>
    createCardInstance(createLive(`PL!SP-own-success-${index}`), PLAYER1, `own-success-${index}`)
  );
  const opponentSuccessLives = Array.from(
    { length: options.opponentSuccessCount ?? 0 },
    (_, index) =>
      createCardInstance(
        createLive(`PL!SP-opponent-success-${index}`),
        PLAYER2,
        `opponent-success-${index}`
      )
  );
  const cheerCards = options.cheerCards ?? [];

  let game = createGameState('sp-bp5-023-shooting-voice', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    sourceLive,
    ...ownSuccessLives,
    ...opponentSuccessLives,
    ...cheerCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, sourceLive.instanceId, {
      orientation: OrientationState.ACTIVE,
    }),
    successZone: ownSuccessLives.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.successZone
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    successZone: opponentSuccessLives.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.successZone
    ),
  }));
  game = {
    ...game,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: options.resolutionCardIds ?? cheerCards.map((card) => card.instanceId),
      revealedCardIds: options.revealedCardIds ?? cheerCards.map((card) => card.instanceId),
    },
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, options.initialScore ?? 5]]),
      firstPlayerCheerCardIds:
        options.firstPlayerCheerCardIds ?? cheerCards.map((card) => card.instanceId),
      secondPlayerCheerCardIds: options.secondPlayerCheerCardIds ?? [],
    },
  };

  return {
    game,
    sourceLiveId: sourceLive.instanceId,
    cheerCardIds: cheerCards.map((card) => card.instanceId),
  };
}

function startAbility(game: GameState, sourceLiveId: string): GameState {
  return confirmIfConfirmOnly(resolvePendingCardEffects({
    ...game,
    pendingAbilities: [createPendingAbility(sourceLiveId)],
  }).gameState);
}

function confirmIfConfirmOnly(game: GameState): GameState {
  return game.activeEffect?.metadata?.confirmOnlyPendingAbility === true
    ? confirmActiveEffectStep(game, PLAYER1, game.activeEffect.id)
    : game;
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_BP5_023_LIVE_SUCCESS_SUCCESS_ZONE_TWO_SCORE_CHEER_THIS_LIVE_SCORE_ABILITY_ID
    )
    .at(-1)?.payload;
}

function shootingVoiceScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        SP_BP5_023_LIVE_SUCCESS_SUCCESS_ZONE_TWO_SCORE_CHEER_THIS_LIVE_SCORE_ABILITY_ID
  );
}

describe('PL!SP-bp5-023-L Shooting Voice!! LIVE success workflow', () => {
  it('adds SCORE +2 to this LIVE and refreshes playerScores when own success zone has two cards and own cheer reveals a SCORE LIVE', () => {
    const scoreCheerLive = createCardInstance(
      createLive('PL!SP-score-cheer-live', { hasScoreBladeHeart: true }),
      PLAYER1,
      'score-cheer-live'
    );
    const { game, sourceLiveId } = setupState({
      ownSuccessCount: 2,
      cheerCards: [scoreCheerLive],
      initialScore: 5,
    });

    const state = startAbility(game, sourceLiveId);

    expect(shootingVoiceScoreModifiers(state)).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 2,
      liveCardId: sourceLiveId,
      sourceCardId: sourceLiveId,
      abilityId: SP_BP5_023_LIVE_SUCCESS_SUCCESS_ZONE_TWO_SCORE_CHEER_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: true,
      scoreCheerLiveCardIds: [scoreCheerLive.instanceId],
      scoreBonus: 2,
    });
  });

  it('also satisfies the success-zone condition when opponent success zone has two cards', () => {
    const scoreCheerLive = createCardInstance(
      createLive('PL!SP-score-cheer-live', { hasScoreBladeHeart: true }),
      PLAYER1,
      'score-cheer-live'
    );
    const { game, sourceLiveId } = setupState({
      opponentSuccessCount: 2,
      cheerCards: [scoreCheerLive],
    });

    const state = startAbility(game, sourceLiveId);

    expect(shootingVoiceScoreModifiers(state)).toHaveLength(1);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(7);
  });

  it('does not add SCORE when neither player has two successful LIVE cards', () => {
    const scoreCheerLive = createCardInstance(
      createLive('PL!SP-score-cheer-live', { hasScoreBladeHeart: true }),
      PLAYER1,
      'score-cheer-live'
    );
    const { game, sourceLiveId } = setupState({
      ownSuccessCount: 1,
      opponentSuccessCount: 1,
      cheerCards: [scoreCheerLive],
    });

    const state = startAbility(game, sourceLiveId);

    expect(shootingVoiceScoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: false,
      successZoneConditionMet: false,
    });
  });

  it('does not add SCORE when own revealed cheer has no SCORE LIVE', () => {
    const noScoreLive = createCardInstance(createLive('PL!SP-no-score-live'), PLAYER1, 'no-score');
    const scoreMemberLikeLiveAbsent = createCardInstance(
      createLive('PL!SP-score-live-absent', { hasScoreBladeHeart: true }),
      PLAYER1,
      'score-live-absent'
    );
    const { game, sourceLiveId } = setupState({
      ownSuccessCount: 2,
      cheerCards: [noScoreLive, scoreMemberLikeLiveAbsent],
      firstPlayerCheerCardIds: [noScoreLive.instanceId, scoreMemberLikeLiveAbsent.instanceId],
      resolutionCardIds: [noScoreLive.instanceId],
      revealedCardIds: [noScoreLive.instanceId],
    });

    const state = startAbility(game, sourceLiveId);

    expect(shootingVoiceScoreModifiers(state)).toEqual([]);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: false,
      scoreCheerLiveCardIds: [],
    });
  });

  it('ignores opponent cheer, old cheer, absent, and unrevealed SCORE LIVE cards', () => {
    const validScoreLive = createCardInstance(
      createLive('PL!SP-valid-score-live', { hasScoreBladeHeart: true }),
      PLAYER1,
      'valid-score-live'
    );
    const opponentScoreLive = createCardInstance(
      createLive('PL!SP-opponent-score-live', { hasScoreBladeHeart: true }),
      PLAYER2,
      'opponent-score-live'
    );
    const oldScoreLive = createCardInstance(
      createLive('PL!SP-old-score-live', { hasScoreBladeHeart: true }),
      PLAYER1,
      'old-score-live'
    );
    const absentScoreLive = createCardInstance(
      createLive('PL!SP-absent-score-live', { hasScoreBladeHeart: true }),
      PLAYER1,
      'absent-score-live'
    );
    const unrevealedScoreLive = createCardInstance(
      createLive('PL!SP-unrevealed-score-live', { hasScoreBladeHeart: true }),
      PLAYER1,
      'unrevealed-score-live'
    );
    const { game, sourceLiveId } = setupState({
      ownSuccessCount: 2,
      cheerCards: [
        validScoreLive,
        opponentScoreLive,
        oldScoreLive,
        absentScoreLive,
        unrevealedScoreLive,
      ],
      firstPlayerCheerCardIds: [
        validScoreLive.instanceId,
        opponentScoreLive.instanceId,
        absentScoreLive.instanceId,
        unrevealedScoreLive.instanceId,
      ],
      secondPlayerCheerCardIds: [opponentScoreLive.instanceId],
      resolutionCardIds: [
        validScoreLive.instanceId,
        opponentScoreLive.instanceId,
        oldScoreLive.instanceId,
        unrevealedScoreLive.instanceId,
      ],
      revealedCardIds: [
        validScoreLive.instanceId,
        opponentScoreLive.instanceId,
        oldScoreLive.instanceId,
      ],
    });

    const state = startAbility(game, sourceLiveId);

    expect(latestPayload(state)).toMatchObject({
      conditionMet: true,
      scoreCheerLiveCardIds: [validScoreLive.instanceId],
    });
    expect(shootingVoiceScoreModifiers(state)).toHaveLength(1);
  });
});
