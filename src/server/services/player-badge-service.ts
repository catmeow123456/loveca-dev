import type { PlayerBadgeView } from '../../online/player-badge-types.js';
import { pool } from '../db/pool.js';
import { getPlayerBadgeCatalogEntry } from '../player-badges/catalog.js';

interface PlayerBadgeRow {
  readonly badge_key: string;
  readonly awarded_at: Date | string;
  readonly source_season_id: string | null;
  readonly source_season_key: string | null;
  readonly source_season_name: string | null;
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
         season.id AS source_season_id,
         season.season_key AS source_season_key,
         season.name AS source_season_name
       FROM player_badges AS badge
       LEFT JOIN ranked_seasons AS season ON season.id = badge.source_season_id
       WHERE badge.user_id = $1
       ORDER BY badge.awarded_at ASC, badge.badge_key ASC`,
      [userId]
    );
    return result.rows.map(mapPlayerBadgeRow);
  }
}

function mapPlayerBadgeRow(row: PlayerBadgeRow): PlayerBadgeView {
  const catalogEntry = getPlayerBadgeCatalogEntry(row.badge_key);
  if (!catalogEntry) {
    throw new PlayerBadgeServiceError(
      'PLAYER_BADGE_DEFINITION_MISSING',
      `找不到徽章定义：${row.badge_key}`
    );
  }
  const hasSourceSeason =
    row.source_season_id !== null &&
    row.source_season_key !== null &&
    row.source_season_name !== null;
  return {
    key: catalogEntry.key,
    name: catalogEntry.name,
    description: catalogEntry.description,
    imagePath: catalogEntry.imagePath,
    awardedAt: new Date(row.awarded_at).getTime(),
    sourceSeason: hasSourceSeason
      ? {
          id: row.source_season_id!,
          seasonKey: row.source_season_key!,
          name: row.source_season_name!,
        }
      : null,
  };
}

export const playerBadgeService = new PlayerBadgeService();
