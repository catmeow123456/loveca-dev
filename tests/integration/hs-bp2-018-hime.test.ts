import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  getLiveSetCardCountForPlayer,
  getLiveSetCardLimitForPlayer,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromZone,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  createConfirmSubPhaseAction,
  createSetLiveCardAction,
} from '../../src/application/actions';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { HS_BP2_018_ON_ENTER_PAY_TWO_ENERGY_PLACE_WAITING_LIVE_REDUCE_NEXT_LIVE_SET_LIMIT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

type CardInstance = ReturnType<typeof createCardInstance>;

function createHime(cardCode = 'PL!HS-bp2-018-N'): MemberCardData {
  return {
    cardCode,
    name: '安養寺 姫芽',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'Mira-Cra Park!',
    cardType: CardType.MEMBER,
    cost: 7,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.PINK, 1), createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function setupOnEnter(
  options: {
    readonly activeEnergyCount?: number;
    readonly waitingCards?: readonly CardInstance[];
    readonly sourceOnStage?: boolean;
    readonly phase?: GamePhase;
    readonly activePlayerIndex?: number;
    readonly extraCards?: readonly CardInstance[];
    readonly handCardIds?: readonly string[];
    readonly mainDeckCardIds?: readonly string[];
  } = {}
): {
  readonly session: GameSession;
  readonly source: CardInstance;
  readonly energyIds: readonly string[];
} {
  const waitingCards = options.waitingCards ?? [];
  const extraCards = options.extraCards ?? [];
  const activeEnergyCount = options.activeEnergyCount ?? 2;
  const source = createCardInstance(createHime(), PLAYER1, 'hime-source');
  const energyCards = Array.from({ length: activeEnergyCount }, (_, index) =>
    createCardInstance(createEnergy(`PL!energy-${index}`), PLAYER1, `energy-${index}`)
  );

  let game = createGameState('hs-bp2-018-hime-state', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...energyCards, ...waitingCards, ...extraCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let energyZone = player.energyZone;
    for (const energy of energyCards) {
      energyZone = addCardToStatefulZone(energyZone, energy.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      energyZone,
      waitingRoom: waitingCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.waitingRoom
      ),
      hand: (options.handCardIds ?? []).reduce(
        (zone, cardId) => addCardToZone(zone, cardId),
        player.hand
      ),
      mainDeck: (options.mainDeckCardIds ?? []).reduce(
        (zone, cardId) => addCardToZone(zone, cardId),
        player.mainDeck
      ),
      memberSlots:
        options.sourceOnStage === false
          ? player.memberSlots
          : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }),
    };
  });
  game = {
    ...game,
    currentPhase: options.phase ?? GamePhase.MAIN_PHASE,
    activePlayerIndex: options.activePlayerIndex ?? 0,
  };
  game = emitGameEvent(
    game,
    createEnterStageEvent(source.instanceId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );
  game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
  game = resolvePendingCardEffects(game).gameState;

  const session = createGameSession();
  session.createGame('hs-bp2-018-hime-session', PLAYER1, 'P1', PLAYER2, 'P2');
  setSessionState(session, game);
  return { session, source, energyIds: energyCards.map((card) => card.instanceId) };
}

function setSessionState(session: GameSession, state: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}

function confirmOption(session: GameSession, selectedOptionId: string | null): void {
  const effect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effect.id, null, null, undefined, selectedOptionId)
  );
  expect(result.success).toBe(true);
}

function confirmCard(session: GameSession, selectedCardId: string): void {
  const effect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effect.id, selectedCardId)
  );
  expect(result.success).toBe(true);
}

function hasPayCostAction(state: GameState): boolean {
  return state.actionHistory.some(
    (action) =>
      action.type === 'PAY_COST' &&
      action.payload.abilityId ===
        HS_BP2_018_ON_ENTER_PAY_TWO_ENERGY_PLACE_WAITING_LIVE_REDUCE_NEXT_LIVE_SET_LIMIT_ABILITY_ID
  );
}

function completeNormalEffect(
  options: {
    readonly extraCards?: readonly CardInstance[];
    readonly handCardIds?: readonly string[];
    readonly mainDeckCardIds?: readonly string[];
  } = {}
): { readonly state: GameState; readonly placedLive: CardInstance } {
  const placedLive = createCardInstance(createLive('PL!HS-test-live'), PLAYER1, 'waiting-live');
  const { session } = setupOnEnter({
    waitingCards: [placedLive],
    extraCards: options.extraCards,
    handCardIds: options.handCardIds,
    mainDeckCardIds: options.mainDeckCardIds,
  });
  confirmOption(session, 'pay');
  confirmCard(session, placedLive.instanceId);
  return { state: session.state!, placedLive };
}

describe('PL!HS-bp2-018-N Hime on-enter workflow', () => {
  it.each([
    ['not main phase', GamePhase.DRAW_PHASE, 0, 'NOT_OWN_MAIN_PHASE'],
    ['opponent main phase', GamePhase.MAIN_PHASE, 1, 'NOT_OWN_MAIN_PHASE'],
  ] as const)('resolves no-op during %s', (_label, phase, activePlayerIndex, reason) => {
    const live = createCardInstance(createLive('PL!HS-test-live'), PLAYER1, 'waiting-live');
    const { session, energyIds } = setupOnEnter({
      waitingCards: [live],
      phase,
      activePlayerIndex,
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(hasPayCostAction(session.state!)).toBe(false);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(live.instanceId);
    expect(
      energyIds.every(
        (cardId) =>
          session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation ===
          OrientationState.ACTIVE
      )
    ).toBe(true);
    expect(session.state?.actionHistory.at(-1)?.payload.reason).toBe(reason);
  });

  it('does not open payment when fewer than two active energy cards are available', () => {
    const live = createCardInstance(createLive('PL!HS-test-live'), PLAYER1, 'waiting-live');
    const { session, energyIds } = setupOnEnter({ activeEnergyCount: 1, waitingCards: [live] });

    expect(session.state?.activeEffect).toBeNull();
    expect(hasPayCostAction(session.state!)).toBe(false);
    expect(session.state?.players[0].energyZone.cardStates.get(energyIds[0]!)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state?.actionHistory.at(-1)?.payload.reason).toBe('INSUFFICIENT_ACTIVE_ENERGY');
  });

  it('does not open payment when the waiting room has no LIVE card', () => {
    const member = createCardInstance(createMember('PL!HS-test-member'), PLAYER1, 'waiting-member');
    const { session } = setupOnEnter({ waitingCards: [member] });

    expect(session.state?.activeEffect).toBeNull();
    expect(hasPayCostAction(session.state!)).toBe(false);
    expect(session.state?.actionHistory.at(-1)?.payload.reason).toBe('NO_WAITING_ROOM_LIVE_TARGET');
  });

  it('declines without paying, moving a LIVE card, or registering the limit reduction', () => {
    const live = createCardInstance(createLive('PL!HS-test-live'), PLAYER1, 'waiting-live');
    const { session, energyIds } = setupOnEnter({ waitingCards: [live] });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId:
        HS_BP2_018_ON_ENTER_PAY_TWO_ENERGY_PLACE_WAITING_LIVE_REDUCE_NEXT_LIVE_SET_LIMIT_ABILITY_ID,
      selectableOptions: [{ id: 'pay', label: '支付[E][E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    confirmOption(session, null);

    expect(session.state?.activeEffect).toBeNull();
    expect(hasPayCostAction(session.state!)).toBe(false);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(live.instanceId);
    expect(session.state?.players[0].liveZone.cardIds).not.toContain(live.instanceId);
    expect(session.state?.liveSetLimitReductions).toEqual([]);
    expect(
      energyIds.every(
        (cardId) =>
          session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation ===
          OrientationState.ACTIVE
      )
    ).toBe(true);
  });

  it('pays exactly two active energy cards, then places a selected waiting-room LIVE face-up and records its event', () => {
    const live = createCardInstance(createLive('PL!HS-test-live'), PLAYER1, 'waiting-live');
    const member = createCardInstance(createMember('PL!HS-test-member'), PLAYER1, 'waiting-member');
    const { session, source, energyIds } = setupOnEnter({ waitingCards: [member, live] });

    confirmOption(session, 'pay');

    expect(hasPayCostAction(session.state!)).toBe(true);
    expect(
      energyIds.map(
        (cardId) => session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([OrientationState.WAITING, OrientationState.WAITING]);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: 'HS_BP2_018_SELECT_WAITING_LIVE_TO_PLACE_FACE_UP',
      selectableCardIds: [live.instanceId],
      canSkipSelection: false,
    });

    confirmCard(session, live.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([member.instanceId]);
    expect(session.state?.players[0].liveZone.cardIds).toContain(live.instanceId);
    expect(session.state?.players[0].liveZone.cardStates.get(live.instanceId)?.face).toBe(
      FaceState.FACE_UP
    );
    expect(getLiveSetCardLimitForPlayer(session.state!, PLAYER1)).toBe(2);
    expect(session.state?.liveSetLimitReductions).toEqual([
      expect.objectContaining({
        playerId: PLAYER1,
        sourceCardId: source.instanceId,
        abilityId:
          HS_BP2_018_ON_ENTER_PAY_TWO_ENERGY_PLACE_WAITING_LIVE_REDUCE_NEXT_LIVE_SET_LIMIT_ABILITY_ID,
        amount: 1,
      }),
    ]);
    expect(
      session.state?.eventLog.some(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_LIVE_ZONE &&
          event.cardInstanceId === live.instanceId &&
          event.fromZone === ZoneType.WAITING_ROOM &&
          event.toZone === ZoneType.LIVE_ZONE &&
          'face' in event &&
          event.face === FaceState.FACE_UP
      )
    ).toBe(true);
  });

  it('rejects an expired target without moving it or registering a partial limit reduction', () => {
    const live = createCardInstance(createLive('PL!HS-test-live'), PLAYER1, 'waiting-live');
    const { session, energyIds } = setupOnEnter({ waitingCards: [live] });
    confirmOption(session, 'pay');

    const staleState = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: removeCardFromZone(player.waitingRoom, live.instanceId),
    }));
    setSessionState(session, staleState);
    const effect = session.state!.activeEffect!;
    const staleResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effect.id, live.instanceId)
    );

    expect(staleResult.success).toBe(false);
    expect(session.state?.activeEffect?.stepId).toBe(
      'HS_BP2_018_SELECT_WAITING_LIVE_TO_PLACE_FACE_UP'
    );
    expect(session.state?.players[0].liveZone.cardIds).not.toContain(live.instanceId);
    expect(session.state?.liveSetLimitReductions).toEqual([]);
    expect(
      energyIds.map(
        (cardId) => session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([OrientationState.WAITING, OrientationState.WAITING]);
  });

  it('applies the reduction only to the next own Live Set, does not consume it for the opponent, then restores the following own phase', () => {
    const setLives = Array.from({ length: 5 }, (_, index) =>
      createCardInstance(createLive(`PL!HS-set-live-${index}`), PLAYER1, `set-live-${index}`)
    );
    const drawCards = Array.from({ length: 5 }, (_, index) =>
      createCardInstance(createMember(`PL!HS-draw-member-${index}`), PLAYER1, `draw-${index}`)
    );
    const { state } = completeNormalEffect({
      extraCards: [...setLives, ...drawCards],
      handCardIds: setLives.map((card) => card.instanceId),
      mainDeckCardIds: drawCards.map((card) => card.instanceId),
    });
    const service = new GameService();

    const opponentCompletion = service.processAction(
      {
        ...state,
        currentPhase: GamePhase.LIVE_SET_PHASE,
        currentSubPhase: SubPhase.LIVE_SET_SECOND_PLAYER,
      },
      createConfirmSubPhaseAction(PLAYER2, SubPhase.LIVE_SET_SECOND_PLAYER)
    );
    expect(opponentCompletion.success).toBe(true);
    expect(getLiveSetCardLimitForPlayer(opponentCompletion.gameState, PLAYER1)).toBe(2);
    expect(opponentCompletion.gameState.liveSetLimitReductions).toHaveLength(1);

    let ownLiveSetState: GameState = {
      ...opponentCompletion.gameState,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      liveSetCompletedPlayers: [],
    };
    const first = service.processAction(
      ownLiveSetState,
      createSetLiveCardAction(PLAYER1, setLives[0]!.instanceId)
    );
    expect(first.success).toBe(true);
    const second = service.processAction(
      first.gameState,
      createSetLiveCardAction(PLAYER1, setLives[1]!.instanceId)
    );
    expect(second.success).toBe(true);
    const blockedThird = service.processAction(
      second.gameState,
      createSetLiveCardAction(PLAYER1, setLives[2]!.instanceId)
    );
    expect(blockedThird.success).toBe(false);
    expect(blockedThird.error).toContain('已达到 Live 卡放置上限');
    expect(getLiveSetCardCountForPlayer(second.gameState, PLAYER1)).toBe(2);

    const ownCompletion = service.processAction(
      second.gameState,
      createConfirmSubPhaseAction(PLAYER1, SubPhase.LIVE_SET_FIRST_PLAYER)
    );
    expect(ownCompletion.success).toBe(true);
    expect(ownCompletion.gameState.liveSetLimitReductions).toEqual([]);
    expect(getLiveSetCardLimitForPlayer(ownCompletion.gameState, PLAYER1)).toBe(3);

    ownLiveSetState = {
      ...ownCompletion.gameState,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      liveSetCompletedPlayers: [],
    };
    for (const live of setLives.slice(2, 5)) {
      const result = service.processAction(
        ownLiveSetState,
        createSetLiveCardAction(PLAYER1, live.instanceId)
      );
      expect(result.success).toBe(true);
      ownLiveSetState = result.gameState;
    }
    expect(getLiveSetCardCountForPlayer(ownLiveSetState, PLAYER1)).toBe(3);
  });

  it('continues ordered pending resolution after declining the first optional window', () => {
    const firstSource = createCardInstance(createHime(), PLAYER1, 'hime-source-a');
    const secondSource = createCardInstance(createHime(), PLAYER1, 'hime-source-b');
    const energies = Array.from({ length: 2 }, (_, index) =>
      createCardInstance(createEnergy(`PL!energy-${index}`), PLAYER1, `energy-${index}`)
    );
    const live = createCardInstance(createLive('PL!HS-test-live'), PLAYER1, 'waiting-live');
    let game = createGameState('hs-bp2-018-ordered', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [firstSource, secondSource, ...energies, live]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      energyZone: energies.reduce(
        (zone, card) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
      waitingRoom: addCardToZone(player.waitingRoom, live.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, firstSource.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.RIGHT,
        secondSource.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    game = { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 };
    game = emitGameEvent(
      game,
      createEnterStageEvent(
        firstSource.instanceId,
        ZoneType.HAND,
        SlotPosition.LEFT,
        PLAYER1,
        PLAYER1
      )
    );
    game = emitGameEvent(
      game,
      createEnterStageEvent(
        secondSource.instanceId,
        ZoneType.HAND,
        SlotPosition.RIGHT,
        PLAYER1,
        PLAYER1
      )
    );
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
    game = resolvePendingCardEffects(game).gameState;

    const session = createGameSession();
    session.createGame('hs-bp2-018-ordered-session', PLAYER1, 'P1', PLAYER2, 'P2');
    const currentSourceCardId = game.activeEffect!.sourceCardId;
    const nextSourceCardId =
      currentSourceCardId === firstSource.instanceId
        ? secondSource.instanceId
        : firstSource.instanceId;
    setSessionState(session, {
      ...game,
      pendingAbilities: [
        ...game.pendingAbilities,
        {
          id: 'hs-bp2-018-ordered-next',
          abilityId:
            HS_BP2_018_ON_ENTER_PAY_TWO_ENERGY_PLACE_WAITING_LIVE_REDUCE_NEXT_LIVE_SET_LIMIT_ABILITY_ID,
          sourceCardId: nextSourceCardId,
          controllerId: PLAYER1,
          mandatory: false,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          eventIds: ['hs-bp2-018-ordered-next-event'],
        },
      ],
      activeEffect: {
        ...game.activeEffect!,
        metadata: { ...game.activeEffect!.metadata, orderedResolution: true },
      },
    });

    confirmOption(session, null);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId:
        HS_BP2_018_ON_ENTER_PAY_TWO_ENERGY_PLACE_WAITING_LIVE_REDUCE_NEXT_LIVE_SET_LIMIT_ABILITY_ID,
      stepId: 'HS_BP2_018_PAY_TWO_ENERGY_FOR_WAITING_LIVE',
    });
    expect(session.state?.activeEffect?.sourceCardId).toBe(nextSourceCardId);
  });
});
