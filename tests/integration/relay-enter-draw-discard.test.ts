import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  PL_N_PB1_019_ON_ENTER_RELAY_FROM_SETSUNA_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
  PL_N_PB1_022_ON_ENTER_RELAY_FROM_SHIORIKO_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
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
    groupName: '虹咲学园学园偶像同好会',
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

interface RelayDrawDiscardScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly replacementId: string;
  readonly handCardIds: readonly string[];
  readonly drawCardIds: readonly string[];
}

function setupRelayDrawDiscardScenario(options: {
  readonly sourceCardCode: string;
  readonly sourceName: string;
  readonly sourceCost: number;
  readonly replacementName: string;
  readonly replacementCardCode?: string;
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
      1
    ),
    PLAYER1,
    'p1-relay-draw-discard-replacement'
  );
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

  const state = registerCards(session.state!, [source, replacement, ...handCards, ...drawCards]);
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
  p1.mainDeck.cardIds = drawCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: replacement.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    [replacement.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);

  return {
    session,
    sourceId: source.instanceId,
    replacementId: replacement.instanceId,
    handCardIds: handCards.map((card) => card.instanceId),
    drawCardIds: drawCards.map((card) => card.instanceId),
  };
}

function playWithRelay(scenario: RelayDrawDiscardScenario): void {
  const result = scenario.session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, scenario.sourceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(result.success).toBe(true);
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
});
