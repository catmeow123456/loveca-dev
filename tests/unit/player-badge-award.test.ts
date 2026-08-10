import { describe, expect, it, vi } from 'vitest';
import { awardEligibleFirstRankedSeasonBadges } from '../../src/server/player-badges/award';
import {
  FIRST_RANKED_SEASON_BADGE_CRITERIA_VERSION,
  FIRST_RANKED_SEASON_BADGE_KEY,
} from '../../src/server/player-badges/catalog';

describe('first ranked season badge award', () => {
  it('does not query when the affected player set is empty', async () => {
    const query = vi.fn();

    await expect(
      awardEligibleFirstRankedSeasonBadges({ query }, { seasonId: 'season-1', userIds: [] })
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('locks the persisted rule to three rated matches and the third effective match date', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        { user_id: '11111111-1111-4111-8111-111111111111' },
        { user_id: '22222222-2222-4222-8222-222222222222' },
      ],
    });
    const userIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];

    await expect(
      awardEligibleFirstRankedSeasonBadges({ query }, { seasonId: 'season-1', userIds })
    ).resolves.toEqual(userIds);

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('JOIN player_badge_rules AS rule');
    expect(sql).toContain("rule.criteria_type = 'RANKED_RATED_MATCH_COUNT'");
    expect(sql).toContain('rating.rated_match_count >= rule.minimum_value');
    expect(sql).toContain("ranked_match.rating_status = 'SETTLED'");
    expect(sql).toContain('OFFSET ($5::integer - 1)');
    expect(sql).toContain('ON CONFLICT (user_id, badge_key) DO NOTHING');
    expect(values).toEqual([
      'season-1',
      userIds,
      FIRST_RANKED_SEASON_BADGE_KEY,
      FIRST_RANKED_SEASON_BADGE_CRITERIA_VERSION,
      3,
    ]);
  });
});
