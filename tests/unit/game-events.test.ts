import { describe, expect, it } from 'vitest';
import { createGameState, emitGameEvent } from '../../src/domain/entities/game';
import {
  createCheerEvent,
  createDrawEvent,
  createEnterStageEvent,
  createLeaveStageEvent,
  createLiveStartEvent,
  createLiveSuccessEvent,
  createMemberStateChangedEvent,
} from '../../src/domain/events/game-events';
import {
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

describe('game event log', () => {
  it('starts empty on a new game state', () => {
    const game = createGameState('event-log-empty', 'p1', 'P1', 'p2', 'P2');

    expect(game.eventLog).toEqual([]);
    expect(game.eventSequence).toBe(0);
  });

  it('appends events without mutating the previous game state', () => {
    const game = createGameState('event-log-append', 'p1', 'P1', 'p2', 'P2');
    const event = createDrawEvent('p1', ['card-1', 'card-2'], 2);

    const nextGame = emitGameEvent(game, event);

    expect(game.eventLog).toEqual([]);
    expect(game.eventSequence).toBe(0);
    expect(nextGame).not.toBe(game);
    expect(nextGame.eventLog).toHaveLength(1);
    expect(nextGame.eventLog[0]).toEqual({
      sequence: 1,
      event,
      causedByActionId: undefined,
    });
    expect(nextGame.eventSequence).toBe(1);
  });

  it('keeps stable sequence order and optional action causality', () => {
    let game = createGameState('event-log-sequence', 'p1', 'P1', 'p2', 'P2');
    const drawEvent = createDrawEvent('p1', ['card-1'], 1);
    const enterStageEvent = createEnterStageEvent(
      'member-1',
      ZoneType.HAND,
      SlotPosition.CENTER,
      'p1',
      'p1'
    );

    game = emitGameEvent(game, drawEvent, { causedByActionId: 'action-1' });
    game = emitGameEvent(game, enterStageEvent, { causedByActionId: 'action-2' });

    expect(game.eventLog.map((entry) => entry.sequence)).toEqual([1, 2]);
    expect(game.eventLog.map((entry) => entry.event.eventId)).toEqual([
      drawEvent.eventId,
      enterStageEvent.eventId,
    ]);
    expect(game.eventLog.map((entry) => entry.causedByActionId)).toEqual([
      'action-1',
      'action-2',
    ]);
    expect(game.eventSequence).toBe(2);
  });

  it('does not write standard events into action history', () => {
    const game = createGameState('event-log-action-history', 'p1', 'P1', 'p2', 'P2');

    const nextGame = emitGameEvent(game, createDrawEvent('p1', ['card-1'], 1));

    expect(nextGame.actionHistory).toEqual([]);
    expect(nextGame.actionSequence).toBe(0);
  });

  it('records live start event facts for trigger matching', () => {
    const event = createLiveStartEvent('p1', ['live-1', 'live-2']);

    expect(event).toMatchObject({
      eventType: TriggerCondition.ON_LIVE_START,
      performerId: 'p1',
      liveCardIds: ['live-1', 'live-2'],
      triggerPlayerId: 'p1',
    });
  });

  it('records live success event facts for trigger matching', () => {
    const event = createLiveSuccessEvent('p1', ['live-1', 'live-2'], 6);

    expect(event).toMatchObject({
      eventType: TriggerCondition.ON_LIVE_SUCCESS,
      playerId: 'p1',
      successfulLiveCardIds: ['live-1', 'live-2'],
      score: 6,
      triggerPlayerId: 'p1',
    });
  });

  it('records cheer event facts for trigger matching', () => {
    const event = createCheerEvent('p1', ['cheer-1', 'cheer-2'], 2, {
      automated: true,
      additional: true,
    });

    expect(event).toMatchObject({
      eventType: TriggerCondition.ON_CHEER,
      playerId: 'p1',
      revealedCardIds: ['cheer-1', 'cheer-2'],
      totalBlade: 2,
      automated: true,
      additional: true,
      triggerPlayerId: 'p1',
    });
  });

  it('records member state changed event facts and cause context', () => {
    const event = createMemberStateChangedEvent(
      'member-1',
      'p2',
      SlotPosition.LEFT,
      OrientationState.ACTIVE,
      OrientationState.WAITING,
      {
        kind: 'CARD_EFFECT',
        playerId: 'p1',
        sourceCardId: 'source-member',
        abilityId: 'ability-1',
        pendingAbilityId: 'pending-1',
      }
    );

    expect(event).toMatchObject({
      eventType: TriggerCondition.ON_MEMBER_STATE_CHANGED,
      cardInstanceId: 'member-1',
      controllerId: 'p2',
      slot: SlotPosition.LEFT,
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
      triggerPlayerId: 'p2',
      cause: {
        kind: 'CARD_EFFECT',
        playerId: 'p1',
        sourceCardId: 'source-member',
        abilityId: 'ability-1',
        pendingAbilityId: 'pending-1',
      },
    });
  });

  it('keeps relay replacement context on leave-stage events', () => {
    const event = createLeaveStageEvent(
      'leaving-member',
      SlotPosition.CENTER,
      ZoneType.WAITING_ROOM,
      'p1',
      'p1',
      'replacing-member'
    );

    expect(event.eventType).toBe('ON_LEAVE_STAGE');
    expect(event.fromSlot).toBe(SlotPosition.CENTER);
    expect(event.toZone).toBe(ZoneType.WAITING_ROOM);
    expect(event.replacingCardId).toBe('replacing-member');
  });
});
