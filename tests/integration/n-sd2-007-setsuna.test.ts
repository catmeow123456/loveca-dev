import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_N_SD2_007_LIVE_SUCCESS_DRAW_ONE_OPPONENT_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createSetsuna(cardCode = 'PL!N-sd2-007-P'): MemberCardData {
  return {
    cardCode,
    name: '優木せつ菜',
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
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
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createSessionFromGame(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('n-sd2-007-setsuna-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function setupGame(
  options: {
    readonly sourceCardCode?: string;
    readonly sourceOnStage?: boolean;
    readonly opponentLiveResult?: boolean;
    readonly opponentSuccessZoneCount?: number;
    readonly handCount?: number;
    readonly deckCount?: number;
  } = {}
): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly handIds: readonly string[];
  readonly drawIds: readonly string[];
} {
  const source = createCardInstance(
    createSetsuna(options.sourceCardCode),
    PLAYER1,
    'setsuna-source'
  );
  const ownLive = createCardInstance(createLive('PL!N-sd2-own-live'), PLAYER1, 'own-live');
  const opponentLive = createCardInstance(
    createLive('PL!N-sd2-opponent-live'),
    PLAYER2,
    'opponent-live'
  );
  const opponentSuccessZoneLives = Array.from(
    { length: options.opponentSuccessZoneCount ?? 0 },
    (_, index) =>
      createCardInstance(
        createLive(`PL!N-sd2-opponent-old-success-${index}`),
        PLAYER2,
        `opponent-old-success-${index}`
      )
  );
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createCardInstance(createMember(`PL!N-sd2-hand-${index}`), PLAYER1, `hand-${index}`)
  );
  const drawCards = Array.from({ length: options.deckCount ?? 2 }, (_, index) =>
    createCardInstance(createMember(`PL!N-sd2-draw-${index}`), PLAYER1, `draw-${index}`)
  );

  let game = createGameState('n-sd2-007-setsuna', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ownLive,
    opponentLive,
    ...opponentSuccessZoneLives,
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
    liveZone: addCardToStatefulZone(player.liveZone, ownLive.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
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
      cardIds: opponentSuccessZoneLives.map((card) => card.instanceId),
    },
  }));

  const liveResults = new Map<string, boolean>([[ownLive.instanceId, true]]);
  if (options.opponentLiveResult !== undefined) {
    liveResults.set(opponentLive.instanceId, options.opponentLiveResult);
  }
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      liveResults,
    },
  };

  return {
    game,
    sourceId: source.instanceId,
    handIds: handCards.map((card) => card.instanceId),
    drawIds: drawCards.map((card) => card.instanceId),
  };
}

function startLiveSuccess(game: GameState): GameState {
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_SUCCESS])
  ).gameState;
}

describe('PL!N-sd2-007-P 费用11「优木雪菜」', () => {
  it('shows a dynamic confirm-only window and draws only one when the opponent did not succeed', () => {
    const { game, handIds, drawIds } = setupGame();

    const started = startLiveSuccess(game);

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.activeEffect?.effectText).toContain(
      '本回合对方未成功LIVE，未满足追加效果条件；实际抽1张卡。'
    );
    expect(started.activeEffect?.stepText).toBe('确认后抽1张卡。');
    expect(started.players[0].hand.cardIds).toEqual(handIds);

    const resolved = confirmIfConfirmOnly(started, PLAYER1);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([...handIds, drawIds[0]]);
    expect(resolved.players[0].mainDeck.cardIds).toEqual([drawIds[1]]);
  });

  it('opens the real draw-two-discard-one window without a confirm-only double popup', () => {
    const { game, handIds, drawIds } = setupGame({ opponentLiveResult: true });

    const started = startLiveSuccess(game);

    expect(started.activeEffect?.abilityId).toBe(
      PL_N_SD2_007_LIVE_SUCCESS_DRAW_ONE_OPPONENT_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    );
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(started.activeEffect?.metadata?.drawCount).toBe(2);
    expect(started.activeEffect?.metadata?.discardCount).toBe(1);
    expect(started.activeEffect?.effectText).toContain(
      '本回合对方已成功LIVE，满足追加效果条件；实际抽2张卡，再将1张手牌放置入休息室。'
    );
    expect(started.activeEffect?.selectionLabel).toBe('请选择要放置入休息室的手牌');
    expect(started.players[0].hand.cardIds).toEqual([...handIds, ...drawIds]);

    const session = createSessionFromGame(started);
    const result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, started.activeEffect!.id, handIds[0])
    );

    expect(result.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
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

  it('ignores persistent opponent success-zone cards when liveResults has no opponent success', () => {
    const { game } = setupGame({ opponentSuccessZoneCount: 2 });

    const started = startLiveSuccess(game);

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.activeEffect?.effectText).toContain('本回合对方未成功LIVE');
  });

  it('ignores an opponent failed LIVE result', () => {
    const { game } = setupGame({ opponentLiveResult: false });

    const started = startLiveSuccess(game);

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(started.activeEffect?.effectText).toContain('本回合对方未成功LIVE');
  });

  it('uses the base-card gate for an unlisted rarity suffix', () => {
    const { game } = setupGame({
      sourceCardCode: 'PL!N-sd2-007-SEC',
      opponentLiveResult: true,
    });

    const started = startLiveSuccess(game);

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(started.activeEffect?.metadata?.drawCount).toBe(2);
  });

  it('consumes a stale pending without drawing when the source is no longer on stage', () => {
    const { game, sourceId, handIds, drawIds } = setupGame({ sourceOnStage: false });
    const stateWithPending: GameState = {
      ...game,
      pendingAbilities: [
        {
          id: 'manual-n-sd2-007-live-success',
          abilityId:
            PL_N_SD2_007_LIVE_SUCCESS_DRAW_ONE_OPPONENT_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
          sourceCardId: sourceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_SUCCESS,
          eventIds: ['manual-live-success'],
          sourceSlot: SlotPosition.CENTER,
        },
      ],
    };

    const resolved = resolvePendingCardEffects(stateWithPending).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual(handIds);
    expect(resolved.players[0].mainDeck.cardIds).toEqual(drawIds);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_SD2_007_LIVE_SUCCESS_DRAW_ONE_OPPONENT_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID &&
          action.payload.step === 'SOURCE_INVALID'
      )
    ).toBe(true);
  });
});
