import { describe, expect, it } from 'vitest';
import { addAction, createGameState, emitGameEvent } from '../../src/domain/entities/game';
import {
  createEnterLiveZoneEvent,
  createTurnStartEvent,
  createTurnEndEvent,
} from '../../src/domain/events/game-events';
import { FaceState, ZoneType } from '../../src/shared/types/enums';
import {
  getCurrentTurnLiveZoneEntries,
  getCurrentTurnSetLiveEntryEventId,
} from '../../src/application/effects/current-turn-live-zone-entries';

function base() {
  return createGameState('entries', 'p1', 'P1', 'p2', 'P2');
}
function entry(game = base(), id = 'a', from = ZoneType.HAND, player = 'p1', normalSet = false) {
  const event = createEnterLiveZoneEvent(id, from, player, player, FaceState.FACE_DOWN);
  const state = normalSet ? addAction(game, 'SET_LIVE_CARD', player, { cardId: id }) : game;
  return {
    event,
    state: emitGameEvent(
      state,
      event,
      normalSet ? { causedByActionId: state.actionHistory.at(-1)!.id } : {}
    ),
  };
}
describe('current-turn LIVE entry occurrences and exact SET cancellation', () => {
  it('counts SET once and cancels only its exact occurrence', () => {
    const a = entry(base(), 'a', ZoneType.HAND, 'p1', true);
    expect(getCurrentTurnLiveZoneEntries(a.state, 'p1')).toHaveLength(1);
    expect(getCurrentTurnSetLiveEntryEventId(a.state, 'p1', 'a')).toBe(a.event.eventId);
    const cancelled = addAction(a.state, 'UNSET_LIVE_CARD', 'p1', {
      cardId: 'a',
      entryEventId: a.event.eventId,
    });
    expect(getCurrentTurnLiveZoneEntries(cancelled, 'p1')).toHaveLength(0);
    const again = entry(cancelled, 'a', ZoneType.HAND, 'p1', true);
    expect(getCurrentTurnLiveZoneEntries(again.state, 'p1').map((x) => x.event.eventId)).toEqual([
      again.event.eventId,
    ]);
  });
  it('counts multiple entries of the same card, including effect departure and re-entry', () => {
    const a = entry();
    const b = entry(a.state, 'a', ZoneType.WAITING_ROOM);
    expect(getCurrentTurnLiveZoneEntries(b.state, 'p1')).toHaveLength(2);
    expect(getCurrentTurnSetLiveEntryEventId(b.state, 'p1', 'a')).toBeNull();
  });
  it('does not infer SET linkage from card IDs or unlinked action history', () => {
    const state = addAction(base(), 'SET_LIVE_CARD', 'p1', { cardId: 'a' });
    expect(getCurrentTurnSetLiveEntryEventId(entry(state).state, 'p1', 'a')).toBeNull();
  });
  it('ignores opponent entries and intra-LIVE rearrangement', () => {
    let state = entry(base(), 'opponent', ZoneType.HAND, 'p2').state;
    state = entry(state, 'internal', ZoneType.LIVE_ZONE).state;
    expect(getCurrentTurnLiveZoneEntries(state, 'p1')).toHaveLength(0);
  });
  it('retains ordinary FREE returns and ignores malformed cancellation references', () => {
    let state = entry(base(), 'a', ZoneType.HAND, 'p1', true).state;
    state = addAction(state, 'MOVE_CARD', 'p1', { cardId: 'a', toZone: ZoneType.HAND });
    state = addAction(state, 'UNSET_LIVE_CARD', 'p2', {
      cardId: 'a',
      entryEventId: state.eventLog[0].event.eventId,
    });
    state = addAction(state, 'UNSET_LIVE_CARD', 'p1', { cardId: 'a', entryEventId: 'wrong' });
    expect(getCurrentTurnLiveZoneEntries(state, 'p1')).toHaveLength(1);
  });
  it('clears the count at authoritative turn boundaries and survives structured-clone rehydration', () => {
    const old = entry(base(), 'old', ZoneType.HAND, 'p1', true).state;
    const ended = emitGameEvent(old, createTurnEndEvent(1, 'p1'));
    expect(getCurrentTurnLiveZoneEntries(ended, 'p1')).toHaveLength(0);
    const current = entry(
      emitGameEvent(ended, createTurnStartEvent(2, 'p2')),
      'new',
      ZoneType.HAND,
      'p1',
      true
    );
    const rehydrated = structuredClone(current.state);
    expect(getCurrentTurnLiveZoneEntries(rehydrated, 'p1')).toHaveLength(1);
    expect(getCurrentTurnSetLiveEntryEventId(rehydrated, 'p1', 'new')).toBe(current.event.eventId);
  });
});
