import type { PlayerBadgeView } from '../../online/player-badge-types.js';
import { pool } from '../db/pool.js';

interface PlayerBadgeRow {
  readonly badge_key: string;
  readonly awarded_at: Date | string;
  readonly criteria_type: 'RANKED_RATED_MATCH_COUNT' | 'THEME_COMPLETED_MATCH_COUNT';
  readonly minimum_value: number;
  readonly image_object_key: string;
  readonly source_season_id: string | null;
  readonly source_season_key: string | null;
  readonly source_season_name: string | null;
  readonly source_theme_id: string | null;
  readonly source_theme_key: string | null;
  readonly source_theme_name: string | null;
}

export class PlayerBadgeServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 500
  ) {
    super(message);
    this.name = 'PlayerBadgeServiceError';
  }
}

export class PlayerBadgeService {
  async listOwnBadges(userId: string): Promise<PlayerBadgeView[]> {
    const result = await pool.query<PlayerBadgeRow>(
      `SELECT
         badge.badge_key,
         badge.awarded_at,
         rule.criteria_type,
         rule.minimum_value,
         rule.image_object_key,
         season.id AS source_season_id,
         season.season_key AS source_season_key,
         season.name AS source_season_name,
         theme.id AS source_theme_id,
         theme.version_key AS source_theme_key,
         theme.name AS source_theme_name
       FROM player_badges AS badge
       JOIN player_badge_rules AS rule ON rule.badge_key = badge.badge_key
       LEFT JOIN ranked_seasons AS season ON season.id = badge.source_season_id
       LEFT JOIN theme_table_versions AS theme
         ON theme.id = badge.source_theme_table_version_id
       WHERE badge.user_id = $1
       ORDER BY badge.awarded_at ASC, badge.badge_key ASC`,
      [userId]
    );
    return result.rows.map(mapPlayerBadgeRow);
  }
}

function mapPlayerBadgeRow(row: PlayerBadgeRow): PlayerBadgeView {
  const rankedSource =
    row.source_season_id && row.source_season_key && row.source_season_name
      ? {
          type: 'RANKED' as const,
          id: row.source_season_id,
          key: row.source_season_key,
          name: row.source_season_name,
        }
      : null;
  const themeSource =
    row.source_theme_id && row.source_theme_key && row.source_theme_name
      ? {
          type: 'THEME' as const,
          id: row.source_theme_id,
          key: row.source_theme_key,
          name: row.source_theme_name,
        }
      : null;
  if ((rankedSource ? 1 : 0) + (themeSource ? 1 : 0) !== 1) {
    throw new PlayerBadgeServiceError(
      'PLAYER_BADGE_SOURCE_INVALID',
      `徽章来源配置无效：${row.badge_key}`
    );
  }
  const sourceActivity = rankedSource ?? themeSource!;
  return {
    key: row.badge_key,
    name: `${sourceActivity.name}纪念徽章`,
    description:
      sourceActivity.type === 'RANKED'
        ? `完成该赛季 ${row.minimum_value} 场有效排位对局，留下属于你的赛季纪念。`
        : `完成该期娱乐模式 ${row.minimum_value} 场有效对局，留下属于你的活动纪念。`,
    imageUrl: `/images/${row.image_object_key}`,
    awardedAt: new Date(row.awarded_at).getTime(),
    sourceActivity,
  };
}

export const playerBadgeService = new PlayerBadgeService();
