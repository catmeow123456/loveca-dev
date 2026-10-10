import { describe, expect, it } from 'vitest';
import { createGameState, emitGameEvent, type GameState } from '../../src/domain/entities/game';
import {
  createEnterStageEvent,
  createLeaveStageEvent,
  createLiveStartEvent,
  createTurnEndEvent,
  createTurnStartEvent,
} from '../../src/domain/events/game-events';
import { SlotPosition, ZoneType } from '../../src/shared/types/enums';
import { getStageMemberEntryAtTriggerThisTurn } from '../../src/application/effects/relay-entry-provenance';

const enter = (fromZone = ZoneType.HAND) =>
  createEnterStageEvent('source', fromZone, SlotPosition.CENTER, 'p1', 'p1', {
    relayReplacements: [
      { cardId: 'a', slot: SlotPosition.CENTER, effectiveCost: 7 },
      { cardId: 'b', slot: SlotPosition.LEFT, effectiveCost: 5 },
    ],
  });
function reference(game: GameState) {
  const event = createLiveStartEvent('p1', []);
  return { game: emitGameEvent(game, event), eventIds: [event.eventId] };
}
const initial = () => createGameState('provenance', 'p1', 'P1', 'p2', 'P2');

describe('stage-member entry provenance at a trigger', () => {
  it('recovers the entry for the source object at the reference, excluding later re-entry', () => {
    const entry = enter();
    const trigger = reference(emitGameEvent(initial(), entry));
    let game = emitGameEvent(
      trigger.game,
      createLeaveStageEvent('source', SlotPosition.CENTER, ZoneType.WAITING_ROOM, 'p1', 'p1')
    );
    game = emitGameEvent(
      game,
      createEnterStageEvent('source', ZoneType.WAITING_ROOM, SlotPosition.RIGHT, 'p1', 'p1')
    );
    expect(getStageMemberEntryAtTriggerThisTurn(game, 'source', 'p1', trigger.eventIds)).toBe(
      entry
    );
    const later = reference(game);
    expect(
      getStageMemberEntryAtTriggerThisTurn(later.game, 'source', 'p1', later.eventIds)
        ?.relayReplacements
    ).toBeUndefined();
  });

  it.each(['start', 'end'] as const)(
    'does not borrow an entry before a turn %s boundary',
    (boundary) => {
      const old = emitGameEvent(initial(), enter());
      const game = emitGameEvent(
        old,
        boundary === 'start' ? createTurnStartEvent(2, 'p2') : createTurnEndEvent(1, 'p1')
      );
      const trigger = reference(game);
      expect(
        getStageMemberEntryAtTriggerThisTurn(trigger.game, 'source', 'p1', trigger.eventIds)
      ).toBeNull();
    }
  );

  it('keeps slot movement on the same object but rejects a source that left before the trigger', () => {
    const entry = enter();
    let game = emitGameEvent(initial(), entry);
    game = emitGameEvent(game, enter(ZoneType.MEMBER_SLOT));
    const first = reference(game);
    expect(getStageMemberEntryAtTriggerThisTurn(first.game, 'source', 'p1', first.eventIds)).toBe(
      entry
    );
    const gone = reference(
      emitGameEvent(
        first.game,
        createLeaveStageEvent('source', SlotPosition.CENTER, ZoneType.WAITING_ROOM, 'p1', 'p1')
      )
    );
    expect(
      getStageMemberEntryAtTriggerThisTurn(gone.game, 'source', 'p1', gone.eventIds)
    ).toBeNull();
  });

  it('requires real reference facts, the exact card instance, and the matching controller', () => {
    const trigger = reference(emitGameEvent(initial(), enter()));
    for (const ids of [undefined, [], ['unknown'], [...trigger.eventIds, 'unknown']]) {
      expect(getStageMemberEntryAtTriggerThisTurn(trigger.game, 'source', 'p1', ids)).toBeNull();
    }
    expect(
      getStageMemberEntryAtTriggerThisTurn(trigger.game, 'another', 'p1', trigger.eventIds)
    ).toBeNull();
    expect(
      getStageMemberEntryAtTriggerThisTurn(trigger.game, 'source', 'p2', trigger.eventIds)
    ).toBeNull();
  });
});
