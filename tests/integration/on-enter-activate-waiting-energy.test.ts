import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
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

function createMember(cardCode: string, name: string, cost: number): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: cardCode.startsWith('PL!HS')
      ? ['蓮ノ空女学院スクールアイドルクラブ']
      : ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setupOnEnterEnergyScenario(options: {
  readonly sourceCardCode: string;
  readonly sourceName: string;
  readonly sourceCost: number;
  readonly energyOrientations: readonly OrientationState[];
}): { readonly game: GameState; readonly energyCardIds: readonly string[] } {
  const source = createCardInstance(
    createMember(options.sourceCardCode, options.sourceName, options.sourceCost),
    PLAYER1,
    'source'
  );
  const energyCards = options.energyOrientations.map((_, index) =>
    createCardInstance(createEnergy(`ENERGY-${index}`), PLAYER1, `energy-${index}`)
  );
  let game = createGameState('on-enter-activate-waiting-energy', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...energyCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    energyZone: energyCards.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: options.energyOrientations[index],
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = emitGameEvent(game, {
    eventId: `enter-${options.sourceCardCode}`,
    eventType: TriggerCondition.ON_ENTER_STAGE,
    timestamp: Date.now(),
    cardInstanceId: source.instanceId,
    fromZone: ZoneType.HAND,
    toZone: ZoneType.MEMBER_SLOT,
    toSlot: SlotPosition.CENTER,
    ownerId: PLAYER1,
    controllerId: PLAYER1,
  });
  return { game, energyCardIds: energyCards.map((card) => card.instanceId) };
}

function resolveOnEnter(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_ENTER_STAGE]);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

describe('shared on-enter activate waiting energy workflow', () => {
  it.each([
    ['PL!HS-bp1-001-R', '日野下花帆', 11],
    ['PL!N-sd1-008-SD', 'エマ・ヴェルデ', 7],
  ] as const)(
    'activates two waiting energy cards for %s',
    (sourceCardCode, sourceName, sourceCost) => {
      const scenario = setupOnEnterEnergyScenario({
        sourceCardCode,
        sourceName,
        sourceCost,
        energyOrientations: [
          OrientationState.WAITING,
          OrientationState.WAITING,
          OrientationState.ACTIVE,
        ],
      });

      const state = resolveOnEnter(scenario.game);

      expect(
        scenario.energyCardIds.map(
          (cardId) => state.players[0].energyZone.cardStates.get(cardId)?.orientation
        )
      ).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE, OrientationState.ACTIVE]);
      expect(
        state.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId === MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID &&
            action.payload.activatedEnergyCardIds?.length === 2
        )
      ).toBe(true);
      expect(state.pendingAbilities).toEqual([]);
    }
  );

  it('activates only one energy when only one is waiting', () => {
    const scenario = setupOnEnterEnergyScenario({
      sourceCardCode: 'PL!HS-bp1-001-P',
      sourceName: '日野下花帆',
      sourceCost: 11,
      energyOrientations: [OrientationState.ACTIVE, OrientationState.WAITING],
    });

    const state = resolveOnEnter(scenario.game);

    expect(
      scenario.energyCardIds.map(
        (cardId) => state.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
    expect(
      state.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID
      )?.payload.activatedEnergyCardIds
    ).toEqual([scenario.energyCardIds[1]]);
  });

  it('selects exact waiting energy when the candidates include a special energy', () => {
    const scenario = setupOnEnterEnergyScenario({
      sourceCardCode: 'PL!HS-bp1-001-R',
      sourceName: '日野下花帆',
      sourceCost: 11,
      energyOrientations: [
        OrientationState.WAITING,
        OrientationState.WAITING,
        OrientationState.WAITING,
      ],
    });
    const marked: GameState = {
      ...scenario.game,
      energyActivePhaseSkips: [
        {
          playerId: PLAYER1,
          energyCardId: scenario.energyCardIds[2]!,
          sourceCardId: 'marker-source',
          abilityId: 'marker-ability',
        },
      ],
    };
    const selecting = resolveOnEnter(marked);
    expect(selecting.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    const resolved = confirmActiveEffectStep(
      selecting,
      PLAYER1,
      selecting.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [scenario.energyCardIds[0]!, scenario.energyCardIds[2]!]
    );
    expect(
      scenario.energyCardIds.map(
        (cardId) => resolved.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([OrientationState.ACTIVE, OrientationState.WAITING, OrientationState.ACTIVE]);
  });

  it('consumes the pending ability when no energy is waiting', () => {
    const scenario = setupOnEnterEnergyScenario({
      sourceCardCode: 'PL!N-sd1-008-RM',
      sourceName: 'エマ・ヴェルデ',
      sourceCost: 7,
      energyOrientations: [OrientationState.ACTIVE],
    });

    const state = resolveOnEnter(scenario.game);

    expect(state.players[0].energyZone.cardStates.get(scenario.energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      state.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID
      )?.payload.activatedEnergyCardIds
    ).toEqual([]);
    expect(state.pendingAbilities).toEqual([]);
  });
});
