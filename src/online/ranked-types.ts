import type { PublicTableStatusView } from './public-table-types.js';
import type { DeckClassifierDisplayMode, DeckEnvironmentSection } from './deck-classifier-types.js';

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
  /** 至少有一个胜方卡组观察的玩家数；未展示胜者构成时为 0。 */
  readonly winningPlayerCount: number;
  /** 当前排行榜前 N 中实际满足排行榜门槛的人数；未展示高排名玩家时为 0。 */
  readonly topRankedEligiblePlayerCount: number;
  /** 上述玩家中至少有一个可分析卡组观察的人数；未展示高排名玩家时为 0。 */
  readonly topRankedAnalyzedPlayerCount: number;
  /** 上述可分析高排名玩家贡献的卡组观察席位数；未展示高排名玩家时为 0。 */
  readonly topRankedDeckObservationCount: number;
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
  /** 当前分区与计权口径下的卡组采用率，取值为 0..1。 */
  readonly adoptionRate: number;
  readonly playerCount: number;
  readonly deckCount: number;
  readonly averageCopies: number;
}

export type RankedSeasonCardEnvironmentWeighting = 'PLAYER_EQUAL' | 'MATCH_EQUAL';

export interface RankedSeasonCardRankingView {
  readonly section: DeckEnvironmentSection;
  readonly weighting: RankedSeasonCardEnvironmentWeighting;
  readonly cards: readonly RankedSeasonCardUsageView[];
}

export interface RankedSeasonEnvironmentView {
  readonly seasonId: string;
  readonly displayMode: DeckClassifierDisplayMode;
  readonly visibleSections: readonly DeckEnvironmentSection[];
  readonly topRankedPlayerCount: number;
  readonly sample: RankedSeasonEnvironmentSampleView;
  readonly rankings: readonly RankedSeasonCardRankingView[];
}

export interface RankedOverviewView {
  readonly season: RankedSeasonPublicView | null;
  readonly availability: RankedAvailabilityView;
  readonly player: RankedPlayerSeasonView | null;
  readonly queue: PublicTableStatusView;
  readonly recentMatches: readonly RankedRecentMatchView[];
  readonly leaderboard: readonly RankedLeaderboardEntryView[];
}
