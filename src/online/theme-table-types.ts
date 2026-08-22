import type { PublicTableStatusView } from './public-table-types.js';

export type ThemeTableAvailabilityState =
  'OPEN' | 'UPCOMING' | 'PAUSED' | 'ENVIRONMENT_CHANGED' | 'CLOSED' | 'NO_EVENT';

export type ThemeDeckDifficulty = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export interface ThemeDeckListEntryView {
  readonly cardCode: string;
  readonly count: number;
}

export interface ThemePrebuiltDeckView {
  readonly id: string;
  readonly deckKey: string;
  readonly displayName: string;
  readonly playStyleTags: readonly string[];
  readonly difficulty: ThemeDeckDifficulty;
  readonly sourceLabel: string;
  readonly sourceUrl: string | null;
  readonly contentHash: string;
  readonly mainDeck: readonly ThemeDeckListEntryView[];
  readonly energyDeck: readonly ThemeDeckListEntryView[];
}

export interface ThemeMatchupStatisticsView {
  readonly firstDeckVersionId: string;
  readonly secondDeckVersionId: string;
  readonly completedMatches: number;
  readonly firstDeckWins: number;
  readonly secondDeckWins: number;
  readonly draws: number;
}

export interface ThemeTableEventView {
  readonly id: string;
  readonly versionKey: string;
  readonly name: string;
  readonly summary: string;
  readonly announcement: string;
  readonly scheduleLabel: string;
  readonly startsAt: number;
  readonly endsAt: number;
  readonly allocationAlgorithmVersion: string;
  readonly prebuiltDecks: readonly ThemePrebuiltDeckView[];
  readonly matchupStatistics: readonly ThemeMatchupStatisticsView[];
}

export interface ThemeTablePlayerSeasonView {
  readonly completedMatches: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly winRate: number | null;
}

export interface ThemeTableOverviewView {
  readonly event: ThemeTableEventView | null;
  readonly availability: {
    readonly state: ThemeTableAvailabilityState;
    readonly canJoin: boolean;
    readonly message: string;
  };
  readonly player: ThemeTablePlayerSeasonView | null;
  readonly queue: PublicTableStatusView;
}

export interface ThemeTableEvaluationPolicy {
  readonly minimumCompletedMatchesPerPair: number;
  readonly minimumCompletionRate: number;
  readonly maximumExceptionRate: number;
  readonly maximumExposureDeviation: number;
  readonly maximumMedianWaitSeconds: number;
  readonly winRateLowerBound: number;
  readonly winRateUpperBound: number;
  readonly baselineWindowLabel: string;
}

export interface ThemeAdminDeckView extends ThemePrebuiltDeckView {
  readonly reviewNote: string;
  readonly approvedAt: number;
}

export interface ThemeAdminMatchupView {
  readonly id: string;
  readonly firstDeckVersionId: string;
  readonly firstDeckName: string;
  readonly secondDeckVersionId: string;
  readonly secondDeckName: string;
  readonly weight: number;
  readonly enabled: boolean;
  readonly testSummary: Readonly<Record<string, unknown>>;
  readonly approvedAt: number;
}

export interface ThemeAdminMetricsView {
  readonly joinedTicketCount: number;
  readonly assignmentCount: number;
  readonly startedMatchCount: number;
  readonly completedMatchCount: number;
  readonly noFaultRequeueCount: number;
  readonly deckExposure: readonly {
    readonly deckVersionId: string;
    readonly displayName: string;
    readonly assignmentCount: number;
    readonly expectedShare: number;
    readonly actualShare: number;
    readonly deviation: number;
  }[];
}

export interface ThemeAdminEventView {
  readonly id: string;
  readonly versionKey: string;
  readonly name: string;
  readonly lifecycle: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
  readonly environmentId: string;
  readonly rulesEnvironmentId: string;
  readonly cardCatalogHash: string;
  readonly allocationAlgorithmVersion: string;
  readonly platformTimeZone: string;
  readonly openWindows: readonly {
    readonly weekdays: readonly number[];
    readonly startMinute: number;
    readonly endMinute: number;
  }[];
  readonly startsAt: number;
  readonly endsAt: number;
  readonly scheduleLabel: string;
  readonly summary: string;
  readonly announcement: string;
  readonly evaluationPolicy: ThemeTableEvaluationPolicy;
  readonly decks: readonly ThemeAdminDeckView[];
  readonly matchups: readonly ThemeAdminMatchupView[];
  readonly metrics: ThemeAdminMetricsView;
}
