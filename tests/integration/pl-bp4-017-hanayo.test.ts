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
import { BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function activateWaitSelfCost(game: GameState): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    null,
    null,
    undefined,
    'activate'
  );
}

function createMemberData(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ["μ's"],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createMember(
  cardCode: string,
  instanceId: string,
  options: Parameters<typeof createMemberData>[1] = {},
  ownerId = PLAYER1
) {
  return createCardInstance(createMemberData(cardCode, options), ownerId, instanceId);
}

function setupState(
  options: {
    readonly sourceInStage?: boolean;
    readonly sourceOrientation?: OrientationState;
    readonly centerKind?: 'muse' | 'non-muse' | 'empty';
  } = {}
) {
  const source = createMember('PL!-bp4-017-N', 'bp4-017-source', {
    name: '小泉花陽',
    cost: 2,
  });
  const center = createMember('PL!-center-muse', 'bp4-017-center-muse', {
    name: '高坂穂乃果',
    cost: 7,
  });
  const nonMuseCenter = createMember('PL!S-center-non-muse', 'bp4-017-center-non-muse', {
    name: '高海千歌',
    cost: 7,
    groupNames: ['Aqours'],
  });

  let game = createGameState('pl-bp4-017-hanayo', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, center, nonMuseCenter]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    if (options.sourceInStage !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, source.instanceId, {
        orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (options.centerKind !== 'empty') {
      const centerCard = options.centerKind === 'non-muse' ? nonMuseCenter : center;
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, centerCard.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return { ...player, memberSlots };
  });

  return { game, source, center, nonMuseCenter };
}

function startAbility(game: GameState, sourceCardId: string): GameState {
  const pendingAbility: PendingAbilityState = {
    id: 'bp4-017-pending',
    abilityId: BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
    sourceSlot: SlotPosition.LEFT,
  };
  return resolvePendingCardEffects({ ...game, pendingAbilities: [pendingAbility] }).gameState;
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID
    )
    .at(-1)?.payload;
}

function bladeModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'BLADE' &&
      modifier.abilityId === BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID
  );
}

describe('PL!-bp4-017 Hanayo live-start wait self for center Muse BLADE workflow', () => {
  it('waits the active source as cost and gives only the center μ’s member BLADE +1', () => {
    const scenario = setupState();
    const started = startAbility(scenario.game, scenario.source.instanceId);

    expect(started.activeEffect).toMatchObject({
      abilityId: BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID,
      awaitingPlayerId: PLAYER1,
      selectableOptions: [{ id: 'activate', label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(started.activeEffect?.selectableCardIds).toBeUndefined();

    const state = activateWaitSelfCost(started);

    expect(
      state.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      state.eventLog.some(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toBe(true);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            BP4_017_LIVE_START_WAIT_SELF_CENTER_MUSE_GAIN_BLADE_ABILITY_ID &&
          Array.isArray(action.payload.memberStateChangedEventIds) &&
          action.payload.memberStateChangedEventIds.length === 1
      )
    ).toBe(true);
    expect(bladeModifiers(state)).toEqual([
      expect.objectContaining({
        sourceCardId: scenario.center.instanceId,
        countDelta: 1,
      }),
    ]);
    expect(bladeModifiers(state)).not.toEqual([
      expect.objectContaining({ sourceCardId: scenario.source.instanceId }),
    ]);
    expect(latestPayload(state)).toMatchObject({
      step: 'WAIT_SELF_CENTER_MUSE_GAIN_BLADE',
      sourceCardId: scenario.source.instanceId,
      targetMemberCardId: scenario.center.instanceId,
      bladeBonus: 1,
    });
  });

  it('declines without waiting the source or adding BLADE', () => {
    const scenario = setupState();
    const started = startAbility(scenario.game, scenario.source.instanceId);
    const state = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);

    expect(
      state.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(bladeModifiers(state)).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      step: 'DECLINE_WAIT_SELF_COST',
    });
  });

  it('revalidates the fixed source when the player confirms activation', () => {
    const scenario = setupState();
    let state = startAbility(scenario.game, scenario.source.instanceId);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map(player.memberSlots.cardStates).set(scenario.source.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      },
    }));

    state = activateWaitSelfCost(state);

    expect(state.activeEffect).toBeNull();
    expect(bladeModifiers(state)).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      step: 'NO_OP_SOURCE_NOT_ACTIVE_STAGE_MEMBER_AFTER_SELECTION',
    });
  });

  it.each([
    { name: 'source already WAITING', options: { sourceOrientation: OrientationState.WAITING } },
    { name: 'source not on stage', options: { sourceInStage: false } },
  ])('consumes pending as no-op when $name', ({ options }) => {
    const scenario = setupState(options);
    const state = startAbility(scenario.game, scenario.source.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(bladeModifiers(state)).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      step: 'NO_OP_SOURCE_NOT_ACTIVE_STAGE_MEMBER',
    });
  });

  it.each([
    { name: 'no center member', centerKind: 'empty' as const },
    { name: 'center member is not μ’s', centerKind: 'non-muse' as const },
  ])('keeps the paid cost but does not add BLADE when $name', ({ centerKind }) => {
    const scenario = setupState({ centerKind });
    const started = startAbility(scenario.game, scenario.source.instanceId);
    const state = activateWaitSelfCost(started);

    expect(
      state.players[0].memberSlots.cardStates.get(scenario.source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(bladeModifiers(state)).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      step: 'NO_OP_NO_CENTER_MUSE_MEMBER_AFTER_COST',
      targetMemberCardId: null,
    });
  });
});
