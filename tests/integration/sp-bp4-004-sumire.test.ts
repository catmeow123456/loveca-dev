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
  SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID,
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

function createMemberCard(
  cardCode: string,
  name = cardCode,
  cost = 4,
  groupName = 'Liella!',
  unitName = 'CatChu!'
): MemberCardData {
  return {
    cardCode,
    name,
    groupName,
    unitName,
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
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMemberCard(`MEM-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
  };
  mutableState.currentPhase = GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.MAIN_FREE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
}

interface SumireScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly centerReplacementId: string;
  readonly leftReplacementId: string;
  readonly candidateId: string;
  readonly drawCardIds: readonly string[];
}

function setupSumireScenario(options: {
  readonly sourceSlot?: SlotPosition;
  readonly centerReplacementGroup?: string;
  readonly leftReplacementGroup?: string;
  readonly centerReplacementCardCode?: string;
  readonly leftReplacementCardCode?: string;
  readonly centerReplacementCost?: number;
  readonly leftReplacementCost?: number;
  readonly candidateCardCode?: string;
  readonly candidateCost?: number;
  readonly includeWaitingCandidate?: boolean;
} = {}): SumireScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('sp-bp4-004-sumire', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard('PL!SP-bp4-004-P', '平安名すみれ', 22),
    PLAYER1,
    'p1-sp-bp4-004-source'
  );
  const centerReplacement = createCardInstance(
    createMemberCard(
      options.centerReplacementCardCode ?? 'PL!SP-test-center-replacement',
      'Center Replacement',
      options.centerReplacementCost ?? 8,
      options.centerReplacementGroup ?? 'Liella!'
    ),
    PLAYER1,
    'p1-center-replacement'
  );
  const leftReplacement = createCardInstance(
    createMemberCard(
      options.leftReplacementCardCode ?? 'PL!SP-test-left-replacement',
      'Left Replacement',
      options.leftReplacementCost ?? 5,
      options.leftReplacementGroup ?? 'Liella!'
    ),
    PLAYER1,
    'p1-left-replacement'
  );
  const waitingCandidate = createCardInstance(
    createMemberCard(
      options.candidateCardCode ?? 'PL!SP-bp4-001-P',
      'Waiting Candidate',
      options.candidateCost ?? 4
    ),
    PLAYER1,
    'p1-waiting-candidate'
  );
  const drawOne = createCardInstance(createMemberCard('PL!SP-test-draw-1'), PLAYER1, 'p1-draw-1');
  const drawTwo = createCardInstance(createMemberCard('PL!SP-test-draw-2'), PLAYER1, 'p1-draw-2');

  const state = registerCards(session.state!, [
    source,
    centerReplacement,
    leftReplacement,
    waitingCandidate,
    drawOne,
    drawTwo,
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

  p1.hand.cardIds = [source.instanceId];
  p1.mainDeck.cardIds = [drawOne.instanceId, drawTwo.instanceId];
  p1.waitingRoom.cardIds =
    options.includeWaitingCandidate === false ? [] : [waitingCandidate.instanceId];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: leftReplacement.instanceId,
    [SlotPosition.CENTER]: centerReplacement.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  p1.memberSlots.cardStates = new Map([
    [centerReplacement.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    [leftReplacement.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);

  return {
    session,
    sourceId: source.instanceId,
    centerReplacementId: centerReplacement.instanceId,
    leftReplacementId: leftReplacement.instanceId,
    candidateId: waitingCandidate.instanceId,
    drawCardIds: [drawOne.instanceId, drawTwo.instanceId],
  };
}

function playSumireWithDoubleRelay(
  scenario: SumireScenario,
  targetSlot = SlotPosition.CENTER,
  replacementSlots: readonly SlotPosition[] = [SlotPosition.CENTER, SlotPosition.LEFT]
): void {
  const result = scenario.session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, scenario.sourceId, targetSlot, {
      freePlay: true,
      relayMode: 'DOUBLE',
      relayReplacementSlots: replacementSlots,
    })
  );
  expect(result.success).toBe(true);
}

describe('PL!SP-bp4-004 Sumire on-enter workflow', () => {
  it('draws two, selects a low-cost Liella member, plays it active, and enqueues on-enter', () => {
    const scenario = setupSumireScenario();
    playSumireWithDoubleRelay(scenario);

    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(
      expect.arrayContaining(scenario.drawCardIds)
    );
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID,
      selectableCardIds: [scenario.candidateId],
      canSkipSelection: false,
    });

    let result = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        scenario.candidateId
      )
    );
    expect(result.success).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toBeUndefined();

    result = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        undefined,
        SlotPosition.LEFT
      )
    );
    expect(result.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.candidateId
    );
    expect(
      scenario.session.state?.players[0].memberSlots.cardStates.get(scenario.candidateId)
        ?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.sourceCardId === scenario.candidateId &&
          action.payload.abilityId ===
            SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID
      )
    ).toBe(true);
  });

  it('does not draw or open an effect for single relay metadata', () => {
    const scenario = setupSumireScenario();
    const result = scenario.session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, scenario.sourceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(result.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).not.toEqual(
      expect.arrayContaining(scenario.drawCardIds)
    );
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID &&
          action.payload.conditionMet === false
      )
    ).toBe(true);
  });

  it('does not draw or open an effect when either replacement is not Liella', () => {
    const scenario = setupSumireScenario({
      leftReplacementCardCode: 'PL!S-test-left-replacement',
      leftReplacementGroup: 'Aqours',
    });
    playSumireWithDoubleRelay(scenario);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).not.toEqual(
      expect.arrayContaining(scenario.drawCardIds)
    );
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID &&
          action.payload.reason === 'REPLACEMENT_NOT_LIELLA_MEMBER'
      )
    ).toBe(true);
  });

  it('does not enqueue pending ability when Sumire enters outside center', () => {
    const scenario = setupSumireScenario();
    playSumireWithDoubleRelay(scenario, SlotPosition.LEFT, [SlotPosition.LEFT, SlotPosition.CENTER]);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID
      )
    ).toBe(false);
  });

  it('draws two and finishes when there is no legal waiting-room candidate', () => {
    const scenario = setupSumireScenario({ includeWaitingCandidate: false });
    playSumireWithDoubleRelay(scenario);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(
      expect.arrayContaining(scenario.drawCardIds)
    );
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID &&
          action.payload.noTargetReason === 'NO_WAITING_ROOM_CANDIDATE'
      )
    ).toBe(true);
  });

  it('allows a low-cost Liella replacement sent to waiting room to be selected', () => {
    const scenario = setupSumireScenario({
      includeWaitingCandidate: false,
      centerReplacementCost: 4,
      leftReplacementCost: 8,
    });
    playSumireWithDoubleRelay(scenario);

    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.centerReplacementId,
    ]);
    const result = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        scenario.centerReplacementId
      )
    );

    expect(result.success).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
  });
});
