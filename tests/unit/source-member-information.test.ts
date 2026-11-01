import { describe, expect, it } from 'vitest';
import { createCardInstance } from '../../src/domain/entities/card';
import {
  emitGameEvent,
  getCardById,
  getPlayerById,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  createEnterStageEvent,
  createLeaveStageEvent,
  type LeaveStageEvent,
} from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  addBladeLiveModifierForTargetMember,
  addMemberCostLiveModifierForMember,
} from '../../src/domain/rules/live-modifiers';
import { queryAbilitySourceMemberInformation } from '../../src/application/card-effects/runtime/source-member-information';
import { getStageMemberLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import {
  sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers,
  paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers,
} from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { playMemberFromZoneToStageSlotWithReplacement } from '../../src/application/card-effects/runtime/play-member-to-stage';
import { moveCardUniversal } from '../../src/application/action-handlers/zone-operations';
import { handlePlayMember } from '../../src/application/action-handlers/play-member.handler';
import type { ActionHandlerContext } from '../../src/application/action-handlers/types';
import { GameActionType } from '../../src/application/actions';
import { SP_PR_033_LIVE_SUCCESS_DISCARD_RECOVER_LIELLA_CHEER_BY_SOURCE_BLADE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { SlotPosition, TriggerCondition, ZoneType } from '../../src/shared/types/enums';
import { createOctober31DraftCard } from '../helpers/october-31-draft-effects';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { gameWith, P1, stage, syntheticMember } from '../helpers/edelnote-effect-fixture';

function setup() {
  const source = createOctober31DraftCard('PL!SP-PR-033', P1, 'source');
  const incoming = syntheticMember('incoming', { cardCode: 'PL!SP-bp4-004-P', cost: 22 });
  const second = syntheticMember('second');
  let game = stage(
    stage(gameWith([source, incoming, second]), 'source'),
    'second',
    SlotPosition.LEFT
  );
  game = updatePlayer(game, P1, (p) => ({ ...p, hand: { ...p.hand, cardIds: ['incoming'] } }));
  game = emitGameEvent(
    game,
    createEnterStageEvent('source', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
  );
  game = addBladeLiveModifierForTargetMember(game, {
    playerId: P1,
    sourceCardId: 'second',
    targetMemberCardId: 'source',
    abilityId: 'test:blade',
    countDelta: 3,
  })!.gameState;
  game = addMemberCostLiveModifierForMember(game, {
    playerId: P1,
    memberCardId: 'source',
    sourceCardId: 'second',
    abilityId: 'test:cost',
    countDelta: 2,
  })!.gameState;
  return game;
}
function context(game: GameState) {
  return {
    abilityId: ABILITY,
    sourceCardId: 'source',
    controllerId: P1,
    sourceLifecycleId: getStageMemberLifecycleId(game, 'source'),
  };
}
const unchanged = (game: GameState) => game;
const ctx = { getPlayerById, getCardById } as ActionHandlerContext;
function leaves(game: GameState): LeaveStageEvent[] {
  return game.eventLog.flatMap(({ event }) =>
    event.eventType === TriggerCondition.ON_LEAVE_STAGE ? [event as LeaveStageEvent] : []
  );
}

describe('source member current / final information (rules 4.1.4 and 9.11)', () => {
  it('reads current effective values and preserves the object across slot movement', () => {
    let game = setup();
    const invocation = context(game);
    expect(queryAbilitySourceMemberInformation(game, invocation)).toEqual({
      effectiveBlade: 7,
      effectiveCost: 11,
    });
    game = moveCardUniversal(game, P1, 'source', ZoneType.MEMBER_SLOT, ZoneType.MEMBER_SLOT, {
      sourceSlot: SlotPosition.CENTER,
      targetSlot: SlotPosition.RIGHT,
    });
    expect(getStageMemberLifecycleId(game, 'source')).toBe(invocation.sourceLifecycleId);
    expect(leaves(game)).toEqual([]);
    expect(queryAbilitySourceMemberInformation(game, invocation)).toEqual({
      effectiveBlade: 7,
      effectiveCost: 11,
    });
  });

  it.each([
    'self-cost',
    'card-send',
    'manual-hand',
    'manual-replacement',
    'card-replacement',
    'relay',
    'duplicate',
    'double-relay',
  ] as const)('captures before mutation for the real %s exit path', (mode) => {
    const game = setup();
    const invocation = context(game);
    let result: GameState;
    if (mode === 'self-cost')
      result = paySourceMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
        game,
        P1,
        'source',
        unchanged
      )!.gameState;
    else if (mode === 'card-send')
      result = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
        game,
        P1,
        'source',
        unchanged
      )!.gameState;
    else if (mode === 'manual-hand')
      result = moveCardUniversal(game, P1, 'source', ZoneType.MEMBER_SLOT, ZoneType.HAND);
    else if (mode === 'manual-replacement')
      result = moveCardUniversal(game, P1, 'incoming', ZoneType.HAND, ZoneType.MEMBER_SLOT, {
        targetSlot: SlotPosition.CENTER,
      });
    else if (mode === 'card-replacement')
      result = playMemberFromZoneToStageSlotWithReplacement(game, P1, {
        cardId: 'incoming',
        sourceZone: ZoneType.HAND,
        toSlot: SlotPosition.CENTER,
      })!.gameState;
    else {
      const played = handlePlayMember(
        game,
        {
          type: GameActionType.PLAY_MEMBER,
          playerId: P1,
          timestamp: 0,
          cardId: 'incoming',
          targetSlot: SlotPosition.CENTER,
          isRelay: mode !== 'duplicate',
          relayMode: mode === 'duplicate' ? 'NONE' : mode === 'double-relay' ? 'DOUBLE' : 'SINGLE',
          relayReplacementSlots:
            mode === 'double-relay' ? [SlotPosition.CENTER, SlotPosition.LEFT] : undefined,
        },
        ctx
      );
      expect(played.success, played.error).toBe(true);
      result = played.gameState;
    }
    expect(
      leaves(result).find((e) => e.cardInstanceId === 'source')?.memberLastKnownInformation
    ).toEqual({ effectiveBlade: 7, effectiveCost: 11 });
    expect(queryAbilitySourceMemberInformation(structuredClone(result), invocation)).toEqual({
      effectiveBlade: 7,
      effectiveCost: 11,
    });
    if (mode === 'double-relay') {
      expect(leaves(result)).toHaveLength(2);
      expect(
        leaves(result).find((e) => e.cardInstanceId === 'second')?.memberLastKnownInformation
      ).toEqual({ effectiveBlade: 1, effectiveCost: 4 });
    }
  });

  it('matches the exact original entry across two later leaves and re-entries', () => {
    let game = setup();
    const first = context(game);
    game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      game,
      P1,
      'source',
      unchanged
    )!.gameState;
    game = { ...game, liveResolution: { ...game.liveResolution, liveModifiers: [] } };
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: [] },
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.RIGHT, 'source'),
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.RIGHT, P1, P1)
    );
    const second = context(game);
    expect(queryAbilitySourceMemberInformation(game, second)).toEqual({
      effectiveBlade: 4,
      effectiveCost: 9,
    });
    game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      game,
      P1,
      'source',
      unchanged
    )!.gameState;
    game = stage(game, 'source');
    game = emitGameEvent(
      game,
      createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
    game = addBladeLiveModifierForTargetMember(game, {
      playerId: P1,
      sourceCardId: 'second',
      targetMemberCardId: 'source',
      abilityId: 'new:blade',
      countDelta: 9,
    })!.gameState;
    expect(queryAbilitySourceMemberInformation(game, first)).toEqual({
      effectiveBlade: 7,
      effectiveCost: 11,
    });
    expect(queryAbilitySourceMemberInformation(game, second)).toEqual({
      effectiveBlade: 4,
      effectiveCost: 9,
    });
    expect(queryAbilitySourceMemberInformation(game, context(game))?.effectiveBlade).toBe(13);
  });

  it('does not substitute printed or current values when the old leave lacks a snapshot', () => {
    let game = setup();
    const invocation = context(game);
    game = moveCardUniversal(game, P1, 'source', ZoneType.MEMBER_SLOT, ZoneType.HAND);
    game = {
      ...game,
      eventLog: game.eventLog.map((record) =>
        record.event.eventType === TriggerCondition.ON_LEAVE_STAGE
          ? {
              ...record,
              event: createLeaveStageEvent('source', SlotPosition.CENTER, ZoneType.HAND, P1, P1),
            }
          : record
      ),
    };
    expect(queryAbilitySourceMemberInformation(game, invocation)).toBeNull();
  });

  it('preserves the exact old snapshot through current-format authority serialization and rehydration', () => {
    let game = setup();
    const invocation = context(game);
    game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      game,
      P1,
      'source',
      unchanged
    )!.gameState;
    game = stage(game, 'source', SlotPosition.RIGHT);
    game = emitGameEvent(
      game,
      createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.RIGHT, P1, P1)
    );
    const restored = rehydrateAuthorityGameState(
      serializeReplayPayload(game, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
    );
    expect(leaves(restored)[0].memberLastKnownInformation).toEqual({
      effectiveBlade: 7,
      effectiveCost: 11,
    });
    expect(queryAbilitySourceMemberInformation(restored, invocation)).toEqual({
      effectiveBlade: 7,
      effectiveCost: 11,
    });
    expect(getStageMemberLifecycleId(restored, 'source')).not.toBe(invocation.sourceLifecycleId);
  });
});
