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
  createAutoAdvancePublicEffectChoiceCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID,
  N_BP7_016_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
  N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID,
  SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
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

function createMemberCard(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createLiveCard(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
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

function setActiveEnergy(
  player: {
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  },
  cardIds: readonly string[]
): void {
  player.energyZone.cardIds = [...cardIds];
  player.energyZone.cardStates = new Map(
    cardIds.map((cardId) => [
      cardId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );
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

function setupLiveStartScenario(options: {
  readonly cardCode: string;
  readonly cardName: string;
  readonly abilityId: string;
  readonly activeEnergyCount: number;
  readonly sourceCount?: number;
  readonly markedEnergyIndices?: readonly number[];
}): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly sourceIds: readonly string[];
  readonly energyCardIds: readonly string[];
} {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(
    `${options.cardCode}-pay-energy-gain-heart-${options.activeEnergyCount}`,
    PLAYER1,
    'Player 1',
    PLAYER2,
    'Player 2'
  );
  session.initializeGame(deck, deck);

  const sources = Array.from({ length: options.sourceCount ?? 1 }, (_, index) =>
    createCardInstance(
      createMemberCard(options.cardCode, options.cardName, 4),
      PLAYER1,
      `p1-pay-energy-heart-source-${index + 1}`
    )
  );
  const liveCard = createCardInstance(
    createLiveCard('PL!SP-test-live', 'Live Start'),
    PLAYER1,
    'p1-pay-energy-heart-live'
  );
  let state = registerCards(session.state!, [...sources, liveCard]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  const energyCardIds = state.players[0].energyDeck.cardIds.slice(0, options.activeEnergyCount);

  p1.hand.cardIds = [];
  p1.mainDeck.cardIds = [];
  p1.waitingRoom.cardIds = [];
  p1.successZone.cardIds = [];
  sources.forEach((source, index) => {
    p1.memberSlots.slots[index === 0 ? SlotPosition.CENTER : SlotPosition.LEFT] = source.instanceId;
  });
  p1.memberSlots.cardStates = new Map(
    sources.map((source) => [
      source.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );
  p1.liveZone.cardIds = [liveCard.instanceId];
  p1.liveZone.cardStates = new Map([
    [liveCard.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
  ]);
  setActiveEnergy(p1, energyCardIds);
  (
    state as unknown as {
      energyActivePhaseSkips: {
        playerId: string;
        energyCardId: string;
        sourceCardId: string;
        abilityId: string;
      }[];
    }
  ).energyActivePhaseSkips = (options.markedEnergyIndices ?? []).map((index) => ({
    playerId: PLAYER1,
    energyCardId: energyCardIds[index]!,
    sourceCardId: 'special-energy-marker-source',
    abilityId: 'special-energy-marker-ability',
  }));

  advanceToLiveStartEffects(session);
  if ((options.sourceCount ?? 1) === 1) {
    expect(session.state?.activeEffect?.abilityId).toBe(options.abilityId);
  } else {
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: 'system:select-pending-card-effect',
      canResolveInOrder: true,
    });
  }

  return {
    session,
    sourceId: sources[0]!.instanceId,
    sourceIds: sources.map((source) => source.instanceId),
    energyCardIds,
  };
}

describe('pay energy gain Heart shared workflow', () => {
  it('lets PL!N-bp7-016 pay [E], choose exactly one of six ordinary colors, and grants the source Heart', () => {
    const { session, sourceId, energyCardIds } = setupLiveStartScenario({
      cardCode: 'PL!N-bp7-016-R',
      cardName: '朝香果林',
      abilityId: N_BP7_016_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
      activeEnergyCount: 1,
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: N_BP7_016_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
      stepId: 'N_BP7_016_PAY_ONE_ENERGY',
      effectText:
        '【LIVE开始时】可以支付[E]：指定1个任意HEART的颜色。LIVE结束时为止，获得1个指定颜色的HEART。',
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          'pay'
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: 'N_BP7_016_CHOOSE_HEART',
      selectionLabel: '选择要获得的Heart颜色',
      canSkipSelection: false,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: HeartColor.PINK, text: '此成员获得[桃ハート]。' },
          { id: HeartColor.RED, text: '此成员获得[赤ハート]。' },
          { id: HeartColor.YELLOW, text: '此成员获得[黄ハート]。' },
          { id: HeartColor.GREEN, text: '此成员获得[緑ハート]。' },
          { id: HeartColor.BLUE, text: '此成员获得[青ハート]。' },
          { id: HeartColor.PURPLE, text: '此成员获得[紫ハート]。' },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
    });
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          HeartColor.BLUE
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
      effectChoice: { selectedOptionIds: [HeartColor.BLUE] },
    });
    const publicChoice = session.state!.activeEffect!;
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      activeEffect: { ...publicChoice, publicEffectChoiceAutoAdvanceAt: 0 },
    };
    expect(
      session.executeCommand(
        createAutoAdvancePublicEffectChoiceCommand(PLAYER1, publicChoice.id, 0)
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      sourceCardId: sourceId,
      abilityId: N_BP7_016_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
    });
  });

  it('keeps the paid energy when the source is no longer on stage before the Heart reward resolves', () => {
    const { session, sourceId, energyCardIds } = setupLiveStartScenario({
      cardCode: 'PL!N-bp7-016-R',
      cardName: '朝香果林',
      abilityId: N_BP7_016_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
      activeEnergyCount: 1,
    });
    const player = session.state!.players[0] as unknown as {
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    player.memberSlots.slots[SlotPosition.CENTER] = null;

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          'pay'
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('N_BP7_016_CHOOSE_HEART');
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          HeartColor.BLUE
        )
      ).success
    ).toBe(true);
    const publicChoice = session.state!.activeEffect!;
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      activeEffect: { ...publicChoice, publicEffectChoiceAutoAdvanceAt: 0 },
    };
    expect(
      session.executeCommand(
        createAutoAdvancePublicEffectChoiceCommand(PLAYER1, publicChoice.id, 0)
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.liveResolution.liveModifiers).not.toContainEqual(
      expect.objectContaining({ sourceCardId: sourceId })
    );
    expect(session.state?.actionHistory).toContainEqual(
      expect.objectContaining({
        type: 'RESOLVE_ABILITY',
        payload: expect.objectContaining({
          abilityId: N_BP7_016_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
          step: 'SOURCE_NOT_ON_STAGE_AFTER_PAYMENT',
        }),
      })
    );
  });

  it('uses the shared special-energy selection and stale-input guards for PL!N-bp7-016', () => {
    const { session, energyCardIds } = setupLiveStartScenario({
      cardCode: 'PL!N-bp7-016-N',
      cardName: '朝香果林',
      abilityId: N_BP7_016_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
      activeEnergyCount: 3,
      markedEnergyIndices: [1],
    });

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          'pay'
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
      selectableCardIds: energyCardIds,
      minSelectableCards: 1,
      maxSelectableCards: 1,
    });

    for (const selectedCardIds of [[energyCardIds[0]!, energyCardIds[0]!], ['illegal-energy']]) {
      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(
            PLAYER1,
            session.state!.activeEffect!.id,
            undefined,
            undefined,
            undefined,
            undefined,
            selectedCardIds
          )
        ).success
      ).toBe(false);
      expect(session.state?.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    }

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, energyCardIds[1]!)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('N_BP7_016_CHOOSE_HEART');
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[1]!)?.orientation
    ).toBe(OrientationState.WAITING);

    const stale = setupLiveStartScenario({
      cardCode: 'PL!N-bp7-016-N',
      cardName: '朝香果林',
      abilityId: N_BP7_016_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
      activeEnergyCount: 3,
      markedEnergyIndices: [1],
    });
    expect(
      stale.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          stale.session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          'pay'
        )
      ).success
    ).toBe(true);
    const stalePlayer = stale.session.state!.players[0] as unknown as {
      energyZone: { cardIds: string[] };
    };
    stalePlayer.energyZone.cardIds = stalePlayer.energyZone.cardIds.filter(
      (cardId) => cardId !== stale.energyCardIds[1]
    );
    expect(
      stale.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          stale.session.state!.activeEffect!.id,
          stale.energyCardIds[1]!
        )
      ).success
    ).toBe(false);
    expect(stale.session.state?.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
  });

  it('lets PL!SP-bp4-012 pay one active energy and gives source member one red Heart', () => {
    const { session, sourceId, energyCardIds } = setupLiveStartScenario({
      cardCode: 'PL!SP-bp4-012-N',
      cardName: '澁谷かのん',
      abilityId: SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
      activeEnergyCount: 1,
    });

    expect(session.state?.activeEffect).toMatchObject({
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [createHeartIcon(HeartColor.RED, 1)],
      sourceCardId: sourceId,
      abilityId: SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
    });
  });

  it('keeps a fixed-Heart payment when its source member is no longer on stage', () => {
    const { session, sourceId, energyCardIds } = setupLiveStartScenario({
      cardCode: 'PL!SP-bp4-012-N',
      cardName: '澁谷かのん',
      abilityId: SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
      activeEnergyCount: 1,
    });
    const player = session.state!.players[0] as unknown as {
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    player.memberSlots.slots[SlotPosition.CENTER] = null;

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          'pay'
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.liveResolution.liveModifiers).not.toContainEqual(
      expect.objectContaining({ sourceCardId: sourceId })
    );
    expect(session.state?.actionHistory).toContainEqual(
      expect.objectContaining({
        type: 'RESOLVE_ABILITY',
        payload: expect.objectContaining({
          abilityId: SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
          step: 'SOURCE_NOT_ON_STAGE_AFTER_PAYMENT',
        }),
      })
    );
  });

  it('does not pay cost or add Heart when PL!SP-bp4-012 is declined', () => {
    const { session, energyCardIds } = setupLiveStartScenario({
      cardCode: 'PL!SP-bp4-012-N',
      cardName: '澁谷かのん',
      abilityId: SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
      activeEnergyCount: 1,
    });

    const declineResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );

    expect(declineResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID
      )
    ).toBe(false);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('offers only decline for PL!SP-bp4-012 when active energy is insufficient', () => {
    const { session } = setupLiveStartScenario({
      cardCode: 'PL!SP-bp4-012-N',
      cardName: '澁谷かのん',
      abilityId: SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
      activeEnergyCount: 0,
    });

    expect(session.state?.activeEffect).toMatchObject({
      selectableOptions: [],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });

    const declineResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );

    expect(declineResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID
      )
    ).toBe(false);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('keeps N-sd1-010 paying two energy for one source-member green Heart', () => {
    const { session, sourceId, energyCardIds } = setupLiveStartScenario({
      cardCode: 'PL!N-sd1-010-SD',
      cardName: '三船栞子',
      abilityId: N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID,
      activeEnergyCount: 2,
    });

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    for (const energyCardId of energyCardIds) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }
    expect(session.state?.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      sourceCardId: sourceId,
      abilityId: N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID,
    });
  });

  it('lets PL!HS-PR-029 pay one active energy for one source-member pink Heart', () => {
    const { session, sourceId, energyCardIds } = setupLiveStartScenario({
      cardCode: 'PL!HS-PR-029-PR',
      cardName: '大沢瑠璃乃',
      abilityId: HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID,
      activeEnergyCount: 1,
    });

    expect(session.state?.activeEffect).toMatchObject({
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(session.state?.activeEffect?.effectText).toBe(
      '【LIVE开始时】可以支付[E]：LIVE结束时为止，获得[桃ハート]。'
    );

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          'pay'
        )
      ).success
    ).toBe(true);

    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
      sourceCardId: sourceId,
      abilityId: HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID,
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID
      )
    ).toBe(true);
  });

  it('lets PL!HS-PR-029 safely decline, including when energy is insufficient', () => {
    for (const activeEnergyCount of [1, 0]) {
      const { session } = setupLiveStartScenario({
        cardCode: 'PL!HS-PR-029-PR',
        cardName: '大沢瑠璃乃',
        abilityId: HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID,
        activeEnergyCount,
      });
      const visibleText = [
        session.state?.activeEffect?.effectText,
        session.state?.activeEffect?.stepText,
        session.state?.activeEffect?.skipSelectionLabel,
        ...(session.state?.activeEffect?.selectableOptions?.map((option) => option.label) ?? []),
      ].join(' ');
      expect(visibleText).not.toMatch(/source|pending|payload|stale|eventId|trigger/i);
      expect(session.state?.activeEffect?.selectableOptions).toHaveLength(activeEnergyCount);

      expect(
        session.executeCommand(
          createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
        ).success
      ).toBe(true);
      expect(session.state?.activeEffect).toBeNull();
      expect(session.state?.liveResolution.liveModifiers).toEqual([]);
      expect(
        session.state?.actionHistory.some(
          (action) =>
            action.type === 'PAY_COST' &&
            action.payload.abilityId === HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID
        )
      ).toBe(false);
    }
  });

  it('continues ordered PL!HS-PR-029 pending resolution through both real payment interactions', () => {
    const { session, sourceIds, energyCardIds } = setupLiveStartScenario({
      cardCode: 'PL!HS-PR-029-PR',
      cardName: '大沢瑠璃乃',
      abilityId: HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID,
      activeEnergyCount: 2,
      sourceCount: 2,
    });

    expect(session.state?.activeEffect).toMatchObject({ canResolveInOrder: true });
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          true
        )
      ).success
    ).toBe(true);

    const firstSourceId = session.state!.activeEffect!.sourceCardId;
    const secondSourceId = sourceIds.find((sourceId) => sourceId !== firstSourceId)!;
    expect(sourceIds).toContain(firstSourceId);
    expect(session.state?.activeEffect).toMatchObject({
      sourceCardId: firstSourceId,
      abilityId: HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID,
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      metadata: expect.objectContaining({ orderedResolution: true }),
    });
    expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          'pay'
        )
      ).success
    ).toBe(true);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
      sourceCardId: firstSourceId,
      abilityId: HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID,
    });

    expect(session.state?.activeEffect).toMatchObject({
      sourceCardId: secondSourceId,
      abilityId: HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID,
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      metadata: expect.objectContaining({ orderedResolution: true }),
    });
    expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(session.state?.pendingAbilities).toEqual([]);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toHaveLength(1);
  });
});
