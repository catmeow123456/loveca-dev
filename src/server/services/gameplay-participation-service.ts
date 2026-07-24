import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';

export type GameplayParticipationKind = 'PUBLIC_QUEUE' | 'ONLINE_ROOM' | 'ONLINE_MATCH';

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
  ticketId: string
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO gameplay_participations (
       user_id, kind, ticket_id, updated_at
     )
     VALUES ($1, 'PUBLIC_QUEUE', $2, NOW())
     ON CONFLICT (user_id) DO NOTHING
     RETURNING user_id`,
    [userId, ticketId]
  );
  return result.rowCount === 1;
}

export async function releasePublicQueueParticipation(
  client: PoolClient,
  userId: string,
  ticketId: string
): Promise<void> {
  await client.query(
    `DELETE FROM gameplay_participations
     WHERE user_id = $1
       AND kind = 'PUBLIC_QUEUE'
       AND ticket_id = $2`,
    [userId, ticketId]
  );
}

export const gameplayParticipationService = new GameplayParticipationService();
