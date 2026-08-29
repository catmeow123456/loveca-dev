import { describe, expect, it } from 'vitest';
import type { PublicEvent, Seat } from '../../src/online/types';
import { ZoneType } from '../../src/shared/types/enums';
import {
  createPublicDiscardRevealQueueState,
  dequeuePublicDiscardRevealBatch,
  groupPublicDiscardRevealMoves,
  parsePublicDiscardRevealMove,
  pruneExpiredPublicDiscardRevealBatches,
  PUBLIC_DISCARD_REVEAL_COMPLETED_BATCH_LIMIT,
  PUBLIC_DISCARD_REVEAL_MAX_AGE_MS,
  PUBLIC_DISCARD_REVEAL_SEEN_EVENT_LIMIT,
  updatePublicDiscardRevealQueue,
} from '../../client/src/lib/publicDiscardRevealQueue';

const MATCH_ID = 'match-1';
const NOW = 20_000;
const PRESENTATION_EPOCH = 3;

function discardEvent(
  seq: number,
  overrides: {
    readonly eventId?: string;
    readonly type?: 'CardMovedPublic' | 'CardRevealedAndMoved';
    readonly movementBatchId?: string;
    readonly ownerSeat?: Seat;
    readonly cardObjectId?: string;
    readonly cardCode?: string;
    readonly timestamp?: number;
    readonly fromZone?: ZoneType;
    readonly toZone?: ZoneType;
    readonly includeCard?: boolean;
    readonly matchId?: string;
  } = {}
): PublicEvent {
  const event = {
    type: overrides.type ?? 'CardMovedPublic',
    eventId: overrides.eventId ?? `${MATCH_ID}:${seq}`,
    matchId: overrides.matchId ?? MATCH_ID,
    seq,
    timestamp: overrides.timestamp ?? NOW,
    source: 'PLAYER',
    actorSeat: 'FIRST',
    movementBatchId: overrides.movementBatchId ?? 'batch-1',
    ...(overrides.includeCard === false
      ? { count: 1 }
      : {
          card: {
            publicObjectId: overrides.cardObjectId ?? `obj_card-${seq}`,
            cardCode: overrides.cardCode ?? `CARD-${seq}`,
          },
        }),
    from: {
      zone: overrides.fromZone ?? ZoneType.HAND,
      ownerSeat: 'FIRST',
    },
    to: {
      zone: overrides.toZone ?? ZoneType.WAITING_ROOM,
      ownerSeat: overrides.ownerSeat ?? 'FIRST',
    },
  };
  return event as PublicEvent;
}

describe('public discard reveal queue', () => {
  it('recognizes only card-bearing batched hand-to-waiting-room public moves', () => {
    expect(parsePublicDiscardRevealMove(discardEvent(1), NOW)).toMatchObject({
      movementBatchId: 'batch-1',
      ownerSeat: 'FIRST',
      receivedAt: NOW,
      card: { publicObjectId: 'obj_card-1', cardCode: 'CARD-1' },
    });
    expect(
      parsePublicDiscardRevealMove(
        discardEvent(2, {
          type: 'CardRevealedAndMoved',
          ownerSeat: 'SECOND',
          movementBatchId: 'batch-2',
        }),
        NOW
      )
    ).toMatchObject({ movementBatchId: 'batch-2', ownerSeat: 'SECOND' });

    expect(parsePublicDiscardRevealMove(discardEvent(3, { includeCard: false }), NOW)).toBeNull();
    expect(parsePublicDiscardRevealMove(discardEvent(4, { movementBatchId: '' }), NOW)).toBeNull();
    expect(
      parsePublicDiscardRevealMove(discardEvent(5, { fromZone: ZoneType.MAIN_DECK }), NOW)
    ).toBeNull();
    expect(
      parsePublicDiscardRevealMove(discardEvent(6, { toZone: ZoneType.EXILE_ZONE }), NOW)
    ).toBeNull();
  });

  it('groups by movementBatchId, orders by sequence, and deduplicates physical cards', () => {
    const moves = [
      discardEvent(4, { movementBatchId: 'batch-b', ownerSeat: 'SECOND' }),
      discardEvent(3, {
        movementBatchId: 'batch-a',
        cardObjectId: 'obj_same',
        eventId: 'duplicate-card-event',
      }),
      discardEvent(2, { movementBatchId: 'batch-a', cardObjectId: 'obj_same' }),
      discardEvent(1, { movementBatchId: 'batch-a', cardObjectId: 'obj_first' }),
    ].flatMap((event) => {
      const move = parsePublicDiscardRevealMove(event, NOW);
      return move ? [move] : [];
    });

    expect(groupPublicDiscardRevealMoves(moves)).toEqual([
      {
        movementBatchId: 'batch-a',
        ownerSeat: 'FIRST',
        eventIds: [`${MATCH_ID}:1`, `${MATCH_ID}:2`, 'duplicate-card-event'],
        cards: [
          { publicObjectId: 'obj_first', cardCode: 'CARD-1' },
          { publicObjectId: 'obj_same', cardCode: 'CARD-2' },
        ],
        firstSeq: 1,
        lastSeq: 3,
        receivedAt: NOW,
      },
      expect.objectContaining({
        movementBatchId: 'batch-b',
        ownerSeat: 'SECOND',
        firstSeq: 4,
        lastSeq: 4,
      }),
    ]);
  });

  it('skips initial history but accepts a normal delayed backfill without replaying duplicates', () => {
    let state = updatePublicDiscardRevealQueue(createPublicDiscardRevealQueueState(), {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 10,
      publicEvents: [discardEvent(9, { movementBatchId: 'history' })],
      now: NOW,
    });
    expect(state).toMatchObject({
      matchId: MATCH_ID,
      skipThroughSeq: 10,
      latestPublicSeq: 10,
      queue: [],
    });

    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 12,
      publicEvents: [],
      now: NOW,
    });
    expect(state.queue).toEqual([]);

    const delayedEvents = [
      discardEvent(11, { movementBatchId: 'batch-delayed', cardObjectId: 'obj_a' }),
      discardEvent(12, { movementBatchId: 'batch-delayed', cardObjectId: 'obj_b' }),
    ];
    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 12,
      publicEvents: delayedEvents,
      now: NOW,
    });
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]).toMatchObject({
      movementBatchId: 'batch-delayed',
      cards: [{ publicObjectId: 'obj_a' }, { publicObjectId: 'obj_b' }],
      firstSeq: 11,
      lastSeq: 12,
    });

    const repeated = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 12,
      publicEvents: delayedEvents,
      now: NOW,
    });
    expect(repeated).toBe(state);
    expect(repeated.queue[0]?.cards).toHaveLength(2);
  });

  it('merges a later event into a queued batch and suppresses it after display', () => {
    let state = updatePublicDiscardRevealQueue(createPublicDiscardRevealQueueState(), {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 0,
      publicEvents: [],
      now: NOW,
    });
    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 1,
      publicEvents: [
        discardEvent(1, { movementBatchId: 'batch-late-card', cardObjectId: 'obj_a' }),
      ],
      now: NOW,
    });
    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 2,
      publicEvents: [
        discardEvent(2, { movementBatchId: 'batch-late-card', cardObjectId: 'obj_b' }),
      ],
      now: NOW + 4_000,
    });
    expect(state.queue[0]?.cards.map((card) => card.publicObjectId)).toEqual(['obj_a', 'obj_b']);
    expect(state.queue[0]?.receivedAt).toBe(NOW);

    const dequeued = dequeuePublicDiscardRevealBatch(state);
    expect(dequeued.batch?.movementBatchId).toBe('batch-late-card');
    expect(dequeued.state.queue).toEqual([]);

    const afterCompletion = updatePublicDiscardRevealQueue(dequeued.state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 3,
      publicEvents: [
        discardEvent(3, { movementBatchId: 'batch-late-card', cardObjectId: 'obj_c' }),
      ],
      now: NOW,
    });
    expect(afterCompletion.queue).toEqual([]);
    expect(afterCompletion.seenEventIds).toContain(`${MATCH_ID}:3`);
  });

  it('keeps rapid independent discards in authority order for serial presentation', () => {
    let state = updatePublicDiscardRevealQueue(createPublicDiscardRevealQueueState(), {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 0,
      publicEvents: [],
      now: NOW,
    });
    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 2,
      publicEvents: [
        discardEvent(1, { movementBatchId: 'rapid-first' }),
        discardEvent(2, { movementBatchId: 'rapid-second' }),
      ],
      now: NOW,
    });

    expect(state.queue.map((batch) => batch.movementBatchId)).toEqual([
      'rapid-first',
      'rapid-second',
    ]);
    const first = dequeuePublicDiscardRevealBatch(state);
    expect(first.batch?.movementBatchId).toBe('rapid-first');
    expect(first.state.queue.map((batch) => batch.movementBatchId)).toEqual(['rapid-second']);
    const second = dequeuePublicDiscardRevealBatch(first.state);
    expect(second.batch?.movementBatchId).toBe('rapid-second');
    expect(second.state.queue).toEqual([]);
  });

  it('clears queued and deduplication state on sequence rollback so the new timeline can replay', () => {
    let state = updatePublicDiscardRevealQueue(createPublicDiscardRevealQueueState(), {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 10,
      publicEvents: [],
      now: NOW,
    });
    const replayedEvent = discardEvent(11, {
      eventId: 'reused-after-rollback',
      movementBatchId: 'replayed-batch',
    });
    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 11,
      publicEvents: [replayedEvent],
      now: NOW,
    });
    expect(state.queue).toHaveLength(1);
    expect(state.seenEventIds).toContain('reused-after-rollback');

    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 8,
      publicEvents: [],
      now: NOW,
    });
    expect(state).toMatchObject({
      skipThroughSeq: 8,
      latestPublicSeq: 8,
      seenEventIds: [],
      completedMovementBatchIds: [],
      queue: [],
    });

    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 11,
      publicEvents: [replayedEvent],
      now: NOW,
    });
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0]?.movementBatchId).toBe('replayed-batch');
  });

  it('rebaselines without replaying restored history when the presentation epoch changes', () => {
    let state = updatePublicDiscardRevealQueue(createPublicDiscardRevealQueueState(), {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 0,
      publicEvents: [],
      now: NOW,
    });
    const beforeRecovery = discardEvent(1, { movementBatchId: 'before-recovery' });
    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 1,
      publicEvents: [beforeRecovery],
      now: NOW,
    });
    expect(state.queue).toHaveLength(1);

    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH + 1,
      currentPublicSeq: 1,
      publicEvents: [beforeRecovery],
      now: NOW,
    });
    expect(state).toMatchObject({
      presentationEpoch: PRESENTATION_EPOCH + 1,
      skipThroughSeq: 1,
      queue: [],
      seenEventIds: [],
    });

    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH + 1,
      currentPublicSeq: 2,
      publicEvents: [discardEvent(2, { movementBatchId: 'after-recovery' })],
      now: NOW,
    });
    expect(state.queue[0]?.movementBatchId).toBe('after-recovery');
  });

  it('bounds retained event and completed-batch deduplication histories', () => {
    let state = updatePublicDiscardRevealQueue(createPublicDiscardRevealQueueState(), {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 0,
      publicEvents: [],
      now: NOW,
    });
    const eventCount = PUBLIC_DISCARD_REVEAL_SEEN_EVENT_LIMIT + 20;
    const events = Array.from({ length: eventCount }, (_, index) =>
      discardEvent(index + 1, { movementBatchId: `batch-${index + 1}` })
    );
    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: eventCount,
      publicEvents: events,
      now: NOW,
    });
    expect(state.seenEventIds).toHaveLength(PUBLIC_DISCARD_REVEAL_SEEN_EVENT_LIMIT);

    while (state.queue.length > 0) {
      state = dequeuePublicDiscardRevealBatch(state).state;
    }
    expect(state.completedMovementBatchIds).toHaveLength(
      PUBLIC_DISCARD_REVEAL_COMPLETED_BATCH_LIMIT
    );
    expect(state.completedMovementBatchIds.at(-1)).toBe(`batch-${eventCount}`);
  });

  it('ignores server clock skew and expires batches from their client receipt time', () => {
    let state = updatePublicDiscardRevealQueue(createPublicDiscardRevealQueueState(), {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 0,
      publicEvents: [],
      now: NOW,
    });
    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 2,
      publicEvents: [
        discardEvent(1, {
          movementBatchId: 'server-clock-far-behind',
          timestamp: NOW - 86_400_000,
        }),
        discardEvent(2, {
          movementBatchId: 'server-clock-far-ahead',
          timestamp: NOW + 86_400_000,
        }),
      ],
      now: NOW,
    });

    expect(state.queue.map((batch) => batch.movementBatchId)).toEqual([
      'server-clock-far-behind',
      'server-clock-far-ahead',
    ]);
    expect(state.queue.every((batch) => batch.receivedAt === NOW)).toBe(true);
    expect(state.seenEventIds).toEqual([`${MATCH_ID}:1`, `${MATCH_ID}:2`]);

    const atBoundary = pruneExpiredPublicDiscardRevealBatches(
      state,
      NOW + PUBLIC_DISCARD_REVEAL_MAX_AGE_MS
    );
    expect(atBoundary.expiredBatches).toEqual([]);
    const afterBoundary = pruneExpiredPublicDiscardRevealBatches(
      atBoundary.state,
      NOW + PUBLIC_DISCARD_REVEAL_MAX_AGE_MS + 1
    );
    expect(afterBoundary.expiredBatches).toHaveLength(2);
    expect(afterBoundary.state.queue).toEqual([]);
  });

  it('drops a batch that becomes stale while queued and prevents a split late event from reviving it', () => {
    let state = updatePublicDiscardRevealQueue(createPublicDiscardRevealQueueState(), {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 0,
      publicEvents: [],
      now: NOW,
    });
    state = updatePublicDiscardRevealQueue(state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 1,
      publicEvents: [discardEvent(1, { movementBatchId: 'queued-too-long' })],
      now: NOW,
    });
    expect(state.queue).toHaveLength(1);

    const pruned = pruneExpiredPublicDiscardRevealBatches(
      state,
      NOW + PUBLIC_DISCARD_REVEAL_MAX_AGE_MS + 1
    );
    expect(pruned.expiredBatches.map((batch) => batch.movementBatchId)).toEqual([
      'queued-too-long',
    ]);
    expect(pruned.state.queue).toEqual([]);
    expect(pruned.state.completedMovementBatchIds).toContain('queued-too-long');

    const afterLateSplit = updatePublicDiscardRevealQueue(pruned.state, {
      matchId: MATCH_ID,
      presentationEpoch: PRESENTATION_EPOCH,
      currentPublicSeq: 2,
      publicEvents: [
        discardEvent(2, {
          movementBatchId: 'queued-too-long',
          cardObjectId: 'obj_late-split',
          timestamp: NOW + PUBLIC_DISCARD_REVEAL_MAX_AGE_MS + 1,
        }),
      ],
      now: NOW + PUBLIC_DISCARD_REVEAL_MAX_AGE_MS + 1,
    });
    expect(afterLateSplit.queue).toEqual([]);
  });
});
