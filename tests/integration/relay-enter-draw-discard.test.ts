import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  PL_N_PB1_019_ON_ENTER_RELAY_FROM_SETSUNA_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  PL_N_PB1_022_ON_ENTER_RELAY_FROM_SHIORIKO_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
  S_PR_045_ON_ENTER_RELAY_FROM_COST_SEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
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
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹咲学园学园偶像同好会'],
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

function createLiveCard(cardCode: string, score: number): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
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

interface RelayDrawDiscardScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly replacementId: string;
  readonly secondReplacementId: string | null;
  readonly handCardIds: readonly string[];
  readonly drawCardIds: readonly string[];
}

function setupRelayDrawDiscardScenario(options: {
  readonly sourceCardCode: string;
  readonly sourceName: string;
  readonly sourceCost: number;
  readonly replacementName: string;
  readonly replacementCardCode?: string;
  readonly replacementCost?: number;
  readonly secondReplacement?: {
    readonly name: string;
    readonly cardCode?: string;
    readonly cost: number;
  };
  readonly successLiveScore?: number;
  readonly mainDeckCardCount?: number;
  readonly handCount: number;
}): RelayDrawDiscardScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('relay-enter-draw-discard', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard(options.sourceCardCode, options.sourceName, options.sourceCost),
    PLAYER1,
    'p1-relay-draw-discard-source'
  );
  const replacement = createCardInstance(
    createMemberCard(
      options.replacementCardCode ?? 'PL!N-test-replacement',
      options.replacementName,
      options.replacementCost ?? 1
    ),
    PLAYER1,
    'p1-relay-draw-discard-replacement'
  );
  const secondReplacement = options.secondReplacement
    ? createCardInstance(
        createMemberCard(
          options.secondReplacement.cardCode ?? 'PL!N-test-second-replacement',
          options.secondReplacement.name,
          options.secondReplacement.cost
        ),
        PLAYER1,
        'p1-relay-draw-discard-second-replacement'
      )
    : null;
  const handCards = Array.from({ length: options.handCount }, (_, index) =>
    createCardInstance(
      createMemberCard(`PL!N-test-hand-${index}`, `Hand ${index}`),
      PLAYER1,
      `p1-relay-draw-discard-hand-${index}`
    )
  );
  const drawCards = [0, 1].map((index) =>
    createCardInstance(
      createMemberCard(`PL!N-test-draw-${index}`, `Draw ${index}`),
      PLAYER1,
      `p1-relay-draw-discard-draw-${index}`
    )
  );
  const remainingDeckCard = createCardInstance(
    createMemberCard('PL!N-test-remaining-deck', 'Remaining Deck'),
    PLAYER1,
    'p1-relay-draw-discard-remaining-deck'
  );
  const successLive =
    options.successLiveScore === undefined
      ? null
      : createCardInstance(
          createLiveCard('PL!-test-success-live', options.successLiveScore),
          PLAYER1,
          'p1-relay-draw-discard-success-live'
        );

  const state = registerCards(session.state!, [
    source,
    replacement,
    ...(secondReplacement ? [secondReplacement] : []),
    ...handCards,
    ...drawCards,
    remainingDeckCard,
    ...(successLive ? [successLive] : []),
  ]);
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
  p1.hand.cardIds = [source.instanceId, ...handCards.map((card) => card.instanceId)];
  p1.mainDeck.cardIds = [
    ...drawCards.map((card) => card.instanceId),
    remainingDeckCard.instanceId,
  ].slice(0, options.mainDeckCardCount ?? 3);
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = successLive ? [successLive.instanceId] : [];
  p1.liveZone.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: secondReplacement?.instanceId ?? null,
    [SlotPosition.CENTER]: replacement.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map();
  p1.memberSlots.cardStates.set(replacement.instanceId, {
    orientation: OrientationState.ACTIVE,
    face: FaceState.FACE_UP,
  });
  if (secondReplacement) {
    p1.memberSlots.cardStates.set(secondReplacement.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
  }

  return {
    session,
    sourceId: source.instanceId,
    replacementId: replacement.instanceId,
    secondReplacementId: secondReplacement?.instanceId ?? null,
    handCardIds: handCards.map((card) => card.instanceId),
    drawCardIds: drawCards.map((card) => card.instanceId),
  };
}

function playWithRelay(scenario: RelayDrawDiscardScenario): void {
  scenario.session.setManualOperationMode('FREE');
  const result = scenario.session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, scenario.sourceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(result.success).toBe(true);
}

function startPrCostSevenAbilityFromRelaySnapshot(
  scenario: RelayDrawDiscardScenario,
  relayReplacements: readonly {
    readonly cardId: string;
    readonly effectiveCost: number;
  }[]
): GameState {
  const sourceState = scenario.session.state!;
  const replacementCardIds = relayReplacements.map((replacement) => replacement.cardId);
  const stagedState = updatePlayer(sourceState, PLAYER1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: player.hand.cardIds.filter((cardId) => cardId !== scenario.sourceId),
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [
        ...player.waitingRoom.cardIds.filter((cardId) => !replacementCardIds.includes(cardId)),
        ...replacementCardIds,
      ],
    },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: null,
        [SlotPosition.CENTER]: scenario.sourceId,
        [SlotPosition.RIGHT]: null,
      },
      cardStates: new Map([
        [scenario.sourceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
  }));
  const ability: PendingAbilityState = {
    id: 'pending-s-pr-045-cost-seven-relay',
    abilityId: S_PR_045_ON_ENTER_RELAY_FROM_COST_SEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    sourceCardId: scenario.sourceId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['test-double-relay-enter-event'],
    sourceSlot: SlotPosition.CENTER,
    metadata: { relayReplacements },
  };
  return resolvePendingCardEffects({
    ...stagedState,
    pendingAbilities: [ability],
  }).gameState;
}

describe('relay enter draw-discard shared workflow', () => {
  it('draws two then discards one for PL!N-pb1-022-R relayed from 三船栞子', () => {
    const scenario = setupRelayDrawDiscardScenario({
      sourceCardCode: 'PL!N-pb1-022-R',
      sourceName: '三船栞子',
      sourceCost: 11,
      replacementName: '三船栞子',
      handCount: 1,
    });

    playWithRelay(scenario);

    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: PL_N_PB1_022_ON_ENTER_RELAY_FROM_SHIORIKO_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
      selectableCardIds: [...scenario.handCardIds, ...scenario.drawCardIds],
      metadata: {
        drawCount: 2,
        discardCount: 1,
        drawnCardIds: scenario.drawCardIds,
      },
    });
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([
      ...scenario.handCardIds,
      ...scenario.drawCardIds,
    ]);

    const discardResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        scenario.handCardIds[0]
      )
    );

    expect(discardResult.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.replacementId,
      scenario.handCardIds[0],
    ]);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(scenario.drawCardIds);
    expect(
      scenario.session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.cardInstanceIds?.includes(scenario.handCardIds[0]!)
      )
    ).toBe(true);
  });

  it('draws two then discards two for PL!N-pb1-019-R relayed from 優木せつ菜', () => {
    const scenario = setupRelayDrawDiscardScenario({
      sourceCardCode: 'PL!N-pb1-019-R',
      sourceName: '優木せつ菜',
      sourceCost: 9,
      replacementName: '優木せつ菜',
      handCount: 2,
    });

    playWithRelay(scenario);

    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: PL_N_PB1_019_ON_ENTER_RELAY_FROM_SETSUNA_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      metadata: {
        drawCount: 2,
        discardCount: 2,
        drawnCardIds: scenario.drawCardIds,
      },
    });

    const selectedDiscardIds = [scenario.handCardIds[0]!, scenario.drawCardIds[0]!];
    const discardResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        selectedDiscardIds
      )
    );

    expect(discardResult.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.replacementId,
      ...selectedDiscardIds,
    ]);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([
      scenario.handCardIds[1],
      scenario.drawCardIds[1],
    ]);
  });

  it('does not trigger when the member enters without relay metadata', () => {
    const scenario = setupRelayDrawDiscardScenario({
      sourceCardCode: 'PL!N-pb1-022-R',
      sourceName: '三船栞子',
      sourceCost: 11,
      replacementName: '三船栞子',
      handCount: 1,
    });

    scenario.session.setManualOperationMode('FREE');
    const result = scenario.session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, scenario.sourceId, SlotPosition.LEFT, {
        freePlay: true,
      })
    );

    expect(result.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(scenario.handCardIds);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_PB1_022_ON_ENTER_RELAY_FROM_SHIORIKO_DRAW_TWO_DISCARD_ONE_ABILITY_ID &&
          action.payload.reason === 'NOT_RELAY_ENTER'
      )
    ).toBe(true);
  });

  it('does not trigger when relayed from a different member name', () => {
    const scenario = setupRelayDrawDiscardScenario({
      sourceCardCode: 'PL!N-pb1-022-R',
      sourceName: '三船栞子',
      sourceCost: 11,
      replacementName: '中須かすみ',
      replacementCardCode: 'PL!N-pb1-014-R',
      handCount: 1,
    });

    playWithRelay(scenario);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(scenario.handCardIds);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_PB1_022_ON_ENTER_RELAY_FROM_SHIORIKO_DRAW_TWO_DISCARD_ONE_ABILITY_ID &&
          action.payload.reason === 'REPLACEMENT_NAME_MISMATCH' &&
          action.payload.relayReplacementCardIds?.includes(scenario.replacementId)
      )
    ).toBe(true);
  });

  it('uses the captured effective cost 7 when PL!S-PR-045-PR 费用11「津島善子」relays from a currently cost-4 member', () => {
    const scenario = setupRelayDrawDiscardScenario({
      sourceCardCode: 'PL!S-PR-045-PR',
      sourceName: '津島善子',
      sourceCost: 11,
      replacementName: '小泉花陽',
      replacementCardCode: 'PL!-bp4-008-P',
      replacementCost: 4,
      successLiveScore: 6,
      handCount: 1,
    });

    playWithRelay(scenario);

    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'PLAY_MEMBER' &&
          action.payload.cardId === scenario.sourceId &&
          action.payload.relayReplacements?.[0]?.cardId === scenario.replacementId &&
          action.payload.relayReplacements?.[0]?.effectiveCost === 7
      )
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: S_PR_045_ON_ENTER_RELAY_FROM_COST_SEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
      selectableCardIds: [...scenario.handCardIds, ...scenario.drawCardIds],
      selectionLabel: '请选择要放置入休息室的手牌',
      metadata: {
        drawCount: 2,
        discardCount: 1,
        drawnCardIds: scenario.drawCardIds,
      },
    });

    const discardResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        scenario.handCardIds[0]
      )
    );

    expect(discardResult.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.replacementId,
      scenario.handCardIds[0],
    ]);
    expect(
      scenario.session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.cardInstanceIds?.includes(scenario.handCardIds[0]!)
      )
    ).toBe(true);
  });

  it('consumes PL!S-PR-045-PR 费用11「津島善子」without drawing on an ordinary non-relay entry', () => {
    const scenario = setupRelayDrawDiscardScenario({
      sourceCardCode: 'PL!S-PR-045-PR',
      sourceName: '津島善子',
      sourceCost: 11,
      replacementName: 'Cost Seven',
      replacementCost: 7,
      handCount: 1,
    });

    scenario.session.setManualOperationMode('FREE');
    const result = scenario.session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, scenario.sourceId, SlotPosition.LEFT, {
        freePlay: true,
      })
    );

    expect(result.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(scenario.handCardIds);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            S_PR_045_ON_ENTER_RELAY_FROM_COST_SEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID &&
          action.payload.reason === 'NOT_RELAY_ENTER'
      )
    ).toBe(true);
  });

  it('does not draw when PL!S-PR-045-PR 费用11「津島善子」relays from effective cost 6', () => {
    const scenario = setupRelayDrawDiscardScenario({
      sourceCardCode: 'PL!S-PR-045-PR',
      sourceName: '津島善子',
      sourceCost: 11,
      replacementName: 'Cost Six',
      replacementCost: 6,
      handCount: 1,
    });

    playWithRelay(scenario);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(scenario.handCardIds);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            S_PR_045_ON_ENTER_RELAY_FROM_COST_SEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID &&
          action.payload.step === 'CHECK_RELAY_REPLACEMENT_EFFECTIVE_COST' &&
          action.payload.reason === 'REPLACEMENT_EFFECTIVE_COST_MISMATCH' &&
          action.payload.relayReplacementEffectiveCosts?.[0] === 6
      )
    ).toBe(true);
  });

  it('accepts a double-relay event snapshot when either replaced member has effective cost 7', () => {
    const scenario = setupRelayDrawDiscardScenario({
      sourceCardCode: 'PL!S-PR-045-PR',
      sourceName: '津島善子',
      sourceCost: 11,
      replacementName: 'Cost Six',
      replacementCost: 6,
      secondReplacement: {
        name: 'Cost Seven',
        cost: 7,
      },
      handCount: 1,
    });

    const started = startPrCostSevenAbilityFromRelaySnapshot(scenario, [
      { cardId: scenario.replacementId, effectiveCost: 6 },
      { cardId: scenario.secondReplacementId!, effectiveCost: 7 },
    ]);

    expect(started.activeEffect).toMatchObject({
      abilityId: S_PR_045_ON_ENTER_RELAY_FROM_COST_SEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
      selectableCardIds: [...scenario.handCardIds, ...scenario.drawCardIds],
      metadata: {
        drawCount: 2,
        discardCount: 1,
        drawnCardIds: scenario.drawCardIds,
      },
    });
    expect(started.pendingAbilities).toEqual([]);
  });

  it('continues drawing through a refresh before PL!S-PR-045-PR 费用11「津島善子」opens the discard step', () => {
    const scenario = setupRelayDrawDiscardScenario({
      sourceCardCode: 'PL!S-PR-045-PR',
      sourceName: '津島善子',
      sourceCost: 11,
      replacementName: 'Cost Seven',
      replacementCost: 7,
      mainDeckCardCount: 1,
      handCount: 1,
    });

    playWithRelay(scenario);

    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: S_PR_045_ON_ENTER_RELAY_FROM_COST_SEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
      selectableCardIds: [...scenario.handCardIds, scenario.drawCardIds[0], scenario.replacementId],
      metadata: {
        drawnCardIds: [scenario.drawCardIds[0], scenario.replacementId],
      },
    });
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1
      )
    ).toBe(true);
  });

  it('keeps the discard window open on illegal input, then finishes through unified continuation', () => {
    const scenario = setupRelayDrawDiscardScenario({
      sourceCardCode: 'PL!S-PR-045-PR',
      sourceName: '津島善子',
      sourceCost: 11,
      replacementName: 'Cost Seven',
      replacementCost: 7,
      handCount: 1,
    });

    playWithRelay(scenario);
    const activeEffectId = scenario.session.state!.activeEffect!.id;
    const handBeforeIllegalInput = [...scenario.session.state!.players[0].hand.cardIds];
    const illegalResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId, scenario.sourceId)
    );

    expect(illegalResult.success).toBe(false);
    expect(scenario.session.state?.activeEffect?.id).toBe(activeEffectId);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(handBeforeIllegalInput);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.replacementId,
    ]);

    const validResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId, scenario.handCardIds[0])
    );

    expect(validResult.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.replacementId,
      scenario.handCardIds[0],
    ]);
  });
});
