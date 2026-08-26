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
          criteria_type: 'RANKED_RATED_MATCH_COUNT',
          minimum_value: 3,
          image_object_key: 'activity-badges/11111111-1111-4111-8111-111111111111/badge.webp',
          source_season_id: '11111111-1111-4111-8111-111111111111',
          source_season_key: 'ranked-season-one',
          source_season_name: '第一赛季',
          source_theme_id: null,
          source_theme_key: null,
          source_theme_name: null,
        },
      ],
    });

    await expect(new PlayerBadgeService().listOwnBadges('player-1')).resolves.toEqual([
      {
        key: 'ranked-first-season-qualified',
        name: '第一赛季纪念徽章',
        description: '完成该赛季 3 场有效排位对局，留下属于你的赛季纪念。',
        imageUrl: '/images/activity-badges/11111111-1111-4111-8111-111111111111/badge.webp',
        awardedAt: new Date('2026-08-03T12:00:00.000Z').getTime(),
        sourceActivity: {
          type: 'RANKED',
          id: '11111111-1111-4111-8111-111111111111',
          key: 'ranked-season-one',
          name: '第一赛季',
        },
      },
    ]);
    const [sql, values] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE badge.user_id = $1');
    expect(values).toEqual(['player-1']);
  });

  it('maps an entertainment-mode badge to its activity metadata', async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          badge_key: 'activity-theme-22222222-2222-4222-8222-222222222222',
          awarded_at: new Date('2026-08-26T12:00:00.000Z'),
          criteria_type: 'THEME_COMPLETED_MATCH_COUNT',
          minimum_value: 3,
          image_object_key: 'activity-badges/33333333-3333-4333-8333-333333333333/badge.webp',
          source_season_id: null,
          source_season_key: null,
          source_season_name: null,
          source_theme_id: '22222222-2222-4222-8222-222222222222',
          source_theme_key: 'summer-special',
          source_theme_name: '盛夏特别活动',
        },
      ],
    });

    await expect(new PlayerBadgeService().listOwnBadges('player-1')).resolves.toEqual([
      {
        key: 'activity-theme-22222222-2222-4222-8222-222222222222',
        name: '盛夏特别活动纪念徽章',
        description: '完成该期娱乐模式 3 场有效对局，留下属于你的活动纪念。',
        imageUrl: '/images/activity-badges/33333333-3333-4333-8333-333333333333/badge.webp',
        awardedAt: new Date('2026-08-26T12:00:00.000Z').getTime(),
        sourceActivity: {
          type: 'THEME',
          id: '22222222-2222-4222-8222-222222222222',
          key: 'summer-special',
          name: '盛夏特别活动',
        },
      },
    ]);
  });

  it('fails closed when persisted data does not resolve exactly one activity source', async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          badge_key: 'unknown-badge',
          awarded_at: new Date(),
          criteria_type: 'RANKED_RATED_MATCH_COUNT',
          minimum_value: 3,
          image_object_key: 'activity-badges/11111111-1111-4111-8111-111111111111/badge.webp',
          source_season_id: null,
          source_season_key: null,
          source_season_name: null,
          source_theme_id: null,
          source_theme_key: null,
          source_theme_name: null,
        },
      ],
    });

    await expect(new PlayerBadgeService().listOwnBadges('player-1')).rejects.toBeInstanceOf(
      PlayerBadgeServiceError
    );
  });
});
