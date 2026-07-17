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
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PB2_040_LIVE_START_PAY_ENERGY_GAIN_TWO_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    unitName: 'CatChu!',
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setupState(options: { readonly activeEnergyCount: number }): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly energyIds: readonly string[];
} {
  const source = createCardInstance(createMember('PL!SP-pb2-040-N'), PLAYER1, 'mei-source');
  const energyCards = [1, 2].map((index) =>
    createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `energy-${index}`)
  );
  let game = createGameState('sp-pb2-040-mei', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...energyCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [SlotPosition.CENTER]: source.instanceId,
      },
      cardStates: new Map([
        [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation:
              index < options.activeEnergyCount
                ? OrientationState.ACTIVE
                : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
  }));

  return {
    game,
    sourceId: source.instanceId,
    energyIds: energyCards.map((card) => card.instanceId),
  };
}

function startAbility(game: GameState, sourceId: string): GameState {
  const pending: PendingAbilityState = {
    id: 'sp-pb2-040-pending',
    abilityId: SP_PB2_040_LIVE_START_PAY_ENERGY_GAIN_TWO_BLADE_ABILITY_ID,
    sourceCardId: sourceId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
  };
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending],
  }).gameState;
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

describe('PL!SP-pb2-040 Mei live start workflow', () => {
  it('pays one active energy and gives the source member Blade +2', () => {
    const scenario = setupState({ activeEnergyCount: 1 });
    const started = startAbility(scenario.game, scenario.sourceId);

    expect(started.activeEffect?.selectableOptions).toEqual([
      { id: 'pay', label: '支付[E]' },
    ]);
    expect(started.activeEffect?.canSkipSelection).toBe(true);
    expect(started.activeEffect?.skipSelectionLabel).toBe('不发动');
    const state = confirmOption(started, 'pay');

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: scenario.sourceId,
      abilityId: SP_PB2_040_LIVE_START_PAY_ENERGY_GAIN_TWO_BLADE_ABILITY_ID,
    });
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            SP_PB2_040_LIVE_START_PAY_ENERGY_GAIN_TWO_BLADE_ABILITY_ID &&
          action.payload.energyCardIds?.includes(scenario.energyIds[0]) === true
      )
    ).toBe(true);
  });

  it('can decline without paying energy or writing a Blade modifier', () => {
    const scenario = setupState({ activeEnergyCount: 1 });
    const started = startAbility(scenario.game, scenario.sourceId);
    const state = confirmOption(started);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.abilityId === SP_PB2_040_LIVE_START_PAY_ENERGY_GAIN_TWO_BLADE_ABILITY_ID
      )
    ).toBe(false);
    expect(state.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });

  it('does not offer payment when there is no active energy', () => {
    const scenario = setupState({ activeEnergyCount: 0 });
    const started = startAbility(scenario.game, scenario.sourceId);

    expect(started.activeEffect?.selectableOptions).toEqual([]);
    expect(started.activeEffect?.canSkipSelection).toBe(true);
    expect(started.activeEffect?.skipSelectionLabel).toBe('不发动');
    const state = confirmOption(started);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.abilityId === SP_PB2_040_LIVE_START_PAY_ENERGY_GAIN_TWO_BLADE_ABILITY_ID
      )
    ).toBe(false);
    expect(state.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });
});
