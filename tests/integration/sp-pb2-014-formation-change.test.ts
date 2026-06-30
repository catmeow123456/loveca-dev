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
import { SP_PB2_014_ON_ENTER_FIVEYNCRISE_STAGE_FORMATION_CHANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, HeartColor, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name: string, unitName: string): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function pendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-pb2-014-pending',
    abilityId: SP_PB2_014_ON_ENTER_FIVEYNCRISE_STAGE_FORMATION_CHANGE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['on-enter'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setupStage(otherUnitName = '5yncri5e!'): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly otherId: string;
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-014-R', '嵐 千砂都', '5yncri5e!'),
    PLAYER1,
    'sp-pb2-014-source'
  );
  const other = createCardInstance(
    createMember('PL!SP-test-other', 'Other', otherUnitName),
    PLAYER1,
    'sp-pb2-014-other'
  );
  let game = createGameState('sp-pb2-014-formation-change', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, other]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.LEFT, other.instanceId),
      SlotPosition.CENTER,
      source.instanceId
    ),
  }));
  return { game, sourceId: source.instanceId, otherId: other.instanceId };
}

function startAbility(game: GameState, sourceId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pendingAbility(sourceId)],
  }).gameState;
}

describe('PL!SP-pb2-014 Chisato formation change', () => {
  it('opens formation change when all own stage members are 5yncri5e!', () => {
    const scenario = setupStage();
    let state = startAbility(scenario.game, scenario.sourceId);

    expect(state.activeEffect).toMatchObject({
      abilityId: SP_PB2_014_ON_ENTER_FIVEYNCRISE_STAGE_FORMATION_CHANGE_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      canSkipSelection: true,
    });

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [
        { cardId: scenario.sourceId, toSlot: SlotPosition.RIGHT },
        { cardId: scenario.otherId, toSlot: SlotPosition.CENTER },
      ]
    );

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.otherId);
    expect(state.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(scenario.sourceId);
    expect(
      state.eventLog.filter(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
          entry.event.cause?.kind === 'CARD_EFFECT' &&
          entry.event.cause.abilityId ===
            SP_PB2_014_ON_ENTER_FIVEYNCRISE_STAGE_FORMATION_CHANGE_ABILITY_ID
      )
    ).toHaveLength(2);
  });

  it('consumes pending without moving when any own stage member is not 5yncri5e!', () => {
    const scenario = setupStage('CatChu!');
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(scenario.otherId);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.sourceId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_014_ON_ENTER_FIVEYNCRISE_STAGE_FORMATION_CHANGE_ABILITY_ID &&
          action.payload.step === 'STAGE_FORMATION_CHANGE_CONDITION_NOT_MET'
      )
    ).toBe(true);
  });

  it('declines without moving', () => {
    const scenario = setupStage();
    let state = startAbility(scenario.game, scenario.sourceId);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(scenario.otherId);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.sourceId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_014_ON_ENTER_FIVEYNCRISE_STAGE_FORMATION_CHANGE_ABILITY_ID &&
          action.payload.step === 'STAGE_FORMATION_CHANGE_SKIPPED'
      )
    ).toBe(true);
  });
});
