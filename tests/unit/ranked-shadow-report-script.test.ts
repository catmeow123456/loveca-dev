import { describe, expect, it } from 'vitest';
import {
  buildRankedShadowReport,
  formatRankedShadowReportMarkdown,
  type RankedShadowSourceRow,
} from '../../scripts/generate-ranked-shadow-report.mjs';

function matchRow(
  matchId: string,
  firstUserId: string,
  secondUserId: string,
  winnerSeat: 'FIRST' | 'SECOND',
  day: number
): RankedShadowSourceRow {
  return {
    matchId,
    matchMode: 'ONLINE',
    originKind: 'PUBLIC_TABLE',
    status: 'COMPLETED',
    completeness: 'FULL',
    startedAt: `2026-07-${String(day).padStart(2, '0')}T10:00:00.000Z`,
    endedAt: `2026-07-${String(day).padStart(2, '0')}T11:00:00.000Z`,
    sealedAt: `2026-07-${String(day).padStart(2, '0')}T11:00:01.000Z`,
    firstUserId,
    secondUserId,
    winnerSeat,
    endReason: 'LIVE_SCORE',
    rulesVersion: 'rules-v1',
    cardDataVersion: 'cards-v1',
    cardDataHash: 'sha256:abcdef0123456789',
  };
}

describe('ranked shadow report script', () => {
  it('filters ineligible records and aggregates anonymous rating data', () => {
    const rows: RankedShadowSourceRow[] = [
      matchRow('match-6', 'alice-private-id', 'bob-private-id', 'SECOND', 6),
      matchRow('match-1', 'alice-private-id', 'bob-private-id', 'FIRST', 1),
      matchRow('match-2', 'alice-private-id', 'carol-private-id', 'SECOND', 2),
      matchRow('match-3', 'bob-private-id', 'carol-private-id', 'FIRST', 3),
      matchRow('match-4', 'alice-private-id', 'bob-private-id', 'FIRST', 4),
      matchRow('match-5', 'alice-private-id', 'carol-private-id', 'FIRST', 5),
      {
        ...matchRow('interrupted', 'dave-private-id', 'erin-private-id', 'FIRST', 7),
        status: 'INTERRUPTED',
      },
      {
        ...matchRow('partial', 'dave-private-id', 'erin-private-id', 'FIRST', 8),
        completeness: 'PARTIAL',
      },
      {
        ...matchRow('unsealed', 'dave-private-id', 'erin-private-id', 'FIRST', 9),
        sealedAt: null,
      },
      {
        ...matchRow('room', 'dave-private-id', 'erin-private-id', 'FIRST', 10),
        originKind: 'ONLINE_ROOM',
      },
    ];

    const report = buildRankedShadowReport(rows, {
      generatedAt: new Date('2026-07-30T00:00:00.000Z'),
      origins: ['PUBLIC_TABLE'],
      from: null,
      to: null,
    });

    expect(report.input).toMatchObject({
      selectedRows: 10,
      eligibleMatches: 6,
      excludedRows: 4,
      exclusions: {
        NOT_COMPLETED_OR_SURRENDERED: 1,
        NOT_FULL: 1,
        NOT_SEALED: 1,
        ORIGIN_OUT_OF_SCOPE: 1,
      },
      selectedStatusCounts: {
        COMPLETED: 9,
        INTERRUPTED: 1,
      },
      excludedStatusCounts: {
        COMPLETED: 3,
        INTERRUPTED: 1,
      },
    });
    expect(report.matchSummary).toMatchObject({
      matchCount: 6,
      playerCount: 3,
      placementCompletePlayerCount: 0,
      firstSeatWins: 4,
      secondSeatWins: 2,
      firstSeatWinRate: 0.6667,
    });
    expect(report.opponentMix).toMatchObject({
      uniquePairs: 3,
      repeatedPairs: 2,
      matchesInRepeatedPairs: 5,
      maximumMatchesForOnePair: 3,
    });
    expect(report.leaderboard.map((entry) => entry.matches).sort((a, b) => b - a)).toEqual([
      5, 4, 3,
    ]);
    expect(report.leaderboard.filter((entry) => entry.rank !== null)).toHaveLength(0);
    expect(report.versions).toEqual({
      rules: { 'rules-v1': 6 },
      cardDataVersions: { 'cards-v1': 6 },
      runtimeDeckCardDataHashes: {
        distinctHashes: 1,
        hashesUsedByMultipleMatches: 1,
        maximumMatchesPerHash: 6,
      },
    });
  });

  it('omits raw player and match identities from JSON and Markdown', () => {
    const rawPlayerIds = ['alice-private-id', 'bob-private-id'];
    const rawMatchId = 'private-match-id';
    const report = buildRankedShadowReport(
      [matchRow(rawMatchId, rawPlayerIds[0], rawPlayerIds[1], 'FIRST', 1)],
      {
        generatedAt: new Date('2026-07-30T00:00:00.000Z'),
        origins: ['PUBLIC_TABLE'],
        from: null,
        to: null,
      }
    );
    const json = JSON.stringify(report);
    const markdown = formatRankedShadowReportMarkdown(report);

    for (const secret of [...rawPlayerIds, rawMatchId]) {
      expect(json).not.toContain(secret);
      expect(markdown).not.toContain(secret);
    }
    expect(json).not.toContain('abcdef0123456789');
    expect(markdown).not.toContain('abcdef0123456789');
    expect(report.leaderboard.every((entry) => /^P_[0-9a-f]{12}$/.test(entry.player))).toBe(true);
    expect(markdown).toContain('数据库事务：只读');
    expect(markdown).toContain('不是全局卡牌目录或赛季环境标识');
  });
});
