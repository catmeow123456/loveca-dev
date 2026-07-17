import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { resolveLiveZoneToWaitingRoomTriggers } from '../../src/application/effects/live-zone-waiting-room-triggers';
import { selectNoBladeHeartMemberCardIdsMovedFromLiveZoneToWaitingThisTurn } from '../../src/domain/rules/member-turn-state';
import { CardType, HeartColor, TriggerCondition, ZoneType } from '../../src/shared/types/enums';

function member(code: string): MemberCardData {
  return {
    cardCode: code,
    name: code,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

describe('LIVE_ZONE to WAITING_ROOM event persistence', () => {
  it('writes one standard event per owner/controller batch with complete moved ids', () => {
    const p1a = createCardInstance(member('P1-A'), 'p1', 'p1-a');
    const p1b = createCardInstance(member('P1-B'), 'p1', 'p1-b');
    const p2a = createCardInstance(member('P2-A'), 'p2', 'p2-a');
    let game = registerCards(createGameState('live-wait-events', 'p1', 'P1', 'p2', 'P2'), [
      p1a,
      p1b,
      p2a,
    ]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [p1a.instanceId, p1b.instanceId] },
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [p2a.instanceId] },
    }));

    const state = resolveLiveZoneToWaitingRoomTriggers(game, [
      p1a.instanceId,
      p1b.instanceId,
      p2a.instanceId,
    ]);
    const events = state.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      fromZone: ZoneType.LIVE_ZONE,
      toZone: ZoneType.WAITING_ROOM,
      ownerId: 'p1',
      controllerId: 'p1',
      cardInstanceId: p1a.instanceId,
      cardInstanceIds: [p1a.instanceId, p1b.instanceId],
    });
    expect(events[1]).toMatchObject({
      ownerId: 'p2',
      controllerId: 'p2',
      cardInstanceId: p2a.instanceId,
      cardInstanceIds: [p2a.instanceId],
    });

    const stateAfterLeavingWaiting = updatePlayer(state, 'p1', (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
    }));
    expect(
      selectNoBladeHeartMemberCardIdsMovedFromLiveZoneToWaitingThisTurn(
        stateAfterLeavingWaiting,
        'p1'
      )
    ).toEqual([p1a.instanceId, p1b.instanceId]);
  });

  it('does not write events for empty, unknown, duplicate, or stale ids', () => {
    const valid = createCardInstance(member('VALID'), 'p1', 'valid');
    const stale = createCardInstance(member('STALE'), 'p1', 'stale');
    let game = registerCards(createGameState('live-wait-stale', 'p1', 'P1', 'p2', 'P2'), [
      valid,
      stale,
    ]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [valid.instanceId] },
    }));

    const state = resolveLiveZoneToWaitingRoomTriggers(game, [
      valid.instanceId,
      valid.instanceId,
      stale.instanceId,
      'unknown',
    ]);

    expect(state.eventLog).toHaveLength(1);
    expect(state.eventLog[0].event).toMatchObject({ cardInstanceIds: [valid.instanceId] });
    expect(resolveLiveZoneToWaitingRoomTriggers(game, []).eventLog).toEqual([]);
  });
});
