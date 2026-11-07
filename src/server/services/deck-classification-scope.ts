import type { PoolClient } from 'pg';
import { DECK_CLASSIFIER_MAX_RECENT_MATCH_LIMIT } from '../../online/deck-classifier-types.js';

export function assertRecentMatchLimit(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > DECK_CLASSIFIER_MAX_RECENT_MATCH_LIMIT) {
    throw new Error(`近期重算场数必须为 1～${DECK_CLASSIFIER_MAX_RECENT_MATCH_LIMIT} 的整数`);
  }
}

export async function readRecentMatchLimit(client: Pick<PoolClient, 'query'>): Promise<number> {
  const result = await client.query<{ recent_match_limit: number }>(
    'SELECT recent_match_limit FROM deck_classifier_settings WHERE id = 1'
  );
  const value = result.rows[0]?.recent_match_limit;
  if (value === undefined) throw new Error('卡组分类设置不存在');
  assertRecentMatchLimit(value);
  return value;
}

// $1: optional season, $2: captured match limit (NULL means all history).
// Select matches before seats: the match limit includes both players, not individual seats.
export const CLASSIFICATION_OBSERVATIONS_QUERY = `WITH selected_matches AS MATERIALIZED (
  SELECT match_id
  FROM ranked_deck_observations
  WHERE ($1::uuid IS NULL OR season_id = $1)
  GROUP BY match_id
  ORDER BY max(observed_at) DESC, match_id DESC
  LIMIT $2::integer
)
SELECT observation.match_id, observation.seat, observation.deck_fingerprint,
       observation.main_deck_cards, observation.observed_at
FROM ranked_deck_observations AS observation
JOIN selected_matches USING (match_id)`;
