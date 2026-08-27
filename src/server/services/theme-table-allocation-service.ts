import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

interface SelectedPairRow {
  readonly pair_id: string;
  readonly weight: number;
  readonly first_deck_id: string;
  readonly first_content_hash: string;
  readonly second_deck_id: string;
  readonly second_content_hash: string;
  readonly allocation_algorithm_version: string;
}

export class ThemeTableAllocationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ThemeTableAllocationError';
  }
}

export async function freezeThemeTableAssignment(
  client: PoolClient,
  reservationId: string,
  themeTableVersionId: string,
  firstTicketId: string,
  secondTicketId: string,
  now: number
): Promise<void> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM theme_table_assignments WHERE reservation_id = $1`,
    [reservationId]
  );
  if (existing.rows[0]) return;

  const result = await client.query<SelectedPairRow>(
    `SELECT
       pair.id AS pair_id,
       pair.weight,
       first_deck.id AS first_deck_id,
       first_deck.content_hash AS first_content_hash,
       second_deck.id AS second_deck_id,
       second_deck.content_hash AS second_content_hash,
       theme.allocation_algorithm_version
     FROM public_table_reservations AS reservation
     JOIN public_table_tickets AS first_ticket ON first_ticket.id = reservation.first_ticket_id
     JOIN public_table_tickets AS second_ticket ON second_ticket.id = reservation.second_ticket_id
     JOIN theme_table_versions AS theme ON theme.id = reservation.theme_table_version_id
     JOIN theme_prebuilt_deck_versions AS first_deck
       ON first_deck.theme_table_version_id = reservation.theme_table_version_id
      AND first_deck.content_hash = first_ticket.deck_content_hash
     JOIN theme_prebuilt_deck_versions AS second_deck
       ON second_deck.theme_table_version_id = reservation.theme_table_version_id
      AND second_deck.content_hash = second_ticket.deck_content_hash
     JOIN theme_matchup_pair_versions AS pair
       ON pair.theme_table_version_id = reservation.theme_table_version_id
      AND (
        (pair.first_deck_version_id = first_deck.id
          AND pair.second_deck_version_id = second_deck.id)
        OR
        (pair.second_deck_version_id = first_deck.id
          AND pair.first_deck_version_id = second_deck.id)
      )
     WHERE reservation.id = $1
       AND reservation.theme_table_version_id = $2
       AND reservation.first_ticket_id = $3
       AND reservation.second_ticket_id = $4
       AND pair.enabled = TRUE
       AND first_deck.theme_table_version_id = pair.theme_table_version_id
       AND second_deck.theme_table_version_id = pair.theme_table_version_id
       AND first_deck.retired_at IS NULL
       AND second_deck.retired_at IS NULL
       AND theme.lifecycle = 'ACTIVE'
       AND theme.starts_at <= $5
       AND theme.ends_at > $5
     FOR SHARE OF reservation, first_ticket, second_ticket, pair, theme,
                  first_deck, second_deck`,
    [reservationId, themeTableVersionId, firstTicketId, secondTicketId, new Date(now)]
  );
  if (result.rows.length === 0) {
    throw new ThemeTableAllocationError(
      'THEME_MATCHUP_POOL_EMPTY',
      '本期娱乐模式暂时没有可分配的对局组合'
    );
  }

  const selected = result.rows[0];
  const selectedPairSnapshot = {
    pairId: selected.pair_id,
    weight: selected.weight,
    firstDeckId: selected.first_deck_id,
    firstContentHash: selected.first_content_hash,
    secondDeckId: selected.second_deck_id,
    secondContentHash: selected.second_content_hash,
  };
  const eligiblePairSnapshotHash = sha256(stableJson(selectedPairSnapshot));
  const entropyCommitment = sha256(`${reservationId}:${eligiblePairSnapshotHash}`);

  await client.query(
    `INSERT INTO theme_table_assignments (
       reservation_id, theme_table_version_id, matchup_pair_version_id,
       first_ticket_deck_version_id, second_ticket_deck_version_id,
       allocation_algorithm_version, eligible_pair_snapshot_hash, entropy_commitment,
       allocation_proof, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      reservationId,
      themeTableVersionId,
      selected.pair_id,
      selected.first_deck_id,
      selected.second_deck_id,
      selected.allocation_algorithm_version,
      eligiblePairSnapshotHash,
      entropyCommitment,
      JSON.stringify({
        selectionMode: 'POST_MATCH_PLAYER_CHOICE',
        selectedPairSnapshot,
      }),
      new Date(now),
    ]
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
