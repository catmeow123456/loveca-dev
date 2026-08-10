import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { GLICKO1_PER_MATCH_V2 } from '../../src/server/rating/glicko';
import { RankedPlayerService } from '../../src/server/services/ranked-player-service';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: vi.fn() },
}));
vi.mock('../../src/server/services/public-table-service.js', () => ({
  publicTableService: {
    getStatus: vi.fn().mockResolvedValue({ state: 'IDLE' }),
  },
}));

import { pool } from '../../src/server/db/pool';

describe('RankedPlayerService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps an active season open when the published card catalog changes', () => {
    const service = new RankedPlayerService({
      now: () => new Date('2026-08-03T04:00:00.000Z'),
    });
    const buildAvailability = Reflect.get(service, 'buildAvailability') as (
      season: Record<string, unknown>
    ) => { state: string; canJoin: boolean };
    const availability = buildAvailability.call(service, {
      lifecycle: 'ACTIVE',
      queue_admission: 'OPEN',
      competitive_environment_id: `sha256:${'a'.repeat(64)}`,
      platform_time_zone: 'Asia/Shanghai',
      open_windows: [{ weekdays: [1], startMinute: 0, endMinute: 1440 }],
      starts_at: new Date('2026-08-01T00:00:00.000Z'),
      scheduled_ends_at: new Date('2026-09-01T00:00:00.000Z'),
    });

    expect(availability).toMatchObject({ state: 'OPEN', canJoin: true });
  });

  it('hides a seeded rating until the player has a settled match', async () => {
    // The mocked pg query overload otherwise resolves to its callback signature.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const queryMock = pool.query as unknown as Mock<(text: unknown) => Promise<never>>;
    queryMock.mockImplementation((text: unknown) => {
      const sql = String(text);
      if (sql.includes('FROM gameplay_participations')) {
        return Promise.resolve({ rows: [], rowCount: 0 } as never);
      }
      if (sql.includes("WHERE lifecycle IN ('ACTIVE', 'FINALIZING')")) {
        return Promise.resolve({
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              season_key: 'season-2026-01',
              name: '第一赛季',
              announcement: '本赛季周末全天开放',
              lifecycle: 'FINALIZING',
              queue_admission: 'PAUSED',
              competitive_environment_id: `sha256:${'a'.repeat(64)}`,
              platform_time_zone: 'Asia/Shanghai',
              open_windows: [{ weekdays: [1], startMinute: 0, endMinute: 1440 }],
              starts_at: new Date('2026-08-01T00:00:00.000Z'),
              scheduled_ends_at: new Date('2026-09-01T00:00:00.000Z'),
              closed_at: null,
              rating_algorithm_version: GLICKO1_PER_MATCH_V2.algorithmVersion,
              rating_config: GLICKO1_PER_MATCH_V2,
              leaderboard_minimum_match_count: 10,
            },
          ],
          rowCount: 1,
        } as never);
      }
      if (sql.includes('FROM ranked_player_ratings') && sql.includes('WHERE season_id = $1')) {
        return Promise.resolve({
          rows: [{ rating: 1500, rating_deviation: 300, rated_match_count: 0 }],
          rowCount: 1,
        } as never);
      }
      if (sql.includes('COUNT(*) FILTER')) {
        return Promise.resolve({
          rows: [{ completed_matches: 0, wins: 0, losses: 0 }],
          rowCount: 1,
        } as never);
      }
      return Promise.resolve({ rows: [], rowCount: 0 } as never);
    });

    const overview = await new RankedPlayerService({
      now: () => new Date('2026-09-01T00:00:00.000Z'),
    }).getOverview('22222222-2222-4222-8222-222222222222');

    expect(overview.player).toMatchObject({
      placement: true,
      placementCompleted: 0,
      rating: null,
      ratingDeviation: null,
    });
    expect(overview.season?.announcement).toBe('本赛季周末全天开放');
  });

  it('returns the exact personal rank outside the public top ten', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const queryMock = pool.query as unknown as Mock<
      (text: unknown, values?: unknown[]) => Promise<never>
    >;
    queryMock.mockImplementation((text: unknown, values?: unknown[]) => {
      const sql = String(text);
      if (sql.includes('SELECT rating, rating_deviation, rated_match_count')) {
        expect(values).toEqual(['season-1', 'player-37']);
        return Promise.resolve({
          rows: [{ rating: 1528.4, rating_deviation: 87.6, rated_match_count: 12 }],
          rowCount: 1,
        } as never);
      }
      if (sql.includes('COUNT(*) FILTER')) {
        expect(values).toEqual(['season-1', 'player-37']);
        return Promise.resolve({
          rows: [{ completed_matches: 12, wins: 7, losses: 5 }],
          rowCount: 1,
        } as never);
      }
      if (sql.includes('SELECT 1 + COUNT(*) AS rank')) {
        expect(values).toEqual(['season-1', 10, 1528.4, 'player-37']);
        return Promise.resolve({ rows: [{ rank: '37' }], rowCount: 1 } as never);
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const service = new RankedPlayerService();
    const loadPlayerSeason = Reflect.get(service, 'loadPlayerSeason') as (
      seasonId: string,
      userId: string,
      leaderboardMinimumMatchCount: number
    ) => Promise<Record<string, unknown>>;

    await expect(
      loadPlayerSeason.call(service, 'season-1', 'player-37', 10)
    ).resolves.toMatchObject({
      placement: false,
      placementCompleted: 10,
      rating: 1528,
      ratingDeviation: 88,
      rank: 37,
      completedMatches: 12,
      wins: 7,
      losses: 5,
    });
  });

  it('only exposes the public top ten leaderboard entries', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const queryMock = pool.query as unknown as Mock<
      (text: unknown, values?: unknown[]) => Promise<never>
    >;
    queryMock.mockImplementation((text: unknown, values?: unknown[]) => {
      const sql = String(text);
      expect(sql).toContain('ORDER BY rating.rating DESC, rating.user_id ASC');
      expect(sql).toContain('LIMIT 10');
      expect(values).toEqual(['season-1', 10]);
      return Promise.resolve({
        rows: Array.from({ length: 10 }, (_, index) => ({
          user_id: `player-${index + 1}`,
          display_name: `Player ${index + 1}`,
          rating: 1600 - index,
          rating_deviation: 80,
          rated_match_count: 12,
        })),
        rowCount: 10,
      } as never);
    });

    const service = new RankedPlayerService();
    const loadLeaderboard = Reflect.get(service, 'loadLeaderboard') as (
      seasonId: string,
      leaderboardMinimumMatchCount: number
    ) => Promise<Array<{ rank: number; userId: string }>>;

    const leaderboard = await loadLeaderboard.call(service, 'season-1', 10);
    expect(leaderboard).toHaveLength(10);
    expect(leaderboard[0]).toMatchObject({ rank: 1, userId: 'player-1' });
    expect(leaderboard[9]).toMatchObject({ rank: 10, userId: 'player-10' });
  });
});
