import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { isRankedQueueWindowOpen, type RankedSeasonOpenWindow } from './ranked-season-service.js';

interface ThemeOpeningTicketRow {
  readonly queue_kind: 'CASUAL' | 'RANKED' | 'THEME';
  readonly theme_table_version_id: string | null;
  readonly environment_id: string;
  readonly theme_lifecycle: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
  readonly theme_platform_time_zone: string;
  readonly theme_open_windows: RankedSeasonOpenWindow[];
  readonly theme_starts_at: Date;
  readonly theme_ends_at: Date;
  readonly first_ticket_id: string;
  readonly first_user_id: string;
  readonly first_joined_at: Date;
  readonly first_source_deck_name: string;
  readonly first_runtime_deck: unknown;
  readonly first_deck_content_hash: string;
  readonly first_point_table_version: string;
  readonly first_point_limit: number;
  readonly second_ticket_id: string;
  readonly second_user_id: string;
  readonly second_joined_at: Date;
  readonly second_source_deck_name: string;
  readonly second_runtime_deck: unknown;
  readonly second_deck_content_hash: string;
  readonly second_point_table_version: string;
  readonly second_point_limit: number;
}

export interface ThemeOpeningRecoveryResult {
  readonly handled: boolean;
  readonly requeued: readonly {
    readonly userId: string;
    readonly previousTicketId: string;
    readonly ticketId: string;
  }[];
}

export async function recoverNoFaultThemeOpeningPlayers(input: {
  readonly reservationId: string;
  readonly roomGeneration: string;
  readonly faultUserIds: readonly string[];
  readonly reason: 'PLAYER_ABANDONED_OPENING' | 'OPENING_ARRIVAL_TIMEOUT' | 'OPENING_TIMEOUT';
  readonly now: number;
}): Promise<ThemeOpeningRecoveryResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await recoverWithClient(client, input);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function recoverWithClient(
  client: PoolClient,
  input: {
    readonly reservationId: string;
    readonly roomGeneration: string;
    readonly faultUserIds: readonly string[];
    readonly reason: 'PLAYER_ABANDONED_OPENING' | 'OPENING_ARRIVAL_TIMEOUT' | 'OPENING_TIMEOUT';
    readonly now: number;
  }
): Promise<ThemeOpeningRecoveryResult> {
  const result = await client.query<ThemeOpeningTicketRow>(
    `SELECT
       reservation.queue_kind,
       reservation.theme_table_version_id,
       reservation.environment_id,
       theme.lifecycle AS theme_lifecycle,
       theme.platform_time_zone AS theme_platform_time_zone,
       theme.open_windows AS theme_open_windows,
       theme.starts_at AS theme_starts_at,
       theme.ends_at AS theme_ends_at,
       first_ticket.id AS first_ticket_id,
       first_ticket.user_id AS first_user_id,
       first_ticket.joined_at AS first_joined_at,
       first_ticket.source_deck_name AS first_source_deck_name,
       first_ticket.runtime_deck AS first_runtime_deck,
       first_ticket.deck_content_hash AS first_deck_content_hash,
       first_ticket.point_table_version AS first_point_table_version,
       first_ticket.point_limit AS first_point_limit,
       second_ticket.id AS second_ticket_id,
       second_ticket.user_id AS second_user_id,
       second_ticket.joined_at AS second_joined_at,
       second_ticket.source_deck_name AS second_source_deck_name,
       second_ticket.runtime_deck AS second_runtime_deck,
       second_ticket.deck_content_hash AS second_deck_content_hash,
       second_ticket.point_table_version AS second_point_table_version,
       second_ticket.point_limit AS second_point_limit
     FROM public_table_reservations AS reservation
     JOIN public_table_tickets AS first_ticket ON first_ticket.id = reservation.first_ticket_id
     JOIN public_table_tickets AS second_ticket ON second_ticket.id = reservation.second_ticket_id
     JOIN theme_table_versions AS theme ON theme.id = reservation.theme_table_version_id
     WHERE reservation.id = $1
       AND reservation.state = 'MATCHED'
       AND reservation.room_generation = $2
     FOR UPDATE OF reservation, first_ticket, second_ticket, theme`,
    [input.reservationId, input.roomGeneration]
  );
  const row = result.rows[0];
  if (!row || row.queue_kind !== 'THEME' || !row.theme_table_version_id) {
    return { handled: false, requeued: [] };
  }

  const released = await client.query(
    `UPDATE public_table_reservations
     SET state = 'RELEASED',
         failure_reason = $2,
         updated_at = $3
     WHERE id = $1
       AND state = 'MATCHED'
       AND room_generation = $4`,
    [input.reservationId, input.reason, new Date(input.now), input.roomGeneration]
  );
  if (released.rowCount !== 1) return { handled: false, requeued: [] };

  const faultUserIds = new Set(input.faultUserIds);
  const queueStillOpen =
    row.theme_lifecycle === 'ACTIVE' &&
    isRankedQueueWindowOpen(
      new Date(input.now),
      row.theme_platform_time_zone,
      row.theme_open_windows,
      row.theme_starts_at,
      row.theme_ends_at
    );
  const tickets = [
    {
      ticketId: row.first_ticket_id,
      userId: row.first_user_id,
      joinedAt: row.first_joined_at,
      sourceDeckName: row.first_source_deck_name,
      runtimeDeck: row.first_runtime_deck,
      deckContentHash: row.first_deck_content_hash,
      pointTableVersion: row.first_point_table_version,
      pointLimit: row.first_point_limit,
    },
    {
      ticketId: row.second_ticket_id,
      userId: row.second_user_id,
      joinedAt: row.second_joined_at,
      sourceDeckName: row.second_source_deck_name,
      runtimeDeck: row.second_runtime_deck,
      deckContentHash: row.second_deck_content_hash,
      pointTableVersion: row.second_point_table_version,
      pointLimit: row.second_point_limit,
    },
  ];
  const requeued: ThemeOpeningRecoveryResult['requeued'][number][] = [];
  for (const ticket of tickets) {
    if (faultUserIds.has(ticket.userId) || !queueStillOpen) {
      await client.query(
        `UPDATE public_table_tickets
         SET state = 'CANCELED',
             terminal_reason = $2,
             updated_at = $3
         WHERE id = $1`,
        [
          ticket.ticketId,
          faultUserIds.has(ticket.userId) ? input.reason : 'NO_FAULT_WINDOW_CLOSED',
          new Date(input.now),
        ]
      );
      continue;
    }

    await client.query(
      `UPDATE public_table_tickets
       SET state = 'EXPIRED',
           terminal_reason = 'NO_FAULT_REQUEUED',
           updated_at = $2
       WHERE id = $1`,
      [ticket.ticketId, new Date(input.now)]
    );
    const nextTicketId = randomUUID();
    await client.query(
      `INSERT INTO public_table_tickets (
         id, user_id, queue_kind, season_id, theme_table_version_id, environment_id,
         source_deck_id, source_deck_name, runtime_deck, deck_content_hash,
         point_table_version, point_total, point_limit, deck_locked_at,
         state, joined_at, heartbeat_at, matchable_after, entry_source,
         requeued_from_ticket_id, created_at, updated_at
       ) VALUES (
         $1, $2, 'THEME', NULL, $3, $4,
         NULL, $5, $6::jsonb, $7, $8, 0, $9, $10,
         'WAITING', $11, $10, $10, 'NO_FAULT_RECOVERY',
         $12, $10, $10
       )`,
      [
        nextTicketId,
        ticket.userId,
        row.theme_table_version_id,
        row.environment_id,
        ticket.sourceDeckName,
        JSON.stringify(ticket.runtimeDeck),
        ticket.deckContentHash,
        ticket.pointTableVersion,
        ticket.pointLimit,
        new Date(input.now),
        ticket.joinedAt,
        ticket.ticketId,
      ]
    );
    const participation = await client.query(
      `UPDATE gameplay_participations
       SET kind = 'THEME_QUEUE',
           ticket_id = $2,
           room_generation = NULL,
           match_id = NULL,
           updated_at = $4
       WHERE user_id = $1
         AND ticket_id = $3
         AND kind = 'ONLINE_ROOM'
         AND room_generation = $5`,
      [ticket.userId, nextTicketId, ticket.ticketId, new Date(input.now), input.roomGeneration]
    );
    if (participation.rowCount !== 1) {
      throw new Error('娱乐模式无过错恢复时玩家占用状态已经变化');
    }
    requeued.push({
      userId: ticket.userId,
      previousTicketId: ticket.ticketId,
      ticketId: nextTicketId,
    });
  }
  return { handled: true, requeued };
}
