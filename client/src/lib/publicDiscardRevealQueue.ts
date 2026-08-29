import type { PublicCardInfo, PublicEvent, Seat } from '@game/online';
import { ZoneType } from '@game/shared/types/enums';

export const PUBLIC_DISCARD_REVEAL_MAX_AGE_MS = 5_000;
export const PUBLIC_DISCARD_REVEAL_SEEN_EVENT_LIMIT = 256;
export const PUBLIC_DISCARD_REVEAL_COMPLETED_BATCH_LIMIT = 128;

export interface PublicDiscardRevealMove {
  readonly eventId: string;
  readonly matchId: string;
  readonly seq: number;
  /** Client monotonic time when this event first entered the presentation queue. */
  readonly receivedAt: number;
  readonly movementBatchId: string;
  readonly ownerSeat: Seat;
  readonly card: PublicCardInfo;
}

export interface PublicDiscardRevealBatch {
  readonly movementBatchId: string;
  readonly ownerSeat: Seat;
  readonly eventIds: readonly string[];
  readonly cards: readonly PublicCardInfo[];
  readonly firstSeq: number;
  readonly lastSeq: number;
  /** Earliest client monotonic receipt time among events in this batch. */
  readonly receivedAt: number;
}

export interface PublicDiscardRevealQueueState {
  readonly matchId: string | null;
  readonly presentationEpoch: number | null;
  /**
   * The public sequence observed when this match (or rollback generation) was
   * first attached. Events at or below it are history and must not animate.
   */
  readonly skipThroughSeq: number;
  /** Latest authority sequence, used to detect rollback. */
  readonly latestPublicSeq: number;
  /** Event IDs are retained so retransmitted/backfilled slices stay idempotent. */
  readonly seenEventIds: readonly string[];
  /** Completed batches stay suppressed if another event from that batch arrives late. */
  readonly completedMovementBatchIds: readonly string[];
  readonly queue: readonly PublicDiscardRevealBatch[];
}

export interface UpdatePublicDiscardRevealQueueInput {
  readonly matchId: string;
  readonly presentationEpoch: number;
  readonly currentPublicSeq: number;
  readonly publicEvents: readonly PublicEvent[];
  /** Client monotonic clock value; never compared with PublicEvent.timestamp. */
  readonly now: number;
}

export interface DequeuePublicDiscardRevealResult {
  readonly state: PublicDiscardRevealQueueState;
  readonly batch: PublicDiscardRevealBatch | null;
}

export interface PruneExpiredPublicDiscardRevealBatchesResult {
  readonly state: PublicDiscardRevealQueueState;
  readonly expiredBatches: readonly PublicDiscardRevealBatch[];
}

type PublicEventWithMovementBatch = PublicEvent & {
  readonly movementBatchId?: unknown;
};

export function createPublicDiscardRevealQueueState(): PublicDiscardRevealQueueState {
  return {
    matchId: null,
    presentationEpoch: null,
    skipThroughSeq: 0,
    latestPublicSeq: 0,
    seenEventIds: [],
    completedMovementBatchIds: [],
    queue: [],
  };
}

/**
 * Extracts the narrow public fact needed to display a discard. Hidden moves,
 * moves to other zones, count-only events, and legacy events without a batch
 * identity are intentionally ignored.
 */
export function parsePublicDiscardRevealMove(
  event: PublicEvent,
  receivedAt: number
): PublicDiscardRevealMove | null {
  if (event.type !== 'CardMovedPublic' && event.type !== 'CardRevealedAndMoved') {
    return null;
  }

  const movementBatchId = (event as PublicEventWithMovementBatch).movementBatchId;
  if (
    typeof movementBatchId !== 'string' ||
    movementBatchId.length === 0 ||
    !event.card ||
    event.from?.zone !== ZoneType.HAND ||
    event.to?.zone !== ZoneType.WAITING_ROOM ||
    (event.to.ownerSeat !== 'FIRST' && event.to.ownerSeat !== 'SECOND')
  ) {
    return null;
  }

  return {
    eventId: event.eventId,
    matchId: event.matchId,
    seq: event.seq,
    receivedAt,
    movementBatchId,
    ownerSeat: event.to.ownerSeat,
    card: event.card,
  };
}

/** Groups moves by their authority-issued movement batch, preserving event order. */
export function groupPublicDiscardRevealMoves(
  moves: readonly PublicDiscardRevealMove[]
): readonly PublicDiscardRevealBatch[] {
  const batches = new Map<string, PublicDiscardRevealBatch>();

  for (const move of [...moves].sort(compareMoves)) {
    const existing = batches.get(move.movementBatchId);
    if (!existing) {
      batches.set(move.movementBatchId, {
        movementBatchId: move.movementBatchId,
        ownerSeat: move.ownerSeat,
        eventIds: [move.eventId],
        cards: [move.card],
        firstSeq: move.seq,
        lastSeq: move.seq,
        receivedAt: move.receivedAt,
      });
      continue;
    }

    // The authority contract never mixes owners inside one batch. Ignore a
    // malformed conflicting event instead of presenting it under the wrong hand.
    if (existing.ownerSeat !== move.ownerSeat) {
      continue;
    }

    batches.set(move.movementBatchId, mergeMoveIntoBatch(existing, move));
  }

  return [...batches.values()].sort(compareBatches);
}

/**
 * Advances the presentation cursor without relying on a contiguous event
 * slice. Every supplied event above the initial floor is scanned, so an event
 * omitted from one snapshot can still be accepted when a later backfill
 * supplies it, even if currentPublicSeq has not changed.
 */
export function updatePublicDiscardRevealQueue(
  state: PublicDiscardRevealQueueState,
  input: UpdatePublicDiscardRevealQueueInput
): PublicDiscardRevealQueueState {
  const currentPublicSeq = normalizePublicSeq(input.currentPublicSeq);
  if (
    state.matchId === null ||
    state.matchId !== input.matchId ||
    state.presentationEpoch !== input.presentationEpoch ||
    currentPublicSeq < state.latestPublicSeq
  ) {
    return createInitializedState(input.matchId, currentPublicSeq, input.presentationEpoch);
  }

  const seenEventIds = new Set(state.seenEventIds);
  const completedBatchIds = new Set(state.completedMovementBatchIds);
  const acceptedMoves: PublicDiscardRevealMove[] = [];

  for (const event of [...input.publicEvents].sort(compareEvents)) {
    if (
      event.matchId !== input.matchId ||
      event.seq <= state.skipThroughSeq ||
      event.seq > currentPublicSeq ||
      seenEventIds.has(event.eventId)
    ) {
      continue;
    }

    const move = parsePublicDiscardRevealMove(event, input.now);
    if (!move) {
      continue;
    }

    seenEventIds.add(move.eventId);
    if (completedBatchIds.has(move.movementBatchId)) {
      continue;
    }
    acceptedMoves.push(move);
  }

  if (acceptedMoves.length === 0) {
    if (
      currentPublicSeq === state.latestPublicSeq &&
      seenEventIds.size === state.seenEventIds.length
    ) {
      return state;
    }
    return {
      ...state,
      latestPublicSeq: currentPublicSeq,
      seenEventIds: retainTail([...seenEventIds], PUBLIC_DISCARD_REVEAL_SEEN_EVENT_LIMIT),
    };
  }

  const queueByBatchId = new Map(
    state.queue.map((batch) => [batch.movementBatchId, batch] as const)
  );
  for (const incomingBatch of groupPublicDiscardRevealMoves(acceptedMoves)) {
    const existing = queueByBatchId.get(incomingBatch.movementBatchId);
    if (!existing) {
      queueByBatchId.set(incomingBatch.movementBatchId, incomingBatch);
      continue;
    }
    queueByBatchId.set(
      incomingBatch.movementBatchId,
      mergePublicDiscardRevealBatches(existing, incomingBatch)
    );
  }

  return {
    ...state,
    latestPublicSeq: currentPublicSeq,
    seenEventIds: retainTail([...seenEventIds], PUBLIC_DISCARD_REVEAL_SEEN_EVENT_LIMIT),
    queue: [...queueByBatchId.values()].sort(compareBatches),
  };
}

/** Removes the next batch and permanently marks its batch ID as displayed. */
export function dequeuePublicDiscardRevealBatch(
  state: PublicDiscardRevealQueueState
): DequeuePublicDiscardRevealResult {
  const batch = state.queue[0] ?? null;
  if (!batch) {
    return { state, batch: null };
  }

  return {
    batch,
    state: {
      ...state,
      completedMovementBatchIds: state.completedMovementBatchIds.includes(batch.movementBatchId)
        ? state.completedMovementBatchIds
        : retainTail(
            [...state.completedMovementBatchIds, batch.movementBatchId],
            PUBLIC_DISCARD_REVEAL_COMPLETED_BATCH_LIMIT
          ),
      queue: state.queue.slice(1),
    },
  };
}

/**
 * Rechecks age immediately before presentation. A batch may have been fresh
 * when received but become irrelevant while an earlier animation was playing.
 * Expired batch IDs are retained as completed so a split late event cannot
 * resurrect an already abandoned presentation.
 */
export function pruneExpiredPublicDiscardRevealBatches(
  state: PublicDiscardRevealQueueState,
  now: number,
  maxAgeMs = PUBLIC_DISCARD_REVEAL_MAX_AGE_MS
): PruneExpiredPublicDiscardRevealBatchesResult {
  const expiredBatches = state.queue.filter((batch) =>
    isOlderThan(batch.receivedAt, now, maxAgeMs)
  );
  if (expiredBatches.length === 0) {
    return { state, expiredBatches };
  }

  const expiredBatchIds = new Set(expiredBatches.map((batch) => batch.movementBatchId));
  return {
    expiredBatches,
    state: {
      ...state,
      completedMovementBatchIds: retainTail(
        [
          ...state.completedMovementBatchIds,
          ...expiredBatches
            .map((batch) => batch.movementBatchId)
            .filter((batchId) => !state.completedMovementBatchIds.includes(batchId)),
        ],
        PUBLIC_DISCARD_REVEAL_COMPLETED_BATCH_LIMIT
      ),
      queue: state.queue.filter((batch) => !expiredBatchIds.has(batch.movementBatchId)),
    },
  };
}

function createInitializedState(
  matchId: string,
  currentPublicSeq: number,
  presentationEpoch: number
): PublicDiscardRevealQueueState {
  return {
    matchId,
    presentationEpoch,
    skipThroughSeq: currentPublicSeq,
    latestPublicSeq: currentPublicSeq,
    seenEventIds: [],
    completedMovementBatchIds: [],
    queue: [],
  };
}

function mergeMoveIntoBatch(
  batch: PublicDiscardRevealBatch,
  move: PublicDiscardRevealMove
): PublicDiscardRevealBatch {
  const eventIds = batch.eventIds.includes(move.eventId)
    ? batch.eventIds
    : [...batch.eventIds, move.eventId];
  const cards = batch.cards.some((card) => card.publicObjectId === move.card.publicObjectId)
    ? batch.cards
    : [...batch.cards, move.card];
  return {
    ...batch,
    eventIds,
    cards,
    firstSeq: Math.min(batch.firstSeq, move.seq),
    lastSeq: Math.max(batch.lastSeq, move.seq),
    receivedAt: Math.min(batch.receivedAt, move.receivedAt),
  };
}

function mergePublicDiscardRevealBatches(
  existing: PublicDiscardRevealBatch,
  incoming: PublicDiscardRevealBatch
): PublicDiscardRevealBatch {
  if (existing.ownerSeat !== incoming.ownerSeat) {
    return existing;
  }

  return {
    ...existing,
    eventIds: [...new Set([...existing.eventIds, ...incoming.eventIds])],
    cards: [
      ...existing.cards,
      ...incoming.cards.filter(
        (incomingCard) =>
          !existing.cards.some(
            (existingCard) => existingCard.publicObjectId === incomingCard.publicObjectId
          )
      ),
    ],
    firstSeq: Math.min(existing.firstSeq, incoming.firstSeq),
    lastSeq: Math.max(existing.lastSeq, incoming.lastSeq),
    receivedAt: Math.min(existing.receivedAt, incoming.receivedAt),
  };
}

function compareMoves(left: PublicDiscardRevealMove, right: PublicDiscardRevealMove): number {
  return left.seq - right.seq || left.eventId.localeCompare(right.eventId);
}

function compareEvents(left: PublicEvent, right: PublicEvent): number {
  return left.seq - right.seq || left.eventId.localeCompare(right.eventId);
}

function compareBatches(left: PublicDiscardRevealBatch, right: PublicDiscardRevealBatch): number {
  return (
    left.firstSeq - right.firstSeq || left.movementBatchId.localeCompare(right.movementBatchId)
  );
}

function isOlderThan(receivedAt: number, now: number, maxAgeMs: number): boolean {
  return now - receivedAt > Math.max(0, maxAgeMs);
}

function normalizePublicSeq(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function retainTail<T>(values: readonly T[], limit: number): readonly T[] {
  return values.length <= limit ? values : values.slice(-limit);
}
