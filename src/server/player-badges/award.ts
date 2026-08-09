import {
  FIRST_RANKED_SEASON_BADGE_CRITERIA_VERSION,
  FIRST_RANKED_SEASON_BADGE_KEY,
  FIRST_RANKED_SEASON_MINIMUM_RATED_MATCH_COUNT,
} from './catalog.js';

export interface PlayerBadgeQueryResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

export interface PlayerBadgeQueryClient {
  query<T = unknown>(text: string, values?: readonly unknown[]): Promise<PlayerBadgeQueryResult<T>>;
}

interface AwardedBadgeRow {
  readonly user_id: string;
}

export interface AwardFirstRankedSeasonBadgeInput {
  readonly seasonId: string;
  readonly userIds?: readonly string[];
}

export async function awardEligibleFirstRankedSeasonBadges(
  client: PlayerBadgeQueryClient,
  input: AwardFirstRankedSeasonBadgeInput
): Promise<readonly string[]> {
  if (input.userIds?.length === 0) {
    return [];
  }
  const result = await client.query<AwardedBadgeRow>(
    `INSERT INTO player_badges (
       user_id,
       badge_key,
       source_season_id,
       criteria_version,
       evidence,
       awarded_at
     )
     SELECT
       rating.user_id,
       $3,
       rating.season_id,
       $4,
       jsonb_build_object(
         'qualification', 'RANKED_RATED_MATCH_COUNT',
         'minimumRatedMatchCount', $5::integer,
         'observedRatedMatchCount', rating.rated_match_count,
         'seasonLedgerRevision', season.ledger_revision,
         'qualificationMatchId', qualification_match.match_id
       ),
       qualification_match.ended_at
     FROM ranked_player_ratings AS rating
     JOIN ranked_seasons AS season ON season.id = rating.season_id
     JOIN player_badge_rules AS rule
      ON rule.badge_key = $3
     AND rule.source_season_id = rating.season_id
     JOIN LATERAL (
       SELECT ranked_match.match_id, ranked_match.ended_at
       FROM ranked_matches AS ranked_match
       WHERE ranked_match.season_id = rating.season_id
         AND ranked_match.rating_status = 'SETTLED'
         AND ranked_match.ended_at IS NOT NULL
         AND (
           ranked_match.first_user_id = rating.user_id
           OR ranked_match.second_user_id = rating.user_id
         )
       ORDER BY ranked_match.ended_at ASC, ranked_match.match_id ASC
       OFFSET ($5::integer - 1)
       LIMIT 1
     ) AS qualification_match ON TRUE
     WHERE rating.season_id = $1
       AND ($2::uuid[] IS NULL OR rating.user_id = ANY($2::uuid[]))
       AND rule.criteria_type = 'RANKED_RATED_MATCH_COUNT'
       AND rule.minimum_value = $5
       AND rule.criteria_version = $4
       AND rating.rated_match_count >= rule.minimum_value
       AND season.lifecycle IN ('ACTIVE', 'FINALIZING', 'CLOSED')
     ON CONFLICT (user_id, badge_key) DO NOTHING
     RETURNING user_id`,
    [
      input.seasonId,
      input.userIds ? [...input.userIds] : null,
      FIRST_RANKED_SEASON_BADGE_KEY,
      FIRST_RANKED_SEASON_BADGE_CRITERIA_VERSION,
      FIRST_RANKED_SEASON_MINIMUM_RATED_MATCH_COUNT,
    ]
  );
  return result.rows.map((row) => row.user_id);
}
