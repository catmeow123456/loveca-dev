import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  BP3_001_ACTIVATED_WAIT_SELF_DRAW_DISCARD_ABILITY_ID,
  BP3_001_LIVE_START_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID,
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
  TurnType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 20 }, (_, index) =>
    createMemberCard(`MEM-${index}`, `Member ${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forcePhase(
  state: GameState,
  options: { readonly phase?: GamePhase; readonly activePlayerIndex?: number } = {}
): void {
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  mutableState.currentPhase = options.phase ?? GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = options.activePlayerIndex ?? 0;
  mutableState.waitingPlayerId = null;
}

function createSessionFromGame(game: GameState): GameSession {
  const session = createGameSession();
  session.createGame('pl-bp3-001-honoka-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function setupActivatedScenario(
  options: {
    readonly sourceOnStage?: boolean;
    readonly sourceOrientation?: OrientationState;
    readonly phase?: GamePhase;
    readonly activePlayerIndex?: number;
    readonly handCount?: number;
    readonly drawCount?: number;
  } = {}
) {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('pl-bp3-001-honoka-activated', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard('PL!-bp3-001-R', '高坂穂乃果', 13),
    PLAYER1,
    'honoka-source'
  );
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createCardInstance(createMemberCard(`HAND-${index}`, `Hand ${index}`), PLAYER1, `hand-${index}`)
  );
  const drawnCards = Array.from({ length: options.drawCount ?? 1 }, (_, index) =>
    createCardInstance(createMemberCard(`DRAW-${index}`, `Draw ${index}`), PLAYER1, `draw-${index}`)
  );

  const state = registerCards(session.state!, [source, ...handCards, ...drawnCards]);
  (session as unknown as { authorityState: GameState }).authorityState = state;
  forcePhase(state, { phase: options.phase, activePlayerIndex: options.activePlayerIndex });

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p1.hand.cardIds = [
    ...(options.sourceOnStage === false ? [source.instanceId] : []),
    ...handCards.map((card) => card.instanceId),
  ];
  p1.mainDeck.cardIds = drawnCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: options.sourceOnStage === false ? null : source.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map(
    options.sourceOnStage === false
      ? []
      : [
          [
            source.instanceId,
            {
              orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            },
          ],
        ]
  );

  return {
    session,
    sourceId: source.instanceId,
    handIds: handCards.map((card) => card.instanceId),
    drawIds: drawnCards.map((card) => card.instanceId),
  };
}

function activateHonoka(session: GameSession, sourceId: string) {
  return session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      sourceId,
      BP3_001_ACTIVATED_WAIT_SELF_DRAW_DISCARD_ABILITY_ID
    )
  );
}

function setupLiveStartScenario(options: {
  readonly sourceOrientation?: OrientationState;
  readonly otherOrientation?: OrientationState;
  readonly includeOther?: boolean;
}) {
  const source = createCardInstance(
    createMemberCard('PL!-bp3-001-P', '高坂穂乃果', 13),
    PLAYER1,
    'live-start-honoka'
  );
  const other = createCardInstance(
    createMemberCard('PL!-test-other-member', 'Other Member', 2),
    PLAYER1,
    'live-start-other'
  );
  let game = createGameState('pl-bp3-001-live-start', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, other]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.includeOther !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, other.instanceId, {
        orientation: options.otherOrientation ?? OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
    }
    return { ...player, memberSlots };
  });
  const resolved = resolvePendingCardEffects(
    enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_START])
  ).gameState;
  return { game: resolved, sourceId: source.instanceId, otherId: other.instanceId };
}

describe('PL!-bp3-001 Honoka workflow', () => {
  it('waits itself as activated cost, draws one, discards one, and preserves both triggers', () => {
    const { session, sourceId, handIds, drawIds } = setupActivatedScenario();

    expect(activateHonoka(session, sourceId).success).toBe(true);
    expect(session.state?.players[0].memberSlots.cardStates.get(sourceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP3_001_ACTIVATED_WAIT_SELF_DRAW_DISCARD_ABILITY_ID
    );
    expect(session.state?.players[0].hand.cardIds).toEqual([handIds[0], drawIds[0]]);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === sourceId
      )
    ).toBe(true);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, drawIds[0])
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([drawIds[0]]);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === drawIds[0]
      )
    ).toBe(true);
  });

  it('does not activate when source is absent, waiting, outside main phase, or not current player', () => {
    const absent = setupActivatedScenario({ sourceOnStage: false });
    expect(activateHonoka(absent.session, absent.sourceId).success).toBe(false);

    const waiting = setupActivatedScenario({ sourceOrientation: OrientationState.WAITING });
    expect(activateHonoka(waiting.session, waiting.sourceId).success).toBe(false);

    const wrongPhase = setupActivatedScenario({ phase: GamePhase.PERFORMANCE_PHASE });
    expect(activateHonoka(wrongPhase.session, wrongPhase.sourceId).success).toBe(false);

    const wrongPlayer = setupActivatedScenario({ activePlayerIndex: 1 });
    expect(activateHonoka(wrongPlayer.session, wrongPlayer.sourceId).success).toBe(false);

    for (const scenario of [absent, waiting, wrongPhase, wrongPlayer]) {
      expect(
        scenario.session.state?.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId === BP3_001_ACTIVATED_WAIT_SELF_DRAW_DISCARD_ABILITY_ID &&
            action.payload.step === 'ABILITY_USE'
        )
      ).toBe(false);
    }
  });

  it('enforces the activated per-turn limit only after the wait cost succeeds', () => {
    const { session, sourceId, drawIds } = setupActivatedScenario();

    expect(activateHonoka(session, sourceId).success).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, drawIds[0])
      ).success
    ).toBe(true);

    const p1 = session.state!.players[0] as unknown as {
      memberSlots: {
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    p1.memberSlots.cardStates.set(sourceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });

    expect(activateHonoka(session, sourceId).success).toBe(false);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === BP3_001_ACTIVATED_WAIT_SELF_DRAW_DISCARD_ABILITY_ID
      )
    ).toHaveLength(1);
  });

  it('opens live-start optional selection and activates a waiting own stage member', () => {
    const { game, otherId } = setupLiveStartScenario({ otherOrientation: OrientationState.WAITING });
    const session = createSessionFromGame(game);

    expect(session.state?.activeEffect?.abilityId).toBe(
      BP3_001_LIVE_START_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([otherId]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, otherId)
      ).success
    ).toBe(true);

    expect(session.state?.players[0].memberSlots.cardStates.get(otherId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === otherId
      )
    ).toBe(true);
  });

  it('can choose the source itself when it is the waiting stage member', () => {
    const { game, sourceId } = setupLiveStartScenario({
      sourceOrientation: OrientationState.WAITING,
      otherOrientation: OrientationState.ACTIVE,
    });

    expect(game.activeEffect?.selectableCardIds).toEqual([sourceId]);
  });

  it('can skip live-start selection without changing member orientation', () => {
    const { game, otherId } = setupLiveStartScenario({ otherOrientation: OrientationState.WAITING });
    const session = createSessionFromGame(game);

    expect(
      session.executeCommand(createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id))
        .success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.cardStates.get(otherId)?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('consumes live-start pending as no-op when there is no non-active own stage member', () => {
    const { game } = setupLiveStartScenario({ otherOrientation: OrientationState.ACTIVE });

    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities).toEqual([]);
    expect(
      game.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            BP3_001_LIVE_START_ACTIVATE_OWN_STAGE_MEMBER_ABILITY_ID &&
          action.payload.step === 'NO_WAITING_OWN_STAGE_MEMBER_TARGET'
      )
    ).toBe(true);
  });
});
