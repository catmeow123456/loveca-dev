import { describe, expect, it, vi } from 'vitest';
import {
  awardEligibleRankedActivityBadges,
  awardEligibleThemeActivityBadges,
  awardEligibleThemeActivityBadgesForMatch,
} from '../../src/server/player-badges/award';

describe('activity badge award', () => {
  it('does not query when the affected player set is empty', async () => {
    const query = vi.fn();

    await expect(
      awardEligibleRankedActivityBadges({ query }, { seasonId: 'season-1', userIds: [] })
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('uses the ranked activity rule and its qualification match threshold', async () => {
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
      awardEligibleRankedActivityBadges({ query }, { seasonId: 'season-1', userIds })
    ).resolves.toEqual(userIds);

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('JOIN player_badge_rules AS rule');
    expect(sql).toContain("rule.criteria_type = 'RANKED_RATED_MATCH_COUNT'");
    expect(sql).toContain('rating.rated_match_count >= rule.minimum_value');
    expect(sql).toContain("ranked_match.rating_status = 'SETTLED'");
    expect(sql).toContain('OFFSET (rule.minimum_value - 1)');
    expect(sql).toContain('ON CONFLICT (user_id, badge_key) DO NOTHING');
    expect(values).toEqual(['season-1', userIds]);
  });

  it('awards entertainment-mode badges from completed activity matches', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ user_id: '11111111-1111-4111-8111-111111111111' }],
    });

    await awardEligibleThemeActivityBadges(
      { query },
      { themeTableVersionId: 'theme-1', userIds: ['11111111-1111-4111-8111-111111111111'] }
    );

    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM theme_table_assignments AS assignment');
    expect(sql).toContain("rule.criteria_type = 'THEME_COMPLETED_MATCH_COUNT'");
    expect(sql).toContain('OFFSET (rule.minimum_value - 1)');
    expect(sql).toContain('ON CONFLICT (user_id, badge_key) DO NOTHING');
    expect(values).toEqual(['theme-1', ['11111111-1111-4111-8111-111111111111']]);
  });

  it('resolves the entertainment activity and both participants from a sealed match', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            theme_table_version_id: 'theme-1',
            first_user_id: '11111111-1111-4111-8111-111111111111',
            second_user_id: '22222222-2222-4222-8222-222222222222',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await awardEligibleThemeActivityBadgesForMatch({ query }, 'match-1');

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain('assignment.match_id = $1');
    expect(query.mock.calls[1]?.[1]).toEqual([
      'theme-1',
      ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
    ]);
  });
});
