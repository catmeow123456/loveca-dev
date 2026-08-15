import { describe, expect, it } from 'vitest';
import {
  buildRankedVolatilityReport,
  formatRankedVolatilityReportMarkdown,
} from '../../scripts/generate-ranked-volatility-report.mjs';

const CONFIG = {
  algorithmVersion: 'GLICKO1_PER_MATCH_V2',
  ratingPeriodMode: 'PER_MATCH',
  initialRating: 1500,
  initialRatingDeviation: 300,
  minimumRatingDeviation: 30,
  maximumRatingDeviation: 350,
  inactivityTimeUnitMs: 86_400_000,
  deviationIncreasePerTimeUnit: 18.131936556464982,
  placementMatchCount: 10,
  displayDecimalPlaces: 0,
};

describe('ranked volatility report script', () => {
  it('replays final correction directives, reports short-sample leaderboard risk, and omits raw IDs', () => {
    const report = buildRankedVolatilityReport(
      {
        seasons: [
          {
            id: 'season-private-id',
            season_key: 'ranked-2026-08',
            name: '八月排位',
            lifecycle: 'ACTIVE',
            queue_admission: 'OPEN',
            starts_at: '2026-08-01T00:00:00.000Z',
            scheduled_ends_at: '2026-09-01T00:00:00.000Z',
            rating_algorithm_version: CONFIG.algorithmVersion,
            rating_config: CONFIG,
            leaderboard_minimum_match_count: 1,
            ledger_revision: 3,
          },
        ],
        players: [
          { userId: 'alice-private-id', name: '双方' },
          { userId: 'bob-private-id', name: '对手' },
        ],
        seeds: [],
        projections: [
          {
            userId: 'alice-private-id',
            rating: 1689.074944321734,
            ratingDeviation: 229.378162349469,
            ratedMatchCount: 2,
          },
          {
            userId: 'bob-private-id',
            rating: 1310.925055678266,
            ratingDeviation: 229.378162349469,
            ratedMatchCount: 2,
          },
        ],
        events: [
          {
            id: 'event-1',
            eventSequence: 1,
            eventType: 'SETTLEMENT',
            matchId: 'match-private-1',
            targetEventId: null,
            firstUserId: 'alice-private-id',
            secondUserId: 'bob-private-id',
            winnerSeat: 'FIRST',
            resultType: 'NORMAL',
            ratedAt: '2026-08-01T10:00:00.000Z',
            algorithmVersion: CONFIG.algorithmVersion,
          },
          {
            id: 'event-2',
            eventSequence: 2,
            eventType: 'SETTLEMENT',
            matchId: 'match-private-2',
            targetEventId: null,
            firstUserId: 'alice-private-id',
            secondUserId: 'bob-private-id',
            winnerSeat: 'FIRST',
            resultType: 'NORMAL',
            ratedAt: '2026-08-01T11:00:00.000Z',
            algorithmVersion: CONFIG.algorithmVersion,
          },
          {
            id: 'event-3',
            eventSequence: 3,
            eventType: 'REPLACEMENT',
            matchId: 'match-private-2',
            targetEventId: 'event-2',
            firstUserId: 'alice-private-id',
            secondUserId: 'bob-private-id',
            winnerSeat: 'FIRST',
            resultType: 'NORMAL',
            ratedAt: '2026-08-01T11:00:00.000Z',
            algorithmVersion: CONFIG.algorithmVersion,
          },
        ],
        match_status_counts: { 'SETTLED:NORMAL': 2 },
      },
      new Date('2026-08-02T00:00:00.000Z')
    );

    expect(report.ratingLedger).toMatchObject({
      totalEvents: 3,
      effectiveRatedMatches: 2,
      projectionMatchesLedger: true,
    });
    expect(report.leaderboardScenarios.find((entry) => entry.minimumMatches === 1)).toMatchObject({
      eligiblePlayers: 2,
      leader: expect.objectContaining({ player: '双方', matches: 2 }),
    });
    expect(
      report.leaderboardScenarios.find((entry) => entry.minimumMatches === 3)?.eligiblePlayers
    ).toBe(0);
    expect(report.perMatchChange.byPlayerPreMatchCount['第 1 局']?.max).toBeCloseTo(134.865, 3);

    const exported = `${JSON.stringify(report)}\n${formatRankedVolatilityReportMarkdown(report)}`;
    expect(exported).toContain('双方');
    expect(exported).not.toContain('alice-private-id');
    expect(exported).not.toContain('match-private-1');
    expect(exported).not.toContain('event-1');
  });
});
