import { describe, expect, it } from 'vitest';
import type { AnyCardData, CardInstance, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
const ABILITY_ID =
  PL_S_BP5_004_ON_ENTER_CHOOSE_AQOURS_BLADE_OR_SAINTSNOW_POSITION_CHANGE_ABILITY_ID;

function member(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
    bladeHearts: [],
  };
}

function instance<TData extends AnyCardData>(
  data: TData,
  id: string,
  ownerId = PLAYER1
): CardInstance<TData> {
  return createCardInstance(data, ownerId, id);
}

function pending(sourceCardId: string, id = 's-bp5-004-pending'): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`event:${id}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function placeStageMembers(
  game: GameState,
  placements: readonly {
    readonly cardId: string;
    readonly slot: SlotPosition;
  }[]
): GameState {
  return updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const placement of placements) {
      memberSlots = placeCardInSlot(memberSlots, placement.slot, placement.cardId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return { ...player, memberSlots };
  });
}

function startEffect(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function chooseOption(game: GameState, selectedOptionId: string): GameState {
  const effect = game.activeEffect!;
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    effect.id,
    undefined,
    undefined,
    undefined,
    selectedOptionId
  );
}

function chooseCard(game: GameState, selectedCardId: string): GameState {
  const effect = game.activeEffect!;
  return confirmActiveEffectStep(game, PLAYER1, effect.id, selectedCardId);
}

function chooseSlot(game: GameState, selectedSlot: SlotPosition): GameState {
  const effect = game.activeEffect!;
  return confirmActiveEffectStep(game, PLAYER1, effect.id, undefined, selectedSlot);
}

function latestPayload(game: GameState): Record<string, unknown> | undefined {
  return game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ABILITY_ID)
    .at(-1)?.payload;
}

describe('PL!S-bp5-004 黒澤ダイヤ', () => {
  it('only offers another Aqours member for the BLADE branch and grants that target BLADE', () => {
    const source = instance(
      member('PL!S-bp5-004-R', { name: '黒澤ダイヤ', groupNames: ['Aqours'] }),
      'dia-source'
    );
    const aqoursTarget = instance(
      member('PL!S-test-aqours', { name: 'Aqours target', groupNames: ['Aqours'] }),
      'aqours-target'
    );
    const saintSnowTarget = instance(
      member('PL!S-test-saintsnow', { name: 'SaintSnow target', groupNames: ['SaintSnow'] }),
      'saintsnow-target'
    );
    let game = registerCards(
      createGameState('s-bp5-004-dia-blade', PLAYER1, 'P1', PLAYER2, 'P2'),
      [source, aqoursTarget, saintSnowTarget]
    );
    game = placeStageMembers(game, [
      { cardId: source.instanceId, slot: SlotPosition.CENTER },
      { cardId: aqoursTarget.instanceId, slot: SlotPosition.LEFT },
      { cardId: saintSnowTarget.instanceId, slot: SlotPosition.RIGHT },
    ]);
    game = { ...game, pendingAbilities: [pending(source.instanceId)] };

    let state = startEffect(game);
    expect(state.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'aqours-blade',
      'saintsnow-position-change',
    ]);

    state = chooseOption(state, 'aqours-blade');
    expect(state.activeEffect?.selectableCardIds).toEqual([aqoursTarget.instanceId]);

    state = chooseCard(state, aqoursTarget.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(state.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        playerId: PLAYER1,
        sourceCardId: aqoursTarget.instanceId,
        abilityId: ABILITY_ID,
        countDelta: 1,
      })
    );
    expect(latestPayload(state)).toMatchObject({
      sourceCardId: source.instanceId,
      step: 'GRANT_AQOURS_TARGET_BLADE',
      targetMemberCardId: aqoursTarget.instanceId,
      bladeModifierSourceCardId: aqoursTarget.instanceId,
    });
  });

  it('position-changes a SaintSnow member to an empty slot and emits a moved event', () => {
    const source = instance(member('PL!S-bp5-004-R', { name: '黒澤ダイヤ' }), 'dia-source');
    const saintSnowTarget = instance(
      member('PL!S-test-saintsnow', { name: 'SaintSnow target', groupNames: ['SaintSnow'] }),
      'saintsnow-target'
    );
    let game = registerCards(
      createGameState('s-bp5-004-dia-empty-move', PLAYER1, 'P1', PLAYER2, 'P2'),
      [source, saintSnowTarget]
    );
    game = placeStageMembers(game, [
      { cardId: source.instanceId, slot: SlotPosition.LEFT },
      { cardId: saintSnowTarget.instanceId, slot: SlotPosition.CENTER },
    ]);
    game = { ...game, pendingAbilities: [pending(source.instanceId)] };

    let state = startEffect(game);
    expect(state.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'saintsnow-position-change',
    ]);

    state = chooseOption(state, 'saintsnow-position-change');
    state = chooseCard(state, saintSnowTarget.instanceId);
    expect(state.activeEffect?.selectableSlots).toEqual([SlotPosition.LEFT, SlotPosition.RIGHT]);

    state = chooseSlot(state, SlotPosition.RIGHT);
    const player = state.players.find((candidate) => candidate.id === PLAYER1)!;

    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(player.memberSlots.slots[SlotPosition.RIGHT]).toBe(saintSnowTarget.instanceId);
    expect(player.positionMovedThisTurn).toContain(saintSnowTarget.instanceId);
    expect(state.eventLog.at(-1)?.event).toMatchObject({
      eventType: TriggerCondition.ON_MEMBER_SLOT_MOVED,
      cardInstanceId: saintSnowTarget.instanceId,
      fromSlot: SlotPosition.CENTER,
      toSlot: SlotPosition.RIGHT,
    });
    expect(latestPayload(state)).toMatchObject({
      step: 'POSITION_CHANGE_SAINTSNOW_MEMBER',
      targetMemberCardId: saintSnowTarget.instanceId,
      fromSlot: SlotPosition.CENTER,
      toSlot: SlotPosition.RIGHT,
      swappedCardId: null,
    });
  });

  it('swaps a SaintSnow member with an occupied target slot and emits both moved events', () => {
    const source = instance(member('PL!S-bp5-004-R', { name: '黒澤ダイヤ' }), 'dia-source');
    const saintSnowTarget = instance(
      member('PL!S-test-saintsnow', { name: 'SaintSnow target', groupNames: ['SaintSnow'] }),
      'saintsnow-target'
    );
    const swapped = instance(
      member('PL!S-test-aqours', { name: 'Aqours swapped', groupNames: ['Aqours'] }),
      'swapped-target'
    );
    let game = registerCards(
      createGameState('s-bp5-004-dia-swap', PLAYER1, 'P1', PLAYER2, 'P2'),
      [source, saintSnowTarget, swapped]
    );
    game = placeStageMembers(game, [
      { cardId: source.instanceId, slot: SlotPosition.LEFT },
      { cardId: saintSnowTarget.instanceId, slot: SlotPosition.CENTER },
      { cardId: swapped.instanceId, slot: SlotPosition.RIGHT },
    ]);
    game = { ...game, pendingAbilities: [pending(source.instanceId)] };

    let state = startEffect(game);
    state = chooseOption(state, 'saintsnow-position-change');
    state = chooseCard(state, saintSnowTarget.instanceId);
    state = chooseSlot(state, SlotPosition.RIGHT);
    const player = state.players.find((candidate) => candidate.id === PLAYER1)!;
    const movedEvents = state.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED);

    expect(player.memberSlots.slots[SlotPosition.CENTER]).toBe(swapped.instanceId);
    expect(player.memberSlots.slots[SlotPosition.RIGHT]).toBe(saintSnowTarget.instanceId);
    expect(movedEvents).toEqual([
      expect.objectContaining({
        cardInstanceId: saintSnowTarget.instanceId,
        fromSlot: SlotPosition.CENTER,
        toSlot: SlotPosition.RIGHT,
        swappedCardInstanceId: swapped.instanceId,
      }),
      expect.objectContaining({
        cardInstanceId: swapped.instanceId,
        fromSlot: SlotPosition.RIGHT,
        toSlot: SlotPosition.CENTER,
        swappedCardInstanceId: saintSnowTarget.instanceId,
      }),
    ]);
  });

  it('consumes the pending ability as no-op when no branch has a legal target', () => {
    const source = instance(member('PL!S-bp5-004-R', { name: '黒澤ダイヤ' }), 'dia-source');
    let game = registerCards(
      createGameState('s-bp5-004-dia-no-target', PLAYER1, 'P1', PLAYER2, 'P2'),
      [source]
    );
    game = placeStageMembers(game, [{ cardId: source.instanceId, slot: SlotPosition.CENTER }]);
    game = { ...game, pendingAbilities: [pending(source.instanceId)] };

    const state = startEffect(game);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(latestPayload(state)).toMatchObject({
      step: 'NO_LEGAL_BRANCH',
    });
  });

  it('safely consumes a stale Aqours target selection without applying BLADE', () => {
    const source = instance(member('PL!S-bp5-004-R', { name: '黒澤ダイヤ' }), 'dia-source');
    const aqoursTarget = instance(
      member('PL!S-test-aqours', { name: 'Aqours target', groupNames: ['Aqours'] }),
      'aqours-target'
    );
    let game = registerCards(
      createGameState('s-bp5-004-dia-stale-target', PLAYER1, 'P1', PLAYER2, 'P2'),
      [source, aqoursTarget]
    );
    game = placeStageMembers(game, [
      { cardId: source.instanceId, slot: SlotPosition.CENTER },
      { cardId: aqoursTarget.instanceId, slot: SlotPosition.LEFT },
    ]);
    game = { ...game, pendingAbilities: [pending(source.instanceId)] };

    let state = startEffect(game);
    state = chooseOption(state, 'aqours-blade');
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    state = chooseCard(state, aqoursTarget.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(state.liveResolution.liveModifiers).not.toContainEqual(
      expect.objectContaining({
        kind: 'BLADE',
        sourceCardId: aqoursTarget.instanceId,
      })
    );
    expect(latestPayload(state)).toMatchObject({
      step: 'AQOURS_BLADE_TARGET_UNAVAILABLE',
      targetMemberCardId: aqoursTarget.instanceId,
    });
  });
});
