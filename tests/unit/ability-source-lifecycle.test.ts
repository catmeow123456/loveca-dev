import { describe, expect, it } from 'vitest';
import {
  addAction,
  createGameState,
  emitGameEvent,
  type ActiveEffectState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  createEnterLiveZoneEvent,
  createEnterStageEvent,
  createLeaveStageEvent,
  createMemberSlotMovedEvent,
  createMemberStateChangedEvent,
} from '../../src/domain/events/game-events';
import {
  FaceState,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import {
  HANAYO_ACTIVATED_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
  S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID,
  SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  canUseAbilityThisTurn,
  getAbilityTurnLimitStatus,
} from '../../src/application/card-effects/runtime/ability-turn-limit';
import {
  capturePendingAbilitySourceLifecycles,
  getAbilitySourceLifecycleId,
  propagateAbilitySourceLifecycle,
} from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { recordAbilityUseForContext } from '../../src/application/card-effects/runtime/workflow-helpers';

const P1 = 'p1';
const P2 = 'p2';
const MEMBER_ID = 'member-source';
const OTHER_MEMBER_ID = 'member-source-copy';
const LIVE_ID = 'live-source';

function createState(id: string) {
  return createGameState(id, P1, 'P1', P2, 'P2');
}

function useMemberAbility(game: ReturnType<typeof createState>, sourceCardId = MEMBER_ID) {
  return recordAbilityUseForContext(game, P1, {
    abilityId: HANAYO_ACTIVATED_ABILITY_ID,
    sourceCardId,
  });
}

describe('per-turn ability source lifecycle', () => {
  it('uses a deterministic initial lifecycle and keeps different physical copies independent', () => {
    const initial = createState('ability-lifecycle-initial');
    const firstLifecycle = getAbilitySourceLifecycleId(
      initial,
      HANAYO_ACTIVATED_ABILITY_ID,
      MEMBER_ID
    );
    const repeatedLifecycle = getAbilitySourceLifecycleId(
      initial,
      HANAYO_ACTIVATED_ABILITY_ID,
      MEMBER_ID
    );
    expect(repeatedLifecycle).toBe(firstLifecycle);
    expect(firstLifecycle).toContain(`initial:STAGE_MEMBER:${MEMBER_ID}`);

    const used = useMemberAbility(initial);
    expect(canUseAbilityThisTurn(used, P1, HANAYO_ACTIVATED_ABILITY_ID, MEMBER_ID)).toBe(false);
    expect(canUseAbilityThisTurn(used, P1, HANAYO_ACTIVATED_ABILITY_ID, OTHER_MEMBER_ID)).toBe(
      true
    );
    expect(used.actionHistory.at(-1)?.payload.sourceLifecycleId).toBe(firstLifecycle);

    const unrestricted = recordAbilityUseForContext(initial, P1, {
      abilityId: HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
      sourceCardId: MEMBER_ID,
    });
    expect(unrestricted.actionHistory.at(-1)?.payload.sourceLifecycleId).toBeUndefined();
  });

  it('resets after a cross-zone stage re-entry but not after orientation or member-slot movement', () => {
    let game = createState('ability-lifecycle-stage-reentry');
    const firstEntry = createEnterStageEvent(MEMBER_ID, ZoneType.HAND, SlotPosition.CENTER, P1, P1);
    game = emitGameEvent(game, firstEntry);
    const firstLifecycle = getAbilitySourceLifecycleId(
      game,
      HANAYO_ACTIVATED_ABILITY_ID,
      MEMBER_ID
    );
    expect(
      getAbilitySourceLifecycleId(
        game,
        SP_BP7_005_AUTO_ENTER_OR_RETURN_PLACE_WAITING_ENERGY_ABILITY_ID,
        MEMBER_ID
      )
    ).toBe(firstLifecycle);
    game = useMemberAbility(game);

    game = emitGameEvent(
      game,
      createMemberStateChangedEvent(
        MEMBER_ID,
        P1,
        SlotPosition.CENTER,
        OrientationState.ACTIVE,
        OrientationState.WAITING
      )
    );
    game = emitGameEvent(
      game,
      createMemberSlotMovedEvent(MEMBER_ID, P1, SlotPosition.CENTER, SlotPosition.LEFT)
    );
    game = emitGameEvent(
      game,
      createEnterStageEvent(MEMBER_ID, ZoneType.MEMBER_SLOT, SlotPosition.RIGHT, P1, P1)
    );
    expect(getAbilitySourceLifecycleId(game, HANAYO_ACTIVATED_ABILITY_ID, MEMBER_ID)).toBe(
      firstLifecycle
    );
    expect(canUseAbilityThisTurn(game, P1, HANAYO_ACTIVATED_ABILITY_ID, MEMBER_ID)).toBe(false);

    game = emitGameEvent(
      game,
      createLeaveStageEvent(MEMBER_ID, SlotPosition.LEFT, ZoneType.WAITING_ROOM, P1, P1)
    );
    const secondEntry = createEnterStageEvent(
      MEMBER_ID,
      ZoneType.WAITING_ROOM,
      SlotPosition.CENTER,
      P1,
      P1
    );
    game = emitGameEvent(game, secondEntry);
    const secondLifecycle = getAbilitySourceLifecycleId(
      game,
      HANAYO_ACTIVATED_ABILITY_ID,
      MEMBER_ID
    );

    expect(secondLifecycle).not.toBe(firstLifecycle);
    expect(secondLifecycle).toContain(secondEntry.eventId);
    expect(canUseAbilityThisTurn(game, P1, HANAYO_ACTIVATED_ABILITY_ID, MEMBER_ID)).toBe(true);

    game = useMemberAbility(game);
    expect(canUseAbilityThisTurn(game, P1, HANAYO_ACTIVATED_ABILITY_ID, MEMBER_ID)).toBe(false);
    expect(
      game.actionHistory
        .filter((action) => action.payload.step === 'ABILITY_USE')
        .map((action) => action.payload.sourceLifecycleId)
    ).toEqual([firstLifecycle, secondLifecycle]);
  });

  it('keeps old pending and active reservations on the lifecycle captured at their trigger timing', () => {
    let game = createState('ability-lifecycle-pending-active');
    const firstEntry = createEnterStageEvent(MEMBER_ID, ZoneType.HAND, SlotPosition.CENTER, P1, P1);
    game = emitGameEvent(game, firstEntry);
    const triggerEvent = createMemberSlotMovedEvent(
      MEMBER_ID,
      P1,
      SlotPosition.CENTER,
      SlotPosition.LEFT
    );
    game = emitGameEvent(game, triggerEvent);

    const pendingAbility: PendingAbilityState = {
      id: 'pending-old-lifecycle',
      abilityId: HANAYO_ACTIVATED_ABILITY_ID,
      sourceCardId: MEMBER_ID,
      controllerId: P1,
      mandatory: true,
      timingId: TriggerCondition.ON_MEMBER_SLOT_MOVED,
      eventIds: [triggerEvent.eventId],
      sourceSlot: SlotPosition.LEFT,
    };
    game = addAction({ ...game, pendingAbilities: [pendingAbility] }, 'TRIGGER_ABILITY', P1, {
      pendingAbilityId: pendingAbility.id,
      abilityId: pendingAbility.abilityId,
      sourceCardId: pendingAbility.sourceCardId,
      eventId: triggerEvent.eventId,
    });
    game = capturePendingAbilitySourceLifecycles(game);
    const oldLifecycle = game.pendingAbilities[0]?.sourceLifecycleId;
    expect(oldLifecycle).toContain(firstEntry.eventId);
    expect(game.actionHistory.at(-1)?.payload.sourceLifecycleId).toBe(oldLifecycle);

    game = emitGameEvent(
      game,
      createLeaveStageEvent(MEMBER_ID, SlotPosition.LEFT, ZoneType.WAITING_ROOM, P1, P1)
    );
    game = emitGameEvent(
      game,
      createEnterStageEvent(MEMBER_ID, ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );

    expect(
      getAbilityTurnLimitStatus(game, P1, HANAYO_ACTIVATED_ABILITY_ID, MEMBER_ID)
    ).toMatchObject({
      used: 0,
      remaining: 1,
    });

    const oldActiveEffect: ActiveEffectState = {
      id: pendingAbility.id,
      abilityId: pendingAbility.abilityId,
      sourceCardId: pendingAbility.sourceCardId,
      sourceLifecycleId: oldLifecycle,
      controllerId: P1,
      effectText: 'test',
      stepId: 'TEST',
      stepText: 'test',
      awaitingPlayerId: P1,
    };
    game = {
      ...game,
      pendingAbilities: [],
      activeEffect: oldActiveEffect,
    };
    expect(
      getAbilityTurnLimitStatus(game, P1, HANAYO_ACTIVATED_ABILITY_ID, MEMBER_ID)
    ).toMatchObject({
      used: 0,
      remaining: 1,
    });

    const propagated = propagateAbilitySourceLifecycle(
      game,
      {
        ...game,
        activeEffect: {
          ...oldActiveEffect,
          sourceLifecycleId: undefined,
        },
      },
      {
        abilityId: pendingAbility.abilityId,
        sourceCardId: pendingAbility.sourceCardId,
        sourceLifecycleId: oldLifecycle,
        eventIds: pendingAbility.eventIds,
      }
    );
    expect(propagated.activeEffect?.sourceLifecycleId).toBe(oldLifecycle);
    expect(
      getAbilityTurnLimitStatus(propagated, P1, HANAYO_ACTIVATED_ABILITY_ID, MEMBER_ID)
    ).toMatchObject({ used: 0, remaining: 1 });

    const recordedAfterPendingRemoval = recordAbilityUseForContext(
      { ...game, activeEffect: null },
      P1,
      {
        abilityId: pendingAbility.abilityId,
        sourceCardId: pendingAbility.sourceCardId,
      }
    );
    expect(recordedAfterPendingRemoval.actionHistory.at(-1)?.payload.sourceLifecycleId).not.toBe(
      oldLifecycle
    );
    const correctedResolution = propagateAbilitySourceLifecycle(game, recordedAfterPendingRemoval, {
      abilityId: pendingAbility.abilityId,
      sourceCardId: pendingAbility.sourceCardId,
      sourceLifecycleId: oldLifecycle,
      eventIds: pendingAbility.eventIds,
    });
    expect(correctedResolution.actionHistory.at(-1)?.payload.sourceLifecycleId).toBe(oldLifecycle);
    expect(
      getAbilityTurnLimitStatus(correctedResolution, P1, HANAYO_ACTIVATED_ABILITY_ID, MEMBER_ID)
    ).toMatchObject({ used: 0, remaining: 1 });
  });

  it('patches only the current dispatch use and preserves a nested lifecycle use and active effect', () => {
    const before = createState('ability-lifecycle-nested-propagation');
    const oldLifecycle = 'source-lifecycle:event:old-entry';
    const newLifecycle = 'source-lifecycle:event:new-entry';
    const currentUse = addAction(before, 'RESOLVE_ABILITY', P1, {
      abilityId: HANAYO_ACTIVATED_ABILITY_ID,
      sourceCardId: MEMBER_ID,
      sourceLifecycleId: newLifecycle,
      step: 'ABILITY_USE',
      turnCount: before.turnCount,
    });
    const nestedUse = addAction(currentUse, 'RESOLVE_ABILITY', P1, {
      abilityId: HANAYO_ACTIVATED_ABILITY_ID,
      sourceCardId: MEMBER_ID,
      sourceLifecycleId: newLifecycle,
      pendingAbilityId: 'new-pending',
      step: 'ABILITY_USE',
      turnCount: before.turnCount,
    });
    const nestedActiveEffect: ActiveEffectState = {
      id: 'nested-new-lifecycle',
      abilityId: HANAYO_ACTIVATED_ABILITY_ID,
      sourceCardId: MEMBER_ID,
      sourceLifecycleId: newLifecycle,
      controllerId: P1,
      effectText: 'nested',
      stepId: 'NESTED',
      stepText: 'nested',
      awaitingPlayerId: P1,
    };

    const propagated = propagateAbilitySourceLifecycle(
      before,
      { ...nestedUse, activeEffect: nestedActiveEffect },
      {
        abilityId: HANAYO_ACTIVATED_ABILITY_ID,
        sourceCardId: MEMBER_ID,
        sourceLifecycleId: oldLifecycle,
        pendingAbilityId: 'old-pending',
      }
    );

    expect(propagated.actionHistory.map((action) => action.payload.sourceLifecycleId)).toEqual([
      oldLifecycle,
      newLifecycle,
    ]);
    expect(propagated.actionHistory.map((action) => action.payload.pendingAbilityId)).toEqual([
      'old-pending',
      'new-pending',
    ]);
    expect(propagated.activeEffect?.sourceLifecycleId).toBe(newLifecycle);
  });

  it('does not claim a nested pending use when the outer pending writes no use', () => {
    const before = createState('ability-lifecycle-outer-no-op');
    const newLifecycle = 'source-lifecycle:event:new-entry';
    const nestedOnly = addAction(before, 'RESOLVE_ABILITY', P1, {
      abilityId: HANAYO_ACTIVATED_ABILITY_ID,
      sourceCardId: MEMBER_ID,
      sourceLifecycleId: newLifecycle,
      pendingAbilityId: 'new-pending',
      step: 'ABILITY_USE',
      turnCount: before.turnCount,
    });

    const propagated = propagateAbilitySourceLifecycle(before, nestedOnly, {
      abilityId: HANAYO_ACTIVATED_ABILITY_ID,
      sourceCardId: MEMBER_ID,
      sourceLifecycleId: 'source-lifecycle:event:old-entry',
      pendingAbilityId: 'old-pending',
    });

    expect(propagated.actionHistory.at(-1)?.payload).toMatchObject({
      sourceLifecycleId: newLifecycle,
      pendingAbilityId: 'new-pending',
    });

    const unownedOuter = propagateAbilitySourceLifecycle(before, nestedOnly, {
      abilityId: HANAYO_ACTIVATED_ABILITY_ID,
      sourceCardId: MEMBER_ID,
      sourceLifecycleId: 'source-lifecycle:event:activated-outer',
    });
    expect(unownedOuter.actionHistory.at(-1)?.payload).toMatchObject({
      sourceLifecycleId: newLifecycle,
      pendingAbilityId: 'new-pending',
    });
  });

  it('uses ON_ENTER_LIVE_ZONE lifecycles and ignores LIVE_ZONE to LIVE_ZONE movement', () => {
    let game = createState('ability-lifecycle-live');
    const firstEntry = createEnterLiveZoneEvent(LIVE_ID, ZoneType.HAND, P1, P1, FaceState.FACE_UP);
    game = emitGameEvent(game, firstEntry);
    const firstLifecycle = getAbilitySourceLifecycleId(
      game,
      S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID,
      LIVE_ID
    );
    game = recordAbilityUseForContext(game, P1, {
      abilityId: S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID,
      sourceCardId: LIVE_ID,
    });
    expect(
      canUseAbilityThisTurn(
        game,
        P1,
        S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID,
        LIVE_ID
      )
    ).toBe(false);

    game = emitGameEvent(
      game,
      createEnterLiveZoneEvent(LIVE_ID, ZoneType.LIVE_ZONE, P1, P1, FaceState.FACE_UP)
    );
    expect(
      getAbilitySourceLifecycleId(
        game,
        S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID,
        LIVE_ID
      )
    ).toBe(firstLifecycle);

    const secondEntry = createEnterLiveZoneEvent(
      LIVE_ID,
      ZoneType.WAITING_ROOM,
      P1,
      P1,
      FaceState.FACE_UP
    );
    game = emitGameEvent(game, secondEntry);
    expect(
      getAbilitySourceLifecycleId(
        game,
        S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID,
        LIVE_ID
      )
    ).toContain(secondEntry.eventId);
    expect(
      canUseAbilityThisTurn(
        game,
        P1,
        S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID,
        LIVE_ID
      )
    ).toBe(true);
  });
});
