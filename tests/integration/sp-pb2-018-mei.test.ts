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
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { SP_PB2_018_LIVE_START_DIFFERENT_NAME_CATCHU_ACTIVATE_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, name: string, unitName = 'CatChu!'): MemberCardData {
  return {
    cardCode,
    name,
    groupName: 'Liella!',
    unitName,
    cardType: CardType.MEMBER,
    cost: 2,
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

function setupState(options: { readonly waitingEnergyCount: number }): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly qualifyingId: string;
  readonly sameNameId: string;
  readonly nonCatchuId: string;
  readonly belowId: string;
  readonly energyIds: readonly string[];
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-018-R', '米女メイ'),
    PLAYER1,
    'sp-pb2-018-source'
  );
  const qualifying = createCardInstance(
    createMember('PL!SP-pb2-018-qualifying', '澁谷かのん'),
    PLAYER1,
    'sp-pb2-018-qualifying'
  );
  const sameName = createCardInstance(
    createMember('PL!SP-pb2-018-same-name', '米女メイ'),
    PLAYER1,
    'sp-pb2-018-same-name'
  );
  const nonCatchu = createCardInstance(
    createMember('PL!SP-pb2-018-non-catchu', '若菜四季', '5yncri5e!'),
    PLAYER1,
    'sp-pb2-018-non-catchu'
  );
  const below = createCardInstance(
    createMember('PL!SP-pb2-018-below', '唐 可可'),
    PLAYER1,
    'sp-pb2-018-below'
  );
  const energyCards = [0, 1, 2].map((index) =>
    createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `sp-pb2-018-energy-${index}`)
  );

  let game = createGameState('sp-pb2-018-mei', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, qualifying, sameName, nonCatchu, below, ...energyCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, qualifying.instanceId),
          SlotPosition.CENTER,
          source.instanceId
        ),
        SlotPosition.RIGHT,
        sameName.instanceId
      ),
      memberBelow: {
        ...player.memberSlots.memberBelow,
        [SlotPosition.CENTER]: [below.instanceId],
      },
    },
    waitingRoom: { ...player.waitingRoom, cardIds: [nonCatchu.instanceId] },
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation:
              index < options.waitingEnergyCount
                ? OrientationState.WAITING
                : OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
  }));

  return {
    game,
    sourceId: source.instanceId,
    qualifyingId: qualifying.instanceId,
    sameNameId: sameName.instanceId,
    nonCatchuId: nonCatchu.instanceId,
    belowId: below.instanceId,
    energyIds: energyCards.map((card) => card.instanceId),
  };
}

function startAbility(game: GameState, sourceId: string): GameState {
  const pending: PendingAbilityState = {
    id: 'sp-pb2-018-pending',
    abilityId: SP_PB2_018_LIVE_START_DIFFERENT_NAME_CATCHU_ACTIVATE_ENERGY_ABILITY_ID,
    sourceCardId: sourceId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
    sourceSlot: SlotPosition.CENTER,
  };
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending],
  }).gameState;
}

describe('PL!SP-pb2-018 Mei live start energy activation', () => {
  it('activates energy for different-named CatChu! stage members only', () => {
    const scenario = setupState({ waitingEnergyCount: 2 });
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      state.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_018_LIVE_START_DIFFERENT_NAME_CATCHU_ACTIVATE_ENERGY_ABILITY_ID
      )?.payload
    ).toMatchObject({
      differentNamedCatchuMemberIds: [scenario.qualifyingId],
      activatedEnergyCardIds: [scenario.energyIds[0]],
    });
  });

  it('only activates available waiting energy when fewer than the counted members', () => {
    const scenario = setupState({ waitingEnergyCount: 0 });
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      state.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_018_LIVE_START_DIFFERENT_NAME_CATCHU_ACTIVATE_ENERGY_ABILITY_ID
      )?.payload
    ).toMatchObject({
      differentNamedCatchuMemberCount: 1,
      activatedEnergyCardIds: [],
    });
  });

  it('does not count non-CatChu! stage members', () => {
    const scenario = setupState({ waitingEnergyCount: 2 });
    const game = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, scenario.nonCatchuId),
    }));
    const state = startAbility(game, scenario.sourceId);

    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );
  });
});
