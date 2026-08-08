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
});
