import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: mocks.query },
}));

import {
  PlayerBadgeService,
  PlayerBadgeServiceError,
} from '../../src/server/services/player-badge-service';

describe('PlayerBadgeService', () => {
  beforeEach(() => mocks.query.mockReset());

  it('returns only the requested player badges with source season metadata', async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          badge_key: 'ranked-first-season-qualified',
          awarded_at: new Date('2026-08-03T12:00:00.000Z'),
          source_season_id: '11111111-1111-4111-8111-111111111111',
          source_season_key: 'ranked-season-one',
          source_season_name: '第一赛季',
        },
      ],
    });

    await expect(new PlayerBadgeService().listOwnBadges('player-1')).resolves.toEqual([
      {
        key: 'ranked-first-season-qualified',
        name: '首届排位·定级纪念',
        description: '完成 Loveca 首届赛季排位定级，感谢你见证排位启程。',
        imagePath: '/badges/first-ranked-season.png',
        awardedAt: new Date('2026-08-03T12:00:00.000Z').getTime(),
        sourceSeason: {
          id: '11111111-1111-4111-8111-111111111111',
          seasonKey: 'ranked-season-one',
          name: '第一赛季',
        },
      },
    ]);
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE badge.user_id = $1');
    expect(values).toEqual(['player-1']);
  });

  it('fails closed when persisted data references an undeployed badge definition', async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          badge_key: 'unknown-badge',
          awarded_at: new Date(),
          source_season_id: null,
          source_season_key: null,
          source_season_name: null,
        },
      ],
    });

    await expect(new PlayerBadgeService().listOwnBadges('player-1')).rejects.toBeInstanceOf(
      PlayerBadgeServiceError
    );
  });
});
