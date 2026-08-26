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

export interface AwardEligibleRankedActivityBadgesInput {
  readonly seasonId: string;
  readonly userIds?: readonly string[];
}

export async function awardEligibleRankedActivityBadges(
  client: PlayerBadgeQueryClient,
  input: AwardEligibleRankedActivityBadgesInput
): Promise<readonly string[]> {
  if (input.userIds?.length === 0) return [];
  const result = await client.query<AwardedBadgeRow>(
    `INSERT INTO player_badges (
       user_id,
       badge_key,
       source_season_id,
       source_theme_table_version_id,
       criteria_version,
       evidence,
       awarded_at
     )
     SELECT
       rating.user_id,
       rule.badge_key,
       rating.season_id,
       NULL,
       rule.criteria_version,
       jsonb_build_object(
         'qualification', 'RANKED_RATED_MATCH_COUNT',
         'minimumRatedMatchCount', rule.minimum_value,
         'observedRatedMatchCount', rating.rated_match_count,
         'seasonLedgerRevision', season.ledger_revision,
         'qualificationMatchId', qualification_match.match_id
       ),
       qualification_match.ended_at
     FROM ranked_player_ratings AS rating
     JOIN ranked_seasons AS season ON season.id = rating.season_id
     JOIN player_badge_rules AS rule
       ON rule.source_season_id = rating.season_id
      AND rule.source_theme_table_version_id IS NULL
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
       OFFSET (rule.minimum_value - 1)
       LIMIT 1
     ) AS qualification_match ON TRUE
     WHERE rating.season_id = $1
       AND ($2::uuid[] IS NULL OR rating.user_id = ANY($2::uuid[]))
       AND rule.criteria_type = 'RANKED_RATED_MATCH_COUNT'
       AND rating.rated_match_count >= rule.minimum_value
       AND season.lifecycle IN ('ACTIVE', 'FINALIZING', 'CLOSED')
     ON CONFLICT (user_id, badge_key) DO NOTHING
     RETURNING user_id`,
    [input.seasonId, input.userIds ? [...input.userIds] : null]
  );
  return result.rows.map((row) => row.user_id);
}

export interface AwardEligibleThemeActivityBadgesInput {
  readonly themeTableVersionId: string;
  readonly userIds?: readonly string[];
}

export async function awardEligibleThemeActivityBadges(
  client: PlayerBadgeQueryClient,
  input: AwardEligibleThemeActivityBadgesInput
): Promise<readonly string[]> {
  if (input.userIds?.length === 0) return [];
  const result = await client.query<AwardedBadgeRow>(
    `WITH participant_matches AS (
       SELECT record.first_user_id AS user_id, record.match_id, record.ended_at
       FROM theme_table_assignments AS assignment
       JOIN match_records AS record ON record.match_id = assignment.match_id
       WHERE assignment.theme_table_version_id = $1
         AND record.ended_at IS NOT NULL
         AND (
           (record.status IN ('COMPLETED', 'SURRENDERED')
             AND record.winner_seat IN ('FIRST', 'SECOND'))
           OR (record.status = 'COMPLETED' AND record.winner_seat IS NULL)
         )
       UNION ALL
       SELECT record.second_user_id AS user_id, record.match_id, record.ended_at
       FROM theme_table_assignments AS assignment
       JOIN match_records AS record ON record.match_id = assignment.match_id
       WHERE assignment.theme_table_version_id = $1
         AND record.ended_at IS NOT NULL
         AND (
           (record.status IN ('COMPLETED', 'SURRENDERED')
             AND record.winner_seat IN ('FIRST', 'SECOND'))
           OR (record.status = 'COMPLETED' AND record.winner_seat IS NULL)
         )
     ), participant_totals AS (
       SELECT user_id, COUNT(*)::integer AS completed_match_count
       FROM participant_matches
       WHERE $2::uuid[] IS NULL OR user_id = ANY($2::uuid[])
       GROUP BY user_id
     )
     INSERT INTO player_badges (
       user_id,
       badge_key,
       source_season_id,
       source_theme_table_version_id,
       criteria_version,
       evidence,
       awarded_at
     )
     SELECT
       total.user_id,
       rule.badge_key,
       NULL,
       rule.source_theme_table_version_id,
       rule.criteria_version,
       jsonb_build_object(
         'qualification', 'THEME_COMPLETED_MATCH_COUNT',
         'minimumCompletedMatchCount', rule.minimum_value,
         'observedCompletedMatchCount', total.completed_match_count,
         'qualificationMatchId', qualification_match.match_id
       ),
       qualification_match.ended_at
     FROM participant_totals AS total
     JOIN player_badge_rules AS rule
       ON rule.source_theme_table_version_id = $1
      AND rule.source_season_id IS NULL
     JOIN LATERAL (
       SELECT participant.match_id, participant.ended_at
       FROM participant_matches AS participant
       WHERE participant.user_id = total.user_id
       ORDER BY participant.ended_at ASC, participant.match_id ASC
       OFFSET (rule.minimum_value - 1)
       LIMIT 1
     ) AS qualification_match ON TRUE
     WHERE rule.criteria_type = 'THEME_COMPLETED_MATCH_COUNT'
       AND total.completed_match_count >= rule.minimum_value
     ON CONFLICT (user_id, badge_key) DO NOTHING
     RETURNING user_id`,
    [input.themeTableVersionId, input.userIds ? [...input.userIds] : null]
  );
  return result.rows.map((row) => row.user_id);
}

interface ThemeMatchContextRow {
  readonly theme_table_version_id: string;
  readonly first_user_id: string;
  readonly second_user_id: string;
}

export async function awardEligibleThemeActivityBadgesForMatch(
  client: PlayerBadgeQueryClient,
  matchId: string
): Promise<readonly string[]> {
  const context = await client.query<ThemeMatchContextRow>(
    `SELECT
       assignment.theme_table_version_id,
       record.first_user_id,
       record.second_user_id
     FROM theme_table_assignments AS assignment
     JOIN match_records AS record ON record.match_id = assignment.match_id
     WHERE assignment.match_id = $1
       AND record.ended_at IS NOT NULL
       AND (
         (record.status IN ('COMPLETED', 'SURRENDERED')
           AND record.winner_seat IN ('FIRST', 'SECOND'))
         OR (record.status = 'COMPLETED' AND record.winner_seat IS NULL)
       )`,
    [matchId]
  );
  const row = context.rows[0];
  if (!row) return [];
  return awardEligibleThemeActivityBadges(client, {
    themeTableVersionId: row.theme_table_version_id,
    userIds: [row.first_user_id, row.second_user_id],
  });
}
