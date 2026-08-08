import { createInitialGlickoRatingState, type GlickoRatingState } from './glicko.js';
import { rateRankedHeadToHead, type RankedRatingConfig } from './ranked-rating.js';

export type RankedRatingEventType = 'SETTLEMENT' | 'VOID' | 'REPLACEMENT';
export type RankedWinnerSeat = 'FIRST' | 'SECOND';
export type RankedResultType =
  'NORMAL' | 'SURRENDER' | 'DISCONNECT_FORFEIT' | 'PLATFORM_NO_CONTEST';

export interface RankedRatingEvent {
  readonly eventId: string;
  readonly eventSequence: number;
  readonly eventType: RankedRatingEventType;
  readonly matchId: string;
  readonly targetEventId: string | null;
  readonly firstUserId: string;
  readonly secondUserId: string;
  readonly winnerSeat: RankedWinnerSeat | null;
  readonly resultType: RankedResultType;
  readonly ratedAt: Date;
  readonly algorithmVersion: string;
}

export interface RankedRatingMaterializationStep {
  readonly stepIndex: number;
  readonly sourceResultEventId: string;
  readonly matchId: string;
  readonly firstUserId: string;
  readonly secondUserId: string;
  readonly winnerSeat: RankedWinnerSeat;
  readonly ratedAt: Date;
  readonly firstBefore: GlickoRatingState;
  readonly secondBefore: GlickoRatingState;
  readonly firstAfter: GlickoRatingState;
  readonly secondAfter: GlickoRatingState;
}

export interface RankedRatingMaterialization {
  readonly effectiveResults: readonly EffectiveRankedRatingEvent[];
  readonly players: ReadonlyMap<string, GlickoRatingState>;
  readonly steps: readonly RankedRatingMaterializationStep[];
}

type EffectiveRankedRatingEvent = RankedRatingEvent & {
  readonly winnerSeat: RankedWinnerSeat;
};

export class RankedRatingLedgerError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'RankedRatingLedgerError';
  }
}

/**
 * Resolves the append-only correction chain for every match. Corrections must
 * point to the latest directive for that match, preventing history branches.
 */
export function resolveEffectiveRankedResults(
  events: readonly RankedRatingEvent[],
  config: RankedRatingConfig
): readonly EffectiveRankedRatingEvent[] {
  const ordered = [...events].sort(
    (first, second) =>
      first.eventSequence - second.eventSequence || compareText(first.eventId, second.eventId)
  );
  const seenEventIds = new Set<string>();
  const seenSequences = new Set<number>();
  const latestByMatch = new Map<string, RankedRatingEvent>();

  for (const event of ordered) {
    validateEvent(event, seenEventIds, seenSequences);
    const latest = latestByMatch.get(event.matchId);

    if (event.eventType === 'SETTLEMENT') {
      if (event.targetEventId !== null) {
        throw ledgerError(
          'RANKED_SETTLEMENT_TARGET_FORBIDDEN',
          'initial settlement must not target another event'
        );
      }
      if (latest) {
        throw ledgerError(
          'RANKED_SETTLEMENT_ALREADY_EXISTS',
          `match already has a settlement directive: ${event.matchId}`
        );
      }
    } else {
      if (!latest || event.targetEventId !== latest.eventId) {
        throw ledgerError(
          'RANKED_CORRECTION_TARGET_STALE',
          `correction must target the latest event for match: ${event.matchId}`
        );
      }
      if (
        event.firstUserId !== latest.firstUserId ||
        event.secondUserId !== latest.secondUserId ||
        event.ratedAt.getTime() !== latest.ratedAt.getTime()
      ) {
        throw ledgerError(
          'RANKED_CORRECTION_IDENTITY_MISMATCH',
          'correction cannot change match participants or settlement time'
        );
      }
    }

    latestByMatch.set(event.matchId, event);
    seenEventIds.add(event.eventId);
    seenSequences.add(event.eventSequence);
  }

  for (const latest of latestByMatch.values()) {
    if (latest.algorithmVersion !== config.algorithmVersion) {
      throw ledgerError(
        'RANKED_EFFECTIVE_EVENT_ALGORITHM_MISMATCH',
        `latest rating directive must use ${config.algorithmVersion}: ${latest.matchId}`
      );
    }
  }

  return [...latestByMatch.values()]
    .filter(
      (event): event is RankedRatingEvent & { readonly winnerSeat: RankedWinnerSeat } =>
        event.eventType !== 'VOID' && event.winnerSeat !== null
    )
    .sort(
      (first, second) =>
        first.ratedAt.getTime() - second.ratedAt.getTime() ||
        compareText(first.matchId, second.matchId) ||
        first.eventSequence - second.eventSequence
    );
}

/**
 * Replays the effective result set from initial ratings. The returned steps
 * are a complete deterministic materialization suitable for an audit snapshot
 * attached to a VOID or REPLACEMENT event.
 */
export function materializeRankedRatingLedger(
  events: readonly RankedRatingEvent[],
  config: RankedRatingConfig,
  initialPlayers: ReadonlyMap<string, GlickoRatingState> = new Map()
): RankedRatingMaterialization {
  const effectiveResults = resolveEffectiveRankedResults(events, config);
  const players = new Map(
    [...initialPlayers].map(([userId, state]) => [
      userId,
      {
        ...cloneState(state),
        ratingDeviation: Math.min(
          config.maximumRatingDeviation,
          Math.max(config.minimumRatingDeviation, state.ratingDeviation)
        ),
      },
    ])
  );
  const steps: RankedRatingMaterializationStep[] = [];

  for (const [stepIndex, event] of effectiveResults.entries()) {
    const firstBefore = cloneState(
      players.get(event.firstUserId) ?? createInitialGlickoRatingState(config)
    );
    const secondBefore = cloneState(
      players.get(event.secondUserId) ?? createInitialGlickoRatingState(config)
    );
    const result = rateRankedHeadToHead(
      firstBefore,
      secondBefore,
      event.winnerSeat === 'FIRST' ? 1 : 0,
      event.ratedAt,
      config
    );
    const firstAfter = cloneState(result.first);
    const secondAfter = cloneState(result.second);

    players.set(event.firstUserId, firstAfter);
    players.set(event.secondUserId, secondAfter);
    steps.push({
      stepIndex,
      sourceResultEventId: event.eventId,
      matchId: event.matchId,
      firstUserId: event.firstUserId,
      secondUserId: event.secondUserId,
      winnerSeat: event.winnerSeat,
      ratedAt: new Date(event.ratedAt.getTime()),
      firstBefore,
      secondBefore,
      firstAfter,
      secondAfter,
    });
  }

  return { effectiveResults, players, steps };
}

function validateEvent(
  event: RankedRatingEvent,
  seenEventIds: ReadonlySet<string>,
  seenSequences: ReadonlySet<number>
): void {
  if (event.eventId.trim().length === 0 || event.matchId.trim().length === 0) {
    throw ledgerError('RANKED_EVENT_ID_INVALID', 'eventId and matchId must not be empty');
  }
  if (seenEventIds.has(event.eventId)) {
    throw ledgerError('RANKED_EVENT_ID_DUPLICATE', `duplicate eventId: ${event.eventId}`);
  }
  if (!Number.isInteger(event.eventSequence) || event.eventSequence <= 0) {
    throw ledgerError('RANKED_EVENT_SEQUENCE_INVALID', 'eventSequence must be a positive integer');
  }
  if (seenSequences.has(event.eventSequence)) {
    throw ledgerError(
      'RANKED_EVENT_SEQUENCE_DUPLICATE',
      `duplicate eventSequence: ${event.eventSequence}`
    );
  }
  if (
    event.firstUserId.trim().length === 0 ||
    event.secondUserId.trim().length === 0 ||
    event.firstUserId === event.secondUserId
  ) {
    throw ledgerError(
      'RANKED_EVENT_PARTICIPANTS_INVALID',
      'a rating event must contain two distinct players'
    );
  }
  if (!Number.isFinite(event.ratedAt.getTime())) {
    throw ledgerError('RANKED_EVENT_TIME_INVALID', 'ratedAt must be a valid Date');
  }
  if (event.algorithmVersion.trim().length === 0 || event.algorithmVersion.includes('SHADOW')) {
    throw ledgerError('RANKED_EVENT_ALGORITHM_INVALID', 'rating event algorithmVersion is invalid');
  }
  if (event.eventType === 'VOID') {
    if (event.winnerSeat !== null) {
      throw ledgerError('RANKED_VOID_WINNER_FORBIDDEN', 'void event must not contain a winner');
    }
  } else if (event.winnerSeat !== 'FIRST' && event.winnerSeat !== 'SECOND') {
    throw ledgerError(
      'RANKED_EVENT_WINNER_REQUIRED',
      'settlement and replacement events require a winner'
    );
  }
}

function cloneState(state: GlickoRatingState): GlickoRatingState {
  return {
    ...state,
    lastRatedAt: state.lastRatedAt === null ? null : new Date(state.lastRatedAt.getTime()),
  };
}

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function ledgerError(code: string, message: string): RankedRatingLedgerError {
  return new RankedRatingLedgerError(code, message);
}
