import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID,
  PL_N_BP1_002_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID,
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
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
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

interface KasumiScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly mainDeckCardIds: readonly string[];
  readonly handCardIds: readonly string[];
  readonly energyCardIds: readonly string[];
  readonly fillerMemberIds: readonly string[];
}

function setupKasumiScenario(options: {
  readonly sourceZone: 'HAND' | 'WAITING_ROOM';
  readonly mainDeckCount?: number;
  readonly handCount?: number;
  readonly activeEnergyCount?: number;
  readonly waitingEnergyCount?: number;
  readonly occupiedSlots?: readonly SlotPosition[];
  readonly currentPhase?: GamePhase;
  readonly activePlayerIndex?: number;
}): KasumiScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('n-bp1-002-kasumi', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard('PL!N-bp1-002-P', '中須かすみ', 2),
    PLAYER1,
    'p1-n-bp1-002-kasumi'
  );
  const mainDeckCards = Array.from({ length: options.mainDeckCount ?? 0 }, (_, index) =>
    createCardInstance(
      createMemberCard(`PL!N-kasumi-deck-${index}`, `Deck ${index}`),
      PLAYER1,
      `p1-kasumi-deck-${index}`
    )
  );
  const handCards = Array.from({ length: options.handCount ?? 0 }, (_, index) =>
    createCardInstance(
      createMemberCard(`PL!N-kasumi-hand-${index}`, `Hand ${index}`),
      PLAYER1,
      `p1-kasumi-hand-${index}`
    )
  );
  const activeEnergyCards = Array.from({ length: options.activeEnergyCount ?? 0 }, (_, index) =>
    createCardInstance(createEnergyCard(`ENE-active-${index}`), PLAYER1, `p1-energy-active-${index}`)
  );
  const waitingEnergyCards = Array.from({ length: options.waitingEnergyCount ?? 0 }, (_, index) =>
    createCardInstance(
      createEnergyCard(`ENE-waiting-${index}`),
      PLAYER1,
      `p1-energy-waiting-${index}`
    )
  );
  const fillerMembers = (options.occupiedSlots ?? []).map((slot) =>
    createCardInstance(
      createMemberCard(`PL!N-kasumi-filler-${slot}`, `Filler ${slot}`),
      PLAYER1,
      `p1-filler-${slot}`
    )
  );

  const state = registerCards(session.state!, [
    source,
    ...mainDeckCards,
    ...handCards,
    ...activeEnergyCards,
    ...waitingEnergyCards,
    ...fillerMembers,
  ]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  mutableState.currentPhase = options.currentPhase ?? GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = options.activePlayerIndex ?? 0;
  mutableState.waitingPlayerId = null;

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p1.hand.cardIds = [
    ...(options.sourceZone === 'HAND' ? [source.instanceId] : []),
    ...handCards.map((card) => card.instanceId),
  ];
  p1.mainDeck.cardIds = mainDeckCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = options.sourceZone === 'WAITING_ROOM' ? [source.instanceId] : [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.energyZone.cardIds = [...activeEnergyCards, ...waitingEnergyCards].map(
    (card) => card.instanceId
  );
  p1.energyZone.cardStates = new Map([
    ...activeEnergyCards.map(
      (card) =>
        [card.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }] as const
    ),
    ...waitingEnergyCards.map(
      (card) =>
        [
          card.instanceId,
          { orientation: OrientationState.WAITING, face: FaceState.FACE_UP },
        ] as const
    ),
  ]);
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: null,
    [SlotPosition.RIGHT]: null,
  };
  for (const [index, slot] of (options.occupiedSlots ?? []).entries()) {
    p1.memberSlots.slots[slot] = fillerMembers[index]!.instanceId;
  }
  p1.memberSlots.cardStates = new Map(
    fillerMembers.map((card) => [
      card.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );

  return {
    session,
    sourceId: source.instanceId,
    mainDeckCardIds: mainDeckCards.map((card) => card.instanceId),
    handCardIds: handCards.map((card) => card.instanceId),
    energyCardIds: [...activeEnergyCards, ...waitingEnergyCards].map((card) => card.instanceId),
    fillerMemberIds: fillerMembers.map((card) => card.instanceId),
  };
}

function activateKasumi(scenario: KasumiScenario) {
  return scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID
    )
  );
}

function confirmSelectedCards(
  session: ReturnType<typeof createGameSession>,
  selectedCardIds: readonly string[]
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedCardIds
    )
  );
}

function confirmSelectedCard(
  session: ReturnType<typeof createGameSession>,
  selectedCardId: string
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
  );
}

function confirmSelectedSlot(session: ReturnType<typeof createGameSession>, slot: SlotPosition) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      slot
    )
  );
}

describe('PL!N-bp1-002 Kasumi workflow', () => {
  it('arranges inspected top three cards on enter with partial selection', () => {
    const scenario = setupKasumiScenario({
      sourceZone: 'HAND',
      mainDeckCount: 3,
    });

    expect(
      scenario.session.executeCommand(
        createPlayMemberToSlotCommand(PLAYER1, scenario.sourceId, SlotPosition.CENTER, {
          freePlay: true,
        })
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect?.abilityId).toBe(
      PL_N_BP1_002_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID
    );
    expect(scenario.session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(scenario.session.state?.activeEffect?.minSelectableCards).toBe(0);
    expect(scenario.session.state?.activeEffect?.maxSelectableCards).toBe(3);
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_BP1_002_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID &&
          action.payload.step === 'START_INSPECTION'
      )?.payload.publicEffectSummary
    ).toMatchObject({
      effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
      summaryStatus: 'STARTED',
      sourceActionLabel: '登场',
      requestedInspectCount: 3,
      actualInspectedCount: 3,
    });

    const selectedTopOrder = [scenario.mainDeckCardIds[1]!, scenario.mainDeckCardIds[0]!];
    expect(confirmSelectedCards(scenario.session, selectedTopOrder).success).toBe(true);

    expect(scenario.session.state?.players[0].mainDeck.cardIds.slice(0, 2)).toEqual(
      selectedTopOrder
    );
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.mainDeckCardIds[2],
    ]);
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_BP1_002_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID &&
          action.payload.step === 'FINISH'
      )?.payload.publicEffectSummary
    ).toMatchObject({
      effectKind: 'ARRANGE_INSPECTED_DECK_TOP',
      summaryStatus: 'COMPLETED',
      sourceActionLabel: '登场',
      actualInspectedCount: 3,
      selectedCardIds: selectedTopOrder,
      waitingRoomCardIds: [scenario.mainDeckCardIds[2]],
    });
  });

  it('allows selecting none, all, and fewer than three inspected cards on enter', () => {
    const selectNone = setupKasumiScenario({
      sourceZone: 'HAND',
      mainDeckCount: 3,
    });
    expect(
      selectNone.session.executeCommand(
        createPlayMemberToSlotCommand(PLAYER1, selectNone.sourceId, SlotPosition.CENTER, {
          freePlay: true,
        })
      ).success
    ).toBe(true);
    expect(confirmSelectedCards(selectNone.session, []).success).toBe(true);
    expect(selectNone.session.state?.players[0].waitingRoom.cardIds).toEqual(
      selectNone.mainDeckCardIds
    );

    const selectAllShortDeck = setupKasumiScenario({
      sourceZone: 'HAND',
      mainDeckCount: 2,
    });
    expect(
      selectAllShortDeck.session.executeCommand(
        createPlayMemberToSlotCommand(PLAYER1, selectAllShortDeck.sourceId, SlotPosition.CENTER, {
          freePlay: true,
        })
      ).success
    ).toBe(true);
    expect(selectAllShortDeck.session.state?.activeEffect?.maxSelectableCards).toBe(2);
    const reversed = [
      selectAllShortDeck.mainDeckCardIds[1]!,
      selectAllShortDeck.mainDeckCardIds[0]!,
    ];
    expect(confirmSelectedCards(selectAllShortDeck.session, reversed).success).toBe(true);
    expect(selectAllShortDeck.session.state?.players[0].mainDeck.cardIds).toEqual(reversed);
    expect(selectAllShortDeck.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('pays two energy and discards one hand card to play itself active from waiting room', () => {
    const scenario = setupKasumiScenario({
      sourceZone: 'WAITING_ROOM',
      handCount: 1,
      activeEnergyCount: 2,
      mainDeckCount: 3,
    });

    expect(activateKasumi(scenario).success).toBe(true);
    expect(confirmSelectedCard(scenario.session, scenario.handCardIds[0]!).success).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ]);
    expect(confirmSelectedSlot(scenario.session, SlotPosition.CENTER).success).toBe(true);

    const player = scenario.session.state!.players[0];
    expect(player.waitingRoom.cardIds).not.toContain(scenario.sourceId);
    expect(player.waitingRoom.cardIds).toContain(scenario.handCardIds[0]);
    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.sourceId);
    expect(player.memberSlots.cardStates.get(scenario.sourceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(player.energyZone.cardStates.get(scenario.energyCardIds[0]!)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(player.energyZone.cardStates.get(scenario.energyCardIds[1]!)?.orientation).toBe(
      OrientationState.WAITING
    );

    const enterStageEvent = scenario.session.state?.eventLog.find(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
        entry.event.cardInstanceId === scenario.sourceId
    )?.event;
    expect(enterStageEvent).toMatchObject({
      fromZone: 'WAITING_ROOM',
      toSlot: SlotPosition.CENTER,
    });

    const activeEffect = scenario.session.state?.activeEffect;
    expect(activeEffect?.abilityId).toBe(
      PL_N_BP1_002_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID
    );
    expect(activeEffect?.sourceCardId).toBe(scenario.sourceId);
    expect(activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(activeEffect?.selectableCardIds).toEqual(scenario.mainDeckCardIds);
    expect(activeEffect?.minSelectableCards).toBe(0);
    expect(activeEffect?.maxSelectableCards).toBe(3);

    const selectedTopOrder = [scenario.mainDeckCardIds[2]!, scenario.mainDeckCardIds[0]!];
    expect(confirmSelectedCards(scenario.session, selectedTopOrder).success).toBe(true);
    expect(scenario.session.state?.players[0].mainDeck.cardIds.slice(0, 2)).toEqual(
      selectedTopOrder
    );
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.handCardIds[0],
      scenario.mainDeckCardIds[1],
    ]);
  });

  it('can replace an occupied member slot after paying costs', () => {
    const scenario = setupKasumiScenario({
      sourceZone: 'WAITING_ROOM',
      handCount: 1,
      activeEnergyCount: 2,
      mainDeckCount: 3,
      occupiedSlots: [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT],
    });

    expect(activateKasumi(scenario).success).toBe(true);
    expect(confirmSelectedCard(scenario.session, scenario.handCardIds[0]!).success).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ]);
    expect(confirmSelectedSlot(scenario.session, SlotPosition.LEFT).success).toBe(true);

    const player = scenario.session.state!.players[0];
    expect(player.memberSlots.slots[SlotPosition.LEFT]).toBe(scenario.sourceId);
    expect(player.waitingRoom.cardIds).not.toContain(scenario.sourceId);
    expect(player.waitingRoom.cardIds).toContain(scenario.handCardIds[0]);
    expect(player.waitingRoom.cardIds).toContain(scenario.fillerMemberIds[0]);

    const leaveStageEvent = scenario.session.state?.eventLog.find(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
        entry.event.cardInstanceId === scenario.fillerMemberIds[0]
    )?.event;
    expect(leaveStageEvent).toMatchObject({
      fromSlot: SlotPosition.LEFT,
      toZone: 'WAITING_ROOM',
      replacingCardId: scenario.sourceId,
    });
    const enterStageEvent = scenario.session.state?.eventLog.find(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
        entry.event.cardInstanceId === scenario.sourceId
    )?.event;
    expect(enterStageEvent).toMatchObject({
      fromZone: 'WAITING_ROOM',
      toSlot: SlotPosition.LEFT,
      replacedMemberCardId: scenario.fillerMemberIds[0],
    });

    const activeEffect = scenario.session.state?.activeEffect;
    expect(activeEffect?.abilityId).toBe(
      PL_N_BP1_002_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID
    );
    expect(activeEffect?.sourceCardId).toBe(scenario.sourceId);
    expect(activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(activeEffect?.selectableCardIds).toEqual(scenario.mainDeckCardIds);
  });

  it('cannot activate without enough energy, without hand, from outside waiting room, outside main phase, or for a non-current player', () => {
    const notEnoughEnergy = setupKasumiScenario({
      sourceZone: 'WAITING_ROOM',
      handCount: 1,
      activeEnergyCount: 1,
    });
    expect(activateKasumi(notEnoughEnergy).success).toBe(false);

    const noHand = setupKasumiScenario({
      sourceZone: 'WAITING_ROOM',
      handCount: 0,
      activeEnergyCount: 2,
    });
    expect(activateKasumi(noHand).success).toBe(false);

    const notInWaitingRoom = setupKasumiScenario({
      sourceZone: 'HAND',
      handCount: 1,
      activeEnergyCount: 2,
    });
    expect(activateKasumi(notInWaitingRoom).success).toBe(false);

    const wrongPhase = setupKasumiScenario({
      sourceZone: 'WAITING_ROOM',
      handCount: 1,
      activeEnergyCount: 2,
      currentPhase: GamePhase.LIVE_SET_PHASE,
    });
    expect(activateKasumi(wrongPhase).success).toBe(false);

    const nonCurrentPlayer = setupKasumiScenario({
      sourceZone: 'WAITING_ROOM',
      handCount: 1,
      activeEnergyCount: 2,
      activePlayerIndex: 1,
    });
    expect(activateKasumi(nonCurrentPlayer).success).toBe(false);
  });
});
