import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { N_SD1_001_LIVE_START_PAY_ONE_ENERGY_OTHER_NIJIGASAKI_MEMBERS_GAIN_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const ABILITY_ID =
  N_SD1_001_LIVE_START_PAY_ONE_ENERGY_OTHER_NIJIGASAKI_MEMBERS_GAIN_BLADE_ABILITY_ID;

function member(cardCode: string, name: string, groupName = '虹ヶ咲', cost = 4): MemberCardData {
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

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function pending(sourceCardId: string, index = 0): PendingAbilityState {
  return {
    id: `n-sd1-001-pending-${index}`,
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`live-start-${index}`],
  };
}

function setup(
  options: {
    readonly activeEnergyCount?: number;
    readonly markedEnergyIndices?: readonly number[];
    readonly includeActiveTarget?: boolean;
    readonly includeWaitingTarget?: boolean;
    readonly includeNonNijigasakiTarget?: boolean;
  } = {}
) {
  const source = createCardInstance(
    member('PL!N-sd1-001-SD', '上原歩夢', '虹ヶ咲', 13),
    PLAYER1,
    'n-sd1-001-source'
  );
  const activeTarget = createCardInstance(
    member('PL!N-test-active', '虹咲 Active'),
    PLAYER1,
    'n-sd1-001-active-target'
  );
  const waitingTarget = createCardInstance(
    member('PL!N-test-waiting', '虹咲 Waiting'),
    PLAYER1,
    'n-sd1-001-waiting-target'
  );
  const nonNijigasakiTarget = createCardInstance(
    member('PL!S-test-member', 'Aqours Member', 'Aqours'),
    PLAYER1,
    'n-sd1-001-non-niji-target'
  );
  const memberBelow = createCardInstance(
    member('PL!N-test-below', '虹咲 Below'),
    PLAYER1,
    'n-sd1-001-member-below'
  );
  const waitingRoomMember = createCardInstance(
    member('PL!N-test-waiting-room', '虹咲 Waiting Room'),
    PLAYER1,
    'n-sd1-001-waiting-room-member'
  );
  const opponentMember = createCardInstance(
    member('PL!N-test-opponent', 'Opponent Nijigasaki'),
    PLAYER2,
    'n-sd1-001-opponent-member'
  );
  const energyCards = Array.from({ length: options.activeEnergyCount ?? 2 }, (_, index) =>
    createCardInstance(energy(`N-SD1-001-E-${index}`), PLAYER1, `n-sd1-001-energy-${index}`)
  );
  const cards = [
    source,
    activeTarget,
    waitingTarget,
    nonNijigasakiTarget,
    memberBelow,
    waitingRoomMember,
    opponentMember,
    ...energyCards,
  ];
  let game = registerCards(createGameState('n-sd1-001-ayumu', PLAYER1, 'P1', PLAYER2, 'P2'), cards);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.includeActiveTarget !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, activeTarget.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (options.includeWaitingTarget !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, waitingTarget.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
    } else if (options.includeNonNijigasakiTarget === true) {
      memberSlots = placeCardInSlot(
        memberSlots,
        SlotPosition.RIGHT,
        nonNijigasakiTarget.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      );
    }
    memberSlots = {
      ...memberSlots,
      memberBelow: {
        ...memberSlots.memberBelow,
        [SlotPosition.CENTER]: [memberBelow.instanceId],
      },
    };
    return {
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [waitingRoomMember.instanceId],
      },
      memberSlots,
      energyZone: energyCards.reduce(
        (zone, card) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      player.memberSlots,
      SlotPosition.CENTER,
      opponentMember.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
  }));
  game = {
    ...game,
    energyActivePhaseSkips: (options.markedEnergyIndices ?? []).map((index) => ({
      playerId: PLAYER1,
      energyCardId: energyCards[index]!.instanceId,
      sourceCardId: 'marker-source',
      abilityId: 'marker-ability',
    })),
  };
  return {
    game,
    source,
    activeTarget,
    waitingTarget,
    nonNijigasakiTarget,
    memberBelow,
    waitingRoomMember,
    opponentMember,
    energyIds: energyCards.map((card) => card.instanceId),
  };
}

function startFromRealLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function activate(game: GameState): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    'activate'
  );
}

function abilityModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === ABILITY_ID
  );
}

describe('PL!N-sd1-001-SD 费用13「上原歩夢」 LIVE开始 ability', () => {
  it('enqueues through real ON_LIVE_START, pays [E], and grants all other top-level Nijigasaki members [BLADE]', () => {
    const scenario = setup();
    let state = startFromRealLiveStart(scenario.game);

    expect(
      state.actionHistory.find(
        (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === ABILITY_ID
      )?.payload
    ).toMatchObject({
      sourceCardId: scenario.source.instanceId,
      timingId: TriggerCondition.ON_LIVE_START,
      sourceSlot: SlotPosition.CENTER,
    });
    expect(state.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      sourceCardId: scenario.source.instanceId,
      effectText:
        '【LIVE开始时】可以支付[E]：LIVE结束时为止，位于自己的舞台的其他的『虹咲』的成员获得[BLADE]。',
      stepId: 'N_SD1_001_PAY_ENERGY_OTHER_NIJIGASAKI_MEMBERS_GAIN_BLADE',
      stepText: '可以支付[E]，使位于自己的舞台的其他『虹咲』成员获得[BLADE]。',
      selectableOptions: [{ id: 'activate', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(state.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    expect(state.activeEffect?.selectableCardIds).toBeUndefined();

    state = activate(state);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      state.actionHistory.find((action) => action.type === 'PAY_COST')?.payload.energyCardIds
    ).toEqual([scenario.energyIds[0]]);
    expect(abilityModifiers(state)).toEqual([
      expect.objectContaining({
        sourceCardId: scenario.activeTarget.instanceId,
        countDelta: 1,
      }),
      expect.objectContaining({
        sourceCardId: scenario.waitingTarget.instanceId,
        countDelta: 1,
      }),
    ]);
    for (const excludedCardId of [
      scenario.source.instanceId,
      scenario.memberBelow.instanceId,
      scenario.waitingRoomMember.instanceId,
      scenario.opponentMember.instanceId,
    ]) {
      expect(
        abilityModifiers(state).some((modifier) => modifier.sourceCardId === excludedCardId)
      ).toBe(false);
    }
  });

  it('declines without payment and keeps invalid options in the original window', () => {
    const scenario = setup();
    const opened = startFromRealLiveStart(scenario.game);
    const invalid = confirmActiveEffectStep(
      opened,
      PLAYER1,
      opened.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'illegal-option'
    );
    expect(invalid).toBe(opened);

    const declined = confirmActiveEffectStep(opened, PLAYER1, opened.activeEffect!.id);
    expect(declined.activeEffect).toBeNull();
    expect(declined.pendingAbilities).toEqual([]);
    expect(declined.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    expect(abilityModifiers(declined)).toEqual([]);
  });

  it('safely consumes no-energy, no-legal-target, and source-left windows without paying', () => {
    const noEnergy = setup({ activeEnergyCount: 0 });
    const noEnergyState = startFromRealLiveStart(noEnergy.game);
    expect(noEnergyState.activeEffect).toBeNull();
    expect(noEnergyState.pendingAbilities).toEqual([]);
    expect(noEnergyState.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);

    const noTarget = setup({
      includeActiveTarget: false,
      includeWaitingTarget: false,
      includeNonNijigasakiTarget: true,
    });
    const noTargetState = startFromRealLiveStart(noTarget.game);
    expect(noTargetState.activeEffect).toBeNull();
    expect(noTargetState.pendingAbilities).toEqual([]);
    expect(abilityModifiers(noTargetState)).toEqual([]);

    const sourceLeft = setup();
    let sourceLeftState = startFromRealLiveStart(sourceLeft.game);
    sourceLeftState = updatePlayer(sourceLeftState, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    sourceLeftState = activate(sourceLeftState);
    expect(sourceLeftState.activeEffect).toBeNull();
    expect(sourceLeftState.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    expect(abilityModifiers(sourceLeftState)).toEqual([]);
  });

  it('uses the common special-energy selector and preserves paid cost when all targets disappear', () => {
    const scenario = setup({ activeEnergyCount: 2, markedEnergyIndices: [1] });
    let state = activate(startFromRealLiveStart(scenario.game));
    expect(state.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
      selectableCardIds: scenario.energyIds,
      minSelectableCards: 1,
      maxSelectableCards: 1,
    });

    const selecting = state;
    for (const selectedCardIds of [
      ['illegal-energy'],
      [scenario.energyIds[0]!, scenario.energyIds[0]!],
    ]) {
      const rejected = confirmActiveEffectStep(
        selecting,
        PLAYER1,
        selecting.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        selectedCardIds
      );
      expect(rejected.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
      expect(rejected.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    }

    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.LEFT]: null,
          [SlotPosition.RIGHT]: null,
        },
      },
    }));
    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [scenario.energyIds[1]!]
    );

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      state.actionHistory.find((action) => action.type === 'PAY_COST')?.payload.energyCardIds
    ).toEqual([scenario.energyIds[1]]);
    expect(abilityModifiers(state)).toEqual([]);
    expect(
      state.actionHistory.findLast(
        (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ABILITY_ID
      )?.payload
    ).toMatchObject({
      step: 'PAY_ENERGY_NO_TARGET_AFTER_PAYMENT',
      paidEnergyCardIds: [scenario.energyIds[1]],
      targetMemberCardIds: [],
      appliedTargetMemberCardIds: [],
    });
  });

  it('rejects a stale special-energy selection without advancing', () => {
    const scenario = setup({ activeEnergyCount: 2, markedEnergyIndices: [1] });
    let state = activate(startFromRealLiveStart(scenario.game));
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: player.energyZone.cardIds.filter((cardId) => cardId !== scenario.energyIds[1]),
      },
    }));
    const rejected = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [scenario.energyIds[1]!]
    );
    expect(rejected.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expect(rejected.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('continues two source instances in selected order and leaves no pending window', () => {
    const first = createCardInstance(
      member('PL!N-sd1-001-SD', '上原歩夢', '虹ヶ咲', 13),
      PLAYER1,
      'n-sd1-001-source-1'
    );
    const second = createCardInstance(
      member('PL!N-sd1-001-SD', '上原歩夢', '虹ヶ咲', 13),
      PLAYER1,
      'n-sd1-001-source-2'
    );
    const target = createCardInstance(
      member('PL!N-test-ordered-target', 'Ordered target'),
      PLAYER1,
      'n-sd1-001-ordered-target'
    );
    const energies = [0, 1].map((index) =>
      createCardInstance(
        energy(`N-SD1-001-ORDER-E-${index}`),
        PLAYER1,
        `n-sd1-001-order-e-${index}`
      )
    );
    let game = registerCards(createGameState('n-sd1-001-ordered', PLAYER1, 'P1', PLAYER2, 'P2'), [
      first,
      second,
      target,
      ...energies,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
          SlotPosition.CENTER,
          second.instanceId
        ),
        SlotPosition.RIGHT,
        target.instanceId
      ),
      energyZone: energies.reduce(
        (zone, card) => addCardToStatefulZone(zone, card.instanceId),
        player.energyZone
      ),
    }));
    game = {
      ...game,
      pendingAbilities: [pending(first.instanceId, 0), pending(second.instanceId, 1)],
    };

    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    let state = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(state.activeEffect?.sourceCardId).toBe(first.instanceId);
    state = activate(state);
    expect(state.activeEffect?.sourceCardId).toBe(second.instanceId);
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.actionHistory.filter((action) => action.type === 'PAY_COST')).toHaveLength(1);
  });
});
