import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';

interface EligiblePairRow {
  readonly pair_id: string;
  readonly weight: number;
  readonly first_deck_id: string;
  readonly first_deck_name: string;
  readonly first_runtime_deck: unknown;
  readonly first_content_hash: string;
  readonly second_deck_id: string;
  readonly second_deck_name: string;
  readonly second_runtime_deck: unknown;
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

  const result = await client.query<EligiblePairRow>(
    `SELECT
       pair.id AS pair_id,
       pair.weight,
       first_deck.id AS first_deck_id,
       first_deck.display_name AS first_deck_name,
       first_deck.runtime_deck AS first_runtime_deck,
       first_deck.content_hash AS first_content_hash,
       second_deck.id AS second_deck_id,
       second_deck.display_name AS second_deck_name,
       second_deck.runtime_deck AS second_runtime_deck,
       second_deck.content_hash AS second_content_hash,
       theme.allocation_algorithm_version
     FROM theme_matchup_pair_versions AS pair
     JOIN theme_table_versions AS theme ON theme.id = pair.theme_table_version_id
     JOIN theme_prebuilt_deck_versions AS first_deck ON first_deck.id = pair.first_deck_version_id
     JOIN theme_prebuilt_deck_versions AS second_deck ON second_deck.id = pair.second_deck_version_id
     WHERE pair.theme_table_version_id = $1
       AND pair.enabled = TRUE
       AND first_deck.theme_table_version_id = pair.theme_table_version_id
       AND second_deck.theme_table_version_id = pair.theme_table_version_id
       AND theme.lifecycle = 'ACTIVE'
       AND theme.starts_at <= $2
       AND theme.ends_at > $2
     ORDER BY pair.id
     FOR SHARE OF pair, theme, first_deck, second_deck`,
    [themeTableVersionId, new Date(now)]
  );
  if (result.rows.length === 0) {
    throw new ThemeTableAllocationError(
      'THEME_MATCHUP_POOL_EMPTY',
      '本期主题暂时没有可分配的对局组合'
    );
  }

  const totalWeight = result.rows.reduce((sum, pair) => sum + pair.weight, 0);
  if (!Number.isSafeInteger(totalWeight) || totalWeight <= 0) {
    throw new ThemeTableAllocationError('THEME_MATCHUP_WEIGHT_INVALID', '本期主题组合权重无效');
  }
  const entropy = randomBytes(32);
  const pairRoll = entropy.readUInt32BE(0) % totalWeight;
  const swapSeats = (entropy[4] & 1) === 1;
  let cursor = 0;
  const selected =
    result.rows.find((pair) => {
      cursor += pair.weight;
      return pairRoll < cursor;
    }) ?? result.rows[result.rows.length - 1];
  const eligiblePairSnapshot = result.rows.map((pair) => ({
    pairId: pair.pair_id,
    weight: pair.weight,
    firstDeckId: pair.first_deck_id,
    firstContentHash: pair.first_content_hash,
    secondDeckId: pair.second_deck_id,
    secondContentHash: pair.second_content_hash,
  }));
  const eligiblePairSnapshotHash = sha256(stableJson(eligiblePairSnapshot));
  const entropyHex = entropy.toString('hex');
  const entropyCommitment = sha256(entropyHex);
  const firstDeck = swapSeats
    ? {
        id: selected.second_deck_id,
        name: selected.second_deck_name,
        runtime: selected.second_runtime_deck,
        contentHash: selected.second_content_hash,
      }
    : {
        id: selected.first_deck_id,
        name: selected.first_deck_name,
        runtime: selected.first_runtime_deck,
        contentHash: selected.first_content_hash,
      };
  const secondDeck = swapSeats
    ? {
        id: selected.first_deck_id,
        name: selected.first_deck_name,
        runtime: selected.first_runtime_deck,
        contentHash: selected.first_content_hash,
      }
    : {
        id: selected.second_deck_id,
        name: selected.second_deck_name,
        runtime: selected.second_runtime_deck,
        contentHash: selected.second_content_hash,
      };

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
      firstDeck.id,
      secondDeck.id,
      selected.allocation_algorithm_version,
      eligiblePairSnapshotHash,
      entropyCommitment,
      JSON.stringify({
        entropyHex,
        pairRoll,
        totalWeight,
        swapSeats,
        eligiblePairSnapshot,
      }),
      new Date(now),
    ]
  );
  await updateTicketDeck(client, firstTicketId, firstDeck, now);
  await updateTicketDeck(client, secondTicketId, secondDeck, now);
}

async function updateTicketDeck(
  client: PoolClient,
  ticketId: string,
  deck: { readonly name: string; readonly runtime: unknown; readonly contentHash: string },
  now: number
): Promise<void> {
  const updated = await client.query(
    `UPDATE public_table_tickets
     SET source_deck_id = NULL,
         source_deck_name = $2,
         runtime_deck = $3::jsonb,
         deck_content_hash = $4,
         deck_locked_at = $5,
         updated_at = $5
     WHERE id = $1
       AND queue_kind = 'THEME'
       AND state = 'RESERVED'`,
    [ticketId, deck.name, JSON.stringify(deck.runtime), deck.contentHash, new Date(now)]
  );
  if (updated.rowCount !== 1) {
    throw new ThemeTableAllocationError(
      'THEME_TICKET_ASSIGNMENT_CONFLICT',
      '主题牌桌候场状态已经变化'
    );
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
