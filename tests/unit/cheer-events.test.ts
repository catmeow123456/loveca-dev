import { describe, expect, it } from 'vitest';
import { createGameState, emitGameEvent, type GameState } from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { getLatestOwnNormalCheerEventByIds } from '../../src/application/card-effects/runtime/cheer-events';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function withEvents(...events: ReturnType<typeof createCheerEvent>[]): GameState {
  return events.reduce(
    (game, event) => emitGameEvent(game, event),
    createGameState('cheer-events', PLAYER1, 'P1', PLAYER2, 'P2')
  );
}

describe('getLatestOwnNormalCheerEventByIds', () => {
  it('returns a matching own normal CheerEvent', () => {
    const event = createCheerEvent(PLAYER1, ['own-card'], 1);

    expect(getLatestOwnNormalCheerEventByIds(withEvents(event), PLAYER1, [event.eventId])).toBe(event);
  });

  it('does not return an opponent CheerEvent', () => {
    const event = createCheerEvent(PLAYER2, ['opponent-card'], 1);

    expect(getLatestOwnNormalCheerEventByIds(withEvents(event), PLAYER1, [event.eventId])).toBeNull();
  });

  it('does not return an additional CheerEvent', () => {
    const event = createCheerEvent(PLAYER1, ['additional-card'], 1, { additional: true });

    expect(getLatestOwnNormalCheerEventByIds(withEvents(event), PLAYER1, [event.eventId])).toBeNull();
  });

  it('treats a legacy CheerEvent without an additional field as normal', () => {
    const event = createCheerEvent(PLAYER1, ['legacy-card'], 1);
    delete event.additional;

    expect(getLatestOwnNormalCheerEventByIds(withEvents(event), PLAYER1, [event.eventId])).toBe(event);
  });

  it('does not return an event outside the supplied event ids', () => {
    const event = createCheerEvent(PLAYER1, ['own-card'], 1);

    expect(getLatestOwnNormalCheerEventByIds(withEvents(event), PLAYER1, ['other-event'])).toBeNull();
  });

  it('returns the last matching event in event-log order', () => {
    const first = createCheerEvent(PLAYER1, ['first-card'], 1);
    const second = createCheerEvent(PLAYER1, ['second-card'], 2);
    const game = withEvents(first, second);

    expect(getLatestOwnNormalCheerEventByIds(game, PLAYER1, [first.eventId, second.eventId])).toBe(second);
  });
});
