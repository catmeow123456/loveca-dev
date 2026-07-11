import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  addAction,
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
import { PL_BP3_005_ON_ENTER_ACTIVATE_ALL_STAGE_MEMBERS_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { resolvePlBp3005RinOnEnter } from '../../src/application/card-effects/workflows/cards/pl-bp3-005-rin';
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

function member(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function pending(id: string, sourceCardId: string): PendingAbilityState {
  return {
    id,
    abilityId: PL_BP3_005_ON_ENTER_ACTIVATE_ALL_STAGE_MEMBERS_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`event-${id}`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: {
  readonly sourceOnStage?: boolean;
  readonly sourceOrientation?: OrientationState;
  readonly leftOrientation?: OrientationState;
  readonly rightOrientation?: OrientationState;
  readonly pendingCount?: number;
} = {}) {
  const source = createCardInstance(
    member('PL!-bp3-005-P', '星空 凛'),
    PLAYER1,
    'rin-source'
  );
  const left = createCardInstance(member('TEST-LEFT', '左侧成员'), PLAYER1, 'left-member');
  const right = createCardInstance(member('TEST-RIGHT', '右侧成员'), PLAYER1, 'right-member');
  let game = createGameState('pl-bp3-005-rin', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, left, right]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, left.instanceId, {
      orientation: options.leftOrientation ?? OrientationState.WAITING,
      face: FaceState.FACE_UP,
    });
    if (options.sourceOnStage !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: options.sourceOrientation ?? OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
    }
    memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, right.instanceId, {
      orientation: options.rightOrientation ?? OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    return {
      ...player,
      memberSlots,
      waitingRoom:
        options.sourceOnStage === false
          ? { ...player.waitingRoom, cardIds: [source.instanceId] }
          : player.waitingRoom,
    };
  });
  game = {
    ...game,
    pendingAbilities: Array.from({ length: options.pendingCount ?? 1 }, (_, index) =>
      pending(`rin-pending-${index + 1}`, source.instanceId)
    ),
  };
  return { game, source, left, right };
}

function orientation(game: GameState, cardId: string): OrientationState | undefined {
  return game.players[0].memberSlots.cardStates.get(cardId)?.orientation;
}

function stateChangedEvents(game: GameState) {
  return game.eventLog
    .map((entry) => entry.event)
    .filter((event) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED);
}

describe('PL!-bp3-005 星空凛 workflow', () => {
  it('activates every current stage member, including the source, while preserving active members', () => {
    const { game, source, left, right } = setup();

    const resolved = resolvePendingCardEffects(game).gameState;

    expect(orientation(resolved, source.instanceId)).toBe(OrientationState.ACTIVE);
    expect(orientation(resolved, left.instanceId)).toBe(OrientationState.ACTIVE);
    expect(orientation(resolved, right.instanceId)).toBe(OrientationState.ACTIVE);
    expect(stateChangedEvents(resolved).map((event) => event.cardInstanceId)).toEqual([
      left.instanceId,
      source.instanceId,
    ]);
    expect(new Set(stateChangedEvents(resolved).map((event) => event.eventId)).size).toBe(2);
  });

  it('emits one event only for each real WAITING to ACTIVE change and no fake event when all are active', () => {
    const mixed = setup({ sourceOrientation: OrientationState.ACTIVE });
    const mixedResolved = resolvePendingCardEffects(mixed.game).gameState;
    expect(stateChangedEvents(mixedResolved).map((event) => event.cardInstanceId)).toEqual([
      mixed.left.instanceId,
    ]);
    expect(stateChangedEvents(mixedResolved)[0]).toMatchObject({
      previousOrientation: OrientationState.WAITING,
      nextOrientation: OrientationState.ACTIVE,
      cause: {
        kind: 'CARD_EFFECT',
        abilityId: PL_BP3_005_ON_ENTER_ACTIVATE_ALL_STAGE_MEMBERS_ABILITY_ID,
      },
    });

    const allActive = setup({
      sourceOrientation: OrientationState.ACTIVE,
      leftOrientation: OrientationState.ACTIVE,
      rightOrientation: OrientationState.ACTIVE,
    });
    const activeResolved = resolvePendingCardEffects(allActive.game).gameState;
    expect(stateChangedEvents(activeResolved)).toEqual([]);
    expect(activeResolved.pendingAbilities).toEqual([]);
    expect(
      activeResolved.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP3_005_ON_ENTER_ACTIVATE_ALL_STAGE_MEMBERS_ABILITY_ID
      )?.payload.activatedMemberCardIds
    ).toEqual([]);
  });

  it('still resolves against the current stage after the source has left', () => {
    const { game, source, left, right } = setup({ sourceOnStage: false });

    const resolved = resolvePendingCardEffects(game).gameState;

    expect(resolved.players[0].waitingRoom.cardIds).toContain(source.instanceId);
    expect(orientation(resolved, left.instanceId)).toBe(OrientationState.ACTIVE);
    expect(orientation(resolved, right.instanceId)).toBe(OrientationState.ACTIVE);
    expect(stateChangedEvents(resolved).map((event) => event.cardInstanceId)).toEqual([
      left.instanceId,
    ]);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('records this ability RESOLVE facts before explicitly enqueueing downstream state-change work', () => {
    const { game, source } = setup();
    const ability = game.pendingAbilities[0];
    let resolveWasRecordedBeforeEnqueue = false;
    let capturedEventIds: readonly string[] = [];

    const resolved = resolvePlBp3005RinOnEnter(
      game,
      ability,
      false,
      (state) => state,
      (state, triggerConditions, options) => {
        capturedEventIds = options?.memberStateChangedEvents?.map((event) => event.eventId) ?? [];
        resolveWasRecordedBeforeEnqueue = state.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.pendingAbilityId === ability.id &&
            action.payload.memberStateChangedEventIds?.every((eventId: string) =>
              capturedEventIds.includes(eventId)
            )
        );
        return addAction(state, 'TRIGGER_ABILITY', PLAYER1, {
          abilityId: 'DOWNSTREAM_STATE_CHANGE_ASSERTION',
          sourceCardId: source.instanceId,
          memberStateChangedEventIds: capturedEventIds,
          triggerConditions,
        });
      }
    );

    expect(capturedEventIds).toHaveLength(2);
    expect(resolveWasRecordedBeforeEnqueue).toBe(true);
    const resolveIndex = resolved.actionHistory.findIndex(
      (action) =>
        action.type === 'RESOLVE_ABILITY' && action.payload.pendingAbilityId === ability.id
    );
    const triggerIndex = resolved.actionHistory.findIndex(
      (action) => action.payload.abilityId === 'DOWNSTREAM_STATE_CHANGE_ASSERTION'
    );
    expect(resolveIndex).toBeGreaterThanOrEqual(0);
    expect(triggerIndex).toBeGreaterThan(resolveIndex);
  });

  it('continues multiple pending abilities without losing or repeating either resolution', () => {
    const { game } = setup({ pendingCount: 2 });
    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);

    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === PL_BP3_005_ON_ENTER_ACTIVATE_ALL_STAGE_MEMBERS_ABILITY_ID &&
          action.payload.step === 'ACTIVATE_ALL_STAGE_MEMBERS'
      )
    ).toHaveLength(2);
    expect(stateChangedEvents(resolved)).toHaveLength(2);
  });
});
