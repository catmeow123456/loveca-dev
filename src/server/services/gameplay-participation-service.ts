import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';

export type GameplayParticipationKind =
  'PUBLIC_QUEUE' | 'RANKED_QUEUE' | 'ONLINE_ROOM' | 'ONLINE_MATCH';

export interface GameplayParticipationRef {
  readonly kind: GameplayParticipationKind;
  readonly ticketId?: string | null;
  readonly roomGeneration?: string | null;
  readonly matchId?: string | null;
}

export interface GameplayParticipationPort {
  acquireOnlineRoom(userId: string, roomGeneration: string): Promise<boolean>;
  markOnlineMatch(
    userIds: readonly string[],
    roomGeneration: string,
    matchId: string
  ): Promise<void>;
  restoreOnlineRoom?(
    userIds: readonly string[],
    roomGeneration: string,
    matchId: string
  ): Promise<number>;
  releaseOnlineRoom(userIds: readonly string[], roomGeneration: string): Promise<void>;
}

export class GameplayParticipationService implements GameplayParticipationPort {
  async acquireOnlineRoom(userId: string, roomGeneration: string): Promise<boolean> {
    const result = await pool.query(
      `INSERT INTO gameplay_participations (
         user_id, kind, room_generation, updated_at
       )
       VALUES ($1, 'ONLINE_ROOM', $2, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET updated_at = NOW()
       WHERE gameplay_participations.kind = 'ONLINE_ROOM'
         AND gameplay_participations.room_generation = EXCLUDED.room_generation
       RETURNING user_id`,
      [userId, roomGeneration]
    );
    return result.rowCount === 1;
  }

  async markOnlineMatch(
    userIds: readonly string[],
    roomGeneration: string,
    matchId: string
  ): Promise<void> {
    if (userIds.length === 0) {
      return;
    }
    await pool.query(
      `UPDATE gameplay_participations
       SET kind = 'ONLINE_MATCH',
           match_id = $3,
           updated_at = NOW()
       WHERE user_id = ANY($1::uuid[])
         AND kind = 'ONLINE_ROOM'
         AND room_generation = $2`,
      [userIds, roomGeneration, matchId]
    );
  }

  async restoreOnlineRoom(
    userIds: readonly string[],
    roomGeneration: string,
    matchId: string
  ): Promise<number> {
    if (userIds.length === 0) {
      return 0;
    }
    const result = await pool.query<{ restored_count: number }>(
      `WITH eligible AS MATERIALIZED (
         SELECT user_id
         FROM gameplay_participations
         WHERE user_id = ANY($1::uuid[])
           AND room_generation = $2
           AND (
             (kind = 'ONLINE_MATCH' AND match_id = $3)
             OR (kind = 'ONLINE_ROOM' AND match_id IS NULL)
           )
         FOR UPDATE
       ), restored AS (
         UPDATE gameplay_participations
         SET kind = 'ONLINE_ROOM',
             match_id = NULL,
             updated_at = NOW()
         WHERE user_id IN (SELECT user_id FROM eligible)
           AND (SELECT COUNT(*) FROM eligible) = cardinality($1::uuid[])
         RETURNING user_id
       )
       SELECT COUNT(*)::integer AS restored_count
       FROM restored`,
      [userIds, roomGeneration, matchId]
    );
    return Number(result.rows[0]?.restored_count ?? 0);
  }

  async releaseOnlineRoom(userIds: readonly string[], roomGeneration: string): Promise<void> {
    if (userIds.length === 0) {
      return;
    }
    await pool.query(
      `DELETE FROM gameplay_participations
       WHERE user_id = ANY($1::uuid[])
         AND room_generation = $2`,
      [userIds, roomGeneration]
    );
  }
}

export async function acquirePublicQueueParticipation(
  client: PoolClient,
  userId: string,
  ticketId: string,
  kind: Extract<GameplayParticipationKind, 'PUBLIC_QUEUE' | 'RANKED_QUEUE'> = 'PUBLIC_QUEUE'
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO gameplay_participations (
       user_id, kind, ticket_id, updated_at
     )
     VALUES ($1, $3, $2, NOW())
     ON CONFLICT (user_id) DO NOTHING
     RETURNING user_id`,
    [userId, ticketId, kind]
  );
  return result.rowCount === 1;
}

export async function releasePublicQueueParticipation(
  client: PoolClient,
  userId: string,
  ticketId: string,
  kind: Extract<GameplayParticipationKind, 'PUBLIC_QUEUE' | 'RANKED_QUEUE'> = 'PUBLIC_QUEUE'
): Promise<void> {
  await client.query(
    `DELETE FROM gameplay_participations
     WHERE user_id = $1
       AND kind = $3
       AND ticket_id = $2`,
    [userId, ticketId, kind]
  );
}

export const gameplayParticipationService = new GameplayParticipationService();
