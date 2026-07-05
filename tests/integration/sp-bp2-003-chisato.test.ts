import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { moveMemberBetweenSlots } from '../../src/application/effects/member-state';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  SP_BP2_003_AUTO_ON_MOVE_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
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

function createMember(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 4,
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

function setupState(options: {
  readonly energyDeckCount?: number;
  readonly includeBladeMember?: boolean;
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly energyIds: readonly string[];
  readonly bladeSourceId: string | null;
} {
  const source = createCardInstance(
    createMember('PL!SP-bp2-003-R', '嵐 千砂都'),
    PLAYER1,
    'sp-bp2-003-source'
  );
  const other = createCardInstance(createMember('PL!SP-test-other', 'Other'), PLAYER1, 'other');
  const bladeSource = createCardInstance(
    createMember('PL!SP-sd2-011-SD2', '鬼塚冬毬'),
    PLAYER1,
    'blade-source'
  );
  const energyCards = [0, 1].map((index) =>
    createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `energy-${index}`)
  );
  const includeBladeMember = options.includeBladeMember === true;

  let game = createGameState('sp-bp2-003-chisato', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, other, bladeSource, ...energyCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        player.memberSlots,
        SlotPosition.LEFT,
        source.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
      SlotPosition.RIGHT,
      includeBladeMember ? bladeSource.instanceId : other.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
    energyDeck: {
      ...player.energyDeck,
      cardIds: energyCards
        .slice(0, options.energyDeckCount ?? 1)
        .map((card) => card.instanceId),
    },
  }));

  return {
    game,
    sourceId: source.instanceId,
    energyIds: energyCards.map((card) => card.instanceId),
    bladeSourceId: includeBladeMember ? bladeSource.instanceId : null,
  };
}

function moveAndQueue(game: GameState, cardId: string, toSlot: SlotPosition): GameState {
  const moveResult = moveMemberBetweenSlots(game, PLAYER1, cardId, toSlot);
  expect(moveResult).not.toBeNull();
  return enqueueTriggeredCardEffects(moveResult!.gameState, [TriggerCondition.ON_MEMBER_SLOT_MOVED]);
}

function chooseFirstPendingBySource(game: GameState, sourceCardId: string): GameState {
  const effect = game.activeEffect;
  expect(effect).not.toBeNull();
  return confirmActiveEffectStep(game, PLAYER1, effect!.id, sourceCardId);
}

describe('PL!SP-bp2-003 Chisato on-move waiting energy', () => {
  it('queues from the member move event and places one WAITING energy', () => {
    const scenario = setupState();
    const queued = moveAndQueue(scenario.game, scenario.sourceId, SlotPosition.CENTER);

    expect(queued.pendingAbilities).toHaveLength(1);
    expect(queued.pendingAbilities[0]).toMatchObject({
      abilityId: SP_BP2_003_AUTO_ON_MOVE_PLACE_WAITING_ENERGY_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
    });

    const state = resolvePendingCardEffects(queued).gameState;
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].energyDeck.cardIds).toEqual([]);
    expect(state.players[0].energyZone.cardIds).toEqual([scenario.energyIds[0]]);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('consumes the pending ability as a no-op when the energy deck is empty', () => {
    const scenario = setupState({ energyDeckCount: 0 });
    const queued = moveAndQueue(scenario.game, scenario.sourceId, SlotPosition.CENTER);
    const state = resolvePendingCardEffects(queued).gameState;

    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].energyZone.cardIds).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_BP2_003_AUTO_ON_MOVE_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.step === 'ENERGY_DECK_EMPTY'
      )
    ).toBe(true);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_BP2_003_AUTO_ON_MOVE_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
  });

  it('respects per-turn limit after a successful placement', () => {
    const scenario = setupState({ energyDeckCount: 2 });
    const resolved = resolvePendingCardEffects(
      moveAndQueue(scenario.game, scenario.sourceId, SlotPosition.CENTER)
    ).gameState;
    const secondQueued = moveAndQueue(resolved, scenario.sourceId, SlotPosition.LEFT);

    expect(secondQueued.pendingAbilities).toEqual([]);
  });

  it('continues to the next moved-member pending ability after resolving', () => {
    const scenario = setupState({ includeBladeMember: true });
    const queued = moveAndQueue(scenario.game, scenario.sourceId, SlotPosition.RIGHT);

    expect(queued.pendingAbilities.map((ability) => ability.abilityId)).toEqual(
      expect.arrayContaining([
        SP_BP2_003_AUTO_ON_MOVE_PLACE_WAITING_ENERGY_ABILITY_ID,
        SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
      ])
    );

    const orderSelection = resolvePendingCardEffects(queued).gameState;
    const state = chooseFirstPendingBySource(orderSelection, scenario.sourceId);
    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(true);
  });
});
