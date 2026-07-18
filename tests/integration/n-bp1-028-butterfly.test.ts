import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
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
import { PL_N_BP1_028_LIVE_START_PAY_TWO_ENERGY_NIJIGASAKI_STAGE_THIS_LIVE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function butterfly(): LiveCardData {
  return {
    cardCode: 'PL!N-bp1-028-L',
    name: 'Butterfly',
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 5 }, 7),
  };
}

function member(groupName: string, ownerName: string): MemberCardData {
  return {
    cardCode: `TEST-${ownerName}`,
    name: ownerName,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(index: number): EnergyCardData {
  return { cardCode: `TEST-E-${index}`, name: `Energy ${index}`, cardType: CardType.ENERGY };
}

function pending(sourceCardId: string, id = 'butterfly-pending'): PendingAbilityState {
  return {
    id,
    abilityId:
      PL_N_BP1_028_LIVE_START_PAY_TWO_ENERGY_NIJIGASAKI_STAGE_THIS_LIVE_SCORE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`event:${id}`],
  };
}

function setup(options: {
  readonly orientations: readonly OrientationState[];
  readonly ownStageGroup?: string | null;
  readonly opponentHasNijigasaki?: boolean;
  readonly ownWaitingNijigasaki?: boolean;
  readonly markedIndices?: readonly number[];
}): { readonly game: GameState; readonly sourceId: string; readonly energyIds: readonly string[] } {
  const source = createCardInstance(butterfly(), PLAYER1, 'butterfly-source');
  const ownStage = options.ownStageGroup
    ? createCardInstance(member(options.ownStageGroup, 'own-stage'), PLAYER1, 'own-stage-member')
    : null;
  const opponentStage = options.opponentHasNijigasaki
    ? createCardInstance(
        member('虹ヶ咲学園スクールアイドル同好会', 'opponent-stage'),
        PLAYER2,
        'opponent-stage-member'
      )
    : null;
  const waitingNijigasaki = options.ownWaitingNijigasaki
    ? createCardInstance(
        member('虹ヶ咲学園スクールアイドル同好会', 'waiting-room'),
        PLAYER1,
        'waiting-room-member'
      )
    : null;
  const energyCards = options.orientations.map((_, index) =>
    createCardInstance(energy(index), PLAYER1, `energy-${index}`)
  );
  let game = registerCards(
    createGameState('n-bp1-028-butterfly', PLAYER1, 'P1', PLAYER2, 'P2'),
    [
      source,
      ...energyCards,
      ...(ownStage ? [ownStage] : []),
      ...(opponentStage ? [opponentStage] : []),
      ...(waitingNijigasaki ? [waitingNijigasaki] : []),
    ]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    memberSlots: ownStage
      ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ownStage.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        })
      : player.memberSlots,
    waitingRoom: waitingNijigasaki
      ? { ...player.waitingRoom, cardIds: [waitingNijigasaki.instanceId] }
      : player.waitingRoom,
    energyZone: energyCards.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: options.orientations[index]!,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));
  if (opponentStage) {
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponentStage.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
  }
  return {
    game: {
      ...game,
      energyActivePhaseSkips: (options.markedIndices ?? []).map((index) => ({
        playerId: PLAYER1,
        energyCardId: energyCards[index]!.instanceId,
        sourceCardId: 'marker-source',
        abilityId: 'marker-ability',
      })),
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([[PLAYER1, 5]]),
      },
      pendingAbilities: [pending(source.instanceId)],
    },
    sourceId: source.instanceId,
    energyIds: energyCards.map((card) => card.instanceId),
  };
}

function open(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function confirmOption(game: GameState, optionId?: string): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    optionId
  );
}

function confirmEnergy(game: GameState, ids: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    [...ids]
  );
}

describe('PL!N-bp1-028-L 分数5「Butterfly」', () => {
  it('pays two ordinary energy in stable order and gives only the source LIVE SCORE +1', () => {
    const scenario = setup({
      orientations: [OrientationState.ACTIVE, OrientationState.ACTIVE, OrientationState.ACTIVE],
      ownStageGroup: '虹ヶ咲学園スクールアイドル同好会',
    });
    let state = open(scenario.game);
    expect(state.activeEffect).toMatchObject({
      abilityId:
        PL_N_BP1_028_LIVE_START_PAY_TWO_ENERGY_NIJIGASAKI_STAGE_THIS_LIVE_SCORE_ABILITY_ID,
      stepId: 'N_BP1_028_PAY_TWO_ENERGY',
      selectableOptions: [{ id: 'pay', label: '支付[E][E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(state.activeEffect?.selectableOptions?.some((option) => option.label === '不发动')).toBe(
      false
    );
    state = confirmOption(state, 'pay');
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(
      scenario.energyIds.map(
        (id) => state.players[0].energyZone.cardStates.get(id)?.orientation
      )
    ).toEqual([
      OrientationState.WAITING,
      OrientationState.WAITING,
      OrientationState.ACTIVE,
    ]);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: scenario.sourceId,
      sourceCardId: scenario.sourceId,
      abilityId:
        PL_N_BP1_028_LIVE_START_PAY_TWO_ENERGY_NIJIGASAKI_STAGE_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(
      state.actionHistory.find((action) => action.type === 'PAY_COST')?.payload.energyCardIds
    ).toEqual(scenario.energyIds.slice(0, 2));
  });

  it('keeps the paid cost without a score reward for opponent-only, non-Nijigasaki, or absent stage members', () => {
    for (const options of [
      { ownStageGroup: null, opponentHasNijigasaki: true },
      { ownStageGroup: 'Liella!', opponentHasNijigasaki: false },
      {
        ownStageGroup: null,
        opponentHasNijigasaki: false,
        ownWaitingNijigasaki: true,
      },
    ]) {
      const scenario = setup({
        orientations: [OrientationState.ACTIVE, OrientationState.ACTIVE],
        ...options,
      });
      const state = confirmOption(open(scenario.game), 'pay');
      expect(state.activeEffect).toBeNull();
      expect(
        scenario.energyIds.every(
          (id) =>
            state.players[0].energyZone.cardStates.get(id)?.orientation ===
            OrientationState.WAITING
        )
      ).toBe(true);
      expect(state.liveResolution.liveModifiers).toEqual([]);
      expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    }
  });

  it('declines without payment and exposes only the skip path when energy is insufficient', () => {
    const payable = setup({
      orientations: [OrientationState.ACTIVE, OrientationState.ACTIVE],
      ownStageGroup: '虹ヶ咲',
    });
    let state = confirmOption(open(payable.game));
    expect(state.activeEffect).toBeNull();
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(
      payable.energyIds.every(
        (id) =>
          state.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
      )
    ).toBe(true);

    const insufficient = setup({
      orientations: [OrientationState.ACTIVE, OrientationState.WAITING],
      ownStageGroup: '虹ヶ咲',
    });
    state = open(insufficient.game);
    expect(state.activeEffect?.selectableOptions).toEqual([]);
    expect(state.activeEffect?.stepText).toContain('无法支付[E][E]');
    state = confirmOption(state);
    expect(state.activeEffect).toBeNull();
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });

  it('uses the exact two-energy marker window and rejects duplicate, illegal, and stale input', () => {
    const scenario = setup({
      orientations: [OrientationState.ACTIVE, OrientationState.ACTIVE, OrientationState.ACTIVE],
      ownStageGroup: '虹ヶ咲',
      markedIndices: [1],
    });
    const selecting = confirmOption(open(scenario.game), 'pay');
    expect(selecting.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E][E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
      minSelectableCards: 2,
      maxSelectableCards: 2,
    });
    for (const ids of [
      [scenario.energyIds[0]!, scenario.energyIds[0]!],
      [scenario.energyIds[0]!, 'illegal-energy'],
    ]) {
      const rejected = confirmEnergy(selecting, ids);
      expect(rejected.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
      expect(rejected.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    }
    const stale = updatePlayer(selecting, PLAYER1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: player.energyZone.cardIds.filter((id) => id !== scenario.energyIds[1]),
      },
    }));
    expect(confirmEnergy(stale, [scenario.energyIds[0]!, scenario.energyIds[1]!]).activeEffect?.stepId).toBe(
      'COMMON_ENERGY_OPERATION_SELECTION'
    );

    const paid = confirmEnergy(selecting, [scenario.energyIds[1]!, scenario.energyIds[2]!]);
    expect(paid.activeEffect).toBeNull();
    expect(
      paid.actionHistory.find((action) => action.type === 'PAY_COST')?.payload.energyCardIds
    ).toEqual([scenario.energyIds[1], scenario.energyIds[2]]);
  });

  it('does not pay if the source LIVE is stale, and duplicate resolution remains idempotent', () => {
    const scenario = setup({
      orientations: [OrientationState.ACTIVE, OrientationState.ACTIVE],
      ownStageGroup: '虹ヶ咲',
    });
    let state = open(scenario.game);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: player.liveZone.cardIds.filter((id) => id !== scenario.sourceId),
      },
    }));
    state = confirmOption(state, 'pay');
    expect(state.activeEffect).toBeNull();
    expect(
      scenario.energyIds.every(
        (id) =>
          state.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
      )
    ).toBe(true);
    expect(state.liveResolution.liveModifiers).toEqual([]);

    let resolved = confirmOption(open(scenario.game), 'pay');
    resolved = updatePlayer(resolved, PLAYER1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardStates: new Map(
          player.energyZone.cardIds.map((id) => [
            id,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
    }));
    resolved = { ...resolved, pendingAbilities: [pending(scenario.sourceId, 'duplicate-pending')] };
    resolved = confirmOption(open(resolved), 'pay');
    expect(
      resolved.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId ===
            PL_N_BP1_028_LIVE_START_PAY_TWO_ENERGY_NIJIGASAKI_STAGE_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toHaveLength(1);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(6);
  });
});
