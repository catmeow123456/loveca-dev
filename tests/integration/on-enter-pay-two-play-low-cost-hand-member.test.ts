import { describe, expect, it } from 'vitest';
import type {
  CardInstance,
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
  createGameState,
  getCardById,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { CostCalculator } from '../../src/domain/rules/cost-calculator';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  PL_N_BP4_005_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
  PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
  PL_N_PB1_013_ON_ENTER_PAY_TWO_PLAY_LOW_COST_AYUMU_MEMBER_ABILITY_ID,
  PL_N_PB1_015_ON_ENTER_PAY_TWO_PLAY_LOW_COST_SHIZUKU_MEMBER_ABILITY_ID,
  PL_N_PB1_017_ON_ENTER_PAY_TWO_PLAY_LOW_COST_AI_MEMBER_ABILITY_ID,
  PL_N_PB1_023_ON_ENTER_PAY_TWO_PLAY_LOW_COST_MIA_TAYLOR_MEMBER_ABILITY_ID,
  PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID,
  PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberData(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
    readonly bladeHeart?: boolean;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts: options.bladeHeart
      ? [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.PINK }]
      : [],
  };
}

function createMember(
  cardCode: string,
  instanceId: string,
  options: Parameters<typeof createMemberData>[1] = {},
  ownerId = PLAYER1
) {
  return createCardInstance(createMemberData(cardCode, options), ownerId, instanceId);
}

function createEnergy(instanceId: string) {
  const data: EnergyCardData = {
    cardCode: `ENERGY-${instanceId}`,
    name: `Energy ${instanceId}`,
    cardType: CardType.ENERGY,
  };
  return createCardInstance(data, PLAYER1, instanceId);
}

function createLive(cardCode: string, instanceId: string, name: string) {
  const data: LiveCardData = {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
  return createCardInstance(data, PLAYER1, instanceId);
}

function addActiveEnergy(game: GameState, energyIds: readonly string[]): GameState {
  return updatePlayer(game, PLAYER1, (player) => {
    const cardStates = new Map(player.energyZone.cardStates);
    for (const energyId of energyIds) {
      cardStates.set(energyId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: [...player.energyZone.cardIds, ...energyIds],
        cardStates,
      },
    };
  });
}

function createPending(
  abilityId: string,
  sourceCardId: string,
  sourceSlot = SlotPosition.CENTER
): PendingAbilityState {
  return {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-stage'],
    sourceSlot,
  };
}

function resolvePending(game: GameState, pending: PendingAbilityState): GameState {
  return resolvePendingCardEffects({ ...game, pendingAbilities: [pending] }).gameState;
}

function latestResolvePayload(game: GameState, abilityId: string) {
  return game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    .at(-1)?.payload;
}

function hasTriggeredAbility(game: GameState, abilityId: string, sourceCardId?: string): boolean {
  return game.actionHistory.some(
    (action) =>
      action.type === 'TRIGGER_ABILITY' &&
      action.payload.abilityId === abilityId &&
      (sourceCardId === undefined || action.payload.sourceCardId === sourceCardId)
  );
}

function setupKanata(options: {
  readonly sourceCode?: string;
  readonly handCards?: readonly CardInstance[];
  readonly activeEnergyCount?: number;
  readonly fillAllSlots?: boolean;
  readonly lockAllSlotsThisTurn?: boolean;
} = {}) {
  const source = createMember(options.sourceCode ?? 'PL!N-bp4-006-R', 'kanata-source', {
    name: '近江彼方',
    cost: 11,
  });
  const left = createMember('PL!N-test-left', 'kanata-left');
  const right = createMember('PL!N-test-right', 'kanata-right');
  const handCards = options.handCards ?? [
    createMember('PL!N-bp4-021-N', 'kanata-play-target', {
      name: '天王寺璃奈',
      cost: 4,
      bladeHeart: true,
    }),
  ];
  const energyCards = Array.from({ length: options.activeEnergyCount ?? 2 }, (_, index) =>
    createEnergy(`kanata-energy-${index}`)
  );

  let game = createGameState('n-bp4-006-kanata', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, left, right, ...handCards, ...energyCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.fillAllSlots) {
      memberSlots = placeCardInSlot(
        placeCardInSlot(memberSlots, SlotPosition.LEFT, left.instanceId),
        SlotPosition.RIGHT,
        right.instanceId
      );
    }
    return {
      ...player,
      memberSlots,
      movedToStageThisTurn: [
        ...player.movedToStageThisTurn,
        source.instanceId,
        ...(options.lockAllSlotsThisTurn ? [left.instanceId, right.instanceId] : []),
      ],
      hand: handCards.reduce((hand, card) => addCardToZone(hand, card.instanceId), player.hand),
    };
  });
  game = addActiveEnergy(
    game,
    energyCards.map((card) => card.instanceId)
  );
  return { game, source, left, right, handCards, energyCards };
}

function setupMia(options: {
  readonly includeNijigasakiTarget?: boolean;
  readonly includeHandDiscardTriggerSource?: boolean;
  readonly handCount?: number;
  readonly mainDeckCount?: number;
} = {}) {
  const source = createMember('PL!N-bp4-023-N', 'mia-source', {
    name: 'ミア・テイラー',
    cost: 5,
  });
  const target = options.includeNijigasakiTarget === false
    ? null
    : createMember('PL!N-test-target', 'mia-target', {
        name: '中須かすみ',
        cost: 4,
      });
  const triggerSource = options.includeHandDiscardTriggerSource
    ? createMember('PL!HS-pb1-003-R', 'hand-discard-trigger-source', {
        name: '大沢瑠璃乃',
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      })
    : null;
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createMember(`PL!N-test-hand-${index}`, `mia-hand-${index}`)
  );
  const mainDeckCards = Array.from({ length: options.mainDeckCount ?? 1 }, (_, index) =>
    createMember(`PL!N-test-draw-${index}`, `mia-draw-${index}`)
  );

  let game = createGameState('n-bp4-023-mia', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...(target ? [target] : []),
    ...(triggerSource ? [triggerSource] : []),
    ...handCards,
    ...mainDeckCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (target) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, target.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (triggerSource) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, triggerSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      hand: handCards.reduce((hand, card) => addCardToZone(hand, card.instanceId), player.hand),
      mainDeck: mainDeckCards.reduce(
        (deck, card) => addCardToZone(deck, card.instanceId),
        player.mainDeck
      ),
    };
  });
  return { game, source, target, triggerSource, handCards, mainDeckCards };
}

const NAMED_MEMBER_CASES = [
  {
    abilityId: PL_N_PB1_013_ON_ENTER_PAY_TWO_PLAY_LOW_COST_AYUMU_MEMBER_ABILITY_ID,
    sourceCode: 'PL!N-pb1-013-R',
    targetCode: 'PL!N-sd1-013-SD',
    targetName: '上原歩夢',
    stepText: '可以支付[E][E]，从自己的手牌选择1张费用4以下的「上原步梦」成员登场至舞台。',
  },
  {
    abilityId: PL_N_PB1_015_ON_ENTER_PAY_TWO_PLAY_LOW_COST_SHIZUKU_MEMBER_ABILITY_ID,
    sourceCode: 'PL!N-pb1-015-P+',
    targetCode: 'PL!N-test-shizuku',
    targetName: '桜坂しずく',
    stepText: '可以支付[E][E]，从自己的手牌选择1张费用4以下的「樱坂雫」成员登场至舞台。',
  },
  {
    abilityId: PL_N_PB1_017_ON_ENTER_PAY_TWO_PLAY_LOW_COST_AI_MEMBER_ABILITY_ID,
    sourceCode: 'PL!N-pb1-017-R',
    targetCode: 'PL!N-bp4-005-R',
    targetName: '宮下 愛',
    stepText: '可以支付[E][E]，从自己的手牌选择1张费用4以下的「宫下爱」成员登场至舞台。',
  },
  {
    abilityId: PL_N_PB1_023_ON_ENTER_PAY_TWO_PLAY_LOW_COST_MIA_TAYLOR_MEMBER_ABILITY_ID,
    sourceCode: 'PL!N-pb1-023-P+',
    targetCode: 'PL!N-PR-013-PR',
    targetName: 'ミア・テイラー',
    stepText: '可以支付[E][E]，从自己的手牌选择1张费用4以下的「米娅·泰勒」成员登场至舞台。',
  },
] as const;

function setupNamedCase(cardCase: (typeof NAMED_MEMBER_CASES)[number], options: {
  readonly activeEnergyCount?: number;
  readonly targetBladeHeart?: boolean;
  readonly targetCost?: number;
  readonly targetName?: string;
  readonly targetCode?: string;
  readonly fillAllSlots?: boolean;
  readonly lockAllSlotsThisTurn?: boolean;
} = {}) {
  const target = createMember(options.targetCode ?? cardCase.targetCode, 'named-target', {
    name: options.targetName ?? cardCase.targetName,
    cost: options.targetCost ?? 4,
    bladeHeart: options.targetBladeHeart ?? true,
  });
  return setupKanata({
    sourceCode: cardCase.sourceCode,
    handCards: [target],
    activeEnergyCount: options.activeEnergyCount,
    fillAllSlots: options.fillAllSlots,
    lockAllSlotsThisTurn: options.lockAllSlotsThisTurn,
  });
}

function startNamedCase(
  scenario: ReturnType<typeof setupNamedCase>,
  abilityId: string
): GameState {
  return resolvePending(scenario.game, createPending(abilityId, scenario.source.instanceId));
}

function markSpecialEnergy(game: GameState, energyCardIds: readonly string[]): GameState {
  return {
    ...game,
    energyActivePhaseSkips: energyCardIds.map((energyCardId) => ({
      playerId: PLAYER1,
      energyCardId,
      sourceCardId: 'special-energy-source',
      abilityId: 'special-energy-marker',
    })),
  };
}

describe('shared on-enter pay-two play low-cost named hand member workflow', () => {
  it.each(NAMED_MEMBER_CASES)(
    '$sourceCode locks selector/copy, pays after member selection, plays via a real enter event, and never waits the new source',
    (cardCase) => {
      const scenario = setupNamedCase(cardCase);
      const started = startNamedCase(scenario, cardCase.abilityId);
      expect(started.activeEffect).toMatchObject({
        abilityId: cardCase.abilityId,
        stepText: cardCase.stepText,
        selectableCardIds: [scenario.handCards[0].instanceId],
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要登场的指定成员',
        confirmSelectionLabel: '登场',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
      });
      expect(
        started.players[0].energyZone.cardStates.get(scenario.energyCards[0].instanceId)
      ).toMatchObject({ orientation: OrientationState.ACTIVE });

      const paid = confirmActiveEffectStep(
        started,
        PLAYER1,
        started.activeEffect!.id,
        scenario.handCards[0].instanceId
      );
      expect(paid.activeEffect).toMatchObject({
        stepId: 'ON_ENTER_PAY_TWO_SELECT_STAGE_SLOT',
        selectionLabel: '选择登场区域',
        confirmSelectionLabel: '登场',
        canSkipSelection: false,
      });
      expect(paid.activeEffect?.selectableCardIds).toBeUndefined();

      const resolved = confirmActiveEffectStep(
        paid,
        PLAYER1,
        paid.activeEffect!.id,
        undefined,
        SlotPosition.LEFT
      );
      const targetId = scenario.handCards[0].instanceId;
      expect(resolved.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(targetId);
      expect(resolved.players[0].movedToStageThisTurn).toContain(targetId);
      expect(resolved.players[0].memberSlots.cardStates.get(scenario.source.instanceId))
        .toMatchObject({ orientation: OrientationState.ACTIVE });
      expect(
        resolved.eventLog.some(
          ({ event }) =>
            event.eventType === TriggerCondition.ON_ENTER_STAGE &&
            event.cardInstanceId === targetId &&
            event.fromZone === ZoneType.HAND
        )
      ).toBe(true);
      expect(
        resolved.actionHistory.some(
          (action) => action.type === 'TRIGGER_ABILITY' && action.payload.sourceCardId === targetId
        )
      ).toBe(cardCase.targetCode !== 'PL!N-test-shizuku');
      if (cardCase.targetCode !== 'PL!N-test-shizuku') {
        const parentIndex = resolved.actionHistory.findIndex(
          (action) =>
            action.payload.abilityId === cardCase.abilityId &&
            action.payload.step === 'PLAY_LOW_COST_HAND_MEMBER_TO_STAGE_SLOT'
        );
        const childIndex = resolved.actionHistory.findIndex(
          (action) => action.type === 'TRIGGER_ABILITY' && action.payload.sourceCardId === targetId
        );
        expect(parentIndex).toBeGreaterThanOrEqual(0);
        expect(childIndex).toBeGreaterThan(parentIndex);
      }

      const targetData = getCardById(resolved, targetId)!.data as MemberCardData;
      expect(
        new CostCalculator().canPlayInSlot(
          SlotPosition.LEFT,
          resolved.players[0].movedToStageThisTurn,
          [{
            cardId: targetId,
            data: targetData,
            position: SlotPosition.LEFT,
            orientation: OrientationState.ACTIVE,
          }]
        )
      ).toBe(false);
    }
  );

  it.each(NAMED_MEMBER_CASES)(
    '$sourceCode accepts only the configured member name at cost 4 or less and rejects same-name LIVE',
    (cardCase) => {
    const accepted = createMember(cardCase.targetCode, 'accepted-name', {
      name: cardCase.targetName,
      cost: 4,
    });
    const wrongName = createMember('PL!N-test-wrong-name', 'wrong-name', {
      name: cardCase.targetName === '上原歩夢' ? '桜坂しずく' : '上原歩夢',
      cost: 4,
    });
    const tooHigh = createMember('PL!N-test-high', 'too-high', {
      name: cardCase.targetName,
      cost: 5,
    });
    const sameNameLive = createLive('PL!N-test-live', 'same-name-live', cardCase.targetName);
    const scenario = setupKanata({
      sourceCode: cardCase.sourceCode,
      handCards: [accepted, wrongName, tooHigh, sameNameLive],
    });
    expect(startNamedCase(scenario, cardCase.abilityId).activeEffect?.selectableCardIds).toEqual([
      accepted.instanceId,
    ]);
    }
  );

  it('keeps private hand candidate IDs out of the opponent projection', () => {
    const cardCase = NAMED_MEMBER_CASES[0];
    const scenario = setupNamedCase(cardCase);
    const started = startNamedCase(scenario, cardCase.abilityId);
    expect(JSON.stringify(projectPlayerViewState(started, PLAYER1))).toContain(
      scenario.handCards[0].instanceId
    );
    expect(JSON.stringify(projectPlayerViewState(started, PLAYER2))).not.toContain(
      scenario.handCards[0].instanceId
    );
  });

  it('plays the PL!N-bp4-005-P 「宮下 愛」 print and enqueues its real ON_ENTER ability', () => {
    const cardCase = NAMED_MEMBER_CASES[2];
    const scenario = setupNamedCase(cardCase, { targetCode: 'PL!N-bp4-005-P' });
    const started = startNamedCase(scenario, cardCase.abilityId);
    const paid = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.handCards[0].instanceId
    );
    const resolved = confirmActiveEffectStep(
      paid,
      PLAYER1,
      paid.activeEffect!.id,
      undefined,
      SlotPosition.LEFT
    );
    expect(
      hasTriggeredAbility(
        resolved,
        PL_N_BP4_005_ON_ENTER_DISCARD_WAIT_OPPONENT_LOW_COST_MEMBERS_ABILITY_ID,
        scenario.handCards[0].instanceId
      )
    ).toBe(true);
  });

  it('declines cleanly and consumes impossible starts without creating a selection window', () => {
    const cardCase = NAMED_MEMBER_CASES[1];
    const scenario = setupNamedCase(cardCase);
    const started = startNamedCase(scenario, cardCase.abilityId);
    const declined = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);
    expect(declined.activeEffect).toBeNull();
    expect(declined.players[0].hand.cardIds).toContain(scenario.handCards[0].instanceId);
    expect(declined.players[0].energyZone.cardStates.get(scenario.energyCards[0].instanceId))
      .toMatchObject({ orientation: OrientationState.ACTIVE });

    const noEnergy = setupNamedCase(cardCase, { activeEnergyCount: 1 });
    expect(startNamedCase(noEnergy, cardCase.abilityId).activeEffect).toBeNull();
    const noTarget = setupNamedCase(cardCase, { targetName: '上原歩夢' });
    expect(startNamedCase(noTarget, cardCase.abilityId).activeEffect).toBeNull();
    const noSlot = setupNamedCase(cardCase, {
      fillAllSlots: true,
      lockAllSlotsThisTurn: true,
    });
    expect(startNamedCase(noSlot, cardCase.abilityId).activeEffect).toBeNull();
  });

  it.each([
    { label: '普通/特殊混合', marked: [1], selected: [0, 2] },
    { label: '全特殊', marked: [0, 1, 2, 3], selected: [1, 3] },
  ])('$label候选暂停到公共精确能量选择并且只支付一次', ({ marked, selected }) => {
    const cardCase = NAMED_MEMBER_CASES[0];
    const scenario = setupNamedCase(cardCase, { activeEnergyCount: 4 });
    scenario.game = markSpecialEnergy(
      scenario.game,
      marked.map((index) => scenario.energyCards[index]!.instanceId)
    );
    const started = startNamedCase(scenario, cardCase.abilityId);
    const selectingEnergy = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.handCards[0].instanceId
    );
    expect(selectingEnergy.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E][E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
      minSelectableCards: 2,
      maxSelectableCards: 2,
    });

    const selectedIds = selected.map((index) => scenario.energyCards[index]!.instanceId);
    const paid = confirmActiveEffectStep(
      selectingEnergy,
      PLAYER1,
      selectingEnergy.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      selectedIds
    );
    expect(paid.activeEffect?.stepId).toBe('ON_ENTER_PAY_TWO_SELECT_STAGE_SLOT');
    for (const energy of scenario.energyCards) {
      expect(paid.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation).toBe(
        selectedIds.includes(energy.instanceId)
          ? OrientationState.WAITING
          : OrientationState.ACTIVE
      );
    }
    expect(
      paid.actionHistory.filter(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === cardCase.abilityId
      )
    ).toHaveLength(1);
  });

  it('rejects duplicate, wrong-count, candidate-external, and stale energy IDs without moving or advancing', () => {
    const cardCase = NAMED_MEMBER_CASES[0];
    const scenario = setupNamedCase(cardCase, { activeEnergyCount: 4 });
    scenario.game = markSpecialEnergy(scenario.game, [scenario.energyCards[1]!.instanceId]);
    const started = startNamedCase(scenario, cardCase.abilityId);
    const selectingEnergy = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.handCards[0].instanceId
    );
    const e0 = scenario.energyCards[0]!.instanceId;
    const e1 = scenario.energyCards[1]!.instanceId;
    for (const invalid of [[e0], [e0, e0], [e0, 'outside-energy']]) {
      expect(
        confirmActiveEffectStep(
          selectingEnergy,
          PLAYER1,
          selectingEnergy.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          invalid
        )
      ).toBe(selectingEnergy);
    }
    const stale = updatePlayer(selectingEnergy, PLAYER1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardStates: new Map(player.energyZone.cardStates).set(e1, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    expect(
      confirmActiveEffectStep(
        stale,
        PLAYER1,
        stale.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [e0, e1]
      )
    ).toBe(stale);
  });

  it('can play to a legal occupied slot and performs the standard replacement lifecycle', () => {
    const cardCase = NAMED_MEMBER_CASES[1];
    const scenario = setupNamedCase(cardCase, { fillAllSlots: true });
    const started = startNamedCase(scenario, cardCase.abilityId);
    const selected = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.handCards[0].instanceId
    );
    expect(selected.activeEffect).toMatchObject({
      stepId: 'ON_ENTER_PAY_TWO_SELECT_STAGE_SLOT',
      stepText: '请选择该成员要登场的区域。',
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
    });

    const resolved = confirmActiveEffectStep(
      selected,
      PLAYER1,
      selected.activeEffect!.id,
      undefined,
      SlotPosition.LEFT
    );
    const targetId = scenario.handCards[0].instanceId;
    expect(resolved.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(targetId);
    expect(resolved.players[0].waitingRoom.cardIds).toContain(scenario.left.instanceId);
    expect(latestResolvePayload(resolved, cardCase.abilityId)).toMatchObject({
      step: 'PLAY_LOW_COST_HAND_MEMBER_TO_STAGE_SLOT',
      selectedCardId: targetId,
      toSlot: SlotPosition.LEFT,
      replacedMemberCardId: scenario.left.instanceId,
    });
    expect(
      resolved.eventLog
        .map((entry) => entry.event)
        .find(
          (event) =>
            event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
            event.cardInstanceId === scenario.left.instanceId
        )
    ).toMatchObject({
      fromSlot: SlotPosition.LEFT,
      toZone: ZoneType.WAITING_ROOM,
      replacingCardId: targetId,
    });
    expect(
      resolved.eventLog
        .map((entry) => entry.event)
        .find(
          (event) =>
            event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            event.cardInstanceId === scenario.left.instanceId
        )
    ).toMatchObject({
      fromZone: ZoneType.MEMBER_SLOT,
      cardInstanceIds: [scenario.left.instanceId],
    });
    expect(
      resolved.eventLog
        .map((entry) => entry.event)
        .find(
          (event) =>
            event.eventType === TriggerCondition.ON_ENTER_STAGE &&
            event.cardInstanceId === targetId
        )
    ).toMatchObject({
      fromZone: ZoneType.HAND,
      toSlot: SlotPosition.LEFT,
      replacedMemberCardId: scenario.left.instanceId,
    });
  });

  it('does not advance stale hand targets or stale occupied slots', () => {
    const cardCase = NAMED_MEMBER_CASES[0];
    const scenario = setupNamedCase(cardCase);
    const started = startNamedCase(scenario, cardCase.abilityId);
    const targetId = scenario.handCards[0].instanceId;
    const staleHand = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: player.hand.cardIds.filter((id) => id !== targetId) },
    }));
    expect(
      confirmActiveEffectStep(staleHand, PLAYER1, staleHand.activeEffect!.id, targetId)
    ).toBe(staleHand);

    const selectingSlot = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      targetId
    );
    const blocker = createMember('PL!N-test-blocker', 'stale-slot-blocker');
    const registered = registerCards(selectingSlot, [blocker]);
    const staleSlot = updatePlayer(registered, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, blocker.instanceId),
      movedToStageThisTurn: [...player.movedToStageThisTurn, blocker.instanceId],
    }));
    expect(
      confirmActiveEffectStep(
        staleSlot,
        PLAYER1,
        staleSlot.activeEffect!.id,
        undefined,
        SlotPosition.LEFT
      )
    ).toBe(staleSlot);
  });
});

describe('PL!N-bp4-006 Kanata on-enter workflow', () => {
  it('pays two energy, plays a low-cost Nijigasaki member from hand, triggers its ON_ENTER, and waits source when it has BLADE HEART', () => {
    const scenario = setupKanata({ sourceCode: 'PL!N-bp4-006-P' });
    const started = resolvePending(
      scenario.game,
      createPending(
        PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
        scenario.source.instanceId
      )
    );

    expect(started.activeEffect).toMatchObject({
      abilityId: PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
      selectableCardIds: [scenario.handCards[0].instanceId],
      canSkipSelection: true,
    });

    const selectedCard = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.handCards[0].instanceId
    );
    expect(selectedCard.players[0].energyZone.cardStates.get(scenario.energyCards[0].instanceId))
      .toMatchObject({ orientation: OrientationState.WAITING });
    expect(selectedCard.activeEffect).toMatchObject({
      stepId: 'ON_ENTER_PAY_TWO_SELECT_STAGE_SLOT',
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
    });

    const resolved = confirmActiveEffectStep(
      selectedCard,
      PLAYER1,
      selectedCard.activeEffect!.id,
      undefined,
      SlotPosition.LEFT
    );

    expect(resolved.players[0].hand.cardIds).not.toContain(scenario.handCards[0].instanceId);
    expect(resolved.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.handCards[0].instanceId
    );
    expect(resolved.players[0].memberSlots.cardStates.get(scenario.source.instanceId)).toMatchObject({
      orientation: OrientationState.WAITING,
    });
    expect(
      hasTriggeredAbility(
        resolved,
        PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID,
        scenario.handCards[0].instanceId
      )
    ).toBe(true);
    expect(latestResolvePayload(resolved, PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID))
      .toMatchObject({
        step: 'WAIT_SOURCE_FOR_BLADE_HEART_MEMBER',
        playedMemberCardId: scenario.handCards[0].instanceId,
      });
  });

  it('skip and impossible starts consume without paying energy or moving cards', () => {
    const scenario = setupKanata();
    const started = resolvePending(
      scenario.game,
      createPending(
        PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
        scenario.source.instanceId
      )
    );
    const skipped = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);
    expect(skipped.activeEffect).toBeNull();
    expect(skipped.players[0].hand.cardIds).toContain(scenario.handCards[0].instanceId);
    expect(skipped.players[0].energyZone.cardStates.get(scenario.energyCards[0].instanceId))
      .toMatchObject({ orientation: OrientationState.ACTIVE });

    const noTarget = setupKanata({
      handCards: [
        createMember('PL!N-test-high-cost', 'kanata-high-cost', { cost: 5 }),
        createMember('PL!S-test-low-cost', 'kanata-non-niji', {
          cost: 4,
          groupNames: ['Aqours'],
        }),
      ],
    });
    expect(
      resolvePending(
        noTarget.game,
        createPending(
          PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
          noTarget.source.instanceId
        )
      ).activeEffect
    ).toBeNull();

    const noEnergy = setupKanata({ activeEnergyCount: 1 });
    expect(
      latestResolvePayload(
        resolvePending(
          noEnergy.game,
          createPending(
            PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
            noEnergy.source.instanceId
          )
        ),
        PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID
      )
    ).toMatchObject({ step: 'NO_OP_ENERGY_COST_UNPAYABLE' });

    const noSlot = setupKanata({ fillAllSlots: true, lockAllSlotsThisTurn: true });
    expect(
      latestResolvePayload(
        resolvePending(
          noSlot.game,
          createPending(
            PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
            noSlot.source.instanceId
          )
        ),
        PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID
      )
    ).toMatchObject({ step: 'NO_OP_NO_LOW_COST_HAND_MEMBER_OR_LEGAL_STAGE_SLOT' });
  });

  it('keeps the source ACTIVE when the played member has no BLADE HEART', () => {
    const scenario = setupKanata({
      handCards: [
        createMember('PL!N-test-no-blade-heart', 'kanata-no-blade-heart', {
          name: '天王寺璃奈',
          cost: 4,
          bladeHeart: false,
        }),
      ],
    });
    const started = resolvePending(
      scenario.game,
      createPending(
        PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
        scenario.source.instanceId
      )
    );
    const selected = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.handCards[0].instanceId
    );
    const resolved = confirmActiveEffectStep(
      selected,
      PLAYER1,
      selected.activeEffect!.id,
      undefined,
      SlotPosition.LEFT
    );
    expect(resolved.players[0].memberSlots.cardStates.get(scenario.source.instanceId))
      .toMatchObject({ orientation: OrientationState.ACTIVE });
  });
});

describe('PL!N-bp4-023 Mia Taylor on-enter workflow', () => {
  it('waits a Nijigasaki stage member, draws one, discards one hand card, and enqueues hand-entered-waiting triggers', () => {
    const scenario = setupMia({ includeHandDiscardTriggerSource: true });
    const started = resolvePending(
      scenario.game,
      createPending(
        PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID,
        scenario.source.instanceId
      )
    );
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID,
      selectableCardIds: [scenario.target!.instanceId, scenario.source.instanceId],
      canSkipSelection: true,
    });

    const waited = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.target!.instanceId
    );
    expect(waited.players[0].memberSlots.cardStates.get(scenario.target!.instanceId))
      .toMatchObject({ orientation: OrientationState.WAITING });
    expect(waited.players[0].hand.cardIds).toContain(scenario.mainDeckCards[0].instanceId);
    expect(waited.activeEffect).toMatchObject({
      stepId: 'N_BP4_023_SELECT_DISCARD_HAND',
      selectableCardIds: [scenario.handCards[0].instanceId, scenario.mainDeckCards[0].instanceId],
      canSkipSelection: false,
    });

    const resolved = confirmActiveEffectStep(
      waited,
      PLAYER1,
      waited.activeEffect!.id,
      scenario.handCards[0].instanceId
    );

    expect(resolved.players[0].mainDeck.cardIds).toContain(scenario.handCards[0].instanceId);
    expect(
      hasTriggeredAbility(
        resolved,
        HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
        scenario.triggerSource!.instanceId
      )
    ).toBe(true);
    expect(latestResolvePayload(resolved, PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID))
      .toMatchObject({
        step: 'DISCARD_ONE_AFTER_DRAW',
        waitedMemberCardId: scenario.target!.instanceId,
        discardedCardIds: [scenario.handCards[0].instanceId],
      });
  });

  it('skip, no legal target, and stale target do not draw or discard', () => {
    const scenario = setupMia();
    const started = resolvePending(
      scenario.game,
      createPending(
        PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID,
        scenario.source.instanceId
      )
    );
    const skipped = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);
    expect(skipped.activeEffect).toBeNull();
    expect(skipped.players[0].mainDeck.cardIds).toEqual([scenario.mainDeckCards[0].instanceId]);
    expect(skipped.players[0].waitingRoom.cardIds).not.toContain(scenario.handCards[0].instanceId);

    const noTarget = setupMia({ includeNijigasakiTarget: false });
    const noTargetWithoutSourceOnStage = updatePlayer(noTarget.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.CENTER]: null,
        },
      },
    }));
    expect(
      latestResolvePayload(
        resolvePending(
          noTargetWithoutSourceOnStage,
          createPending(
            PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID,
            noTarget.source.instanceId
          )
        ),
        PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID
      )
    ).toMatchObject({ step: 'NO_OP_NO_NIJIGASAKI_STAGE_MEMBER' });

    const staleTarget = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map([
          ...player.memberSlots.cardStates,
          [scenario.target!.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    expect(
      confirmActiveEffectStep(
        staleTarget,
        PLAYER1,
        staleTarget.activeEffect!.id,
        scenario.target!.instanceId
      )
    ).toBe(staleTarget);
  });
});
