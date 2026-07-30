export interface RankedShadowSourceRow {
  readonly matchId: string;
  readonly matchMode: string;
  readonly originKind: string;
  readonly status: string;
  readonly completeness: string;
  readonly startedAt: Date | string;
  readonly endedAt: Date | string | null;
  readonly sealedAt: Date | string | null;
  readonly firstUserId: string;
  readonly secondUserId: string;
  readonly winnerSeat: string | null;
  readonly endReason: string | null;
  readonly rulesVersion: string;
  readonly cardDataVersion: string;
  readonly cardDataHash: string;
}

export interface RankedShadowReportScope {
  readonly generatedAt: Date;
  readonly origins: readonly string[];
  readonly from: Date | null;
  readonly to: Date | null;
}

export interface RankedShadowReport {
  readonly schemaVersion: string;
  readonly generatedAt: string;
  readonly input: {
    readonly selectedRows: number;
    readonly eligibleMatches: number;
    readonly excludedRows: number;
    readonly exclusions: Readonly<Record<string, number>>;
    readonly selectedStatusCounts: Readonly<Record<string, number>>;
    readonly excludedStatusCounts: Readonly<Record<string, number>>;
  };
  readonly matchSummary: {
    readonly matchCount: number;
    readonly playerCount: number;
    readonly placementCompletePlayerCount: number;
    readonly firstSeatWins: number;
    readonly secondSeatWins: number;
    readonly firstSeatWinRate: number | null;
  };
  readonly opponentMix: {
    readonly uniquePairs: number;
    readonly repeatedPairs: number;
    readonly matchesInRepeatedPairs: number;
    readonly maximumMatchesForOnePair: number;
  };
  readonly versions: {
    readonly rules: Readonly<Record<string, number>>;
    readonly cardDataVersions: Readonly<Record<string, number>>;
    readonly runtimeDeckCardDataHashes: {
      readonly distinctHashes: number;
      readonly hashesUsedByMultipleMatches: number;
      readonly maximumMatchesPerHash: number;
    };
  };
  readonly leaderboard: readonly {
    readonly player: string;
    readonly rating: number;
    readonly displayedRating: number;
    readonly ratingDeviation: number;
    readonly matches: number;
    readonly wins: number;
    readonly losses: number;
    readonly rank: number | null;
  }[];
  readonly limitations: readonly string[];
}

export function buildRankedShadowReport(
  rows: readonly RankedShadowSourceRow[],
  scope: RankedShadowReportScope
): RankedShadowReport;

export function formatRankedShadowReportMarkdown(report: RankedShadowReport): string;
