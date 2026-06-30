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
import { createMemberSlotMovedEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PB2_028_AUTO_MAIN_PHASE_ON_MOVE_ACTIVATE_TWO_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    unitName: '5yncri5e!',
    cardType: CardType.MEMBER,
    cost: 5,
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

function setupState(options: {
  readonly phase?: GamePhase;
  readonly waitingEnergyCount?: number;
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly otherId: string;
  readonly energyIds: readonly string[];
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-028-N', '桜小路きな子'),
    PLAYER1,
    'sp-pb2-028-source'
  );
  const other = createCardInstance(
    createMember('PL!SP-test-other', 'Other'),
    PLAYER1,
    'sp-pb2-028-other'
  );
  const energyCards = [0, 1, 2].map((index) =>
    createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `sp-pb2-028-energy-${index}`)
  );
  const waitingEnergyCount = options.waitingEnergyCount ?? 2;

  let game = createGameState('sp-pb2-028-kinako', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, other, ...energyCards]);
  game = {
    ...game,
    currentPhase: options.phase ?? GamePhase.MAIN_PHASE,
    activePlayerIndex: 0,
  };
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, other.instanceId),
        SlotPosition.RIGHT,
        source.instanceId
      ),
      cardStates: new Map([
        [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        [other.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
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
              index < waitingEnergyCount ? OrientationState.WAITING : OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
  }));

  return {
    game,
    sourceId: source.instanceId,
    otherId: other.instanceId,
    energyIds: energyCards.map((card) => card.instanceId),
  };
}

function enqueueMove(game: GameState, cardId: string, fromSlot: SlotPosition, toSlot: SlotPosition): GameState {
  const event = createMemberSlotMovedEvent(cardId, PLAYER1, fromSlot, toSlot);
  return enqueueTriggeredCardEffects(emitGameEvent(game, event), [
    TriggerCondition.ON_MEMBER_SLOT_MOVED,
  ]);
}

describe('PL!SP-pb2-028 Kinako on-move energy activation', () => {
  it('activates two energy when this member moves during own main phase', () => {
    const scenario = setupState();
    const queued = enqueueMove(scenario.game, scenario.sourceId, SlotPosition.CENTER, SlotPosition.RIGHT);

    expect(queued.pendingAbilities).toHaveLength(1);
    const state = resolvePendingCardEffects(queued).gameState;

    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[1])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_028_AUTO_MAIN_PHASE_ON_MOVE_ACTIVATE_TWO_ENERGY_ABILITY_ID &&
          action.payload.step === 'MAIN_PHASE_ON_MOVE_ACTIVATE_TWO_ENERGY' &&
          Array.isArray(action.payload.activatedEnergyCardIds) &&
          action.payload.activatedEnergyCardIds.length === 2
      )
    ).toBe(true);
  });

  it('consumes pending no-op outside own main phase', () => {
    const scenario = setupState({ phase: GamePhase.PERFORMANCE_PHASE });
    const queued = enqueueMove(scenario.game, scenario.sourceId, SlotPosition.CENTER, SlotPosition.RIGHT);
    const state = resolvePendingCardEffects(queued).gameState;

    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_028_AUTO_MAIN_PHASE_ON_MOVE_ACTIVATE_TWO_ENERGY_ABILITY_ID &&
          action.payload.step === 'CONDITION_NOT_MET'
      )
    ).toBe(true);
  });

  it('does not enqueue when a different member moves', () => {
    const scenario = setupState();
    const queued = enqueueMove(scenario.game, scenario.otherId, SlotPosition.CENTER, SlotPosition.LEFT);

    expect(queued.pendingAbilities).toEqual([]);
  });

  it('respects per-turn limit one after the first resolution', () => {
    const scenario = setupState({ waitingEnergyCount: 3 });
    const firstQueued = enqueueMove(
      scenario.game,
      scenario.sourceId,
      SlotPosition.CENTER,
      SlotPosition.RIGHT
    );
    const resolved = resolvePendingCardEffects(firstQueued).gameState;

    const secondQueued = enqueueMove(
      resolved,
      scenario.sourceId,
      SlotPosition.LEFT,
      SlotPosition.RIGHT
    );

    expect(secondQueued.pendingAbilities).toEqual([]);
  });
});
