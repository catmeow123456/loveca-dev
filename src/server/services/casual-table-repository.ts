import type { Pool, PoolClient } from 'pg';
import type {
  CasualTableDiscoverability,
  CasualTableState,
} from '../../online/casual-table-types.js';

export const CASUAL_ENVIRONMENT_ID = 'CASUAL_TABLE_V1';

export interface CasualTableRow {
  id: string;
  room_code: string;
  discoverability: CasualTableDiscoverability;
  note: string;
  environment_id: string;
  state: CasualTableState;
  round_id: string;
  revision: number;
  waiting_since: Date;
  confirmation_expires_at: Date | null;
  bootstrap_lease_until: Date | null;
  bootstrap_attempts: number;
  room_generation: string | null;
  created_by: string;
  creation_key: string;
  failure_reason: string | null;
  created_at: Date;
  closed_at: Date | null;
}

export interface CasualSeatRow {
  table_id: string;
  seat: number;
  user_id: string;
  source_deck_id: string | null;
  deck_name: string;
  runtime_deck: unknown;
  point_table_version: string;
  point_total: number;
  point_limit: number;
  locked_at: Date;
  heartbeat_at: Date;
  waiting_since: Date;
  continue_public: boolean;
  spectator_enabled: boolean;
  confirmed_at: Date | null;
  display_name: string;
}

export interface CasualParticipationRow {
  kind: string;
  ticket_id: string | null;
  casual_table_id: string | null;
  room_generation: string | null;
  match_id: string | null;
}

export interface CasualLobbyMember {
  userId: string;
  displayName: string;
  heartbeatAt: number;
}

interface CasualLobbyRow extends CasualTableRow {
  members: CasualLobbyMember[];
  is_mine: boolean;
}

/** One MVCC snapshot, without admission/row locks or private deck snapshots. */
export async function readCasualLobby(
  database: Pick<Pool, 'connect'>,
  userId: string,
  anchor: number
): Promise<CasualLobbyRow[]> {
  const client = await database.connect();
  try {
    const result = await client.query<CasualLobbyRow>(
      `SELECT tables.*,
         COALESCE(jsonb_agg(jsonb_build_object(
           'userId', seat.user_id,
           'displayName', COALESCE(profile.display_name, profile.username),
           'heartbeatAt', EXTRACT(EPOCH FROM seat.heartbeat_at) * 1000
         ) ORDER BY seat.seat) FILTER (WHERE seat.user_id IS NOT NULL), '[]'::jsonb) AS members,
         COALESCE(bool_or(seat.user_id = $1), false) AND EXISTS (
           SELECT 1 FROM gameplay_participations
           WHERE user_id = $1 AND casual_table_id = tables.id
         ) AS is_mine
       FROM casual_tables AS tables
       LEFT JOIN casual_table_seats AS seat ON seat.table_id = tables.id
       LEFT JOIN profiles AS profile ON profile.id = seat.user_id
       WHERE tables.discoverability = 'PUBLIC' AND tables.state <> 'CLOSED'
         AND tables.created_at <= $2
       GROUP BY tables.id`,
      [userId, new Date(anchor)]
    );
    return result.rows;
  } finally {
    client.release();
  }
}

/** One short admission lock also covers direct joins, cancellation and recovery.
 * No asset, profile, deck or policy loading may run inside the callback. */
export async function withCasualAdmission<T>(
  database: Pick<Pool, 'connect'>,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [CASUAL_ENVIRONMENT_ID]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function readCasualTable(
  client: PoolClient,
  id: string
): Promise<CasualTableRow | null> {
  const result = await client.query<CasualTableRow>(
    'SELECT * FROM casual_tables WHERE id = $1 FOR UPDATE',
    [id]
  );
  return result.rows[0] ?? null;
}

export async function readCasualSeats(
  client: PoolClient,
  tableId: string
): Promise<CasualSeatRow[]> {
  const result = await client.query<CasualSeatRow>(
    `SELECT seat.*, COALESCE(profile.display_name, profile.username) AS display_name
     FROM casual_table_seats AS seat
     JOIN profiles AS profile ON profile.id = seat.user_id
     WHERE seat.table_id = $1 ORDER BY seat.seat FOR UPDATE OF seat`,
    [tableId]
  );
  return result.rows;
}

export async function readCasualParticipation(
  client: PoolClient,
  userId: string
): Promise<CasualParticipationRow | null> {
  // Read before table locks without locking the participation. The environment
  // lock serializes casual operations; other modes only see its unique user key.
  const result = await client.query<CasualParticipationRow>(
    'SELECT kind, ticket_id, casual_table_id, room_generation, match_id FROM gameplay_participations WHERE user_id = $1',
    [userId]
  );
  return result.rows[0] ?? null;
}

export async function saveCasualTable(client: PoolClient, row: CasualTableRow): Promise<void> {
  await client.query(
    `UPDATE casual_tables SET state = $2, round_id = $3, revision = $4,
       waiting_since = $5, confirmation_expires_at = $6, bootstrap_lease_until = $7,
       bootstrap_attempts = $8, room_generation = $9, failure_reason = $10, closed_at = $11
     WHERE id = $1`,
    [
      row.id,
      row.state,
      row.round_id,
      row.revision,
      row.waiting_since,
      row.confirmation_expires_at,
      row.bootstrap_lease_until,
      row.bootstrap_attempts,
      row.room_generation,
      row.failure_reason,
      row.closed_at,
    ]
  );
}

export async function insertCasualTable(client: PoolClient, row: CasualTableRow): Promise<void> {
  await client.query(
    `INSERT INTO casual_tables (id, room_code, discoverability, note, environment_id,
       state, round_id, revision, waiting_since, created_by, creation_key, created_at)
     VALUES ($1, $2, $3, $4, $5, 'WAITING', $6, $7, $8, $9, $10, $11)`,
    [
      row.id,
      row.room_code,
      row.discoverability,
      row.note,
      row.environment_id,
      row.round_id,
      row.revision,
      row.waiting_since,
      row.created_by,
      row.creation_key,
      row.created_at,
    ]
  );
}

export async function insertCasualSeat(client: PoolClient, row: CasualSeatRow): Promise<void> {
  await client.query(
    `INSERT INTO casual_table_seats (table_id, seat, user_id, source_deck_id, deck_name,
       runtime_deck, point_table_version, point_total, point_limit,
       locked_at, heartbeat_at, waiting_since, continue_public, spectator_enabled, confirmed_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      row.table_id,
      row.seat,
      row.user_id,
      row.source_deck_id,
      row.deck_name,
      JSON.stringify(row.runtime_deck),
      row.point_table_version,
      row.point_total,
      row.point_limit,
      row.locked_at,
      row.heartbeat_at,
      row.waiting_since,
      row.continue_public,
      row.spectator_enabled,
      row.confirmed_at,
    ]
  );
}

export async function acquireCasualParticipation(
  client: PoolClient,
  userId: string,
  tableId: string
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO gameplay_participations (user_id, kind, casual_table_id)
     VALUES ($1, 'CASUAL_TABLE', $2) ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
    [userId, tableId]
  );
  return result.rowCount === 1;
}
