import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID,
  PL_N_BP1_004_ON_ENTER_OTHER_NIJIGASAKI_ACTIVATE_ONE_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createMember(
  cardCode: string,
  options: {
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function stageMember(
  game: GameState,
  cardId: string,
  slot: SlotPosition,
  orientation = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function setup(options: {
  readonly family?: 'NIJIGASAKI' | 'CERISE';
  readonly otherIdentity?: 'MATCHING' | 'NON_MATCHING' | 'NONE';
  readonly otherOrientation?: OrientationState;
  readonly energyOrientations?: readonly OrientationState[];
  readonly markedEnergyIndices?: readonly number[];
}) {
  const family = options.family ?? 'NIJIGASAKI';
  const abilityId =
    family === 'NIJIGASAKI'
      ? PL_N_BP1_004_ON_ENTER_OTHER_NIJIGASAKI_ACTIVATE_ONE_ENERGY_ABILITY_ID
      : HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID;
  const source = createCardInstance(
    createMember(family === 'NIJIGASAKI' ? 'PL!N-bp1-004-P' : 'PL!HS-bp6-012-R', {
      groupNames: family === 'NIJIGASAKI' ? ['虹ヶ咲'] : ['蓮ノ空'],
      unitName: family === 'CERISE' ? 'Cerise Bouquet' : undefined,
    }),
    PLAYER1,
    `${family}-source`
  );
  const other = createCardInstance(
    createMember(`${family}-other`, {
      groupNames:
        family === 'NIJIGASAKI'
          ? options.otherIdentity === 'NON_MATCHING'
            ? ['Liella!']
            : ['虹咲']
          : ['蓮ノ空'],
      unitName:
        family === 'CERISE'
          ? options.otherIdentity === 'NON_MATCHING'
            ? 'DOLLCHESTRA'
            : 'スリーズブーケ'
          : undefined,
    }),
    PLAYER1,
    `${family}-other`
  );
  const energies = (options.energyOrientations ?? []).map((_, index) =>
    createCardInstance(createEnergy(`${family}-E-${index}`), PLAYER1, `${family}-energy-${index}`)
  );
  let game = registerCards(
    createGameState(`other-identity-${family}`, PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, other, ...energies]
  );
  game = stageMember(game, source.instanceId, SlotPosition.CENTER);
  if (options.otherIdentity !== 'NONE') {
    game = stageMember(
      game,
      other.instanceId,
      SlotPosition.LEFT,
      options.otherOrientation ?? OrientationState.ACTIVE
    );
  }
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    energyZone: energies.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: options.energyOrientations?.[index] ?? OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));
  game = {
    ...game,
    energyActivePhaseSkips: (options.markedEnergyIndices ?? []).map((index) => ({
      playerId: PLAYER1,
      energyCardId: energies[index]!.instanceId,
      sourceCardId: 'marker-source',
      abilityId: 'marker-ability',
    })),
    pendingAbilities: [
      {
        id: `${family}-pending`,
        abilityId,
        sourceCardId: source.instanceId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_ENTER_STAGE,
        eventIds: ['enter-event'],
      },
    ],
  };
  return {
    game,
    abilityId,
    sourceId: source.instanceId,
    otherId: other.instanceId,
    energyIds: energies.map((card) => card.instanceId),
  };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function resolvedEnergyIds(game: GameState, abilityId: string): unknown {
  return game.actionHistory.find(
    (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId
  )?.payload.activatedEnergyCardIds;
}

describe('on-enter other identity activate energy shared workflow', () => {
  it('PL!N-bp1-004 does not satisfy the condition with only the source itself', () => {
    const scenario = setup({
      otherIdentity: 'NONE',
      energyOrientations: [OrientationState.WAITING],
    });
    const state = resolve(scenario.game);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(resolvedEnergyIds(state, scenario.abilityId)).toEqual([]);
    expect(state.actionHistory.at(-1)?.payload.step).toBe('NO_OTHER_NIJIGASAKI_MEMBER');
    expect(state.pendingAbilities).toEqual([]);
  });

  it('PL!N-bp1-004 rejects another non-Nijigasaki member', () => {
    const scenario = setup({
      otherIdentity: 'NON_MATCHING',
      energyOrientations: [OrientationState.WAITING],
    });
    const state = resolve(scenario.game);
    expect(resolvedEnergyIds(state, scenario.abilityId)).toEqual([]);
    expect(state.pendingAbilities).toEqual([]);
  });

  it.each([OrientationState.ACTIVE, OrientationState.WAITING])(
    'PL!N-bp1-004 accepts another Nijigasaki member in %s orientation',
    (otherOrientation) => {
      const scenario = setup({
        otherIdentity: 'MATCHING',
        otherOrientation,
        energyOrientations: [OrientationState.WAITING],
      });
      const state = resolve(scenario.game);
      expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
        OrientationState.ACTIVE
      );
      expect(resolvedEnergyIds(state, scenario.abilityId)).toEqual([scenario.energyIds[0]]);
      expect(state.pendingAbilities).toEqual([]);
    }
  );

  it('continues normally when the condition is met but no WAITING energy exists', () => {
    const scenario = setup({
      otherIdentity: 'MATCHING',
      energyOrientations: [OrientationState.ACTIVE],
    });
    const state = resolve(scenario.game);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(resolvedEnergyIds(state, scenario.abilityId)).toEqual([]);
    expect(state.actionHistory.at(-1)?.payload.step).toBe('NO_WAITING_ENERGY');
  });

  it('automatically activates the first WAITING energy in stable order without markers', () => {
    const scenario = setup({
      otherIdentity: 'MATCHING',
      energyOrientations: [
        OrientationState.WAITING,
        OrientationState.WAITING,
        OrientationState.ACTIVE,
      ],
    });
    const state = resolve(scenario.game);
    expect(resolvedEnergyIds(state, scenario.abilityId)).toEqual([scenario.energyIds[0]]);
    expect(
      scenario.energyIds.map(
        (cardId) => state.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([OrientationState.ACTIVE, OrientationState.WAITING, OrientationState.ACTIVE]);
  });

  it('opens the common exact selector when excess WAITING energy includes a marker', () => {
    const scenario = setup({
      otherIdentity: 'MATCHING',
      energyOrientations: [OrientationState.WAITING, OrientationState.WAITING],
      markedEnergyIndices: [1],
    });
    let state = resolve(scenario.game);
    expect(state.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择要变为活跃状态的待机能量。',
      selectionLabel: '选择要变为活跃的能量',
      confirmSelectionLabel: '变为活跃',
      selectableCardIds: scenario.energyIds,
      minSelectableCards: 1,
      maxSelectableCards: 1,
    });

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
    expect(resolvedEnergyIds(state, scenario.abilityId)).toEqual([scenario.energyIds[1]]);
    expect(state.pendingAbilities).toEqual([]);
  });

  it('does not advance on duplicate, illegal, or stale energy ids', () => {
    const scenario = setup({
      otherIdentity: 'MATCHING',
      energyOrientations: [OrientationState.WAITING, OrientationState.WAITING],
      markedEnergyIndices: [1],
    });
    const selecting = resolve(scenario.game);
    for (const selectedCardIds of [
      [scenario.energyIds[0]!, scenario.energyIds[0]!],
      ['illegal-energy'],
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
      expect(rejected.pendingAbilities).toHaveLength(1);
    }

    const stale = updatePlayer(selecting, PLAYER1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: player.energyZone.cardIds.filter((id) => id !== scenario.energyIds[1]),
      },
    }));
    const rejected = confirmActiveEffectStep(
      stale,
      PLAYER1,
      stale.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [scenario.energyIds[1]!]
    );
    expect(rejected.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expect(rejected.pendingAbilities).toHaveLength(1);
  });

  it('keeps PL!HS-bp6-012 on the same shared family with UNIT identity matching', () => {
    const scenario = setup({
      family: 'CERISE',
      otherIdentity: 'MATCHING',
      otherOrientation: OrientationState.WAITING,
      energyOrientations: [OrientationState.WAITING],
    });
    const state = resolve(scenario.game);
    expect(resolvedEnergyIds(state, scenario.abilityId)).toEqual([scenario.energyIds[0]]);
    expect(state.pendingAbilities).toEqual([]);
  });
});
