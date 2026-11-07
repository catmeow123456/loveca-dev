import { describe, expect, it } from 'vitest';
import { hasWaitingRoomSelectionReenteredAfter } from '../../src/application/effects/waiting-room-selection-lifecycle';
import { createGameState, emitGameEvent } from '../../src/domain/entities/game';
import { createEnterWaitingRoomEvent } from '../../src/domain/events/game-events';
import { ZoneType } from '../../src/shared/types/enums';

describe('waiting-room selection rules-object identity', () => {
  it('matches either the single or grouped event card and only events after the captured sequence', () => {
    const initial = createGameState('waiting-identity', 'p1', 'P1', 'p2', 'P2');
    const old = emitGameEvent(
      initial,
      createEnterWaitingRoomEvent(['target'], ZoneType.HAND, 'p1', 'p1')
    );
    const sequence = old.eventLog.at(-1)!.sequence;
    expect(hasWaitingRoomSelectionReenteredAfter(old, ['target'], sequence)).toBe(false);
    const grouped = emitGameEvent(
      old,
      createEnterWaitingRoomEvent(['other', 'target'], ZoneType.HAND, 'p1', 'p1')
    );
    expect(hasWaitingRoomSelectionReenteredAfter(grouped, ['target'], sequence)).toBe(true);
    expect(hasWaitingRoomSelectionReenteredAfter(grouped, ['unrelated'], sequence)).toBe(false);
    const rearranged = emitGameEvent(
      old,
      createEnterWaitingRoomEvent(['target'], ZoneType.WAITING_ROOM, 'p1', 'p1')
    );
    expect(hasWaitingRoomSelectionReenteredAfter(rearranged, ['target'], sequence)).toBe(false);
    const event = createEnterWaitingRoomEvent(['target'], ZoneType.HAND, 'p1', 'p1');
    const { cardInstanceIds: ignored, ...single } = event;
    expect(
      hasWaitingRoomSelectionReenteredAfter(emitGameEvent(old, single), ['target'], sequence)
    ).toBe(true);
  });
  it('rejects a missing or invalid capture instead of granting an unbound restored selection', () => {
    const game = createGameState('waiting-identity', 'p1', 'P1', 'p2', 'P2');
    expect(hasWaitingRoomSelectionReenteredAfter(game, ['target'], undefined)).toBe(true);
    expect(hasWaitingRoomSelectionReenteredAfter(game, ['target'], Number.NaN)).toBe(true);
    expect(hasWaitingRoomSelectionReenteredAfter(game, ['target'], 0)).toBe(false);
  });
});
