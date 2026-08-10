export interface PlayerBadgeCatalogEntry {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly imagePath: string;
}

export const FIRST_RANKED_SEASON_BADGE_KEY = 'ranked-first-season-qualified';
export const FIRST_RANKED_SEASON_BADGE_CRITERIA_VERSION = 'RANKED_FIRST_SEASON_THREE_MATCHES_V1';
export const FIRST_RANKED_SEASON_MINIMUM_RATED_MATCH_COUNT = 3;

const PLAYER_BADGE_CATALOG = new Map<string, PlayerBadgeCatalogEntry>([
  [
    FIRST_RANKED_SEASON_BADGE_KEY,
    {
      key: FIRST_RANKED_SEASON_BADGE_KEY,
      name: '首届排位·定级纪念',
      description: '完成 Loveca 首届赛季排位定级，感谢你见证排位启程。',
      imagePath: '/badges/first-ranked-season.png',
    },
  ],
]);

export function getPlayerBadgeCatalogEntry(badgeKey: string): PlayerBadgeCatalogEntry | null {
  return PLAYER_BADGE_CATALOG.get(badgeKey) ?? null;
}
