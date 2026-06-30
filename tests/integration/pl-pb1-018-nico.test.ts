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
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  PL_PB1_018_ON_ENTER_BOTH_PLAY_LOW_COST_MEMBERS_WAITING_ABILITY_ID,
  SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ["μ's"],
    unitName: options.unitName ?? "μ's",
    cardType: CardType.MEMBER,
    cost: options.cost ?? 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
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

interface NicoScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly p1CandidateId: string;
  readonly p2CandidateId: string;
  readonly p1HighCostId: string;
  readonly p1LiveId: string;
  readonly p1NonWaitingLowCostId: string;
}

function setupNicoScenario(options: {
  readonly p1HasLowCostCandidate?: boolean;
  readonly p2HasLowCostCandidate?: boolean;
  readonly p1NoEmptySlotAfterSourceEnters?: boolean;
  readonly p2NoEmptySlot?: boolean;
  readonly candidatesHaveOnEnterAbility?: boolean;
} = {}): NicoScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('pl-pb1-018-nico', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard('PL!-pb1-018-R', { name: '矢澤にこ', cost: 7 }),
    PLAYER1,
    'p1-pl-pb1-018-source'
  );
  const candidateCardCode = options.candidatesHaveOnEnterAbility
    ? 'PL!SP-bp4-001-P'
    : 'PL!-pb1-018-low-cost-member';
  const p1Candidate = createCardInstance(
    createMemberCard(candidateCardCode, {
      name: 'P1 low cost',
      cost: 2,
      groupNames: options.candidatesHaveOnEnterAbility ? ['Liella!'] : ["μ's"],
      unitName: options.candidatesHaveOnEnterAbility ? 'Liella!' : "μ's",
    }),
    PLAYER1,
    'p1-low-cost-candidate'
  );
  const p2Candidate = createCardInstance(
    createMemberCard(candidateCardCode, {
      name: 'P2 low cost',
      cost: 2,
      groupNames: options.candidatesHaveOnEnterAbility ? ['Liella!'] : ["μ's"],
      unitName: options.candidatesHaveOnEnterAbility ? 'Liella!' : "μ's",
    }),
    PLAYER2,
    'p2-low-cost-candidate'
  );
  const p1HighCost = createCardInstance(
    createMemberCard('PL!-pb1-018-high-cost-member', { name: 'High Cost', cost: 3 }),
    PLAYER1,
    'p1-high-cost-member'
  );
  const p1Live = createCardInstance(
    createLiveCard('PL!-pb1-018-live-card'),
    PLAYER1,
    'p1-live-card'
  );
  const p1NonWaitingLowCost = createCardInstance(
    createMemberCard('PL!-pb1-018-non-waiting-low-cost', { name: 'Not Waiting', cost: 2 }),
    PLAYER1,
    'p1-non-waiting-low-cost'
  );
  const p1LeftBlocker = createCardInstance(
    createMemberCard('PL!-pb1-018-p1-left-blocker', { name: 'P1 Left', cost: 4 }),
    PLAYER1,
    'p1-left-blocker'
  );
  const p1RightBlocker = createCardInstance(
    createMemberCard('PL!-pb1-018-p1-right-blocker', { name: 'P1 Right', cost: 4 }),
    PLAYER1,
    'p1-right-blocker'
  );
  const p2LeftBlocker = createCardInstance(
    createMemberCard('PL!-pb1-018-p2-left-blocker', { name: 'P2 Left', cost: 4 }),
    PLAYER2,
    'p2-left-blocker'
  );
  const p2CenterBlocker = createCardInstance(
    createMemberCard('PL!-pb1-018-p2-center-blocker', { name: 'P2 Center', cost: 4 }),
    PLAYER2,
    'p2-center-blocker'
  );
  const p2RightBlocker = createCardInstance(
    createMemberCard('PL!-pb1-018-p2-right-blocker', { name: 'P2 Right', cost: 4 }),
    PLAYER2,
    'p2-right-blocker'
  );

  const state = registerCards(session.state!, [
    source,
    p1Candidate,
    p2Candidate,
    p1HighCost,
    p1Live,
    p1NonWaitingLowCost,
    p1LeftBlocker,
    p1RightBlocker,
    p2LeftBlocker,
    p2CenterBlocker,
    p2RightBlocker,
  ]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const p1 = state.players[0] as unknown as MutablePlayerZones;
  const p2 = state.players[1] as unknown as MutablePlayerZones;
  p1.hand.cardIds = [source.instanceId];
  p1.mainDeck.cardIds = [p1NonWaitingLowCost.instanceId];
  p1.waitingRoom.cardIds = [
    ...(options.p1HasLowCostCandidate === false ? [] : [p1Candidate.instanceId]),
    p1HighCost.instanceId,
    p1Live.instanceId,
  ];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: options.p1NoEmptySlotAfterSourceEnters ? p1LeftBlocker.instanceId : null,
    [SlotPosition.CENTER]: null,
    [SlotPosition.RIGHT]: options.p1NoEmptySlotAfterSourceEnters ? p1RightBlocker.instanceId : null,
  };
  p1.memberSlots.cardStates = new Map(
    [
      options.p1NoEmptySlotAfterSourceEnters
        ? [p1LeftBlocker.instanceId, activeFaceUp()]
        : null,
      options.p1NoEmptySlotAfterSourceEnters
        ? [p1RightBlocker.instanceId, activeFaceUp()]
        : null,
    ].filter((entry): entry is readonly [string, ReturnType<typeof activeFaceUp>] => entry !== null)
  );

  p2.hand.cardIds = [];
  p2.waitingRoom.cardIds =
    options.p2HasLowCostCandidate === false ? [] : [p2Candidate.instanceId];
  p2.successZone.cardIds = [];
  p2.liveZone.cardIds = [];
  p2.memberSlots.slots = {
    [SlotPosition.LEFT]: options.p2NoEmptySlot ? p2LeftBlocker.instanceId : null,
    [SlotPosition.CENTER]: options.p2NoEmptySlot ? p2CenterBlocker.instanceId : null,
    [SlotPosition.RIGHT]: options.p2NoEmptySlot ? p2RightBlocker.instanceId : null,
  };
  p2.memberSlots.cardStates = new Map(
    [
      options.p2NoEmptySlot ? [p2LeftBlocker.instanceId, activeFaceUp()] : null,
      options.p2NoEmptySlot ? [p2CenterBlocker.instanceId, activeFaceUp()] : null,
      options.p2NoEmptySlot ? [p2RightBlocker.instanceId, activeFaceUp()] : null,
    ].filter((entry): entry is readonly [string, ReturnType<typeof activeFaceUp>] => entry !== null)
  );

  return {
    session,
    sourceId: source.instanceId,
    p1CandidateId: p1Candidate.instanceId,
    p2CandidateId: p2Candidate.instanceId,
    p1HighCostId: p1HighCost.instanceId,
    p1LiveId: p1Live.instanceId,
    p1NonWaitingLowCostId: p1NonWaitingLowCost.instanceId,
  };
}

interface MutablePlayerZones {
  hand: { cardIds: string[] };
  mainDeck: { cardIds: string[] };
  waitingRoom: { cardIds: string[] };
  successZone: { cardIds: string[] };
  liveZone: { cardIds: string[] };
  memberSlots: {
    slots: Record<SlotPosition, string | null>;
    cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
  };
}

function activeFaceUp(): { readonly orientation: OrientationState; readonly face: FaceState } {
  return { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP };
}

function playNico(scenario: NicoScenario): void {
  const result = scenario.session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, scenario.sourceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(result.success).toBe(true);
}

function selectWaitingRoomCard(
  scenario: NicoScenario,
  playerId: string,
  cardId: string
): void {
  const result = scenario.session.executeCommand(
    createConfirmEffectStepCommand(
      playerId,
      scenario.session.state!.activeEffect!.id,
      cardId
    )
  );
  expect(result.success).toBe(true);
}

function selectStageSlot(
  scenario: NicoScenario,
  playerId: string,
  slot: SlotPosition
): void {
  const result = scenario.session.executeCommand(
    createConfirmEffectStepCommand(
      playerId,
      scenario.session.state!.activeEffect!.id,
      undefined,
      slot
    )
  );
  expect(result.success).toBe(true);
}

function orientationOf(
  scenario: NicoScenario,
  playerIndex: number,
  cardId: string
): OrientationState | undefined {
  return scenario.session.state?.players[playerIndex].memberSlots.cardStates.get(cardId)
    ?.orientation;
}

describe('PL!-pb1-018 Nico on-enter workflow', () => {
  it('plays one low-cost waiting-room member for each player in WAITING orientation', () => {
    const scenario = setupNicoScenario();
    playNico(scenario);

    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: PL_PB1_018_ON_ENTER_BOTH_PLAY_LOW_COST_MEMBERS_WAITING_ABILITY_ID,
      awaitingPlayerId: PLAYER1,
      selectableCardIds: [scenario.p1CandidateId],
      canSkipSelection: false,
    });

    selectWaitingRoomCard(scenario, PLAYER1, scenario.p1CandidateId);
    expect(scenario.session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toBeUndefined();
    const slotStepSnapshot = JSON.stringify(scenario.session.state?.activeEffect);
    const misclickResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        scenario.p1CandidateId
      )
    );
    expect(
      misclickResult.success === false ||
        JSON.stringify(scenario.session.state?.activeEffect) === slotStepSnapshot
    ).toBe(true);
    expect(JSON.stringify(scenario.session.state?.activeEffect)).toBe(slotStepSnapshot);
    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    selectStageSlot(scenario, PLAYER1, SlotPosition.LEFT);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      awaitingPlayerId: PLAYER2,
      selectableCardIds: [scenario.p2CandidateId],
    });

    selectWaitingRoomCard(scenario, PLAYER2, scenario.p2CandidateId);
    expect(scenario.session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ]);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toBeUndefined();
    selectStageSlot(scenario, PLAYER2, SlotPosition.RIGHT);

    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.p1CandidateId
    );
    expect(scenario.session.state?.players[1].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      scenario.p2CandidateId
    );
    expect(orientationOf(scenario, 0, scenario.p1CandidateId)).toBe(OrientationState.WAITING);
    expect(orientationOf(scenario, 1, scenario.p2CandidateId)).toBe(OrientationState.WAITING);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).not.toContain(
      scenario.p1CandidateId
    );
    expect(scenario.session.state?.players[1].waitingRoom.cardIds).not.toContain(
      scenario.p2CandidateId
    );
  });

  it('only offers cost <= 2 member cards currently in the waiting room', () => {
    const scenario = setupNicoScenario();
    playNico(scenario);

    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.p1CandidateId,
    ]);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.p1HighCostId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.p1LiveId
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).not.toContain(
      scenario.p1NonWaitingLowCostId
    );
  });

  it('skips a player with no low-cost member and still processes the other player', () => {
    const scenario = setupNicoScenario({ p1HasLowCostCandidate: false });
    playNico(scenario);

    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'SKIP_PLAYER' &&
          action.payload.currentPlayerId === PLAYER1 &&
          action.payload.reason === 'NO_LOW_COST_MEMBER'
      )
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      awaitingPlayerId: PLAYER2,
      selectableCardIds: [scenario.p2CandidateId],
    });

    selectWaitingRoomCard(scenario, PLAYER2, scenario.p2CandidateId);
    selectStageSlot(scenario, PLAYER2, SlotPosition.LEFT);

    expect(scenario.session.state?.players[1].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.p2CandidateId
    );
    expect(orientationOf(scenario, 1, scenario.p2CandidateId)).toBe(OrientationState.WAITING);
  });

  it('skips a player with no empty member slot and still processes the other player', () => {
    const scenario = setupNicoScenario({ p1NoEmptySlotAfterSourceEnters: true });
    playNico(scenario);

    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'SKIP_PLAYER' &&
          action.payload.currentPlayerId === PLAYER1 &&
          action.payload.reason === 'NO_EMPTY_STAGE_SLOT'
      )
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      awaitingPlayerId: PLAYER2,
      selectableCardIds: [scenario.p2CandidateId],
    });

    selectWaitingRoomCard(scenario, PLAYER2, scenario.p2CandidateId);
    selectStageSlot(scenario, PLAYER2, SlotPosition.LEFT);

    expect(scenario.session.state?.players[1].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.p2CandidateId
    );
  });

  it('queues on-enter effects in normal-phase player order when both played members have them', () => {
    const scenario = setupNicoScenario({ candidatesHaveOnEnterAbility: true });
    playNico(scenario);

    selectWaitingRoomCard(scenario, PLAYER1, scenario.p1CandidateId);
    selectStageSlot(scenario, PLAYER1, SlotPosition.LEFT);
    selectWaitingRoomCard(scenario, PLAYER2, scenario.p2CandidateId);
    selectStageSlot(scenario, PLAYER2, SlotPosition.RIGHT);

    const triggerActions = scenario.session.state!.actionHistory.filter(
      (action) =>
        action.type === 'TRIGGER_ABILITY' &&
        action.payload.abilityId ===
          SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID
    );
    const p1TriggerIndex = triggerActions.findIndex(
      (action) => action.payload.sourceCardId === scenario.p1CandidateId
    );
    const p2TriggerIndex = triggerActions.findIndex(
      (action) => action.payload.sourceCardId === scenario.p2CandidateId
    );

    expect(p1TriggerIndex).toBeGreaterThanOrEqual(0);
    expect(p2TriggerIndex).toBeGreaterThanOrEqual(0);
    expect(p1TriggerIndex).toBeLessThan(p2TriggerIndex);
  });

  // 本卡括号中的本回合区域再登场/换手限制依赖通用底层规则；
  // 本窗口只覆盖双方休息室登场效果，不在这里新增锁槽行为。
});
