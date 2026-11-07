// $1: optional season, $2: RECENT/FULL, $3: recent match limit.
// Select matches before seats: the match limit includes both players, not individual seats.
export const CLASSIFICATION_OBSERVATIONS_QUERY = `WITH selected_matches AS MATERIALIZED (
  SELECT match_id
  FROM ranked_deck_observations
  WHERE ($1::uuid IS NULL OR season_id = $1)
  GROUP BY match_id
  ORDER BY max(observed_at) DESC, match_id DESC
  LIMIT CASE WHEN $2::text = 'FULL' THEN NULL ELSE $3::integer END
)
SELECT observation.match_id, observation.seat, observation.deck_fingerprint,
       observation.main_deck_cards, observation.observed_at
FROM ranked_deck_observations AS observation
JOIN selected_matches USING (match_id)`;
