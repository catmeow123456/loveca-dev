import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    groupName: 'Liella!',
    unitName: '5yncri5e!',
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function pendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-pb2-025-pending',
    abilityId: GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['on-enter'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setupStage(withLeftMember = false): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly leftId: string | null;
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-025-N', '嵐 千砂都'),
    PLAYER1,
    'sp-pb2-025-source'
  );
  const left = createCardInstance(
    createMember('PL!SP-test-left', 'Left member'),
    PLAYER1,
    'sp-pb2-025-left'
  );
  let game = createGameState('sp-pb2-025-position-change', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, withLeftMember ? [source, left] : [source]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: withLeftMember
      ? placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, left.instanceId),
          SlotPosition.CENTER,
          source.instanceId
        )
      : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
  }));
  return { game, sourceId: source.instanceId, leftId: withLeftMember ? left.instanceId : null };
}

function startAbility(game: GameState, sourceId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pendingAbility(sourceId)],
  }).gameState;
}

describe('PL!SP-pb2-025 Chisato self position change', () => {
  it('moves this member to an empty slot and records moved event', () => {
    const scenario = setupStage();
    let state = startAbility(scenario.game, scenario.sourceId);

    expect(state.activeEffect).toMatchObject({
      abilityId: GENERIC_ON_ENTER_SELF_POSITION_CHANGE_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
      canSkipSelection: true,
    });

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      null,
      SlotPosition.RIGHT
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(state.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(scenario.sourceId);
    expect(
      state.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
          entry.event.cardInstanceId === scenario.sourceId &&
          entry.event.fromSlot === SlotPosition.CENTER &&
          entry.event.toSlot === SlotPosition.RIGHT
      )
    ).toBe(true);
  });

  it('swaps with an occupied member slot', () => {
    const scenario = setupStage(true);
    let state = startAbility(scenario.game, scenario.sourceId);

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      null,
      SlotPosition.LEFT
    );

    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(scenario.sourceId);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.leftId);
    expect(
      state.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
      )
    ).toHaveLength(2);
  });

  it('declines without moving', () => {
    const scenario = setupStage(true);
    let state = startAbility(scenario.game, scenario.sourceId);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(scenario.leftId);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.sourceId);
    expect(state.players[0].positionMovedThisTurn).toEqual([]);
  });
});
