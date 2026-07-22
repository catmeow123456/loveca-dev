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
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import type { DeckConfig } from '../../src/application/game-service';
import {
  HS_BP2_001_ACTIVATED_PAY_TWO_ENERGY_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID,
  SP_SD1_005_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID,
  SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
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

function createMember(
  cardCode: string,
  groupNames = ['蓮ノ空女学院スクールアイドルクラブ']
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 13,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string, score: number, groupNames: readonly string[]): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [...groupNames],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function createDeck(): DeckConfig {
  return {
    mainDeck: Array.from({ length: 20 }, (_, index) =>
      createMember(`FILLER-M-${index}`)
    ) as AnyCardData[],
    energyDeck: Array.from({ length: 12 }, (_, index) => createEnergy(`FILLER-E-${index}`)),
  };
}

function setupScenario(options: {
  readonly sourceCardCode?: string;
  readonly waitingRoomCards: readonly ReturnType<typeof createCardInstance>[];
  readonly energyCount: number;
  readonly activeEnergyCount?: number;
  readonly markedEnergyIndices?: readonly number[];
  readonly sourceOnStage?: boolean;
}) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  const deck = createDeck();
  session.createGame('hs-bp2-001-pay-energy-recovery', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMember(options.sourceCardCode ?? 'PL!HS-bp2-001-R'),
    PLAYER1,
    'source'
  );
  const energyCards = Array.from({ length: options.energyCount }, (_, index) =>
    createCardInstance(createEnergy(`ENERGY-${index}`), PLAYER1, `energy-${index}`)
  );
  let state = registerCards(session.state!, [source, ...energyCards, ...options.waitingRoomCards]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.waitingRoomCards.map((card) => card.instanceId),
    },
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation:
              index < (options.activeEnergyCount ?? options.energyCount)
                ? OrientationState.ACTIVE
                : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: null,
        [SlotPosition.CENTER]: options.sourceOnStage === false ? null : source.instanceId,
        [SlotPosition.RIGHT]: null,
      },
      cardStates:
        options.sourceOnStage === false
          ? new Map()
          : new Map([
              [
                source.instanceId,
                { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
              ],
            ]),
    },
  }));
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
    energyActivePhaseSkips: (options.markedEnergyIndices ?? []).map((index) => ({
      playerId: PLAYER1,
      energyCardId: energyCards[index]!.instanceId,
      sourceCardId: 'marker-source',
      abilityId: 'marker-ability',
    })),
  };
  (session as unknown as { authorityState: GameState }).authorityState = state;

  return {
    session,
    sourceId: source.instanceId,
    energyCardIds: energyCards.map((card) => card.instanceId),
    setNow(value: number) {
      now = value;
    },
  };
}

function activate(scenario: ReturnType<typeof setupScenario>) {
  return scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      HS_BP2_001_ACTIVATED_PAY_TWO_ENERGY_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID
    )
  );
}

describe('pay-energy waiting-room-to-hand shared workflow', () => {
  it.each(['PL!HS-bp2-001-R', 'PL!HS-bp2-001-P'])(
    '%s pays two active energy and recovers only a score-three-or-less Hasunosora LIVE',
    (sourceCardCode) => {
      const eligible = createCardInstance(
        createLive('HASU-LOW-LIVE', 3, ['蓮ノ空女学院スクールアイドルクラブ']),
        PLAYER1,
        'eligible'
      );
      const highScore = createCardInstance(
        createLive('HASU-HIGH-LIVE', 4, ['蓮ノ空女学院スクールアイドルクラブ']),
        PLAYER1,
        'high-score'
      );
      const otherGroup = createCardInstance(
        createLive('OTHER-LOW-LIVE', 2, ['Aqours']),
        PLAYER1,
        'other-group'
      );
      const member = createCardInstance(createMember('HASU-MEMBER'), PLAYER1, 'member');
      const scenario = setupScenario({
        sourceCardCode,
        waitingRoomCards: [eligible, highScore, otherGroup, member],
        energyCount: 2,
      });

      const activateResult = activate(scenario);
      expect(activateResult.success, activateResult.error).toBe(true);
      expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
        eligible.instanceId,
      ]);
      expect(scenario.session.state?.activeEffect?.canSkipSelection).toBe(false);
      expect(
        scenario.energyCardIds.every(
          (cardId) =>
            scenario.session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation ===
            OrientationState.WAITING
        )
      ).toBe(true);

      const confirmResult = scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          eligible.instanceId
        )
      );
      expect(confirmResult.success, confirmResult.error).toBe(true);
      confirmPublicSelectionIfNeeded(scenario.session);
      expect(scenario.session.state?.players[0].hand.cardIds).toContain(eligible.instanceId);
      expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
        highScore.instanceId,
        otherGroup.instanceId,
        member.instanceId,
      ]);
    }
  );

  it('does not pay energy or consume the turn limit when no legal target exists', () => {
    const highScore = createCardInstance(
      createLive('HASU-HIGH-LIVE', 4, ['蓮ノ空女学院スクールアイドルクラブ']),
      PLAYER1,
      'high-score'
    );
    const scenario = setupScenario({ waitingRoomCards: [highScore], energyCount: 2 });

    const result = activate(scenario);
    expect(result.success).toBe(false);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(
      scenario.energyCardIds.every(
        (cardId) =>
          scenario.session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation ===
          OrientationState.ACTIVE
      )
    ).toBe(true);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            HS_BP2_001_ACTIVATED_PAY_TWO_ENERGY_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
  });

  it('does not partially pay or consume the turn limit with fewer than two active energy', () => {
    const eligible = createCardInstance(
      createLive('HASU-LOW-LIVE', 3, ['蓮ノ空女学院スクールアイドルクラブ']),
      PLAYER1,
      'eligible'
    );
    const scenario = setupScenario({
      waitingRoomCards: [eligible],
      energyCount: 2,
      activeEnergyCount: 1,
    });

    const result = activate(scenario);
    expect(result.success).toBe(false);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyCardIds[0]!)
        ?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            HS_BP2_001_ACTIVATED_PAY_TWO_ENERGY_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
  });

  it('enforces once per turn after a successful recovery', () => {
    const first = createCardInstance(
      createLive('HASU-LOW-LIVE-1', 1, ['蓮ノ空女学院スクールアイドルクラブ']),
      PLAYER1,
      'first'
    );
    const second = createCardInstance(
      createLive('HASU-LOW-LIVE-2', 2, ['蓮ノ空女学院スクールアイドルクラブ']),
      PLAYER1,
      'second'
    );
    const scenario = setupScenario({
      waitingRoomCards: [first, second],
      energyCount: 4,
    });

    expect(activate(scenario).success).toBe(true);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          first.instanceId
        )
      ).success
    ).toBe(true);
    confirmPublicSelectionIfNeeded(scenario.session);

    const secondActivation = activate(scenario);
    expect(secondActivation.success).toBe(false);
    expect(secondActivation.error).toContain('本回合已发动 1/1 次');
  });

  it('rejects illegal and stale selections without moving another card', () => {
    const eligible = createCardInstance(
      createLive('HASU-LOW-LIVE', 3, ['蓮ノ空女学院スクールアイドルクラブ']),
      PLAYER1,
      'eligible'
    );
    const illegal = createCardInstance(
      createLive('OTHER-LOW-LIVE', 2, ['Aqours']),
      PLAYER1,
      'illegal'
    );
    const scenario = setupScenario({
      waitingRoomCards: [eligible, illegal],
      energyCount: 2,
    });
    expect(activate(scenario).success).toBe(true);
    const effectId = scenario.session.state!.activeEffect!.id;

    const illegalResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, illegal.instanceId)
    );
    expect(illegalResult.success).toBe(false);
    expect(scenario.session.state?.players[0].hand.cardIds).not.toContain(illegal.instanceId);

    const player = scenario.session.state!.players[0] as unknown as {
      waitingRoom: { cardIds: string[] };
    };
    player.waitingRoom.cardIds = [illegal.instanceId];
    const staleResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, eligible.instanceId)
    );
    expect(staleResult.success).toBe(false);
    expect(scenario.session.state?.players[0].hand.cardIds).not.toContain(eligible.instanceId);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([illegal.instanceId]);
  });
});

function activateSpSd1005(scenario: ReturnType<typeof setupScenario>, playerId = PLAYER1) {
  return scenario.session.executeCommand(
    createActivateAbilityCommand(
      playerId,
      scenario.sourceId,
      SP_SD1_005_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID
    )
  );
}

describe('PL!SP-sd1-005-SD Ren activated LIVE recovery', () => {
  it('pays the first three ordinary ACTIVE energy, records exact ids, and only selects LIVE', () => {
    const live = createCardInstance(createLive('LIELLA-LIVE', 4, ['Liella!']), PLAYER1, 'live');
    const member = createCardInstance(
      createMember('LIELLA-MEMBER', ['Liella!']),
      PLAYER1,
      'member'
    );
    const scenario = setupScenario({
      sourceCardCode: 'PL!SP-sd1-005-SD',
      waitingRoomCards: [live, member],
      energyCount: 4,
    });

    expect(activateSpSd1005(scenario).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      selectableCardIds: [live.instanceId],
      stepText: '请选择自己的休息室中1张LIVE卡加入手牌。',
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
    });
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === SP_SD1_005_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID
      )?.payload.energyCardIds
    ).toEqual(scenario.energyCardIds.slice(0, 3));
    expect(
      scenario.energyCardIds.map(
        (cardId) =>
          scenario.session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([
      OrientationState.WAITING,
      OrientationState.WAITING,
      OrientationState.WAITING,
      OrientationState.ACTIVE,
    ]);
  });

  it('opens the exact special-energy payment window with governed copy and rejects bad ids', () => {
    const live = createCardInstance(createLive('LIELLA-LIVE', 4, ['Liella!']), PLAYER1, 'live');
    const scenario = setupScenario({
      sourceCardCode: 'PL!SP-sd1-005-SD',
      waitingRoomCards: [live],
      energyCount: 4,
      markedEnergyIndices: [0],
    });

    expect(activateSpSd1005(scenario).success).toBe(true);
    const payment = scenario.session.state!.activeEffect!;
    expect(payment).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E][E][E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
      minSelectableCards: 3,
      maxSelectableCards: 3,
    });
    for (const ids of [
      [scenario.energyCardIds[0]!, scenario.energyCardIds[0]!, scenario.energyCardIds[1]!],
      [scenario.energyCardIds[0]!, scenario.energyCardIds[1]!, 'forged-energy'],
    ]) {
      expect(
        scenario.session.executeCommand(
          createConfirmEffectStepCommand(
            PLAYER1,
            payment.id,
            undefined,
            undefined,
            undefined,
            undefined,
            ids
          )
        ).success
      ).toBe(false);
      expect(scenario.session.state?.activeEffect?.stepId).toBe(
        'COMMON_ENERGY_OPERATION_SELECTION'
      );
    }

    const selectedEnergyCardIds = scenario.energyCardIds.slice(1, 4);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          payment.id,
          undefined,
          undefined,
          undefined,
          undefined,
          selectedEnergyCardIds
        )
      ).success
    ).toBe(true);
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === SP_SD1_005_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID
      )?.payload.energyCardIds
    ).toEqual(selectedEnergyCardIds);
  });

  it('keeps the special-energy payment window when a selected ACTIVE energy becomes stale', () => {
    const live = createCardInstance(createLive('LIELLA-LIVE', 4, ['Liella!']), PLAYER1, 'live');
    const scenario = setupScenario({
      sourceCardCode: 'PL!SP-sd1-005-SD',
      waitingRoomCards: [live],
      energyCount: 4,
      markedEnergyIndices: [0],
    });

    expect(activateSpSd1005(scenario).success).toBe(true);
    const payment = scenario.session.state!.activeEffect!;
    const staleId = scenario.energyCardIds[0]!;
    const staleState = updatePlayer(scenario.session.state!, PLAYER1, (player) => {
      const cardStates = new Map(player.energyZone.cardStates);
      cardStates.set(staleId, {
        ...cardStates.get(staleId)!,
        orientation: OrientationState.WAITING,
      });
      return {
        ...player,
        energyZone: {
          ...player.energyZone,
          cardStates,
        },
      };
    });
    (scenario.session as unknown as { authorityState: GameState }).authorityState = staleState;
    const actionHistoryLength = scenario.session.state!.actionHistory.length;

    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          payment.id,
          undefined,
          undefined,
          undefined,
          undefined,
          [staleId, scenario.energyCardIds[1]!, scenario.energyCardIds[2]!]
        )
      ).success
    ).toBe(false);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      id: payment.id,
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      selectableCardIds: scenario.energyCardIds,
    });
    expect(scenario.session.state?.actionHistory).toHaveLength(actionHistoryLength);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
          SP_SD1_005_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID
      )
    ).toBe(false);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(live.instanceId);

    const validEnergyCardIds = scenario.energyCardIds.slice(1, 4);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          payment.id,
          undefined,
          undefined,
          undefined,
          undefined,
          validEnergyCardIds
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      selectableCardIds: [live.instanceId],
      selectionLabel: '选择要加入手牌的卡',
    });
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            SP_SD1_005_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID
      )?.payload.energyCardIds
    ).toEqual(validEnergyCardIds);
  });

  it.each([
    ['insufficient ACTIVE energy', { energyCount: 3, activeEnergyCount: 2 }],
    ['no legal LIVE', { energyCount: 3, noLive: true }],
    ['wrong phase', { energyCount: 3, wrongPhase: true }],
    ['not active player', { energyCount: 3, inactivePlayer: true }],
    ['source not on stage', { energyCount: 3, sourceOnStage: false }],
  ])('does not pay or consume turn1 when %s', (_label, options) => {
    const live = createCardInstance(createLive('LIELLA-LIVE', 4, ['Liella!']), PLAYER1, 'live');
    const member = createCardInstance(createMember('MEMBER', ['Liella!']), PLAYER1, 'member');
    const scenario = setupScenario({
      sourceCardCode: 'PL!SP-sd1-005-SD',
      waitingRoomCards: options.noLive ? [member] : [live],
      energyCount: options.energyCount,
      activeEnergyCount: options.activeEnergyCount,
      sourceOnStage: options.sourceOnStage,
    });
    if (options.wrongPhase) {
      (scenario.session.state as GameState).currentPhase = GamePhase.LIVE_SET;
    }
    if (options.inactivePlayer) {
      (scenario.session.state as GameState).activePlayerIndex = 1;
    }
    const beforeOrientations = scenario.energyCardIds.map(
      (cardId) => scenario.session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation
    );

    expect(activateSpSd1005(scenario).success).toBe(false);
    expect(
      scenario.energyCardIds.map(
        (cardId) =>
          scenario.session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual(beforeOrientations);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId === SP_SD1_005_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('keeps the selected LIVE in the waiting room until the shared public deadline', () => {
    const live = createCardInstance(createLive('LIELLA-LIVE', 4, ['Liella!']), PLAYER1, 'live');
    const scenario = setupScenario({
      sourceCardCode: 'PL!SP-sd1-005-SD',
      waitingRoomCards: [live],
      energyCount: 6,
    });
    expect(activateSpSd1005(scenario).success).toBe(true);
    const selection = scenario.session.state!.activeEffect!;
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(live.instanceId);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, selection.id, live.instanceId)
      ).success
    ).toBe(true);
    const reveal = scenario.session.state!.activeEffect!;
    const deadline = reveal.publicCardSelectionAutoAdvanceAt!;
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(live.instanceId);
    expect(scenario.session.state?.players[0].hand.cardIds).not.toContain(live.instanceId);
    for (const playerId of [PLAYER1, PLAYER2]) {
      expect(scenario.session.getPlayerViewState(playerId)?.activeEffect).toMatchObject({
        revealedObjectIds: [`obj_${live.instanceId}`],
        publicCardSelectionAutoAdvanceAt: deadline,
      });
    }
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(PLAYER2, reveal.id, deadline)
      ).success
    ).toBe(false);
    scenario.setNow(deadline);
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(PLAYER2, reveal.id, deadline)
      ).success
    ).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toContain(live.instanceId);
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(PLAYER1, reveal.id, deadline)
      ).success
    ).toBe(false);
    expect(activateSpSd1005(scenario).success).toBe(false);
  });

  it('rejects duplicate, forged, and expired recovery selections without advancing twice', () => {
    const first = createCardInstance(createLive('FIRST-LIVE', 4, ['Liella!']), PLAYER1, 'first');
    const second = createCardInstance(createLive('SECOND-LIVE', 4, ['Liella!']), PLAYER1, 'second');
    const scenario = setupScenario({
      sourceCardCode: 'PL!SP-sd1-005-SD',
      waitingRoomCards: [first, second],
      energyCount: 3,
    });
    expect(activateSpSd1005(scenario).success).toBe(true);
    const selection = scenario.session.state!.activeEffect!;
    for (const selectedCardIds of [[first.instanceId, first.instanceId], ['forged-live']]) {
      expect(
        scenario.session.executeCommand(
          createConfirmEffectStepCommand(
            PLAYER1,
            selection.id,
            undefined,
            undefined,
            undefined,
            undefined,
            selectedCardIds
          )
        ).success
      ).toBe(false);
      expect(scenario.session.state?.activeEffect?.stepId).toBe(selection.stepId);
      expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
        first.instanceId,
        second.instanceId,
      ]);
    }
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, selection.id, first.instanceId)
      ).success
    ).toBe(true);
    const reveal = scenario.session.state!.activeEffect!;
    scenario.setNow(reveal.publicCardSelectionAutoAdvanceAt!);
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(
          PLAYER2,
          reveal.id,
          reveal.publicCardSelectionAutoAdvanceAt!
        )
      ).success
    ).toBe(true);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, selection.id, second.instanceId)
      ).success
    ).toBe(false);
    expect(scenario.session.state?.players[0].hand.cardIds).toContain(first.instanceId);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([second.instanceId]);
  });

  it('does not substitute a stale target at the deadline and retains paid cost and turn use', () => {
    const selected = createCardInstance(
      createLive('SELECTED-LIVE', 4, ['Liella!']),
      PLAYER1,
      'selected'
    );
    const other = createCardInstance(createLive('OTHER-LIVE', 4, ['Liella!']), PLAYER1, 'other');
    const scenario = setupScenario({
      sourceCardCode: 'PL!SP-sd1-005-SD',
      waitingRoomCards: [selected, other],
      energyCount: 6,
    });
    expect(activateSpSd1005(scenario).success).toBe(true);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          selected.instanceId
        )
      ).success
    ).toBe(true);
    const reveal = scenario.session.state!.activeEffect!;
    const staleState = updatePlayer(scenario.session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== selected.instanceId),
      },
      hand: { ...player.hand, cardIds: [...player.hand.cardIds, selected.instanceId] },
    }));
    (scenario.session as unknown as { authorityState: GameState }).authorityState = staleState;
    scenario.setNow(reveal.publicCardSelectionAutoAdvanceAt!);
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(
          PLAYER1,
          reveal.id,
          reveal.publicCardSelectionAutoAdvanceAt!
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([other.instanceId]);
    expect(
      scenario.session.state?.actionHistory.filter(
        (action) =>
          action.payload.abilityId ===
            SP_SD1_005_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyCardIds[0]!)
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(activateSpSd1005(scenario).success).toBe(false);
  });
});

function setupSpSd1007(options: {
  readonly waitingRoomCards: readonly ReturnType<typeof createCardInstance>[];
  readonly energyCount?: number;
  readonly activeEnergyCount?: number;
  readonly markedEnergyIndices?: readonly number[];
  readonly realPlay?: boolean;
  readonly removeSourceAfterQueue?: boolean;
}) {
  let now = 30_000;
  const session = createGameSession({ now: () => now });
  const deck = createDeck();
  session.createGame('sp-sd1-007-on-enter-recovery', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);
  const source = createCardInstance(
    createMember('PL!SP-sd1-007-SD', ['Liella!']),
    PLAYER1,
    'sp-sd1-007-source'
  );
  const energyCards = Array.from({ length: options.energyCount ?? 2 }, (_, index) =>
    createCardInstance(createEnergy(`SP-SD1-007-ENERGY-${index}`), PLAYER1, `sp007-energy-${index}`)
  );
  let state = registerCards(session.state!, [source, ...energyCards, ...options.waitingRoomCards]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: options.realPlay ? [source.instanceId] : [],
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.waitingRoomCards.map((card) => card.instanceId),
    },
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation:
              index < (options.activeEnergyCount ?? energyCards.length)
                ? OrientationState.ACTIVE
                : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
    memberSlots: options.realPlay
      ? removeCardFromSlot(player.memberSlots, SlotPosition.CENTER)
      : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
  }));
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
    energyActivePhaseSkips: (options.markedEnergyIndices ?? []).map((index) => ({
      playerId: PLAYER1,
      energyCardId: energyCards[index]!.instanceId,
      sourceCardId: 'marker-source',
      abilityId: 'marker-ability',
    })),
  };

  if (!options.realPlay) {
    state = emitGameEvent(
      state,
      createEnterStageEvent(
        source.instanceId,
        ZoneType.HAND,
        SlotPosition.CENTER,
        PLAYER1,
        PLAYER1
      )
    );
    state = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_ENTER_STAGE]);
    if (options.removeSourceAfterQueue) {
      state = updatePlayer(state, PLAYER1, (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: [...player.waitingRoom.cardIds, source.instanceId],
        },
      }));
    }
    state = resolvePendingCardEffects(state).gameState;
  }
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return {
    session,
    source,
    energyCardIds: energyCards.map((card) => card.instanceId),
    setNow(value: number) {
      now = value;
    },
  };
}

function confirmSpSd1007Option(
  scenario: ReturnType<typeof setupSpSd1007>,
  selectedOptionId: string | null
) {
  const effect = scenario.session.state!.activeEffect!;
  return scenario.session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effect.id,
      undefined,
      undefined,
      undefined,
      selectedOptionId ?? undefined
    )
  );
}

function paySpSd1007OrdinaryEnergy(scenario: ReturnType<typeof setupSpSd1007>): void {
  const result = confirmSpSd1007Option(scenario, 'pay');
  expect(result.success, result.error).toBe(true);
  expect(scenario.session.state?.activeEffect?.stepId).toBe(
    'SP_SD1_007_SELECT_LIELLA_MEMBER_FROM_WAITING_ROOM'
  );
}

describe('PL!SP-sd1-007-SD 费用7「米女メイ」queued ON_ENTER recovery', () => {
  it('uses real PLAY_MEMBER -> ON_ENTER_STAGE and locks source instance, slot, and timing', () => {
    const target = createCardInstance(
      createMember('LIELLA-MEMBER', ['Liella!']),
      PLAYER1,
      'liella-member'
    );
    const scenario = setupSpSd1007({ waitingRoomCards: [target], realPlay: true });
    scenario.session.setManualOperationMode('FREE');
    const result = scenario.session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, scenario.source.instanceId, SlotPosition.LEFT, {
        freePlay: true,
      })
    );
    expect(result.success, result.error).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
      sourceCardId: scenario.source.instanceId,
      stepId: 'SP_SD1_007_PAY_ENERGY_FOR_LIELLA_MEMBER_RECOVERY',
    });
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID
      )?.payload
    ).toMatchObject({
      sourceCardId: scenario.source.instanceId,
      sourceSlot: SlotPosition.LEFT,
      timingId: TriggerCondition.ON_ENTER_STAGE,
    });
  });

  it('continues resolving after the queued source leaves the stage', () => {
    const target = createCardInstance(
      createMember('LIELLA-MEMBER', ['Liella!']),
      PLAYER1,
      'liella-member'
    );
    const scenario = setupSpSd1007({
      waitingRoomCards: [target],
      removeSourceAfterQueue: true,
    });
    expect(scenario.session.state?.activeEffect).toMatchObject({
      sourceCardId: scenario.source.instanceId,
      stepId: 'SP_SD1_007_PAY_ENERGY_FOR_LIELLA_MEMBER_RECOVERY',
    });
    expect(scenario.session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
  });

  it('filters by controller waiting room, owner, MEMBER type, and Liella! group', () => {
    const eligible = createCardInstance(
      createMember('OWN-LIELLA-MEMBER', ['Liella!']),
      PLAYER1,
      'eligible'
    );
    const liellaLive = createCardInstance(createLive('LIELLA-LIVE', 4, ['Liella!']), PLAYER1, 'live');
    const otherMember = createCardInstance(createMember('OTHER-MEMBER', ['Aqours']), PLAYER1, 'other');
    const opponentOwned = createCardInstance(
      createMember('OPPONENT-LIELLA-MEMBER', ['Liella!']),
      PLAYER2,
      'opponent-owned'
    );
    const scenario = setupSpSd1007({
      waitingRoomCards: [eligible, liellaLive, otherMember, opponentOwned],
    });
    expect(scenario.session.state?.activeEffect?.metadata).toMatchObject({ orderedResolution: false });
    paySpSd1007OrdinaryEnergy(scenario);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      selectableCardIds: [eligible.instanceId],
      stepText: '请选择自己的休息室中1张『Liella!』的成员卡加入手牌。',
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
    });
  });

  it('consumes no-target pending without paying or opening an empty selection window', () => {
    const invalid = createCardInstance(createMember('AQOURS-MEMBER', ['Aqours']), PLAYER1, 'invalid');
    const scenario = setupSpSd1007({ waitingRoomCards: [invalid] });
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID
      )
    ).toBe(false);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) => action.payload.reason === 'NO_LIELLA_MEMBER_TARGET'
      )
    ).toBe(true);
  });

  it.each([0, 1])(
    'with %i ACTIVE energy only offers decline and atomically rejects forged pay',
    (activeEnergyCount) => {
      const target = createCardInstance(
        createMember('LIELLA-MEMBER', ['Liella!']),
        PLAYER1,
        'target'
      );
      const scenario = setupSpSd1007({
        waitingRoomCards: [target],
        energyCount: 2,
        activeEnergyCount,
      });
      const payment = scenario.session.state!.activeEffect!;
      expect(payment).toMatchObject({
        stepText: '当前活跃能量不足，无法支付[E][E]，可以不发动。',
        selectableOptions: [],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
      });
      const actionCount = scenario.session.state!.actionHistory.length;
      const forged = confirmSpSd1007Option(scenario, 'pay');
      expect(forged.success).toBe(false);
      expect(scenario.session.state?.activeEffect).toEqual(payment);
      expect(scenario.session.state?.actionHistory).toHaveLength(actionCount);
      expect(
        scenario.energyCardIds.map(
          (cardId) =>
            scenario.session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation
        )
      ).toEqual(
        scenario.energyCardIds.map((_, index) =>
          index < activeEnergyCount ? OrientationState.ACTIVE : OrientationState.WAITING
        )
      );
    }
  );

  it('declines without changing energy, waiting room, hand, or recording PAY_COST/ABILITY_USE', () => {
    const target = createCardInstance(
      createMember('LIELLA-MEMBER', ['Liella!']),
      PLAYER1,
      'target'
    );
    const scenario = setupSpSd1007({ waitingRoomCards: [target] });
    expect(scenario.session.state?.activeEffect).toMatchObject({
      stepText:
        '可以支付[E][E]；如此做时，从自己的休息室将1张『Liella!』的成员卡加入手牌。',
      selectableOptions: [{ id: 'pay', label: '支付[E][E]' }],
      skipSelectionLabel: '不发动',
    });
    expect(confirmSpSd1007Option(scenario, null).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([target.instanceId]);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(
      scenario.energyCardIds.every(
        (cardId) =>
          scenario.session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation ===
          OrientationState.ACTIVE
      )
    ).toBe(true);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          (action.type === 'PAY_COST' || action.payload.step === 'ABILITY_USE') &&
          action.payload.abilityId ===
            SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID
      )
    ).toBe(false);
  });

  it('pays the first two ordinary ACTIVE energy and records exact paid ids', () => {
    const target = createCardInstance(
      createMember('LIELLA-MEMBER', ['Liella!']),
      PLAYER1,
      'target'
    );
    const scenario = setupSpSd1007({ waitingRoomCards: [target], energyCount: 3 });
    paySpSd1007OrdinaryEnergy(scenario);
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID
      )?.payload.energyCardIds
    ).toEqual(scenario.energyCardIds.slice(0, 2));
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
  });

  it('uses exact special-energy selection and rejects duplicate, forged, stale-direction, and stale-zone ids', () => {
    const target = createCardInstance(
      createMember('LIELLA-MEMBER', ['Liella!']),
      PLAYER1,
      'target'
    );
    const scenario = setupSpSd1007({
      waitingRoomCards: [target],
      energyCount: 3,
      markedEnergyIndices: [0],
    });
    expect(confirmSpSd1007Option(scenario, 'pay').success).toBe(true);
    const selection = scenario.session.state!.activeEffect!;
    expect(selection).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E][E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
      minSelectableCards: 2,
      maxSelectableCards: 2,
    });
    for (const ids of [
      [scenario.energyCardIds[0]!, scenario.energyCardIds[0]!],
      [scenario.energyCardIds[0]!, 'forged-energy'],
    ]) {
      expect(
        scenario.session.executeCommand(
          createConfirmEffectStepCommand(
            PLAYER1,
            selection.id,
            undefined,
            undefined,
            undefined,
            undefined,
            ids
          )
        ).success
      ).toBe(false);
    }
    const staleDirectionId = scenario.energyCardIds[0]!;
    const staleZoneId = scenario.energyCardIds[1]!;
    let staleState = updatePlayer(scenario.session.state!, PLAYER1, (player) => {
      const cardStates = new Map(player.energyZone.cardStates);
      cardStates.set(staleDirectionId, {
        ...cardStates.get(staleDirectionId)!,
        orientation: OrientationState.WAITING,
      });
      return {
        ...player,
        energyZone: {
          ...player.energyZone,
          cardIds: player.energyZone.cardIds.filter((cardId) => cardId !== staleZoneId),
          cardStates,
        },
      };
    });
    (scenario.session as unknown as { authorityState: GameState }).authorityState = staleState;
    for (const ids of [
      [staleDirectionId, scenario.energyCardIds[2]!],
      [staleZoneId, scenario.energyCardIds[2]!],
    ]) {
      const beforeActions = scenario.session.state!.actionHistory.length;
      expect(
        scenario.session.executeCommand(
          createConfirmEffectStepCommand(
            PLAYER1,
            selection.id,
            undefined,
            undefined,
            undefined,
            undefined,
            ids
          )
        ).success
      ).toBe(false);
      expect(scenario.session.state?.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
      expect(scenario.session.state?.actionHistory).toHaveLength(beforeActions);
    }
    staleState = updatePlayer(scenario.session.state!, PLAYER1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: [staleDirectionId, ...player.energyZone.cardIds],
        cardStates: new Map([
          ...player.energyZone.cardStates,
          [
            staleDirectionId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ],
        ]),
      },
    }));
    (scenario.session as unknown as { authorityState: GameState }).authorityState = staleState;
    const validIds = [staleDirectionId, scenario.energyCardIds[2]!];
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          selection.id,
          undefined,
          undefined,
          undefined,
          undefined,
          validIds
        )
      ).success
    ).toBe(true);
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID
      )?.payload.energyCardIds
    ).toEqual(validIds);
  });

  it('keeps a successful special-energy payment when the target disappears during the pause', () => {
    const target = createCardInstance(
      createMember('LIELLA-MEMBER', ['Liella!']),
      PLAYER1,
      'target'
    );
    const scenario = setupSpSd1007({
      waitingRoomCards: [target],
      energyCount: 3,
      markedEnergyIndices: [0],
    });
    expect(confirmSpSd1007Option(scenario, 'pay').success).toBe(true);
    const payment = scenario.session.state!.activeEffect!;
    const withoutTarget = updatePlayer(scenario.session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
    }));
    (scenario.session as unknown as { authorityState: GameState }).authorityState = withoutTarget;
    const paidIds = scenario.energyCardIds.slice(0, 2);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          payment.id,
          undefined,
          undefined,
          undefined,
          undefined,
          paidIds
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID
      )?.payload.energyCardIds
    ).toEqual(paidIds);
  });

  it('atomically rejects empty, duplicate, forged, wrong-type/group, and wrong-player recovery input', () => {
    const eligible = createCardInstance(
      createMember('LIELLA-MEMBER', ['Liella!']),
      PLAYER1,
      'eligible'
    );
    const wrongType = createCardInstance(createLive('LIELLA-LIVE', 4, ['Liella!']), PLAYER1, 'wrong-type');
    const wrongGroup = createCardInstance(createMember('AQOURS-MEMBER', ['Aqours']), PLAYER1, 'wrong-group');
    const scenario = setupSpSd1007({ waitingRoomCards: [eligible, wrongType, wrongGroup] });
    paySpSd1007OrdinaryEnergy(scenario);
    const selection = scenario.session.state!.activeEffect!;
    const initialWaitingRoom = [...scenario.session.state!.players[0].waitingRoom.cardIds];
    const attempts: Array<{ playerId: string; selectedCardId?: string; selectedCardIds?: string[] }> = [
      { playerId: PLAYER1 },
      { playerId: PLAYER1, selectedCardIds: [eligible.instanceId, eligible.instanceId] },
      { playerId: PLAYER1, selectedCardId: 'forged-card' },
      { playerId: PLAYER1, selectedCardId: wrongType.instanceId },
      { playerId: PLAYER1, selectedCardId: wrongGroup.instanceId },
      { playerId: PLAYER2, selectedCardId: eligible.instanceId },
    ];
    for (const attempt of attempts) {
      const beforeActions = scenario.session.state!.actionHistory.length;
      expect(
        scenario.session.executeCommand(
          createConfirmEffectStepCommand(
            attempt.playerId,
            selection.id,
            attempt.selectedCardId,
            undefined,
            undefined,
            undefined,
            attempt.selectedCardIds
          )
        ).success
      ).toBe(false);
      expect(scenario.session.state?.activeEffect).toEqual(selection);
      expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual(initialWaitingRoom);
      expect(scenario.session.state?.actionHistory).toHaveLength(beforeActions);
    }
  });

  it.each([PLAYER1, PLAYER2])(
    'publishes one selected card to both players and lets %s resume at the authoritative deadline once',
    (resumingPlayerId) => {
      const target = createCardInstance(
        createMember('LIELLA-MEMBER', ['Liella!']),
        PLAYER1,
        'target'
      );
      const scenario = setupSpSd1007({ waitingRoomCards: [target] });
      paySpSd1007OrdinaryEnergy(scenario);
      const selection = scenario.session.state!.activeEffect!;
      expect(
        scenario.session.executeCommand(
          createConfirmEffectStepCommand(PLAYER1, selection.id, target.instanceId)
        ).success
      ).toBe(true);
      const reveal = scenario.session.state!.activeEffect!;
      const deadline = reveal.publicCardSelectionAutoAdvanceAt!;
      expect(scenario.session.state?.players[0].waitingRoom.cardIds).toContain(target.instanceId);
      expect(scenario.session.state?.players[0].hand.cardIds).not.toContain(target.instanceId);
      for (const playerId of [PLAYER1, PLAYER2]) {
        expect(scenario.session.getPlayerViewState(playerId)?.activeEffect).toMatchObject({
          revealedObjectIds: [`obj_${target.instanceId}`],
          publicCardSelectionAutoAdvanceAt: deadline,
        });
      }
      expect(
        scenario.session.executeCommand(
          createAutoAdvancePublicCardSelectionCommand(resumingPlayerId, reveal.id, deadline)
        ).success
      ).toBe(false);
      scenario.setNow(deadline);
      expect(
        scenario.session.executeCommand(
          createAutoAdvancePublicCardSelectionCommand(resumingPlayerId, reveal.id, deadline)
        ).success
      ).toBe(true);
      expect(scenario.session.state?.players[0].hand.cardIds).toContain(target.instanceId);
      expect(
        scenario.session.executeCommand(
          createAutoAdvancePublicCardSelectionCommand(
            resumingPlayerId === PLAYER1 ? PLAYER2 : PLAYER1,
            reveal.id,
            deadline
          )
        ).success
      ).toBe(false);
    }
  );

  it('does not substitute another card when the published target becomes stale and does not refund cost', () => {
    const selected = createCardInstance(
      createMember('SELECTED-LIELLA-MEMBER', ['Liella!']),
      PLAYER1,
      'selected'
    );
    const other = createCardInstance(
      createMember('OTHER-LIELLA-MEMBER', ['Liella!']),
      PLAYER1,
      'other'
    );
    const scenario = setupSpSd1007({ waitingRoomCards: [selected, other] });
    paySpSd1007OrdinaryEnergy(scenario);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          selected.instanceId
        )
      ).success
    ).toBe(true);
    const reveal = scenario.session.state!.activeEffect!;
    const staleState = updatePlayer(scenario.session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== selected.instanceId),
      },
    }));
    (scenario.session as unknown as { authorityState: GameState }).authorityState = staleState;
    scenario.setNow(reveal.publicCardSelectionAutoAdvanceAt!);
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(
          PLAYER2,
          reveal.id,
          reveal.publicCardSelectionAutoAdvanceAt!
        )
      ).success
    ).toBe(true);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([other.instanceId]);
    expect(
      scenario.energyCardIds.every(
        (cardId) =>
          scenario.session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation ===
          OrientationState.WAITING
      )
    ).toBe(true);
  });

  it('does not advance or swallow a newly queued pending before recovery finishes', () => {
    const first = createCardInstance(
      createMember('FIRST-LIELLA-MEMBER', ['Liella!']),
      PLAYER1,
      'first'
    );
    const second = createCardInstance(
      createMember('SECOND-LIELLA-MEMBER', ['Liella!']),
      PLAYER1,
      'second'
    );
    const nextSource = createCardInstance(
      createMember('PL!SP-sd1-007-SD', ['Liella!']),
      PLAYER1,
      'next-source'
    );
    const scenario = setupSpSd1007({ waitingRoomCards: [first, second] });
    let state = registerCards(scenario.session.state!, [nextSource]);
    state = {
      ...state,
      activeEffect: state.activeEffect
        ? {
            ...state.activeEffect,
            metadata: { ...state.activeEffect.metadata, orderedResolution: true },
          }
        : null,
      pendingAbilities: [
        ...state.pendingAbilities,
        {
          id: 'new-trigger-pending',
          abilityId: SP_SD1_007_ON_ENTER_PAY_TWO_ENERGY_RECOVER_LIELLA_MEMBER_ABILITY_ID,
          sourceCardId: nextSource.instanceId,
          controllerId: PLAYER1,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.RIGHT,
          eventIds: ['new-trigger-event'],
        },
      ],
    };
    (scenario.session as unknown as { authorityState: GameState }).authorityState = state;
    paySpSd1007OrdinaryEnergy(scenario);
    expect(scenario.session.state?.pendingAbilities.map((ability) => ability.id)).toContain(
      'new-trigger-pending'
    );
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          first.instanceId
        )
      ).success
    ).toBe(true);
    const reveal = scenario.session.state!.activeEffect!;
    expect(scenario.session.state?.pendingAbilities.map((ability) => ability.id)).toContain(
      'new-trigger-pending'
    );
    scenario.setNow(reveal.publicCardSelectionAutoAdvanceAt!);
    expect(
      scenario.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(
          PLAYER1,
          reveal.id,
          reveal.publicCardSelectionAutoAdvanceAt!
        )
      ).success
    ).toBe(true);
    expect(
      scenario.session.state?.activeEffect?.sourceCardId === nextSource.instanceId ||
        scenario.session.state?.pendingAbilities.some(
          (ability) => ability.id === 'new-trigger-pending'
        )
    ).toBe(true);
  });
});
