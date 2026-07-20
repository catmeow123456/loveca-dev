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
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
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

function shizuku(): MemberCardData {
  return {
    cardCode: 'PL!N-bp1-003-P',
    name: '桜坂しずく',
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: 10,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.BLUE, 3), createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function energy(index: number): EnergyCardData {
  return { cardCode: `TEST-E-${index}`, name: `Energy ${index}`, cardType: CardType.ENERGY };
}

function pending(sourceCardId: string, id = 'shizuku-pending'): PendingAbilityState {
  return {
    id,
    abilityId: PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`event:${id}`],
  };
}

function setup(options: {
  readonly orientations: readonly OrientationState[];
  readonly markedIndices?: readonly number[];
}): { readonly game: GameState; readonly sourceId: string; readonly energyIds: readonly string[] } {
  const source = createCardInstance(shizuku(), PLAYER1, 'shizuku-source');
  const energyCards = options.orientations.map((_, index) =>
    createCardInstance(energy(index), PLAYER1, `energy-${index}`)
  );
  let game = registerCards(createGameState('n-bp1-003-shizuku', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    ...energyCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyZone: energyCards.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: options.orientations[index]!,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));
  return {
    game: {
      ...game,
      energyActivePhaseSkips: (options.markedIndices ?? []).map((index) => ({
        playerId: PLAYER1,
        energyCardId: energyCards[index]!.instanceId,
        sourceCardId: 'marker-source',
        abilityId: 'marker-ability',
      })),
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

function confirmEnergy(game: GameState, energyIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    [...energyIds]
  );
}

function confirmEffectChoice(game: GameState, optionId: string): GameState {
  const disclosed = confirmOption(game, optionId);
  expect(disclosed.activeEffect).toMatchObject({
    stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
    effectChoice: { selectedOptionIds: [optionId] },
  });
  return confirmActiveEffectStep(disclosed, PLAYER1, disclosed.activeEffect!.id);
}

describe('PL!N-bp1-003 费用10「桜坂しずく」LIVE开始能力', () => {
  it('pays one ordinary energy, offers exactly six normal Heart results, and grants only the source member', () => {
    const scenario = setup({
      orientations: [OrientationState.ACTIVE, OrientationState.ACTIVE],
    });
    let state = open(scenario.game);
    expect(state.activeEffect).toMatchObject({
      abilityId: PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
      stepId: 'N_BP1_003_PAY_ONE_ENERGY',
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(
      state.activeEffect?.selectableOptions?.filter((option) => option.label === '不发动')
    ).toEqual([]);

    state = confirmOption(state, 'pay');
    expect(state.activeEffect).toMatchObject({
      stepId: 'N_BP1_003_CHOOSE_HEART',
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
    expect(state.activeEffect?.selectableOptions).toBeUndefined();
    expect(state.activeEffect?.skipSelectionLabel).toBeUndefined();
    expect(state.activeEffect?.confirmSelectionLabel).toBeUndefined();
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[1])?.orientation).toBe(
      OrientationState.ACTIVE
    );

    state = confirmEffectChoice(state, HeartColor.PURPLE);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.PURPLE, count: 1 }],
      sourceCardId: scenario.sourceId,
      abilityId: PL_N_BP1_003_LIVE_START_PAY_ONE_ENERGY_CHOOSE_HEART_ABILITY_ID,
      target: 'SOURCE_MEMBER',
    });
    expect(
      getMemberEffectiveHeartIcons(state, PLAYER1, scenario.sourceId).find(
        (heart) => heart.color === HeartColor.PURPLE
      )?.count
    ).toBe(1);
  });

  it('declines cleanly and exposes only the skip path when energy is insufficient', () => {
    const payable = setup({ orientations: [OrientationState.ACTIVE] });
    let state = confirmOption(open(payable.game));
    expect(state.activeEffect).toBeNull();
    expect(state.players[0].energyZone.cardStates.get(payable.energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(state.liveResolution.liveModifiers).toEqual([]);

    const insufficient = setup({ orientations: [OrientationState.WAITING] });
    state = open(insufficient.game);
    expect(state.activeEffect?.selectableOptions).toEqual([]);
    expect(state.activeEffect?.stepText).toContain('无法支付[E]');
    state = confirmOption(state);
    expect(state.activeEffect).toBeNull();
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });

  it('uses exact marked-energy selection and rejects duplicate, illegal, and stale energy ids', () => {
    const scenario = setup({
      orientations: [OrientationState.ACTIVE, OrientationState.ACTIVE, OrientationState.ACTIVE],
      markedIndices: [1],
    });
    const selecting = confirmOption(open(scenario.game), 'pay');
    expect(selecting.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
      selectableCardIds: scenario.energyIds,
      minSelectableCards: 1,
      maxSelectableCards: 1,
    });

    for (const ids of [[scenario.energyIds[0]!, scenario.energyIds[0]!], ['illegal-energy']]) {
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
    expect(confirmEnergy(stale, [scenario.energyIds[1]!]).activeEffect?.stepId).toBe(
      'COMMON_ENERGY_OPERATION_SELECTION'
    );

    let paid = confirmEnergy(selecting, [scenario.energyIds[1]!]);
    expect(paid.activeEffect?.stepId).toBe('N_BP1_003_CHOOSE_HEART');
    expect(paid.players[0].energyZone.cardStates.get(scenario.energyIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('does not pay after the source leaves, and keeps paid energy without granting Heart if it leaves later', () => {
    const before = setup({ orientations: [OrientationState.ACTIVE] });
    let state = open(before.game);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    state = confirmOption(state, 'pay');
    expect(state.activeEffect).toBeNull();
    expect(state.players[0].energyZone.cardStates.get(before.energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );

    const after = setup({ orientations: [OrientationState.ACTIVE] });
    state = confirmOption(open(after.game), 'pay');
    const illegalHeart = confirmOption(state, HeartColor.RAINBOW);
    expect(illegalHeart.activeEffect?.stepId).toBe('N_BP1_003_CHOOSE_HEART');
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    state = confirmEffectChoice(state, HeartColor.BLUE);
    expect(state.activeEffect).toBeNull();
    expect(state.players[0].energyZone.cardStates.get(after.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.liveResolution.liveModifiers).toEqual([]);
  });
});
