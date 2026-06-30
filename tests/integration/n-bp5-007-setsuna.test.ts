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
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_N_BP5_007_LIVE_START_EQUAL_SUCCESS_ZONES_GAIN_RED_HEART_ABILITY_ID,
  PL_N_BP5_007_LIVE_SUCCESS_REMAINING_HEART_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createSetsuna(): MemberCardData {
  return {
    cardCode: 'PL!N-bp5-007-R＋',
    name: '優木せつ菜',
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: 7,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createSessionFromGame(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('n-bp5-007-setsuna-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function setupStageSource(options: {
  readonly ownSuccessCount?: number;
  readonly opponentSuccessCount?: number;
  readonly sourceOnStage?: boolean;
  readonly handCount?: number;
  readonly deckCount?: number;
  readonly remainingHearts?: readonly { readonly color: HeartColor; readonly count: number }[];
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly handIds: readonly string[];
  readonly drawIds: readonly string[];
} {
  const source = createCardInstance(createSetsuna(), PLAYER1, 'setsuna-source');
  const currentLive = createCardInstance(createLive('PL!N-current-live'), PLAYER1, 'current-live');
  const ownSuccessLives = Array.from({ length: options.ownSuccessCount ?? 0 }, (_, index) =>
    createCardInstance(createLive(`PL!N-own-success-${index}`), PLAYER1, `own-success-${index}`)
  );
  const opponentSuccessLives = Array.from(
    { length: options.opponentSuccessCount ?? 0 },
    (_, index) =>
      createCardInstance(createLive(`PL!N-opponent-success-${index}`), PLAYER2, `opp-success-${index}`)
  );
  const handCards = Array.from({ length: options.handCount ?? 0 }, (_, index) =>
    createCardInstance(createMember(`PL!N-hand-${index}`), PLAYER1, `hand-${index}`)
  );
  const drawCards = Array.from({ length: options.deckCount ?? 0 }, (_, index) =>
    createCardInstance(createMember(`PL!N-draw-${index}`), PLAYER1, `draw-${index}`)
  );

  let game = createGameState('n-bp5-007-setsuna', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    currentLive,
    ...ownSuccessLives,
    ...opponentSuccessLives,
    ...handCards,
    ...drawCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.sourceOnStage === false ? [source.instanceId] : [],
    },
    successZone: {
      ...player.successZone,
      cardIds: ownSuccessLives.map((card) => card.instanceId),
    },
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    successZone: {
      ...player.successZone,
      cardIds: opponentSuccessLives.map((card) => card.instanceId),
    },
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      liveResults: new Map([[currentLive.instanceId, true]]),
      playerRemainingHearts: new Map([[PLAYER1, options.remainingHearts ?? []]]),
    },
  };

  return {
    game,
    sourceId: source.instanceId,
    handIds: handCards.map((card) => card.instanceId),
    drawIds: drawCards.map((card) => card.instanceId),
  };
}

function resolveTiming(game: GameState, timing: TriggerCondition): GameState {
  return resolvePendingCardEffects(enqueueTriggeredCardEffects(game, [timing])).gameState;
}

function resolveManualPending(game: GameState, sourceId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      {
        id: 'manual-setsuna-live-start',
        abilityId: PL_N_BP5_007_LIVE_START_EQUAL_SUCCESS_ZONES_GAIN_RED_HEART_ABILITY_ID,
        sourceCardId: sourceId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: ['manual-live-start'],
        sourceSlot: SlotPosition.CENTER,
      },
    ],
  }).gameState;
}

describe('PL!N-bp5-007 Setsuna workflow', () => {
  it('gains RED Heart x2 at live start when success zones are both 0', () => {
    const { game, sourceId } = setupStageSource();

    const state = resolveTiming(game, TriggerCondition.ON_LIVE_START);

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.RED, count: 2 }],
      sourceCardId: sourceId,
      abilityId: PL_N_BP5_007_LIVE_START_EQUAL_SUCCESS_ZONES_GAIN_RED_HEART_ABILITY_ID,
      target: 'SOURCE_MEMBER',
    });
  });

  it('consumes live-start pending without modifier when success zone counts differ', () => {
    const { game, sourceId } = setupStageSource({ ownSuccessCount: 1, opponentSuccessCount: 0 });

    const state = resolveTiming(game, TriggerCondition.ON_LIVE_START);

    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'HEART' &&
          modifier.sourceCardId === sourceId &&
          modifier.abilityId ===
            PL_N_BP5_007_LIVE_START_EQUAL_SUCCESS_ZONES_GAIN_RED_HEART_ABILITY_ID
      )
    ).toBe(false);
  });

  it('consumes stale live-start pending without modifier when source is not on stage', () => {
    const { game, sourceId } = setupStageSource({ sourceOnStage: false });

    const state = resolveManualPending(game, sourceId);

    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_BP5_007_LIVE_START_EQUAL_SUCCESS_ZONES_GAIN_RED_HEART_ABILITY_ID &&
          action.payload.sourceOnStage === false
      )
    ).toBe(true);
  });

  it('draws two and discards one on live success with remaining Heart', () => {
    const { game, handIds, drawIds } = setupStageSource({
      handCount: 1,
      deckCount: 2,
      remainingHearts: [{ color: HeartColor.RED, count: 1 }],
    });
    const started = resolveTiming(game, TriggerCondition.ON_LIVE_SUCCESS);

    expect(started.activeEffect?.abilityId).toBe(
      PL_N_BP5_007_LIVE_SUCCESS_REMAINING_HEART_DRAW_TWO_DISCARD_ONE_ABILITY_ID
    );
    expect(started.activeEffect?.metadata?.drawCount).toBe(2);
    expect(started.activeEffect?.metadata?.discardCount).toBe(1);

    const session = createSessionFromGame(started);
    const result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, handIds[0])
    );

    expect(result.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual(drawIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(handIds[0]);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === handIds[0]
      )
    ).toBe(true);
  });

  it('consumes live-success pending without draw when there is no remaining Heart', () => {
    const { game, handIds, drawIds } = setupStageSource({ handCount: 1, deckCount: 2 });

    const state = resolveTiming(game, TriggerCondition.ON_LIVE_SUCCESS);

    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual(handIds);
    expect(state.players[0].mainDeck.cardIds).toEqual(drawIds);
  });

  it('does not consume remaining Heart used as the live-success condition', () => {
    const remainingHearts = [{ color: HeartColor.RED, count: 1 }];
    const { game, handIds } = setupStageSource({
      handCount: 1,
      deckCount: 2,
      remainingHearts,
    });
    const started = resolveTiming(game, TriggerCondition.ON_LIVE_SUCCESS);
    const session = createSessionFromGame(started);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, handIds[0])
      ).success
    ).toBe(true);

    expect(session.state?.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual(
      remainingHearts
    );
  });
});
