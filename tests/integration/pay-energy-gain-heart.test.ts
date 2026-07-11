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
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  HS_PR_029_LIVE_START_PAY_ENERGY_GAIN_PINK_HEART_ABILITY_ID,
  N_SD1_010_LIVE_START_PAY_TWO_ENERGY_GAIN_GREEN_HEART_ABILITY_ID,
  SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
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
  it('lets PL!SP-bp4-012 pay one active energy and gives source member one red Heart', () => {
    const { session, sourceId, energyCardIds } = setupLiveStartScenario({
      cardCode: 'PL!SP-bp4-012-N',
      cardName: '澁谷かのん',
      abilityId: SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
      activeEnergyCount: 1,
    });

    expect(session.state?.activeEffect).toMatchObject({
      selectableOptions: [{ id: 'pay', label: '支付1[E]' }],
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
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation).toBe(
      OrientationState.WAITING
    );
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

  it('does not pay cost or add Heart when PL!SP-bp4-012 is declined', () => {
    const { session, energyCardIds } = setupLiveStartScenario({
      cardCode: 'PL!SP-bp4-012-N',
      cardName: '澁谷かのん',
      abilityId: SP_BP4_012_LIVE_START_PAY_ENERGY_GAIN_RED_HEART_ABILITY_ID,
      activeEnergyCount: 1,
    });

    const declineResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        null
      )
    );

    expect(declineResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation).toBe(
      OrientationState.ACTIVE
    );
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
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        null
      )
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
      selectableOptions: [{ id: 'pay', label: '支付1[E]' }],
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

    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation).toBe(
      OrientationState.WAITING
    );
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
      selectableOptions: [{ id: 'pay', label: '支付1[E]' }],
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
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation).toBe(
      OrientationState.WAITING
    );
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
      selectableOptions: [{ id: 'pay', label: '支付1[E]' }],
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
