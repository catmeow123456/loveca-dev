import type { PublicTableStatusView } from './public-table-types.js';

export type RankedAvailabilityState =
  | 'NO_SEASON'
  | 'UPCOMING'
  | 'OPEN'
  | 'PAUSED'
  | 'OUTSIDE_WINDOW'
  | 'FINALIZING'
  | 'CLOSED'
  | 'ENVIRONMENT_CHANGED';

export interface RankedSeasonPublicView {
  readonly id: string;
  readonly seasonKey: string;
  readonly name: string;
  readonly lifecycle: 'ACTIVE' | 'FINALIZING' | 'CLOSED';
  readonly platformTimeZone: string;
  readonly startsAt: number;
  readonly scheduledEndsAt: number;
  readonly closedAt: number | null;
  readonly ratingAlgorithmVersion: string;
  readonly placementMatchCount: number;
}

export interface RankedAvailabilityView {
  readonly state: RankedAvailabilityState;
  readonly canJoin: boolean;
  readonly message: string;
  readonly nextOpensAt: number | null;
  readonly currentWindowEndsAt: number | null;
}

export interface RankedPlayerSeasonView {
  readonly placement: boolean;
  readonly placementCompleted: number;
  readonly placementRequired: number;
  readonly rating: number | null;
  readonly ratingDeviation: number | null;
  readonly rank: number | null;
  readonly completedMatches: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number | null;
}

export interface RankedRecentMatchView {
  readonly matchId: string;
  readonly opponentDisplayName: string;
  readonly result: 'WIN' | 'LOSS' | 'VOIDED';
  readonly resultType: string | null;
  readonly endedAt: number | null;
  readonly ratingDelta: number | null;
}

export interface RankedLeaderboardEntryView {
  readonly rank: number;
  readonly userId: string;
  readonly displayName: string;
  readonly rating: number;
  readonly ratingDeviation: number;
  readonly ratedMatchCount: number;
}

export interface RankedOverviewView {
  readonly season: RankedSeasonPublicView | null;
  readonly availability: RankedAvailabilityView;
  readonly player: RankedPlayerSeasonView | null;
  readonly queue: PublicTableStatusView;
  readonly recentMatches: readonly RankedRecentMatchView[];
  readonly leaderboard: readonly RankedLeaderboardEntryView[];
}
