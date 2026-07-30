import {
  CURRENT_GLICKO1_SHADOW_CONFIG,
  createInitialGlickoRatingState,
  rateGlickoHeadToHead,
  type Glicko1Config,
  type GlickoRatingState,
} from './glicko.js';

export type GlickoShadowWinnerSeat = 'FIRST' | 'SECOND';

export interface GlickoShadowMatch {
  readonly matchId: string;
  readonly firstPlayerId: string;
  readonly secondPlayerId: string;
  readonly winnerSeat: GlickoShadowWinnerSeat;
  readonly settledAt: Date;
}

export interface GlickoShadowSettlement {
  readonly matchId: string;
  readonly algorithmVersion: string;
  readonly settledAt: Date;
  readonly firstPlayerId: string;
  readonly secondPlayerId: string;
  readonly winnerSeat: GlickoShadowWinnerSeat;
  readonly firstBefore: GlickoRatingState;
  readonly secondBefore: GlickoRatingState;
  readonly firstAfter: GlickoRatingState;
  readonly secondAfter: GlickoRatingState;
}

export interface GlickoShadowSimulation {
  readonly players: ReadonlyMap<string, GlickoRatingState>;
  readonly settlements: readonly GlickoShadowSettlement[];
}

function compareShadowMatches(first: GlickoShadowMatch, second: GlickoShadowMatch): number {
  const timeDifference = first.settledAt.getTime() - second.settledAt.getTime();
  if (timeDifference !== 0) {
    return timeDifference;
  }
  if (first.matchId < second.matchId) {
    return -1;
  }
  if (first.matchId > second.matchId) {
    return 1;
  }
  return 0;
}

function cloneRatingState(state: GlickoRatingState): GlickoRatingState {
  return {
    ...state,
    lastRatedAt: state.lastRatedAt === null ? null : new Date(state.lastRatedAt.getTime()),
  };
}

/**
 * Replays eligible completed matches into a deterministic, in-memory shadow
 * ledger. It never reads or writes production rating state.
 */
export function simulateGlickoShadow(
  matches: readonly GlickoShadowMatch[],
  config: Glicko1Config = CURRENT_GLICKO1_SHADOW_CONFIG
): GlickoShadowSimulation {
  const orderedMatches = [...matches].sort(compareShadowMatches);
  const seenMatchIds = new Set<string>();
  const players = new Map<string, GlickoRatingState>();
  const settlements: GlickoShadowSettlement[] = [];

  for (const match of orderedMatches) {
    if (match.matchId.trim().length === 0) {
      throw new Error('shadow matchId must not be empty');
    }
    if (seenMatchIds.has(match.matchId)) {
      throw new Error(`duplicate shadow matchId: ${match.matchId}`);
    }
    if (match.firstPlayerId.trim().length === 0 || match.secondPlayerId.trim().length === 0) {
      throw new Error('shadow player IDs must not be empty');
    }
    if (match.firstPlayerId === match.secondPlayerId) {
      throw new Error('a shadow match must contain two different players');
    }
    if (!Number.isFinite(match.settledAt.getTime())) {
      throw new Error('shadow settledAt must be a valid Date');
    }

    seenMatchIds.add(match.matchId);
    const firstBefore = cloneRatingState(
      players.get(match.firstPlayerId) ?? createInitialGlickoRatingState(config)
    );
    const secondBefore = cloneRatingState(
      players.get(match.secondPlayerId) ?? createInitialGlickoRatingState(config)
    );
    const rated = rateGlickoHeadToHead(
      firstBefore,
      secondBefore,
      match.winnerSeat === 'FIRST' ? 1 : 0,
      match.settledAt,
      config
    );
    const firstAfter = cloneRatingState(rated.first);
    const secondAfter = cloneRatingState(rated.second);

    players.set(match.firstPlayerId, firstAfter);
    players.set(match.secondPlayerId, secondAfter);
    settlements.push({
      matchId: match.matchId,
      algorithmVersion: config.algorithmVersion,
      settledAt: new Date(match.settledAt.getTime()),
      firstPlayerId: match.firstPlayerId,
      secondPlayerId: match.secondPlayerId,
      winnerSeat: match.winnerSeat,
      firstBefore,
      secondBefore,
      firstAfter,
      secondAfter,
    });
  }

  return { players, settlements };
}
