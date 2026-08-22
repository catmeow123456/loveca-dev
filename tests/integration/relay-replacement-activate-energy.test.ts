import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
  PL_PB2_009_AUTO_RELAY_REPLACED_BY_HIGH_COST_MUSE_ACTIVATE_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { resolvePendingAbilityStarterWithRegistry } from '../../src/application/card-effects/runtime/starter-registry';
import {
  createCardInstance,
  createHeartIcon,
  type EnergyCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createLeaveStageEvent } from '../../src/domain/events/game-events';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function member(cardCode: string, cost: number, groupName: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    groupNames: [groupName],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function setup(options: {
  readonly sourceCardCode?: string;
  readonly replacingGroup?: string;
  readonly replacingCost?: number;
  readonly replacingCardId?: string | null;
  readonly toZone?: ZoneType;
  readonly waitingEnergyCount?: number;
  readonly energyCount?: number;
  readonly markedEnergyIndices?: readonly number[];
}) {
  const source = createCardInstance(
    member(options.sourceCardCode ?? 'PL!-pb2-009-PP', 9, "μ's"),
    P1,
    'source'
  );
  const replacement = createCardInstance(
    member('REPLACEMENT', options.replacingCost ?? 15, options.replacingGroup ?? "μ's"),
    P1,
    'replacement'
  );
  const energyCount = options.energyCount ?? Math.max(3, options.waitingEnergyCount ?? 3);
  const energies = Array.from({ length: energyCount }, (_, index) =>
    createCardInstance(energy(`ENERGY-${index}`), P1, `energy-${index}`)
  );
  let game = registerCards(createGameState('relay-replacement-energy', P1, 'P1', P2, 'P2'), [
    source,
    replacement,
    ...energies,
  ]);
  const waitingEnergyCount = options.waitingEnergyCount ?? energyCount;
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    waitingRoom: addCardToZone(player.waitingRoom, source.instanceId),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, replacement.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyZone: energies.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation:
            index < waitingEnergyCount ? OrientationState.WAITING : OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));
  game = {
    ...game,
    energyActivePhaseSkips: (options.markedEnergyIndices ?? []).map((index) => ({
      playerId: P1,
      energyCardId: energies[index]!.instanceId,
      sourceCardId: 'marker-source',
      abilityId: 'marker-ability',
    })),
  };

  const replacingCardId =
    options.replacingCardId === undefined ? replacement.instanceId : options.replacingCardId;
  const leaveStageEvent = createLeaveStageEvent(
    source.instanceId,
    SlotPosition.CENTER,
    options.toZone ?? ZoneType.WAITING_ROOM,
    P1,
    P1,
    replacingCardId ?? undefined
  );
  game = emitGameEvent(game, leaveStageEvent);
  const enqueued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LEAVE_STAGE], {
    leaveStageEvents: [leaveStageEvent],
  });
  return {
    game: enqueued,
    sourceId: source.instanceId,
    replacementId: replacement.instanceId,
    energyIds: energies.map((card) => card.instanceId),
    leaveStageEventId: leaveStageEvent.eventId,
  };
}

function resolvedAction(game: GameState, abilityId: string) {
  return game.actionHistory.find(
    (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId
  );
}

describe('relay replacement activate-energy shared workflow', () => {
  it.each([
    {
      sourceCardCode: 'PL!-pb2-009-PP',
      group: "μ's",
      cost: 15,
      abilityId: PL_PB2_009_AUTO_RELAY_REPLACED_BY_HIGH_COST_MUSE_ACTIVATE_ENERGY_ABILITY_ID,
    },
    {
      sourceCardCode: 'PL!HS-sd1-001-SD',
      group: '蓮ノ空',
      cost: 10,
      abilityId: HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
    },
  ])(
    'resolves $sourceCardCode through the shared family',
    ({ sourceCardCode, group, cost, abilityId }) => {
      const scenario = setup({ sourceCardCode, replacingGroup: group, replacingCost: cost });

      expect(scenario.game.pendingAbilities).toHaveLength(1);
      const done = resolvePendingCardEffects(scenario.game).gameState;
      expect(
        scenario.energyIds.map(
          (cardId) => done.players[0].energyZone.cardStates.get(cardId)?.orientation
        )
      ).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE, OrientationState.WAITING]);
      expect(resolvedAction(done, abilityId)?.payload).toMatchObject({
        step: 'ACTIVATE_TWO_ENERGY_AFTER_RELAY',
        leaveStageEventId: scenario.leaveStageEventId,
        replacingCardId: scenario.replacementId,
        activatedEnergyCardIds: scenario.energyIds.slice(0, 2),
      });
      expect(done.pendingAbilities).toEqual([]);
    }
  );

  it.each([
    { label: '普通离场', options: { replacingCardId: null } },
    { label: '错误团体', options: { replacingGroup: 'Aqours' } },
    { label: '费用不足', options: { replacingCost: 14 } },
    { label: '未进入休息室', options: { toZone: ZoneType.HAND } },
  ])('$label时不入队', ({ options }) => {
    const scenario = setup(options);
    expect(scenario.game.pendingAbilities).toEqual([]);
    expect(
      scenario.game.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            PL_PB2_009_AUTO_RELAY_REPLACED_BY_HIGH_COST_MUSE_ACTIVATE_ENERGY_ABILITY_ID
      )
    ).toBe(false);
  });

  it('revalidates the exact replacingCardId at resolution and consumes a stale condition', () => {
    const scenario = setup({});
    const cardRegistry = new Map(scenario.game.cardRegistry);
    cardRegistry.delete(scenario.replacementId);

    const done = resolvePendingCardEffects({ ...scenario.game, cardRegistry }).gameState;
    expect(
      resolvedAction(
        done,
        PL_PB2_009_AUTO_RELAY_REPLACED_BY_HIGH_COST_MUSE_ACTIVATE_ENERGY_ABILITY_ID
      )?.payload
    ).toMatchObject({
      step: 'CONDITION_NOT_MET',
      replacingCardId: scenario.replacementId,
      activatedEnergyCardIds: [],
    });
    expect(done.pendingAbilities).toEqual([]);
  });

  it.each([
    { waitingEnergyCount: 0, expected: [] },
    { waitingEnergyCount: 1, expected: ['energy-0'] },
  ])(
    '在只有 $waitingEnergyCount 张待机能量时仅处理实际可活跃数量',
    ({ waitingEnergyCount, expected }) => {
      const scenario = setup({ waitingEnergyCount, energyCount: 2 });
      const done = resolvePendingCardEffects(scenario.game).gameState;
      expect(
        resolvedAction(
          done,
          PL_PB2_009_AUTO_RELAY_REPLACED_BY_HIGH_COST_MUSE_ACTIVATE_ENERGY_ABILITY_ID
        )?.payload.activatedEnergyCardIds
      ).toEqual(expected);
      expect(done.pendingAbilities).toEqual([]);
    }
  );

  it('uses the common exact selector when excess waiting energy includes a special marker', () => {
    const scenario = setup({ waitingEnergyCount: 3, energyCount: 3, markedEnergyIndices: [2] });
    let state = resolvePendingCardEffects(scenario.game).gameState;
    expect(state.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      selectableCardIds: scenario.energyIds,
      minSelectableCards: 2,
      maxSelectableCards: 2,
      confirmSelectionLabel: '变为活跃',
    });

    state = confirmActiveEffectStep(
      state,
      P1,
      state.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [scenario.energyIds[2]!, scenario.energyIds[1]!]
    );
    expect(
      resolvedAction(
        state,
        PL_PB2_009_AUTO_RELAY_REPLACED_BY_HIGH_COST_MUSE_ACTIVATE_ENERGY_ABILITY_ID
      )?.payload.activatedEnergyCardIds
    ).toEqual([scenario.energyIds[2], scenario.energyIds[1]]);
    expect(state.pendingAbilities).toEqual([]);
  });

  it('shows a dynamic confirm-only result for manual selection, then resolves on confirmation', () => {
    const scenario = setup({ waitingEnergyCount: 1, energyCount: 2 });
    const pending = scenario.game.pendingAbilities[0]!;
    const started = resolvePendingAbilityStarterWithRegistry(
      scenario.game,
      pending,
      { manualConfirmation: true },
      { continuePendingCardEffects: (state) => state, delegatePendingAbility: (state) => state }
    )!;
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_PB2_009_AUTO_RELAY_REPLACED_BY_HIGH_COST_MUSE_ACTIVATE_ENERGY_ABILITY_ID,
      effectText:
        '【自动】此成员从舞台被放置入休息室时，此成员与费用大于等于15的『μ’s』的成员换手的场合，将2张能量变为活跃状态。\n\n（当前待机能量1张，本次将1张能量变为活跃状态。）',
    });

    const done = confirmActiveEffectStep(started, P1, started.activeEffect!.id);
    expect(done.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(done.pendingAbilities).toEqual([]);
  });

  it('preserves ordered continuation without a confirm-only bridge', () => {
    const scenario = setup({ waitingEnergyCount: 2, energyCount: 2 });
    const pending = scenario.game.pendingAbilities[0]!;
    let continuedInOrder = false;
    const done = resolvePendingAbilityStarterWithRegistry(
      scenario.game,
      pending,
      { orderedResolution: true },
      {
        continuePendingCardEffects: (state, ordered) => {
          continuedInOrder = ordered;
          return state;
        },
        delegatePendingAbility: (state) => state,
      }
    )!;

    expect(continuedInOrder).toBe(true);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
  });

  it.each([
    {
      cardCode: 'PL!-pb2-009-SEC',
      abilityId: PL_PB2_009_AUTO_RELAY_REPLACED_BY_HIGH_COST_MUSE_ACTIVATE_ENERGY_ABILITY_ID,
    },
    {
      cardCode: 'PL!HS-sd1-001-R',
      abilityId: HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
    },
  ])('covers unknown rarity $cardCode through baseCardCodes', ({ cardCode, abilityId }) => {
    expect(
      getCardAbilityDefinitionsForCardCode(cardCode).some(
        (definition) => definition.abilityId === abilityId
      )
    ).toBe(true);
  });
});
