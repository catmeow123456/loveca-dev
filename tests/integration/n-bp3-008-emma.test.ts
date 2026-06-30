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
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  PL_N_BP3_008_ACTIVATED_WAIT_OTHER_NIJIGASAKI_DRAW_ONE_ABILITY_ID,
  PL_N_BP3_008_LIVE_START_DISCARD_TWO_ACTIVATE_OTHER_MEMBER_GAIN_GREEN_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  N_BP3_008_LIVE_START_SELECT_ACTIVATE_TARGET_STEP_ID,
  N_BP3_008_LIVE_START_SELECT_DISCARD_TWO_STEP_ID,
} from '../../src/application/card-effects/workflows/cards/n-bp3-008-emma';
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
  cost = 1,
  groupName = '虹ヶ咲学園スクールアイドル同好会'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.LIVE,
    score: 3,
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

interface StageMemberConfig {
  readonly cardCode: string;
  readonly name: string;
  readonly orientation: OrientationState;
  readonly groupNames?: readonly string[];
}

interface EmmaScenarioOptions {
  readonly left?: StageMemberConfig;
  readonly right?: StageMemberConfig;
  readonly handCount?: number;
  readonly mainDeckCount?: number;
  readonly currentPhase?: GamePhase;
}

interface EmmaScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly leftId?: string;
  readonly rightId?: string;
  readonly handCardIds: readonly string[];
  readonly drawCardIds: readonly string[];
  readonly liveCardId: string;
}

function setupEmmaScenario(options: EmmaScenarioOptions = {}): EmmaScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('n-bp3-008-emma', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard('PL!N-bp3-008-P', 'エマ・ヴェルデ', 13),
    PLAYER1,
    'p1-n-bp3-008-emma'
  );
  const left = options.left
    ? createCardInstance(
        createMemberCard(
          options.left.cardCode,
          options.left.name,
          1,
          options.left.groupNames?.[0]
        ),
        PLAYER1,
        'p1-emma-left'
      )
    : null;
  const right = options.right
    ? createCardInstance(
        createMemberCard(
          options.right.cardCode,
          options.right.name,
          1,
          options.right.groupNames?.[0]
        ),
        PLAYER1,
        'p1-emma-right'
      )
    : null;
  const handCards = Array.from({ length: options.handCount ?? 0 }, (_, index) =>
    createCardInstance(
      createMemberCard(`PL!N-emma-hand-${index}`, `Hand ${index}`),
      PLAYER1,
      `p1-emma-hand-${index}`
    )
  );
  const drawCards = Array.from({ length: options.mainDeckCount ?? 0 }, (_, index) =>
    createCardInstance(
      createMemberCard(`PL!N-emma-draw-${index}`, `Draw ${index}`),
      PLAYER1,
      `p1-emma-draw-${index}`
    )
  );
  const liveCard = createCardInstance(
    createLiveCard('PL!N-emma-live'),
    PLAYER1,
    'p1-emma-live'
  );

  const registeredCards = [
    source,
    ...(left ? [left] : []),
    ...(right ? [right] : []),
    ...handCards,
    ...drawCards,
    liveCard,
  ];
  const state = registerCards(session.state!, registeredCards);
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
  mutableState.activePlayerIndex = 0;
  mutableState.waitingPlayerId = null;

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  p1.hand.cardIds = handCards.map((card) => card.instanceId);
  p1.mainDeck.cardIds = drawCards.map((card) => card.instanceId);
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [liveCard.instanceId];
  p1.liveZone.cardStates = new Map([
    [liveCard.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
  ]);
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: left?.instanceId ?? null,
    [SlotPosition.CENTER]: source.instanceId,
    [SlotPosition.RIGHT]: right?.instanceId ?? null,
  };
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ...(left
      ? [[left.instanceId, { orientation: options.left!.orientation, face: FaceState.FACE_UP }]]
      : []),
    ...(right
      ? [[right.instanceId, { orientation: options.right!.orientation, face: FaceState.FACE_UP }]]
      : []),
  ]);

  return {
    session,
    sourceId: source.instanceId,
    leftId: left?.instanceId,
    rightId: right?.instanceId,
    handCardIds: handCards.map((card) => card.instanceId),
    drawCardIds: drawCards.map((card) => card.instanceId),
    liveCardId: liveCard.instanceId,
  };
}

function activateEmma(scenario: EmmaScenario) {
  return scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      PL_N_BP3_008_ACTIVATED_WAIT_OTHER_NIJIGASAKI_DRAW_ONE_ABILITY_ID
    )
  );
}

function confirmEffectCard(session: ReturnType<typeof createGameSession>, cardId: string | null) {
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, cardId)
  );
}

function confirmEffectCards(
  session: ReturnType<typeof createGameSession>,
  cardIds: readonly string[]
) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      cardIds
    )
  );
}

function orientation(
  scenario: EmmaScenario,
  cardId: string | undefined
): OrientationState | undefined {
  return cardId
    ? scenario.session.state?.players[0].memberSlots.cardStates.get(cardId)?.orientation
    : undefined;
}

function advanceToLiveStartEffects(session: ReturnType<typeof createGameSession>): void {
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    firstPlayerIndex: number;
    liveSetCompletedPlayers: string[];
  };
  mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
  mutableState.currentSubPhase = SubPhase.LIVE_SET_SECOND_DRAW;
  mutableState.currentTurnType = TurnType.LIVE_PHASE;
  mutableState.activePlayerIndex = 0;
  mutableState.firstPlayerIndex = 0;
  mutableState.liveSetCompletedPlayers = [PLAYER1, PLAYER2];

  const service = new GameService();
  const advanceResult = service.advancePhase(state);
  expect(advanceResult.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;
}

describe('PL!N-bp3-008 Emma workflow', () => {
  it('waits another active Nijigasaki member as activated cost and draws one', () => {
    const scenario = setupEmmaScenario({
      left: {
        cardCode: 'PL!N-emma-target',
        name: '近江彼方',
        orientation: OrientationState.ACTIVE,
      },
      right: {
        cardCode: 'PL!N-emma-second-target',
        name: '中須かすみ',
        orientation: OrientationState.ACTIVE,
      },
      mainDeckCount: 1,
    });

    expect(activateEmma(scenario).success).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      scenario.leftId,
      scenario.rightId,
    ]);

    expect(confirmEffectCard(scenario.session, scenario.leftId!).success).toBe(true);

    expect(orientation(scenario, scenario.leftId)).toBe(OrientationState.WAITING);
    expect(scenario.session.state?.players[0].hand.cardIds).toContain(scenario.drawCardIds[0]);

    const memberStateEvent = scenario.session.state?.eventLog.find(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
        entry.event.cardInstanceId === scenario.leftId
    )?.event;
    const payCost = scenario.session.state?.actionHistory.find(
      (action) =>
        action.type === 'PAY_COST' &&
        action.payload.abilityId ===
          PL_N_BP3_008_ACTIVATED_WAIT_OTHER_NIJIGASAKI_DRAW_ONE_ABILITY_ID
    );
    expect(payCost?.payload).toMatchObject({
      sourceCardId: scenario.sourceId,
      waitedMemberCardId: scenario.leftId,
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
    });
    expect(payCost?.payload.memberStateChangedEventIds).toContain(memberStateEvent?.eventId);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_BP3_008_ACTIVATED_WAIT_OTHER_NIJIGASAKI_DRAW_ONE_ABILITY_ID &&
          action.payload.sourceCardId === scenario.sourceId &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(true);
  });

  it('does not allow self, already waiting members, or non-Nijigasaki members as activated cost targets', () => {
    const withNonNijigasaki = setupEmmaScenario({
      left: {
        cardCode: 'PL!N-emma-target',
        name: '近江彼方',
        orientation: OrientationState.ACTIVE,
      },
      right: {
        cardCode: 'PL!SP-emma-non-niji',
        name: '澁谷かのん',
        groupNames: ['Liella!'],
        orientation: OrientationState.ACTIVE,
      },
      mainDeckCount: 1,
    });

    expect(activateEmma(withNonNijigasaki).success).toBe(true);
    expect(withNonNijigasaki.session.state?.activeEffect?.selectableCardIds).toEqual([
      withNonNijigasaki.leftId,
    ]);
    expect(withNonNijigasaki.session.state?.activeEffect?.selectableCardIds).not.toContain(
      withNonNijigasaki.sourceId
    );
    expect(withNonNijigasaki.session.state?.activeEffect?.selectableCardIds).not.toContain(
      withNonNijigasaki.rightId
    );

    const onlyInvalidTargets = setupEmmaScenario({
      left: {
        cardCode: 'PL!N-emma-waiting-target',
        name: '近江彼方',
        orientation: OrientationState.WAITING,
      },
      right: {
        cardCode: 'PL!SP-emma-non-niji',
        name: '澁谷かのん',
        groupNames: ['Liella!'],
        orientation: OrientationState.ACTIVE,
      },
      mainDeckCount: 1,
    });

    expect(activateEmma(onlyInvalidTargets).success).toBe(false);
    expect(onlyInvalidTargets.session.state?.activeEffect).toBeNull();
  });

  it('blocks the same activated source from activating twice in one turn', () => {
    const scenario = setupEmmaScenario({
      left: {
        cardCode: 'PL!N-emma-target',
        name: '近江彼方',
        orientation: OrientationState.ACTIVE,
      },
      right: {
        cardCode: 'PL!N-emma-second-target',
        name: '中須かすみ',
        orientation: OrientationState.ACTIVE,
      },
      mainDeckCount: 2,
    });

    expect(activateEmma(scenario).success).toBe(true);
    expect(confirmEffectCard(scenario.session, scenario.leftId!).success).toBe(true);
    expect(activateEmma(scenario).success).toBe(false);
    expect(orientation(scenario, scenario.rightId)).toBe(OrientationState.ACTIVE);
  });

  it('discards two at live start, activates another waiting member, and grants both green Hearts', () => {
    const scenario = setupEmmaScenario({
      left: {
        cardCode: 'PL!N-emma-waiting-target',
        name: '近江彼方',
        orientation: OrientationState.WAITING,
      },
      handCount: 2,
    });

    advanceToLiveStartEffects(scenario.session);

    expect(scenario.session.state?.activeEffect?.abilityId).toBe(
      PL_N_BP3_008_LIVE_START_DISCARD_TWO_ACTIVATE_OTHER_MEMBER_GAIN_GREEN_HEART_ABILITY_ID
    );
    expect(scenario.session.state?.activeEffect?.stepId).toBe(
      N_BP3_008_LIVE_START_SELECT_DISCARD_TWO_STEP_ID
    );

    expect(confirmEffectCards(scenario.session, scenario.handCardIds).success).toBe(true);
    expect(scenario.session.state?.activeEffect?.stepId).toBe(
      N_BP3_008_LIVE_START_SELECT_ACTIVATE_TARGET_STEP_ID
    );
    expect(confirmEffectCard(scenario.session, scenario.leftId!).success).toBe(true);

    expect(orientation(scenario, scenario.leftId)).toBe(OrientationState.ACTIVE);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(
      scenario.handCardIds
    );
    expect(scenario.session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: scenario.leftId,
      sourceCardId: scenario.sourceId,
      abilityId:
        PL_N_BP3_008_LIVE_START_DISCARD_TWO_ACTIVATE_OTHER_MEMBER_GAIN_GREEN_HEART_ABILITY_ID,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
    });
    expect(scenario.session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: scenario.sourceId,
      abilityId:
        PL_N_BP3_008_LIVE_START_DISCARD_TWO_ACTIVATE_OTHER_MEMBER_GAIN_GREEN_HEART_ABILITY_ID,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
    });
  });

  it('skips the live-start optional cost without changing hand, member state, or Hearts', () => {
    const scenario = setupEmmaScenario({
      left: {
        cardCode: 'PL!N-emma-waiting-target',
        name: '近江彼方',
        orientation: OrientationState.WAITING,
      },
      handCount: 2,
    });

    advanceToLiveStartEffects(scenario.session);

    expect(confirmEffectCard(scenario.session, null).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual(scenario.handCardIds);
    expect(orientation(scenario, scenario.leftId)).toBe(OrientationState.WAITING);
    expect(scenario.session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('keeps the discard cost when there is no waiting member to activate', () => {
    const scenario = setupEmmaScenario({
      left: {
        cardCode: 'PL!N-emma-active-target',
        name: '近江彼方',
        orientation: OrientationState.ACTIVE,
      },
      handCount: 2,
    });

    advanceToLiveStartEffects(scenario.session);

    expect(confirmEffectCards(scenario.session, scenario.handCardIds).success).toBe(true);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(
      scenario.handCardIds
    );
    expect(orientation(scenario, scenario.leftId)).toBe(OrientationState.ACTIVE);
    expect(scenario.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_BP3_008_LIVE_START_DISCARD_TWO_ACTIVATE_OTHER_MEMBER_GAIN_GREEN_HEART_ABILITY_ID &&
          action.payload.step === 'DISCARD_TWO_NO_WAITING_TARGET' &&
          Array.isArray(action.payload.greenHeartMemberCardIds) &&
          action.payload.greenHeartMemberCardIds.length === 0
      )
    ).toBe(true);
  });
});
