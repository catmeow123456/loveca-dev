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
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PB2_007_LIVE_SUCCESS_PAY_THREE_ENERGY_RECOVER_LIELLA_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createLive(cardCode: string, groupName = 'Liella!'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setupMeiState(options: {
  readonly activeEnergyCount: number;
  readonly waitingLiveGroup?: string;
}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly targetLiveId: string;
  readonly energyCardIds: readonly string[];
} {
  const source = createCardInstance(createMember('PL!SP-pb2-007-R'), PLAYER1, 'mei-source');
  const targetLive = createCardInstance(
    createLive(
      options.waitingLiveGroup === 'Aqours' ? 'PL!S-test-live' : 'PL!SP-test-live',
      options.waitingLiveGroup ?? 'Liella!'
    ),
    PLAYER1,
    'liella-live'
  );
  const energyCards = Array.from({ length: 4 }, (_, index) =>
    createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `energy-${index}`)
  );

  let game = createGameState('sp-pb2-007-mei', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, targetLive, ...energyCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [targetLive.instanceId],
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
  }));

  return {
    game,
    sourceId: source.instanceId,
    targetLiveId: targetLive.instanceId,
    energyCardIds: energyCards.map((card) => card.instanceId),
  };
}

function withPending(game: GameState, sourceCardId: string): GameState {
  const pendingAbility: PendingAbilityState = {
    id: `${SP_PB2_007_LIVE_SUCCESS_PAY_THREE_ENERGY_RECOVER_LIELLA_LIVE_ABILITY_ID}:pending`,
    abilityId: SP_PB2_007_LIVE_SUCCESS_PAY_THREE_ENERGY_RECOVER_LIELLA_LIVE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
    sourceSlot: SlotPosition.CENTER,
  };
  return {
    ...game,
    pendingAbilities: [pendingAbility],
  };
}

function startMei(game: GameState, sourceId: string): GameState {
  return resolvePendingCardEffects(withPending(game, sourceId)).gameState;
}

describe('PL!SP-pb2-007 Mei live success workflow', () => {
  it('pays EEE and recovers one Liella Live from waiting room', () => {
    const { game, sourceId, targetLiveId, energyCardIds } = setupMeiState({
      activeEnergyCount: 4,
    });
    let state = startMei(game, sourceId);

    expect(state.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'pay',
      'decline',
    ]);

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'pay'
    );
    expect(state.activeEffect?.selectableCardIds).toEqual([targetLiveId]);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, targetLiveId);
    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toContain(targetLiveId);
    expect(state.players[0].waitingRoom.cardIds).not.toContain(targetLiveId);
    expect(
      energyCardIds
        .slice(0, 3)
        .every(
          (cardId) =>
            state.players[0].energyZone.cardStates.get(cardId)?.orientation ===
            OrientationState.WAITING
        )
    ).toBe(true);
  });

  it('consumes pending without paying when active energy is insufficient', () => {
    const { game, sourceId, energyCardIds } = setupMeiState({ activeEnergyCount: 2 });
    const state = startMei(game, sourceId);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(
      energyCardIds
        .slice(0, 2)
        .every(
          (cardId) =>
            state.players[0].energyZone.cardStates.get(cardId)?.orientation ===
            OrientationState.ACTIVE
        )
    ).toBe(true);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.reason === 'INSUFFICIENT_ACTIVE_ENERGY'
      )
    ).toBe(true);
  });

  it('consumes pending without paying when there is no Liella Live target', () => {
    const { game, sourceId, energyCardIds } = setupMeiState({
      activeEnergyCount: 3,
      waitingLiveGroup: 'Aqours',
    });
    const state = startMei(game, sourceId);

    expect(state.activeEffect).toBeNull();
    expect(
      energyCardIds
        .slice(0, 3)
        .every(
          (cardId) =>
            state.players[0].energyZone.cardStates.get(cardId)?.orientation ===
            OrientationState.ACTIVE
        )
    ).toBe(true);
    expect(
      state.actionHistory.some(
        (action) => action.type === 'RESOLVE_ABILITY' && action.payload.reason === 'NO_TARGET'
      )
    ).toBe(true);
  });

  it('records paid energy before target selection', () => {
    const { game, sourceId } = setupMeiState({ activeEnergyCount: 3 });
    let state = startMei(game, sourceId);

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'pay'
    );

    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          Array.isArray(action.payload.energyCardIds) &&
          action.payload.energyCardIds.length === 3
      )
    ).toBe(true);
    expect(state.players[0].hand.cardIds).toEqual([]);
    expect(state.activeEffect?.stepId).toBe('SP_PB2_007_SELECT_LIELLA_LIVE');
  });
});
