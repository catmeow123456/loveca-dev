import { describe, expect, it } from 'vitest';
import {
  didPlayerPerformAndFailLiveInPreviousCompletedTurn,
  getPreviousCompletedTurnLiveResult,
} from '../../src/application/effects/previous-completed-turn-live-result';
import {
  createLiveStartEvent,
  createLiveSuccessEvent,
  createTurnEndEvent,
  createTurnStartEvent,
  type GameEvent,
} from '../../src/domain/events/game-events';
import { createGameState, emitGameEvent, type GameState } from '../../src/domain/entities/game';

const P1 = 'p1';
const P2 = 'p2';

function withEvents(events: readonly GameEvent[]): GameState {
  return events.reduce(
    (game, event) => emitGameEvent(game, event),
    createGameState('previous-completed-turn-live-result', P1, 'P1', P2, 'P2')
  );
}

describe('previous completed turn LIVE result query', () => {
  it('reads a failed opponent LIVE from the latest complete turn and ignores the open current turn', () => {
    const game = withEvents([
      createTurnStartEvent(1, P1),
      createLiveStartEvent(P2, ['live-1']),
      createTurnEndEvent(1, P1),
      createTurnStartEvent(2, P1),
    ]);

    expect(getPreviousCompletedTurnLiveResult(game, P2)).toEqual({
      turnNumber: 1,
      playerId: P2,
      startSequence: 1,
      endSequence: 3,
      performedLive: true,
      succeededLive: false,
    });
    expect(didPlayerPerformAndFailLiveInPreviousCompletedTurn(game, P2)).toBe(true);
    expect(didPlayerPerformAndFailLiveInPreviousCompletedTurn(game, P1)).toBe(false);
  });

  it('uses the first turn end as an implicit start boundary when the runtime omitted ON_TURN_START', () => {
    const game = withEvents([
      createLiveStartEvent(P2, ['live-1']),
      createTurnEndEvent(1, P1),
      createTurnStartEvent(2, P1),
    ]);

    expect(getPreviousCompletedTurnLiveResult(game, P2)).toEqual({
      turnNumber: 1,
      playerId: P2,
      startSequence: null,
      endSequence: 2,
      performedLive: true,
      succeededLive: false,
    });
    expect(didPlayerPerformAndFailLiveInPreviousCompletedTurn(game, P2)).toBe(true);
  });

  it('does not treat a turn without LIVE or a successful LIVE as failed', () => {
    const withoutLive = withEvents([
      createTurnStartEvent(1, P1),
      createTurnEndEvent(1, P1),
      createTurnStartEvent(2, P1),
    ]);
    expect(didPlayerPerformAndFailLiveInPreviousCompletedTurn(withoutLive, P2)).toBe(false);

    const successful = withEvents([
      createTurnStartEvent(1, P1),
      createLiveStartEvent(P2, ['live-1']),
      createLiveSuccessEvent(P2, ['live-1'], 3),
      createTurnEndEvent(1, P1),
      createTurnStartEvent(2, P1),
    ]);
    expect(didPlayerPerformAndFailLiveInPreviousCompletedTurn(successful, P2)).toBe(false);
  });

  it('reads each player independently inside the same shared turn boundary', () => {
    const game = withEvents([
      createTurnStartEvent(1, P1),
      createLiveStartEvent(P1, ['p1-live']),
      createLiveSuccessEvent(P1, ['p1-live'], 3),
      createLiveStartEvent(P2, ['p2-live']),
      createTurnEndEvent(1, P1),
      createTurnStartEvent(2, P1),
    ]);

    expect(getPreviousCompletedTurnLiveResult(game, P1)).toMatchObject({
      playerId: P1,
      performedLive: true,
      succeededLive: true,
    });
    expect(getPreviousCompletedTurnLiveResult(game, P2)).toMatchObject({
      playerId: P2,
      performedLive: true,
      succeededLive: false,
    });
  });

  it('uses only the latest completed turn and does not resurrect an older failed LIVE', () => {
    const game = withEvents([
      createTurnStartEvent(1, P1),
      createLiveStartEvent(P2, ['old-live']),
      createTurnEndEvent(1, P1),
      createTurnStartEvent(2, P1),
      createLiveStartEvent(P1, ['current-live']),
      createTurnEndEvent(2, P1),
      createTurnStartEvent(3, P1),
    ]);

    expect(getPreviousCompletedTurnLiveResult(game, P2)).toMatchObject({
      turnNumber: 2,
      playerId: P2,
      performedLive: false,
      succeededLive: false,
    });
    expect(didPlayerPerformAndFailLiveInPreviousCompletedTurn(game, P2)).toBe(false);
  });

  it('uses the previous turn end to isolate later implicit intervals without ON_TURN_START', () => {
    const game = withEvents([
      createLiveStartEvent(P2, ['old-live']),
      createTurnEndEvent(1, P1),
      createLiveStartEvent(P1, ['latest-live']),
      createTurnEndEvent(2, P1),
      createTurnStartEvent(3, P1),
    ]);

    expect(getPreviousCompletedTurnLiveResult(game, P2)).toMatchObject({
      turnNumber: 2,
      startSequence: null,
      performedLive: false,
      succeededLive: false,
    });
    expect(didPlayerPerformAndFailLiveInPreviousCompletedTurn(game, P2)).toBe(false);
  });

  it('rejects incomplete and mismatched turn boundaries', () => {
    const incomplete = withEvents([
      createTurnStartEvent(1, P2),
      createLiveStartEvent(P2, ['live-1']),
    ]);
    expect(getPreviousCompletedTurnLiveResult(incomplete, P2)).toBeNull();

    const mismatched = withEvents([
      createTurnStartEvent(1, P2),
      createLiveStartEvent(P2, ['live-1']),
      createTurnEndEvent(2, P2),
    ]);
    expect(getPreviousCompletedTurnLiveResult(mismatched, P2)).toBeNull();
  });
});
