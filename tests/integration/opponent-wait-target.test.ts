import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import type { DeckConfig } from '../../src/application/game-service';
import {
  PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
  HS_PB1_010_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_PB1_010_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  S_BP6_012_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID,
  S_BP6_015_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
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
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
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
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMemberCard(`MEM-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };

  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.MAIN_FREE;
  state.currentTurnType = TurnType.NORMAL;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
}

function clearPlayerZones(player: {
  hand: { cardIds: string[] };
  mainDeck: { cardIds: string[] };
  waitingRoom: { cardIds: string[] };
  successZone: { cardIds: string[] };
  liveZone: { cardIds: string[] };
}): void {
  player.hand.cardIds = [];
  player.mainDeck.cardIds = [];
  player.waitingRoom.cardIds = [];
  player.successZone.cardIds = [];
  player.liveZone.cardIds = [];
}

function setupPb1010LiveStartPending(options: {
  readonly hasHighCostOwnMember: boolean;
  readonly targetOrientation: OrientationState | null;
  readonly pendingCount?: 1 | 2;
}): {
  readonly game: GameState;
  readonly sourceCardIds: readonly string[];
  readonly targetCardId: string | null;
} {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('opponent-wait-target-hs-pb1-010-live-start', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  const pendingCount = options.pendingCount ?? 1;
  const sources = Array.from({ length: pendingCount }, (_, index) =>
    createCardInstance(
      createMemberCard('PL!HS-pb1-010-R', `村野さやか${index}`, 2),
      PLAYER1,
      `p1-hs-pb1-010-live-start-source-${index}`
    )
  );
  const highCostOwnMember = options.hasHighCostOwnMember
    ? createCardInstance(
        createMemberCard('PL!HS-test-live-start-cost-10', 'Cost 10', 10),
        PLAYER1,
        'p1-hs-pb1-010-live-start-high-cost'
      )
    : null;
  const target =
    options.targetOrientation === null
      ? null
      : createCardInstance(
          createMemberCard('PL!HS-test-live-start-cost-4', 'Cost 4', 4),
          PLAYER2,
          'p2-hs-pb1-010-live-start-target'
        );
  const game = registerCards(session.state!, [
    ...sources,
    ...(highCostOwnMember ? [highCostOwnMember] : []),
    ...(target ? [target] : []),
  ]);
  const p1 = game.players[0] as unknown as {
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
  const p2 = game.players[1] as unknown as typeof p1;
  clearPlayerZones(p1);
  clearPlayerZones(p2);
  const slots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
  p1.memberSlots.cardStates = new Map();
  for (const [index, source] of sources.entries()) {
    const slot = slots[index]!;
    p1.memberSlots.slots[slot] = source.instanceId;
    p1.memberSlots.cardStates.set(source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
  }
  if (highCostOwnMember) {
    const slot = slots[sources.length]!;
    p1.memberSlots.slots[slot] = highCostOwnMember.instanceId;
    p1.memberSlots.cardStates.set(highCostOwnMember.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
  }
  if (target && options.targetOrientation) {
    p2.memberSlots.slots[SlotPosition.CENTER] = target.instanceId;
    p2.memberSlots.cardStates = new Map([
      [target.instanceId, { orientation: options.targetOrientation, face: FaceState.FACE_UP }],
    ]);
  }
  return {
    game: {
      ...game,
      pendingAbilities: sources.map((source, index) => ({
        id: `hs-pb1-010-live-start-pending-${index}`,
        abilityId: HS_PB1_010_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
        sourceCardId: source.instanceId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_START,
        sourceSlot: slots[index],
      })),
    },
    sourceCardIds: sources.map((source) => source.instanceId),
    targetCardId: target?.instanceId ?? null,
  };
}

describe('opponent wait target shared workflow', () => {
  it('uses PL!HS-pb1-010 printed cost gates and waits a cost-four target through the state-change wrapper', () => {
    const session = createGameSession();
    const deck = createDeck();
    session.createGame('opponent-wait-target-hs-pb1-010', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-pb1-010-R', '村野さやか', 2),
      PLAYER1,
      'p1-hs-pb1-010-source'
    );
    const highCostOwnMember = createCardInstance(
      createMemberCard('PL!HS-test-cost-10', 'Cost 10', 10),
      PLAYER1,
      'p1-hs-pb1-010-high-cost'
    );
    const target = createCardInstance(
      createMemberCard('PL!HS-test-cost-4', 'Cost 4', 4),
      PLAYER2,
      'p2-hs-pb1-010-target'
    );
    const state = registerCards(session.state!, [source, highCostOwnMember, target]);
    (session as unknown as { authorityState: GameState }).authorityState = state;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: { slots: Record<SlotPosition, string | null>; cardStates: Map<string, { orientation: OrientationState; face: FaceState }> };
    };
    const p2 = state.players[1] as unknown as typeof p1;
    clearPlayerZones(p1);
    clearPlayerZones(p2);
    p1.hand.cardIds = [source.instanceId];
    p1.memberSlots.slots[SlotPosition.LEFT] = highCostOwnMember.instanceId;
    p1.memberSlots.cardStates = new Map([[highCostOwnMember.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }]]);
    p2.memberSlots.slots[SlotPosition.CENTER] = target.instanceId;
    p2.memberSlots.cardStates = new Map([[target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }]]);

    expect(session.executeCommand(createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, { freePlay: true })).success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(HS_PB1_010_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    expect(session.executeCommand(createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)).success).toBe(true);
    expect(session.state?.players[1].memberSlots.cardStates.get(target.instanceId)?.orientation).toBe(OrientationState.WAITING);
    expect(session.state?.eventLog.some((entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED && entry.event.cardInstanceId === target.instanceId)).toBe(true);
  });

  it('shows a confirm-only no-op for PL!HS-pb1-010 LIVE_START when no own cost-ten member exists', () => {
    const { game, targetCardId } = setupPb1010LiveStartPending({
      hasHighCostOwnMember: false,
      targetOrientation: OrientationState.ACTIVE,
    });
    const preview = resolvePendingCardEffects(game).gameState;

    expect(preview.activeEffect).toMatchObject({
      abilityId: HS_PB1_010_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain('费用大于等于10的成员0名');
    expect(preview.activeEffect?.effectText).toContain('可选择目标1名');
    expect(preview.activeEffect?.stepText).toContain('不处理');

    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.players[1].memberSlots.cardStates.get(targetCardId!)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('shows a confirm-only no-op for PL!HS-pb1-010 LIVE_START when no legal opponent target exists', () => {
    const { game, targetCardId } = setupPb1010LiveStartPending({
      hasHighCostOwnMember: true,
      targetOrientation: OrientationState.WAITING,
    });
    const preview = resolvePendingCardEffects(game).gameState;

    expect(preview.activeEffect).toMatchObject({
      abilityId: HS_PB1_010_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain('费用大于等于10的成员1名');
    expect(preview.activeEffect?.effectText).toContain('可选择目标0名');
    expect(preview.activeEffect?.stepText).toContain('不处理');

    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.activeEffect).toBeNull();
    expect(
      resolved.players[1].memberSlots.cardStates.get(targetCardId!)?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('auto-resolves ordered PL!HS-pb1-010 LIVE_START no-op pendings without opening confirm-only', () => {
    const { game } = setupPb1010LiveStartPending({
      hasHighCostOwnMember: false,
      targetOrientation: OrientationState.ACTIVE,
      pendingCount: 2,
    });
    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);

    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_010_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID
      )
    ).toHaveLength(2);
  });
  it('waits only an opponent stage member with cost less than or equal to four for PL!-bp5-013', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('opponent-wait-target-bp5-013', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!-bp5-013-N', '園田海未', 9),
      PLAYER1,
      'p1-bp5-013-source'
    );
    const lowCostTarget = createCardInstance(
      createMemberCard('PL!-test-cost-4', 'Cost 4', 4),
      PLAYER2,
      'p2-cost-4-target'
    );
    const waitingLowCostTarget = createCardInstance(
      createMemberCard('PL!-test-cost-4-waiting', 'Cost 4 Waiting', 4),
      PLAYER2,
      'p2-cost-4-waiting-target'
    );
    const highCostTarget = createCardInstance(
      createMemberCard('PL!-test-cost-5', 'Cost 5', 5),
      PLAYER2,
      'p2-cost-5-target'
    );

    let state = registerCards(session.state!, [
      source,
      lowCostTarget,
      waitingLowCostTarget,
      highCostTarget,
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const p2 = state.players[1] as unknown as {
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
    clearPlayerZones(p1);
    clearPlayerZones(p2);
    p1.hand.cardIds = [source.instanceId];
    p2.memberSlots.slots[SlotPosition.LEFT] = lowCostTarget.instanceId;
    p2.memberSlots.slots[SlotPosition.CENTER] = waitingLowCostTarget.instanceId;
    p2.memberSlots.slots[SlotPosition.RIGHT] = highCostTarget.instanceId;
    p2.memberSlots.cardStates = new Map([
      [lowCostTarget.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [
        waitingLowCostTarget.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
      ],
      [
        highCostTarget.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
      ],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([lowCostTarget.instanceId]);

    const waitResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        lowCostTarget.instanceId
      )
    );

    expect(waitResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[1].memberSlots.cardStates.get(lowCostTarget.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(highCostTarget.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(waitingLowCostTarget.instanceId)
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID &&
          action.payload.sourceCardId === source.instanceId &&
          action.payload.step === 'WAIT_OPPONENT_MEMBER' &&
          action.payload.targetPlayerId === PLAYER2 &&
          action.payload.targetCardId === lowCostTarget.instanceId
      )
    ).toBe(true);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === lowCostTarget.instanceId &&
          entry.event.controllerId === PLAYER2 &&
          entry.event.slot === SlotPosition.LEFT &&
          entry.event.previousOrientation === OrientationState.ACTIVE &&
          entry.event.nextOrientation === OrientationState.WAITING
      )
    ).toBe(true);
  });

  it('skips PL!-bp5-013 when every matching opponent member is already waiting', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'opponent-wait-target-bp5-013-no-active-target',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!-bp5-013-N', '園田海未', 9),
      PLAYER1,
      'p1-bp5-013-no-target-source'
    );
    const waitingLowCostTarget = createCardInstance(
      createMemberCard('PL!-test-waiting-cost-4', 'Waiting Cost 4', 4),
      PLAYER2,
      'p2-waiting-cost-4-target'
    );
    const activeHighCostTarget = createCardInstance(
      createMemberCard('PL!-test-active-cost-5', 'Active Cost 5', 5),
      PLAYER2,
      'p2-active-cost-5-target'
    );

    let state = registerCards(session.state!, [source, waitingLowCostTarget, activeHighCostTarget]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const p2 = state.players[1] as unknown as {
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
    clearPlayerZones(p1);
    clearPlayerZones(p2);
    p1.hand.cardIds = [source.instanceId];
    p2.memberSlots.slots[SlotPosition.LEFT] = waitingLowCostTarget.instanceId;
    p2.memberSlots.slots[SlotPosition.RIGHT] = activeHighCostTarget.instanceId;
    p2.memberSlots.cardStates = new Map([
      [
        waitingLowCostTarget.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
      ],
      [
        activeHighCostTarget.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
      ],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[1].memberSlots.cardStates.get(waitingLowCostTarget.instanceId)
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(activeHighCostTarget.instanceId)
        ?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID &&
          action.payload.sourceCardId === source.instanceId &&
          action.payload.step === 'SKIP_NO_TARGET' &&
          action.payload.targetPlayerId === PLAYER2
      )
    ).toBe(true);
  });

  it('waits a legal cost two or lower opponent member for PL!S-bp6-015-N and rejects illegal choices', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('opponent-wait-target-s-bp6-015', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!S-bp6-015-N', '津島善子', 4),
      PLAYER1,
      'p1-s-bp6-015-source'
    );
    const legalTarget = createCardInstance(
      createMemberCard('PL!S-bp6-015-legal-cost-2', 'Cost 2', 2),
      PLAYER2,
      'p2-s-bp6-015-cost-2'
    );
    const waitingLegalTarget = createCardInstance(
      createMemberCard('PL!S-bp6-015-waiting-cost-2', 'Waiting Cost 2', 2),
      PLAYER2,
      'p2-s-bp6-015-waiting-cost-2'
    );
    const illegalCostTarget = createCardInstance(
      createMemberCard('PL!S-bp6-015-illegal-cost-3', 'Cost 3', 3),
      PLAYER2,
      'p2-s-bp6-015-cost-3'
    );

    const state = registerCards(session.state!, [
      source,
      legalTarget,
      waitingLegalTarget,
      illegalCostTarget,
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const p2 = state.players[1] as unknown as {
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
    clearPlayerZones(p1);
    clearPlayerZones(p2);
    p1.hand.cardIds = [source.instanceId];
    p2.memberSlots.slots[SlotPosition.LEFT] = legalTarget.instanceId;
    p2.memberSlots.slots[SlotPosition.CENTER] = waitingLegalTarget.instanceId;
    p2.memberSlots.slots[SlotPosition.RIGHT] = illegalCostTarget.instanceId;
    p2.memberSlots.cardStates = new Map([
      [legalTarget.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [
        waitingLegalTarget.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
      ],
      [
        illegalCostTarget.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
      ],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success, playResult.error).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_015_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([legalTarget.instanceId]);

    const illegalSelection = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        illegalCostTarget.instanceId
      )
    );
    expect(illegalSelection.success).toBe(false);
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_015_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID
    );

    const waitResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        legalTarget.instanceId
      )
    );

    expect(waitResult.success, waitResult.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[1].memberSlots.cardStates.get(legalTarget.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(waitingLegalTarget.instanceId)
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(illegalCostTarget.instanceId)
        ?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
          entry.event.cardInstanceId === legalTarget.instanceId &&
          entry.event.controllerId === PLAYER2 &&
          entry.event.previousOrientation === OrientationState.ACTIVE &&
          entry.event.nextOrientation === OrientationState.WAITING
      )
    ).toBe(true);
  });

  it('skips PL!S-bp6-015-N when no active cost two or lower opponent target exists', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'opponent-wait-target-s-bp6-015-no-target',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!S-bp6-015-N', '津島善子', 4),
      PLAYER1,
      'p1-s-bp6-015-no-target-source'
    );
    const waitingLowCostTarget = createCardInstance(
      createMemberCard('PL!S-bp6-015-waiting-cost-2', 'Waiting Cost 2', 2),
      PLAYER2,
      'p2-s-bp6-015-no-target-waiting'
    );
    const activeHighCostTarget = createCardInstance(
      createMemberCard('PL!S-bp6-015-active-cost-3', 'Cost 3', 3),
      PLAYER2,
      'p2-s-bp6-015-no-target-cost-3'
    );

    const state = registerCards(session.state!, [source, waitingLowCostTarget, activeHighCostTarget]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const p2 = state.players[1] as unknown as {
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
    clearPlayerZones(p1);
    clearPlayerZones(p2);
    p1.hand.cardIds = [source.instanceId];
    p2.memberSlots.slots[SlotPosition.LEFT] = waitingLowCostTarget.instanceId;
    p2.memberSlots.slots[SlotPosition.RIGHT] = activeHighCostTarget.instanceId;
    p2.memberSlots.cardStates = new Map([
      [
        waitingLowCostTarget.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
      ],
      [
        activeHighCostTarget.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
      ],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success, playResult.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === S_BP6_015_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID &&
          action.payload.sourceCardId === source.instanceId &&
          action.payload.step === 'SKIP_NO_TARGET'
      )
    ).toBe(true);
  });

  it('continues pending effects after PL!S-bp6-015-N resolves', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'opponent-wait-target-s-bp6-015-continuation',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!S-bp6-015-N', '津島善子', 4),
      PLAYER1,
      'p1-s-bp6-015-continuation-source'
    );
    const nextSource = createCardInstance(
      createMemberCard('PL!S-bp6-012-N', '松浦果南', 2),
      PLAYER1,
      'p1-s-bp6-012-continuation-source'
    );
    const target = createCardInstance(
      createMemberCard('PL!S-bp6-015-continuation-cost-2', 'Cost 2', 2),
      PLAYER2,
      'p2-s-bp6-015-continuation-target'
    );
    const topCards = [0, 1, 2, 3, 4].map((index) =>
      createCardInstance(
        createMemberCard(`PL!S-bp6-012-continuation-top-${index}`, `Top ${index}`),
        PLAYER1,
        `p1-s-bp6-012-continuation-top-${index}`
      )
    );

    const state = registerCards(session.state!, [source, nextSource, target, ...topCards]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

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
    const p2 = state.players[1] as unknown as {
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
    clearPlayerZones(p1);
    clearPlayerZones(p2);
    p1.hand.cardIds = [source.instanceId];
    p1.mainDeck.cardIds = topCards.map((card) => card.instanceId);
    p1.memberSlots.slots[SlotPosition.LEFT] = nextSource.instanceId;
    p1.memberSlots.cardStates = new Map([
      [nextSource.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots[SlotPosition.CENTER] = target.instanceId;
    p2.memberSlots.cardStates = new Map([
      [target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    expect(playResult.success, playResult.error).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_BP6_015_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID
    );

    (session.state as unknown as { pendingAbilities: GameState['pendingAbilities'] })
      .pendingAbilities = [
      ...session.state!.pendingAbilities,
      {
        id: `${S_BP6_012_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID}:${nextSource.instanceId}:manual-continuation`,
        abilityId: S_BP6_012_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID,
        sourceCardId: nextSource.instanceId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_ENTER_STAGE,
        sourceSlot: SlotPosition.LEFT,
      },
    ];

    const waitResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
    );

    expect(waitResult.success, waitResult.error).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(S_BP6_012_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID);
    expect(session.state?.activeEffect?.metadata?.milledCardIds).toEqual(
      topCards.map((card) => card.instanceId)
    );
  });
});
