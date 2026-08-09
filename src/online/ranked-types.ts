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
  readonly announcement: string;
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

export interface RankedSeasonEnvironmentSampleView {
  /** 已完成计分的赛季对局数。 */
  readonly settledMatchCount: number;
  /** 同时具备双方完整卡组观察事实的对局数。 */
  readonly analyzedMatchCount: number;
  readonly deckObservationCount: number;
  readonly playerCount: number;
  /** analyzedMatchCount / settledMatchCount，无已结算对局时为 0。 */
  readonly coverageRate: number;
}

export interface RankedSeasonCardUsageView {
  readonly rank: number;
  readonly baseCardCode: string;
  /** 用于卡名与卡图展示的当局代表印刷编号。 */
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: 'MEMBER' | 'LIVE';
  readonly imageFilename: string | null;
  /** 玩家等权的卡组采用率，取值为 0..1。 */
  readonly usageRate: number;
  /** 不做玩家权重修正的原始卡组搭载率，取值为 0..1。 */
  readonly deckInclusionRate: number;
  readonly playerCount: number;
  readonly deckCount: number;
  readonly averageCopies: number;
}

export interface RankedSeasonEnvironmentView {
  readonly seasonId: string;
  readonly sample: RankedSeasonEnvironmentSampleView;
  readonly cardUsage: readonly RankedSeasonCardUsageView[];
}

export interface RankedOverviewView {
  readonly season: RankedSeasonPublicView | null;
  readonly availability: RankedAvailabilityView;
  readonly player: RankedPlayerSeasonView | null;
  readonly queue: PublicTableStatusView;
  readonly recentMatches: readonly RankedRecentMatchView[];
  readonly leaderboard: readonly RankedLeaderboardEntryView[];
}
