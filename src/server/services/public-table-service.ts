import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type {
  PublicTableStatusView,
  PublicTableSummaryView,
} from '../../online/public-table-types.js';
import { pool } from '../db/pool.js';
import {
  acquirePublicQueueParticipation,
  releasePublicQueueParticipation,
} from './gameplay-participation-service.js';
import {
  loadOwnedDeckForOnlineMatch,
  loadUserProfileForOnlineMatch,
  onlineRoomService,
  type OnlineRoomService,
} from './online-room-service.js';
import {
  decodePublicTableRuntimeDeck,
  encodePublicTableRuntimeDeck,
} from './public-table-deck-snapshot.js';
import { logPublicTableLifecycleEvent } from './public-table-telemetry.js';
import { siteAnnouncementService } from './site-announcement-service.js';

const ENVIRONMENT_ID = 'PUBLIC_TABLE_V1';
const HEARTBEAT_GRACE_MS = 90_000;
const CONFIRMATION_TTL_MS = 60_000;
const OPENING_TTL_MS = 3 * 60_000;

interface PublicTableServiceDeps {
  readonly now?: () => number;
  readonly roomService?: OnlineRoomService;
}

interface StatusRow {
  ticket_id: string;
  ticket_state: 'WAITING' | 'RESERVED' | 'MATCHED';
  joined_at: Date;
  deck_name: string;
  reservation_id: string | null;
  reservation_state: 'PENDING_CONFIRMATION' | 'CREATING_ROOM' | 'MATCHED' | 'RELEASED' | null;
  first_ticket_id: string | null;
  first_confirmed_at: Date | null;
  second_confirmed_at: Date | null;
  expires_at: Date | null;
  room_code: string | null;
  room_generation: string | null;
}

export class PublicTableServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'PublicTableServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class PublicTableService {
  private readonly now: () => number;
  private readonly roomService: OnlineRoomService;

  constructor(deps: PublicTableServiceDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.roomService = deps.roomService ?? onlineRoomService;
  }

  async getSummary(): Promise<PublicTableSummaryView> {
    const restriction = await siteAnnouncementService.getGameplayRestriction(process.env);
    if (restriction) {
      return {
        open: false,
        hasWaitingPlayer: false,
        unavailableReason: restriction.summary || restriction.title || '当前暂不开放新对局',
      };
    }

    const result = await pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM public_table_tickets
         WHERE environment_id = $1
           AND state = 'WAITING'
           AND heartbeat_at > $2
           AND matchable_after <= $3
       ) AS exists`,
      [ENVIRONMENT_ID, new Date(this.now() - HEARTBEAT_GRACE_MS), new Date(this.now())]
    );
    return {
      open: true,
      hasWaitingPlayer: result.rows[0]?.exists === true,
      unavailableReason: null,
    };
  }

  async join(
    userId: string,
    deckId: string,
    entrySource = 'DIRECT'
  ): Promise<PublicTableStatusView> {
    const current = await this.getStatus(userId);
    if (current.state !== 'IDLE') {
      return current;
    }
    const restriction = await siteAnnouncementService.getGameplayRestriction(process.env);
    if (restriction) {
      throw new PublicTableServiceError(
        'PUBLIC_TABLE_UNAVAILABLE',
        restriction.summary || restriction.title || '当前暂不开放新对局',
        503
      );
    }

    const [deck] = await Promise.all([
      loadOwnedDeckForOnlineMatch(userId, deckId),
      loadUserProfileForOnlineMatch(userId),
    ]);
    const now = this.now();
    const ticketId = randomUUID();
    const encodedDeck = encodePublicTableRuntimeDeck(deck.runtimeDeck);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO public_table_tickets (
           id, user_id, environment_id, source_deck_id, source_deck_name,
           runtime_deck, deck_content_hash, deck_locked_at, state,
           joined_at, heartbeat_at, matchable_after, entry_source, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'WAITING', $8, $8, $8, $9, $8, $8)`,
        [
          ticketId,
          userId,
          ENVIRONMENT_ID,
          deck.deckId,
          deck.deckName,
          encodedDeck.json,
          encodedDeck.contentHash,
          new Date(now),
          normalizeEntrySource(entrySource),
        ]
      );
      if (!(await acquirePublicQueueParticipation(client, userId, ticketId))) {
        throw new PublicTableServiceError(
          'PUBLIC_TABLE_PARTICIPATION_CONFLICT',
          '你已经在寻找对手、准备房间或进行其他真人对局',
          409
        );
      }
      logPublicTableLifecycleEvent({
        eventType: 'QUEUE_JOINED',
        eventKey: `${ticketId}:QUEUE_JOINED`,
        userId,
        ticketId,
        detail: { entrySource: normalizeEntrySource(entrySource) },
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) {
        return this.getStatus(userId);
      }
      throw error;
    } finally {
      client.release();
    }

    await this.tryMatch();
    return this.getStatus(userId);
  }

  async heartbeat(userId: string): Promise<PublicTableStatusView> {
    const now = new Date(this.now());
    await pool.query(
      `UPDATE public_table_tickets AS ticket
       SET heartbeat_at = $2,
           updated_at = $2
       FROM gameplay_participations AS participation
       WHERE participation.user_id = $1
         AND participation.kind = 'PUBLIC_QUEUE'
         AND participation.ticket_id = ticket.id
         AND ticket.state IN ('WAITING', 'RESERVED')`,
      [userId, now]
    );
    await this.tryMatch();
    return this.getStatus(userId);
  }

  async getStatus(userId: string): Promise<PublicTableStatusView> {
    const result = await pool.query<StatusRow>(
      `SELECT
         ticket.id AS ticket_id,
         ticket.state AS ticket_state,
         ticket.joined_at,
         ticket.source_deck_name AS deck_name,
         reservation.id AS reservation_id,
         reservation.state AS reservation_state,
         reservation.first_ticket_id,
         reservation.first_confirmed_at,
         reservation.second_confirmed_at,
         reservation.expires_at,
         reservation.room_code,
         reservation.room_generation
       FROM gameplay_participations AS participation
       JOIN public_table_tickets AS ticket
         ON ticket.id = participation.ticket_id
       LEFT JOIN public_table_reservations AS reservation
         ON reservation.id = ticket.reservation_id
       WHERE participation.user_id = $1
         AND participation.ticket_id IS NOT NULL
       LIMIT 1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) {
      return idleStatus();
    }
    return mapStatusRow(row);
  }

  async cancel(userId: string): Promise<PublicTableStatusView> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ticketResult = await client.query<{
        id: string;
        state: 'WAITING' | 'RESERVED';
        reservation_id: string | null;
      }>(
        `SELECT ticket.id, ticket.state, ticket.reservation_id
         FROM gameplay_participations AS participation
         JOIN public_table_tickets AS ticket ON ticket.id = participation.ticket_id
         WHERE participation.user_id = $1
           AND participation.kind = 'PUBLIC_QUEUE'
         FOR UPDATE OF ticket`,
        [userId]
      );
      const ticket = ticketResult.rows[0];
      if (!ticket) {
        await client.query('COMMIT');
        return idleStatus();
      }

      if (ticket.state === 'WAITING' || !ticket.reservation_id) {
        await finishTicket(client, ticket.id, 'CANCELED', 'PLAYER_CANCELED');
      } else {
        await this.releaseReservationForPlayer(client, ticket.reservation_id, ticket.id, userId);
      }
      await releasePublicQueueParticipation(client, userId, ticket.id);
      logPublicTableLifecycleEvent({
        eventType: 'QUEUE_CANCELED',
        eventKey: `${ticket.id}:QUEUE_CANCELED`,
        userId,
        ticketId: ticket.id,
      });
      await client.query('COMMIT');
      return idleStatus();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async confirm(userId: string): Promise<PublicTableStatusView> {
    const current = await this.getStatus(userId);
    if (
      current.state === 'CONFIRMED' ||
      current.state === 'CREATING_ROOM' ||
      current.state === 'MATCHED'
    ) {
      return current;
    }
    const client = await pool.connect();
    let reservationId: string | null = null;
    let shouldBootstrap = false;
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        ticket_id: string;
        reservation_id: string;
        first_ticket_id: string;
        first_confirmed_at: Date | null;
        second_confirmed_at: Date | null;
        expires_at: Date;
      }>(
        `SELECT
           ticket.id AS ticket_id,
           reservation.id AS reservation_id,
           reservation.first_ticket_id,
           reservation.first_confirmed_at,
           reservation.second_confirmed_at,
           reservation.expires_at
         FROM gameplay_participations AS participation
         JOIN public_table_tickets AS ticket ON ticket.id = participation.ticket_id
         JOIN public_table_reservations AS reservation ON reservation.id = ticket.reservation_id
         WHERE participation.user_id = $1
           AND participation.kind = 'PUBLIC_QUEUE'
           AND ticket.state = 'RESERVED'
           AND reservation.state IN ('PENDING_CONFIRMATION', 'CREATING_ROOM')
         FOR UPDATE OF ticket, reservation`,
        [userId]
      );
      const row = result.rows[0];
      if (!row) {
        throw new PublicTableServiceError(
          'PUBLIC_TABLE_CONFIRMATION_GONE',
          '这次配对已经结束',
          409
        );
      }
      if (row.expires_at.getTime() <= this.now()) {
        throw new PublicTableServiceError(
          'PUBLIC_TABLE_CONFIRMATION_EXPIRED',
          '确认时间已经结束',
          409
        );
      }
      reservationId = row.reservation_id;
      const isFirst = row.first_ticket_id === row.ticket_id;
      await client.query(
        `UPDATE public_table_reservations
         SET first_confirmed_at = CASE WHEN $2 THEN COALESCE(first_confirmed_at, NOW()) ELSE first_confirmed_at END,
             second_confirmed_at = CASE WHEN NOT $2 THEN COALESCE(second_confirmed_at, NOW()) ELSE second_confirmed_at END,
             updated_at = NOW()
         WHERE id = $1`,
        [row.reservation_id, isFirst]
      );
      await client.query(
        `UPDATE public_table_tickets SET heartbeat_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [row.ticket_id]
      );
      const updated = await client.query<{
        first_confirmed_at: Date | null;
        second_confirmed_at: Date | null;
        state: string;
      }>(
        `SELECT first_confirmed_at, second_confirmed_at, state
         FROM public_table_reservations
         WHERE id = $1`,
        [row.reservation_id]
      );
      const reservation = updated.rows[0];
      shouldBootstrap =
        reservation?.state === 'PENDING_CONFIRMATION' &&
        reservation.first_confirmed_at !== null &&
        reservation.second_confirmed_at !== null;
      if (shouldBootstrap) {
        await client.query(
          `UPDATE public_table_reservations
           SET state = 'CREATING_ROOM',
               bootstrap_lease_until = $2,
               updated_at = NOW()
           WHERE id = $1`,
          [row.reservation_id, new Date(this.now() + 30_000)]
        );
      }
      logPublicTableLifecycleEvent({
        eventType: 'RESERVATION_CONFIRMED',
        eventKey: `${row.reservation_id}:RESERVATION_CONFIRMED:${row.ticket_id}`,
        userId,
        ticketId: row.ticket_id,
        reservationId: row.reservation_id,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (shouldBootstrap && reservationId) {
      await this.bootstrapRoom(reservationId);
    }
    return this.getStatus(userId);
  }

  async tryMatch(): Promise<void> {
    const client = await pool.connect();
    const now = this.now();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `SELECT id
         FROM public_table_tickets
         WHERE environment_id = $1
           AND state = 'WAITING'
           AND heartbeat_at > $2
           AND matchable_after <= $3
         ORDER BY joined_at ASC, id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 2`,
        [ENVIRONMENT_ID, new Date(now - HEARTBEAT_GRACE_MS), new Date(now)]
      );
      if (result.rows.length < 2) {
        await client.query('COMMIT');
        return;
      }
      const [first, second] = result.rows;
      const reservationId = randomUUID();
      await client.query(
        `INSERT INTO public_table_reservations (
           id, environment_id, first_ticket_id, second_ticket_id,
           state, created_at, expires_at, updated_at
         )
         VALUES ($1, $2, $3, $4, 'PENDING_CONFIRMATION', $5, $6, $5)`,
        [
          reservationId,
          ENVIRONMENT_ID,
          first.id,
          second.id,
          new Date(now),
          new Date(now + CONFIRMATION_TTL_MS),
        ]
      );
      await client.query(
        `UPDATE public_table_tickets
         SET state = 'RESERVED',
             reservation_id = $1,
             updated_at = $2
         WHERE id = ANY($3::uuid[])`,
        [reservationId, new Date(now), [first.id, second.id]]
      );
      logPublicTableLifecycleEvent({
        eventType: 'RESERVATION_CREATED',
        eventKey: `${reservationId}:RESERVATION_CREATED`,
        reservationId,
        detail: { firstTicketId: first.id, secondTicketId: second.id },
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cleanupExpiredState(): Promise<{
    expiredWaitingTickets: number;
    releasedReservations: number;
  }> {
    const client = await pool.connect();
    let expiredWaitingTickets = 0;
    let releasedReservations = 0;
    const now = this.now();
    try {
      await client.query('BEGIN');
      const expired = await client.query<{ id: string }>(
        `WITH expired AS (
           UPDATE public_table_tickets
           SET state = 'EXPIRED',
               terminal_reason = 'HEARTBEAT_EXPIRED',
               updated_at = $2
           WHERE state = 'WAITING'
             AND heartbeat_at <= $1
           RETURNING id
         )
         DELETE FROM gameplay_participations
         WHERE kind = 'PUBLIC_QUEUE'
           AND ticket_id IN (SELECT id FROM expired)
         RETURNING ticket_id AS id`,
        [new Date(now - HEARTBEAT_GRACE_MS), new Date(now)]
      );
      expiredWaitingTickets = expired.rowCount ?? 0;

      const reservations = await client.query<{
        id: string;
        first_ticket_id: string;
        second_ticket_id: string;
        first_confirmed_at: Date | null;
        second_confirmed_at: Date | null;
      }>(
        `SELECT id, first_ticket_id, second_ticket_id, first_confirmed_at, second_confirmed_at
         FROM public_table_reservations
         WHERE state = 'PENDING_CONFIRMATION'
           AND expires_at <= $1
         ORDER BY expires_at
         FOR UPDATE SKIP LOCKED
         LIMIT 100`,
        [new Date(now)]
      );
      for (const reservation of reservations.rows) {
        await client.query(
          `UPDATE public_table_reservations
           SET state = 'RELEASED',
               failure_reason = 'CONFIRMATION_TIMEOUT',
               updated_at = $2
           WHERE id = $1`,
          [reservation.id, new Date(now)]
        );
        const neitherConfirmed =
          reservation.first_confirmed_at === null && reservation.second_confirmed_at === null;
        await expireOrRestoreTimedOutTicket(
          client,
          reservation.first_ticket_id,
          neitherConfirmed || reservation.first_confirmed_at === null,
          now
        );
        await expireOrRestoreTimedOutTicket(
          client,
          reservation.second_ticket_id,
          neitherConfirmed || reservation.second_confirmed_at === null,
          now
        );
        logPublicTableLifecycleEvent({
          eventType: 'RESERVATION_RELEASED',
          eventKey: `${reservation.id}:RESERVATION_RELEASED`,
          reservationId: reservation.id,
          detail: { reason: 'CONFIRMATION_TIMEOUT' },
        });
        releasedReservations += 1;
      }

      const matchedReservations = await client.query<{
        id: string;
        room_generation: string;
      }>(
        `SELECT id, room_generation
         FROM public_table_reservations
         WHERE state = 'MATCHED'
           AND room_generation IS NOT NULL
         ORDER BY updated_at
         FOR UPDATE SKIP LOCKED
         LIMIT 100`
      );
      for (const reservation of matchedReservations.rows) {
        const activeRoom = this.roomService.getRoomIdentityForPublicTableReservation(
          reservation.id
        );
        if (activeRoom?.roomGeneration === reservation.room_generation) {
          continue;
        }
        const released = await client.query(
          `UPDATE public_table_reservations
           SET state = 'RELEASED',
               failure_reason = 'RUNTIME_ROOM_GONE',
               updated_at = $2
           WHERE id = $1
             AND state = 'MATCHED'`,
          [reservation.id, new Date(now)]
        );
        if (released.rowCount !== 1) {
          continue;
        }
        await client.query(
          `DELETE FROM gameplay_participations
           WHERE room_generation = $1`,
          [reservation.room_generation]
        );
        logPublicTableLifecycleEvent({
          eventType: 'MATCH_INTERRUPTED',
          eventKey: `${reservation.id}:RUNTIME_ROOM_GONE`,
          reservationId: reservation.id,
          roomGeneration: reservation.room_generation,
          detail: { reason: 'RUNTIME_ROOM_GONE' },
        });
        releasedReservations += 1;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await this.tryMatch();
    return { expiredWaitingTickets, releasedReservations };
  }

  private async bootstrapRoom(reservationId: string): Promise<void> {
    const result = await pool.query<{
      state: string;
      first_ticket_id: string;
      second_ticket_id: string;
      first_user_id: string;
      second_user_id: string;
      first_deck_id: string | null;
      second_deck_id: string | null;
      first_deck_name: string;
      second_deck_name: string;
      first_runtime_deck: unknown;
      second_runtime_deck: unknown;
      first_locked_at: Date;
      second_locked_at: Date;
    }>(
      `SELECT
         reservation.state,
         reservation.first_ticket_id,
         reservation.second_ticket_id,
         first_ticket.user_id AS first_user_id,
         second_ticket.user_id AS second_user_id,
         first_ticket.source_deck_id AS first_deck_id,
         second_ticket.source_deck_id AS second_deck_id,
         first_ticket.source_deck_name AS first_deck_name,
         second_ticket.source_deck_name AS second_deck_name,
         first_ticket.runtime_deck AS first_runtime_deck,
         second_ticket.runtime_deck AS second_runtime_deck,
         first_ticket.deck_locked_at AS first_locked_at,
         second_ticket.deck_locked_at AS second_locked_at
       FROM public_table_reservations AS reservation
       JOIN public_table_tickets AS first_ticket ON first_ticket.id = reservation.first_ticket_id
       JOIN public_table_tickets AS second_ticket ON second_ticket.id = reservation.second_ticket_id
       WHERE reservation.id = $1`,
      [reservationId]
    );
    const row = result.rows[0];
    if (!row || row.state !== 'CREATING_ROOM') {
      return;
    }
    const [firstProfile, secondProfile] = await Promise.all([
      loadUserProfileForOnlineMatch(row.first_user_id),
      loadUserProfileForOnlineMatch(row.second_user_id),
    ]);
    const room = await this.roomService.createPublicTableRoom({
      reservationId,
      first: {
        ...firstProfile,
        deckId: row.first_deck_id,
        deckName: row.first_deck_name,
        deck: decodePublicTableRuntimeDeck(row.first_runtime_deck),
        lockedAt: row.first_locked_at.getTime(),
      },
      second: {
        ...secondProfile,
        deckId: row.second_deck_id,
        deckName: row.second_deck_name,
        deck: decodePublicTableRuntimeDeck(row.second_runtime_deck),
        lockedAt: row.second_locked_at.getTime(),
      },
      openingExpiresAt: this.now() + OPENING_TTL_MS,
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const bound = await client.query(
        `UPDATE public_table_reservations
         SET state = 'MATCHED',
             room_code = $2,
             room_generation = $3,
             bootstrap_lease_until = NULL,
             updated_at = NOW()
         WHERE id = $1
           AND state = 'CREATING_ROOM'
         RETURNING id`,
        [reservationId, room.roomCode, room.roomGeneration]
      );
      if (bound.rowCount !== 1) {
        await client.query('ROLLBACK');
        return;
      }
      await client.query(
        `UPDATE public_table_tickets
         SET state = 'MATCHED',
             matched_room_generation = $2,
             terminal_reason = 'ROOM_CREATED',
             updated_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [[row.first_ticket_id, row.second_ticket_id], room.roomGeneration]
      );
      await client.query(
        `UPDATE gameplay_participations
         SET kind = 'ONLINE_ROOM',
             room_generation = $2,
             updated_at = NOW()
         WHERE ticket_id = ANY($1::uuid[])
           AND kind = 'PUBLIC_QUEUE'`,
        [[row.first_ticket_id, row.second_ticket_id], room.roomGeneration]
      );
      logPublicTableLifecycleEvent({
        eventType: 'ROOM_CREATED',
        eventKey: `${reservationId}:ROOM_CREATED`,
        reservationId,
        roomGeneration: room.roomGeneration,
        detail: { roomCode: room.roomCode },
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async releaseReservationForPlayer(
    client: PoolClient,
    reservationId: string,
    actorTicketId: string,
    actorUserId: string
  ): Promise<void> {
    const result = await client.query<{
      first_ticket_id: string;
      second_ticket_id: string;
    }>(
      `UPDATE public_table_reservations
       SET state = 'RELEASED',
           failure_reason = 'PLAYER_CANCELED',
           updated_at = NOW()
       WHERE id = $1
         AND state = 'PENDING_CONFIRMATION'
       RETURNING first_ticket_id, second_ticket_id`,
      [reservationId]
    );
    const reservation = result.rows[0];
    if (!reservation) {
      throw new PublicTableServiceError(
        'PUBLIC_TABLE_CANCEL_CONFLICT',
        '这次配对已经进入对局，不能再结束等待',
        409
      );
    }
    const otherTicketId =
      reservation.first_ticket_id === actorTicketId
        ? reservation.second_ticket_id
        : reservation.first_ticket_id;
    await finishTicket(client, actorTicketId, 'CANCELED', 'PLAYER_CANCELED');
    await client.query(
      `UPDATE public_table_tickets
       SET state = CASE WHEN heartbeat_at > $2 THEN 'WAITING' ELSE 'EXPIRED' END,
           reservation_id = NULL,
           terminal_reason = CASE WHEN heartbeat_at > $2 THEN NULL ELSE 'HEARTBEAT_EXPIRED' END,
           updated_at = NOW()
       WHERE id = $1`,
      [otherTicketId, new Date(this.now() - HEARTBEAT_GRACE_MS)]
    );
    await client.query(
      `DELETE FROM gameplay_participations
       WHERE ticket_id = $1
         AND EXISTS (
           SELECT 1 FROM public_table_tickets
           WHERE id = $1 AND state = 'EXPIRED'
         )`,
      [otherTicketId]
    );
    logPublicTableLifecycleEvent({
      eventType: 'RESERVATION_RELEASED',
      eventKey: `${reservationId}:RESERVATION_RELEASED`,
      userId: actorUserId,
      ticketId: actorTicketId,
      reservationId,
      detail: { reason: 'PLAYER_CANCELED' },
    });
  }
}

async function expireOrRestoreTimedOutTicket(
  client: PoolClient,
  ticketId: string,
  causedTimeout: boolean,
  now: number
): Promise<void> {
  if (causedTimeout) {
    await finishTicket(client, ticketId, 'EXPIRED', 'CONFIRMATION_TIMEOUT');
    await client.query(
      `DELETE FROM gameplay_participations
       WHERE kind = 'PUBLIC_QUEUE' AND ticket_id = $1`,
      [ticketId]
    );
    return;
  }
  await client.query(
    `UPDATE public_table_tickets
     SET state = CASE WHEN heartbeat_at > $2 THEN 'WAITING' ELSE 'EXPIRED' END,
         reservation_id = NULL,
         terminal_reason = CASE WHEN heartbeat_at > $2 THEN NULL ELSE 'HEARTBEAT_EXPIRED' END,
         updated_at = $3
     WHERE id = $1`,
    [ticketId, new Date(now - HEARTBEAT_GRACE_MS), new Date(now)]
  );
  await client.query(
    `DELETE FROM gameplay_participations
     WHERE ticket_id = $1
       AND EXISTS (
         SELECT 1 FROM public_table_tickets
         WHERE id = $1 AND state = 'EXPIRED'
       )`,
    [ticketId]
  );
}

async function finishTicket(
  client: PoolClient,
  ticketId: string,
  state: 'CANCELED' | 'EXPIRED',
  reason: string
): Promise<void> {
  await client.query(
    `UPDATE public_table_tickets
     SET state = $2,
         terminal_reason = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [ticketId, state, reason]
  );
}

function mapStatusRow(row: StatusRow): PublicTableStatusView {
  const isFirst = row.first_ticket_id === row.ticket_id;
  const confirmed = isFirst ? row.first_confirmed_at !== null : row.second_confirmed_at !== null;
  const state =
    row.ticket_state === 'WAITING'
      ? 'WAITING'
      : row.ticket_state === 'MATCHED'
        ? 'MATCHED'
        : row.reservation_state === 'CREATING_ROOM'
          ? 'CREATING_ROOM'
          : confirmed
            ? 'CONFIRMED'
            : 'PENDING_CONFIRMATION';
  return {
    state,
    ticketId: row.ticket_id,
    joinedAt: row.joined_at.getTime(),
    deckName: row.deck_name,
    reservationId: row.reservation_id,
    confirmationExpiresAt: row.expires_at?.getTime() ?? null,
    confirmed,
    roomCode: row.room_code,
    roomGeneration: row.room_generation,
    message: null,
  };
}

function idleStatus(): PublicTableStatusView {
  return {
    state: 'IDLE',
    ticketId: null,
    joinedAt: null,
    deckName: null,
    reservationId: null,
    confirmationExpiresAt: null,
    confirmed: false,
    roomCode: null,
    roomGeneration: null,
    message: null,
  };
}

function normalizeEntrySource(value: string): string {
  const normalized = value.trim().toUpperCase();
  return normalized === 'SHARED_LINK' ? normalized : 'DIRECT';
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

export const publicTableService = new PublicTableService();
