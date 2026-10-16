import { randomInt, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type {
  CasualLobbyQuery,
  CasualLobbyView,
  CasualRoomSummary,
  CasualTableCommandTarget,
  CasualTableCurrentView,
  CasualTableEntryInput,
  CasualTableOwnView,
  CreateCasualTableInput,
} from '../../online/casual-table-types.js';
import type { DeckPointTableRules } from '../../domain/rules/deck-point-table.js';
import {
  DEFAULT_ROOM_LIFECYCLE_TIMEOUT_CONFIG,
  type RoomLifecycleTimeoutConfig,
} from '../../online/room-lifecycle-policy.js';
import { pool } from '../db/pool.js';
import { battleTimeoutConfigService } from './battle-timeout-config-service.js';
import { deckPointTableService } from './deck-point-table-service.js';
import { revalidateRuntimeDeckPointSnapshot } from './deck-point-snapshot-validation.js';
import {
  loadOwnedDeckForOnlineMatch,
  onlineRoomService,
  PUBLIC_TABLE_OPENING_TTL_MS,
  type CasualTableRuntimePort,
  type OwnedDeckSummary,
  type PublicTableRoomMemberInput,
} from './online-room-service.js';
import {
  decodePublicTableRuntimeDeck,
  encodePublicTableRuntimeDeck,
} from './public-table-deck-snapshot.js';
import { siteAnnouncementService } from './site-announcement-service.js';
import {
  acquireCasualParticipation,
  CASUAL_ENVIRONMENT_ID,
  insertCasualSeat,
  insertCasualTable,
  readCasualLobby,
  readCasualParticipation,
  readCasualSeats,
  readCasualTable,
  saveCasualTable,
  withCasualAdmission,
  type CasualLobbyMember,
  type CasualSeatRow,
  type CasualTableRow,
} from './casual-table-repository.js';

const BOOTSTRAP_LEASE_MS = 30_000;
const MAX_BOOTSTRAP_ATTEMPTS = 3;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const entrySchema = z.object({
  requestId: z.uuid(),
  deckId: z.uuid(),
  spectatorEnabled: z.boolean(),
});
const targetSchema = z.object({
  tableId: z.uuid(),
  roundId: z.uuid(),
  revision: z.number().int().positive(),
});
const createSchema = entrySchema.extend({
  discoverability: z.enum(['PUBLIC', 'UNLISTED']),
  note: z.string().trim().max(40),
});

export class CasualTableServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409
  ) {
    super(message);
    this.name = 'CasualTableServiceError';
  }
}

interface CasualTableServiceDeps {
  readonly database?: Pick<Pool, 'connect'>;
  readonly runtime?: CasualTableRuntimePort;
  readonly now?: () => number;
  readonly loadDeck?: (userId: string, deckId: string) => Promise<OwnedDeckSummary>;
  readonly getPointTable?: () => Promise<DeckPointTableRules>;
  readonly assertGameplayAvailable?: () => Promise<void>;
  readonly getGameplayRestriction?: () => Promise<{ title: string; summary: string | null } | null>;
  readonly loadRoomLifecycleTimeoutConfig?: () => Promise<RoomLifecycleTimeoutConfig>;
}

/** 命令级加载的休闲时限窗口：心跳宽限与配对确认期限（实时语义，不冻结）。 */
interface CasualLifecycleWindows {
  readonly heartbeatGraceMs: number;
  readonly confirmationTtlMs: number;
}

/** Persistent casual admission and ownership across preparation, matches and rematches. */
export class CasualTableService {
  private readonly database: Pick<Pool, 'connect'>;
  private readonly runtime: CasualTableRuntimePort;
  private readonly now: () => number;
  private readonly loadDeck: (userId: string, deckId: string) => Promise<OwnedDeckSummary>;
  private readonly getPointTable: () => Promise<DeckPointTableRules>;
  private readonly assertGameplayAvailable: () => Promise<void>;
  private readonly getGameplayRestriction: () => Promise<{
    title: string;
    summary: string | null;
  } | null>;
  private readonly loadRoomLifecycleTimeoutConfig: () => Promise<RoomLifecycleTimeoutConfig>;

  constructor(deps: CasualTableServiceDeps = {}) {
    this.database = deps.database ?? pool;
    this.runtime = deps.runtime ?? onlineRoomService;
    this.now = deps.now ?? Date.now;
    this.loadDeck = deps.loadDeck ?? loadOwnedDeckForOnlineMatch;
    this.getPointTable = deps.getPointTable ?? (() => deckPointTableService.getCurrentRules());
    this.getGameplayRestriction =
      deps.getGameplayRestriction ?? (() => siteAnnouncementService.getGameplayRestriction());
    this.loadRoomLifecycleTimeoutConfig =
      deps.loadRoomLifecycleTimeoutConfig ??
      (() => Promise.resolve(DEFAULT_ROOM_LIFECYCLE_TIMEOUT_CONFIG));
    this.assertGameplayAvailable =
      deps.assertGameplayAvailable ??
      (async () => {
        const restriction = await this.getGameplayRestriction();
        if (restriction)
          throw new CasualTableServiceError(
            'CASUAL_UNAVAILABLE',
            restriction.summary || restriction.title || '当前暂不开放新对局',
            503
          );
      });
  }

  private async loadLifecycleWindows(): Promise<CasualLifecycleWindows> {
    const lifecycle = await this.loadRoomLifecycleTimeoutConfig();
    return {
      heartbeatGraceMs: lifecycle.casualHeartbeatGraceSeconds * 1000,
      confirmationTtlMs: lifecycle.casualConfirmationTtlSeconds * 1000,
    };
  }

  async list(userId: string, query: CasualLobbyQuery = {}): Promise<CasualLobbyView> {
    const parsed = parse(
      z.object({
        filter: z.enum(['ALL', 'WAITING', 'PLAYING']).optional(),
        search: z.string().trim().max(80).optional(),
        spectatable: z.boolean().optional(),
        cursor: z.string().max(2048).optional(),
      }),
      query
    );
    const restriction = await this.getGameplayRestriction();
    const lifecycle = await this.loadLifecycleWindows();
    const signature = JSON.stringify([
      parsed.filter ?? 'ALL',
      parsed.search ?? '',
      parsed.spectatable ?? false,
    ]);
    let anchor = this.now();
    let after: [number, number, string] | null = null;
    if (parsed.cursor) {
      try {
        const cursor = z
          .object({
            anchor: z.number(),
            signature: z.string(),
            after: z.tuple([z.number(), z.number(), z.uuid()]),
          })
          .parse(JSON.parse(Buffer.from(parsed.cursor, 'base64url').toString('utf8')));
        if (
          cursor.signature !== signature ||
          cursor.anchor > this.now() ||
          cursor.anchor < this.now() - 300_000
        )
          throw changed();
        anchor = cursor.anchor;
        after = cursor.after;
      } catch {
        throw new CasualTableServiceError(
          'CASUAL_CURSOR_EXPIRED',
          '列表已变化，请刷新房间列表',
          400
        );
      }
    }
    const rows = await readCasualLobby(this.database, userId, anchor);
    const all: CasualRoomSummary[] = [];
    for (const row of rows) {
      const summary = this.projectSummary(row, row.members, row.is_mine, lifecycle);
      if (summary && !(summary.status === 'ENDED' && this.now() - summary.since > 60_000))
        all.push(summary);
    }
    const counts = {
      waiting: all.filter((row) => row.status === 'WAITING').length,
      preparing: all.filter((row) => row.status === 'RESERVED' || row.status === 'OPENING').length,
      playing: all.filter((row) => row.status === 'PLAYING').length,
    };
    const filtered = all
      .filter(
        (row) =>
          (parsed.filter === 'WAITING'
            ? row.status === 'WAITING'
            : parsed.filter === 'PLAYING'
              ? row.status === 'PLAYING'
              : true) &&
          (!parsed.spectatable || row.spectatorViews.length > 0) &&
          (!parsed.search ||
            [row.roomCode, ...row.members.map((member) => member.displayName)].some((value) =>
              value.toLocaleLowerCase().includes(parsed.search!.toLocaleLowerCase())
            ))
      )
      .sort((a, b) => compareLobbyKeys(lobbyKey(a), lobbyKey(b)));
    const remaining = after
      ? filtered.filter((row) => compareLobbyKeys(lobbyKey(row), after!) > 0)
      : filtered;
    const rooms = remaining.slice(0, 50);
    return {
      rooms,
      counts,
      snapshotAt: this.now(),
      unavailableReason: restriction ? restriction.summary || restriction.title : null,
      nextCursor:
        remaining.length > 50
          ? Buffer.from(
              JSON.stringify({ anchor, signature, after: lobbyKey(rooms[rooms.length - 1]) })
            ).toString('base64url')
          : null,
    };
  }

  async preview(userId: string, roomCode: string): Promise<CasualRoomSummary> {
    const code = parse(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9]{4,12}$/),
      roomCode
    );
    await this.cleanupExpiredState();
    const lifecycle = await this.loadLifecycleWindows();
    return withCasualAdmission(this.database, async (client) => {
      const result = await client.query<CasualTableRow>(
        "SELECT * FROM casual_tables WHERE room_code = $1 AND state <> 'CLOSED'",
        [code]
      );
      const summary = result.rows[0]
        ? await this.summary(client, result.rows[0], userId, lifecycle)
        : null;
      if (!summary)
        throw new CasualTableServiceError('CASUAL_ROOM_NOT_FOUND', '房间不存在或已关闭', 404);
      return summary;
    });
  }

  async spectate(userId: string, target: CasualTableCommandTarget, seat: 'FIRST' | 'SECOND') {
    parse(targetSchema, target);
    parse(z.enum(['FIRST', 'SECOND']), seat);
    const lifecycle = await this.loadLifecycleWindows();
    await withCasualAdmission(this.database, async (client) => {
      const table = await this.requireTable(client, target);
      assertRevision(table, target);
      const summary = await this.summary(client, table, userId, lifecycle);
      if (!summary || summary.isMine || !summary.spectatorViews.some((view) => view.seat === seat))
        throw new CasualTableServiceError(
          'CASUAL_SPECTATOR_UNAVAILABLE',
          '本轮视角未开放，请刷新后重试'
        );
    });
    return this.runtime.createCasualSpectatorLink(target.tableId, target.roundId, userId, seat);
  }

  async setSpectatorPreference(
    userId: string,
    target: CasualTableCommandTarget,
    enabled: boolean
  ): Promise<CasualTableOwnView> {
    parse(targetSchema, target);
    parse(z.boolean(), enabled);
    const view = await withCasualAdmission(this.database, async (client) => {
      const table = await this.requireTable(client, target);
      assertRevision(table, target);
      await this.requireOwnSeat(client, table, userId);
      if (table.state === 'BOOTSTRAPPING') throw changed();
      await client.query(
        'UPDATE casual_table_seats SET spectator_enabled = $3 WHERE table_id = $1 AND user_id = $2',
        [table.id, userId, enabled]
      );
      table.revision += 1;
      await saveCasualTable(client, table);
      return this.project(client, table, userId);
    });
    if (view.state !== 'BOUND') return view;
    // Reconcile only committed preferences under the admission lock. Reading them
    // again also prevents a delayed request from overwriting a later toggle.
    return withCasualAdmission(this.database, async (client) => {
      const table = await this.requireTable(client, view);
      return this.project(client, table, userId);
    });
  }

  async requestRematch(
    userId: string,
    target: CasualTableCommandTarget,
    deckId: string,
    spectatorEnabled: boolean
  ): Promise<CasualTableOwnView> {
    parse(targetSchema, target);
    parse(z.uuid(), deckId);
    parse(z.boolean(), spectatorEnabled);
    await this.assertGameplayAvailable();
    const [deck, rules] = await Promise.all([this.loadDeck(userId, deckId), this.getPointTable()]);
    const view = await withCasualAdmission(this.database, async (client) => {
      const table = await this.requireTable(client, target);
      assertRevision(table, target);
      await this.requireOwnSeat(client, table, userId);
      await this.requirePostMatch(client, table, true);
      await this.replaceOwnSnapshot(client, table, userId, deck, rules, spectatorEnabled!);
      return this.project(client, table, userId);
    });
    this.runtime.requestCasualRematch(view.tableId, view.roundId, userId);
    return (await this.getCurrent(userId)).table ?? view;
  }

  async respondRematch(
    userId: string,
    target: CasualTableCommandTarget,
    requestId: string,
    deckId: string | null,
    spectatorEnabled: boolean | null
  ): Promise<CasualTableOwnView> {
    parse(targetSchema, target);
    parse(z.uuid(), requestId);
    if (deckId) {
      parse(z.boolean(), spectatorEnabled);
      parse(z.uuid(), deckId);
      await this.assertGameplayAvailable();
    }
    const [deck, rules, lifecycle] = await Promise.all([
      deckId ? this.loadDeck(userId, deckId) : Promise.resolve(null),
      this.getPointTable(),
      this.loadLifecycleWindows(),
    ]);
    let retirement: { tableId: string; roundId: string; generation: string } | null = null;
    const result = await withCasualAdmission(this.database, async (client) => {
      const table = await this.requireTable(client, target);
      assertRevision(table, target);
      await this.requireOwnSeat(client, table, userId);
      const runtime = await this.requirePostMatch(client, table, Boolean(deck));
      const request = runtime.view.rematch;
      if (
        !request ||
        request.requestId !== requestId ||
        (deck && request.responderUserId !== userId)
      )
        throw changed();
      if (!deck) this.runtime.dismissCasualRematch(table.id, table.round_id, userId, requestId);
      else {
        await this.replaceOwnSnapshot(client, table, userId, deck, rules, spectatorEnabled!);
        const seats = await readCasualSeats(client, table.id);
        if (seats.some((seat) => !reviewSeat(seat, rules))) throw invalidDeck();
        await this.runtime.sealCasualTableRuntime(table.id, table.round_id, table.room_generation!);
        retirement = {
          tableId: table.id,
          roundId: table.round_id,
          generation: table.room_generation!,
        };
        table.state = 'RESERVED';
        table.round_id = randomUUID();
        table.revision += 1;
        table.room_generation = null;
        table.bootstrap_attempts = 0;
        table.confirmation_expires_at = new Date(this.now() + lifecycle.confirmationTtlMs);
        await client.query(
          'UPDATE casual_table_seats SET confirmed_at = NULL, heartbeat_at = $2 WHERE table_id = $1',
          [table.id, new Date(this.now())]
        );
        await client.query(
          "UPDATE gameplay_participations SET kind = 'CASUAL_TABLE', room_generation = NULL, match_id = NULL, updated_at = $2 WHERE casual_table_id = $1",
          [table.id, new Date(this.now())]
        );
        await saveCasualTable(client, table);
      }
      return this.project(client, table, userId);
    });
    if (retirement) await this.finishRetirement(retirement);
    return result;
  }

  async leave(userId: string, target: CasualTableCommandTarget): Promise<CasualTableCurrentView> {
    parse(targetSchema, target);
    const [rules, lifecycle] = await Promise.all([
      this.getPointTable(),
      this.loadLifecycleWindows(),
    ]);
    const result = await withCasualAdmission(this.database, async (client) => {
      let retirement: { tableId: string; roundId: string; generation: string } | null = null;
      let departure: { tableId: string; roundId: string } | null = null;
      const table = await this.requireTable(client, target);
      assertRevision(table, target);
      await this.requireOwnSeat(client, table, userId);
      if (table.state === 'BOOTSTRAPPING') throw changed();
      if (table.state !== 'BOUND')
        await this.recoverPair(client, table, [userId], 'PLAYER_CANCELED', rules, false, lifecycle);
      else {
        const runtime = this.runtime.getCasualTableRuntime(table.id, table.round_id);
        if (!runtime || runtime.ended) await this.close(client, table, 'RUNTIME_UNAVAILABLE');
        else if (runtime.completed) {
          departure = { tableId: table.id, roundId: table.round_id };
          await client.query(
            'DELETE FROM gameplay_participations WHERE casual_table_id = $1 AND user_id = $2',
            [table.id, userId]
          );
          const remaining = await client.query(
            'SELECT user_id FROM gameplay_participations WHERE casual_table_id = $1',
            [table.id]
          );
          if (!remaining.rowCount) {
            await this.runtime.sealCasualTableRuntime(
              table.id,
              table.round_id,
              table.room_generation!
            );
            retirement = {
              tableId: table.id,
              roundId: table.round_id,
              generation: table.room_generation!,
            };
            await this.close(client, table, 'ROOM_LEFT');
          }
        } else if (!runtime.view.matchId) {
          await this.runtime.sealCasualTableRuntime(
            table.id,
            table.round_id,
            table.room_generation!
          );
          retirement = {
            tableId: table.id,
            roundId: table.round_id,
            generation: table.room_generation!,
          };
          await this.close(client, table, 'PLAYER_LEFT_OPENING');
        } else
          throw new CasualTableServiceError(
            'CASUAL_MATCH_ACTIVE',
            '对局进行中，请返回房间；结束本局请认输'
          );
      }
      return { view: await this.current(client, userId), departure, retirement };
    });
    if (result.departure)
      this.runtime.markCasualMemberLeft(result.departure.tableId, result.departure.roundId, userId);
    if (result.retirement) await this.finishRetirement(result.retirement);
    return result.view;
  }

  async continuePublic(
    userId: string,
    target: CasualTableCommandTarget,
    input: CasualTableEntryInput,
    publishNewRoom: boolean
  ): Promise<CasualTableOwnView> {
    parse(targetSchema, target);
    parse(entrySchema, input);
    parse(z.boolean(), publishNewRoom);
    await this.assertGameplayAvailable();
    const [deck, rules] = await Promise.all([
      this.loadDeck(userId, input.deckId),
      this.getPointTable(),
    ]);
    let retirement: { tableId: string; roundId: string; generation: string } | null = null;
    const result = await withCasualAdmission(this.database, async (client) => {
      const table = await this.requireTable(client, target);
      assertRevision(table, target);
      await this.requireOwnSeat(client, table, userId);
      await this.requirePostMatch(client, table, false);
      const others = await client.query(
        'SELECT user_id FROM gameplay_participations WHERE casual_table_id = $1 AND user_id <> $2',
        [table.id, userId]
      );
      if (others.rowCount)
        throw new CasualTableServiceError(
          'CASUAL_OPPONENT_STILL_PRESENT',
          '对手仍在房间中，可先协商再战或离开'
        );
      if (table.discoverability === 'UNLISTED' && !publishNewRoom)
        throw new CasualTableServiceError(
          'CASUAL_PUBLIC_CONSENT_REQUIRED',
          '继续公开找人会关闭原房间并新建公开房间，请确认'
        );
      const seat = makeSeat(userId, deck, input.spectatorEnabled, true, this.now());
      if (!reviewSeat(seat, rules)) throw invalidDeck();
      await this.runtime.sealCasualTableRuntime(table.id, table.round_id, table.room_generation!);
      retirement = {
        tableId: table.id,
        roundId: table.round_id,
        generation: table.room_generation!,
      };
      let next = table;
      if (table.discoverability === 'UNLISTED') {
        await this.close(client, table, 'CONTINUED_PUBLICLY');
        next = await this.newTable(
          client,
          userId,
          { requestId: input.requestId, discoverability: 'PUBLIC', note: '' },
          this.now()
        );
        if (!(await acquireCasualParticipation(client, userId, next.id))) throw occupied();
      } else {
        next.state = 'WAITING';
        next.round_id = randomUUID();
        next.revision += 1;
        next.waiting_since = new Date(this.now());
        next.room_generation = null;
        next.bootstrap_attempts = 0;
        await client.query('DELETE FROM casual_table_seats WHERE table_id = $1', [next.id]);
        await client.query(
          "UPDATE gameplay_participations SET kind = 'CASUAL_TABLE', room_generation = NULL, match_id = NULL, updated_at = $2 WHERE casual_table_id = $1",
          [next.id, new Date(this.now())]
        );
        await saveCasualTable(client, next);
      }
      seat.table_id = next.id;
      await insertCasualSeat(client, seat);
      return this.project(client, next, userId);
    });
    if (retirement) await this.finishRetirement(retirement);
    return result;
  }

  private async requirePostMatch(client: PoolClient, table: CasualTableRow, requireBoth: boolean) {
    const runtime = this.runtime.getCasualTableRuntime(table.id, table.round_id);
    if (table.state !== 'BOUND' || !runtime?.completed || runtime.ended) throw changed();
    if (requireBoth) {
      const participants = await client.query(
        'SELECT user_id FROM gameplay_participations WHERE casual_table_id = $1',
        [table.id]
      );
      if (participants.rowCount !== 2 || runtime.view.departedUserIds.length)
        throw new CasualTableServiceError('CASUAL_OPPONENT_LEFT', '对手已离开，无法再战');
    }
    return runtime;
  }

  private async replaceOwnSnapshot(
    client: PoolClient,
    table: CasualTableRow,
    userId: string,
    deck: OwnedDeckSummary,
    rules: DeckPointTableRules,
    spectatorEnabled: boolean
  ) {
    const previous = await this.requireOwnSeat(client, table, userId);
    const seat = makeSeat(userId, deck, spectatorEnabled, previous.continue_public, this.now());
    if (!reviewSeat(seat, rules)) throw invalidDeck();
    seat.table_id = table.id;
    seat.seat = previous.seat;
    seat.waiting_since = previous.waiting_since;
    await client.query('DELETE FROM casual_table_seats WHERE table_id = $1 AND user_id = $2', [
      table.id,
      userId,
    ]);
    await insertCasualSeat(client, seat);
  }

  private async summary(
    client: PoolClient,
    table: CasualTableRow,
    userId: string,
    lifecycle: CasualLifecycleWindows
  ): Promise<CasualRoomSummary | null> {
    if (table.state === 'CLOSED') return null;
    const seats = await readCasualSeats(client, table.id);
    const isMine =
      seats.some((seat) => seat.user_id === userId) &&
      (await readCasualParticipation(client, userId))?.casual_table_id === table.id;
    return this.projectSummary(
      table,
      seats.map((seat) => ({
        userId: seat.user_id,
        displayName: seat.display_name,
        heartbeatAt: seat.heartbeat_at.getTime(),
      })),
      isMine,
      lifecycle
    );
  }

  private projectSummary(
    table: CasualTableRow,
    members: readonly CasualLobbyMember[],
    isMine: boolean,
    lifecycle: CasualLifecycleWindows
  ): CasualRoomSummary | null {
    if (table.state === 'CLOSED') return null;
    const alive = members.every(
      (member) => member.heartbeatAt > this.now() - lifecycle.heartbeatGraceMs
    );
    if (
      (table.state === 'WAITING' && (members.length !== 1 || !alive)) ||
      (table.state === 'RESERVED' &&
        (members.length !== 2 ||
          !alive ||
          (table.confirmation_expires_at?.getTime() ?? 0) <= this.now()))
    )
      return null;
    const runtime =
      table.state === 'BOUND' ? this.runtime.getCasualTableRuntime(table.id, table.round_id) : null;
    if (
      table.state === 'BOUND' &&
      (!runtime || runtime.ended || runtime.roomGeneration !== table.room_generation)
    )
      return null;
    const view = runtime?.view;
    return {
      tableId: table.id,
      roundId: table.round_id,
      revision: table.revision,
      roomCode: table.room_code,
      note: table.note,
      status:
        view?.status ??
        (table.state === 'BOOTSTRAPPING'
          ? 'OPENING'
          : table.state === 'RESERVED'
            ? 'RESERVED'
            : 'WAITING'),
      members: members.map(({ userId, displayName }) => ({ userId, displayName })),
      since:
        view?.status === 'OPENING'
          ? table.waiting_since.getTime()
          : (view?.endedAt ?? view?.startedAt ?? table.waiting_since.getTime()),
      canJoin: table.state === 'WAITING' && members.length === 1 && alive,
      isMine,
      spectatorViews: view?.spectatorViews ?? [],
    };
  }

  async create(userId: string, input: CreateCasualTableInput): Promise<CasualTableOwnView> {
    const parsed = parse(createSchema, input);
    return this.enter(userId, parsed, false);
  }

  async findOpponent(userId: string, input: CasualTableEntryInput): Promise<CasualTableOwnView> {
    return this.enter(
      userId,
      { ...parse(entrySchema, input), discoverability: 'PUBLIC', note: '' },
      true
    );
  }

  private async enter(
    userId: string,
    input: CreateCasualTableInput,
    find: boolean
  ): Promise<CasualTableOwnView> {
    // Recover retries from the frozen snapshot even if the source deck was later
    // edited/deleted, or the site has paused new admission.
    const initialRules = await this.getPointTable();
    const initialLifecycle = await this.loadLifecycleWindows();
    const existing = await withCasualAdmission(this.database, async (client) => {
      await this.sweep(client, initialRules, initialLifecycle);
      return this.existingEntry(client, userId, input.requestId, find);
    });
    if (existing) return existing;
    await this.assertGameplayAvailable();
    const [deck, rules, lifecycle] = await Promise.all([
      this.loadDeck(userId, input.deckId),
      this.getPointTable(),
      this.loadLifecycleWindows(),
    ]);
    return withCasualAdmission(this.database, async (client) => {
      await this.sweep(client, rules, lifecycle);
      const retry = await this.existingEntry(client, userId, input.requestId, find);
      if (retry) return retry;
      let table: CasualTableRow | null = null;
      if (find) {
        const candidates = await client.query<CasualTableRow>(
          `SELECT * FROM casual_tables WHERE environment_id = $1 AND state = 'WAITING'
             AND discoverability = 'PUBLIC' ORDER BY waiting_since, id FOR UPDATE`,
          [CASUAL_ENVIRONMENT_ID]
        );
        table = candidates.rows[0] ?? null;
      }
      if (table) {
        await this.claim(
          client,
          table,
          makeSeat(userId, deck, input.spectatorEnabled, true, this.now()),
          rules,
          lifecycle
        );
      } else {
        table = await this.newTable(client, userId, input, this.now());
        const seat = makeSeat(
          userId,
          deck,
          input.spectatorEnabled,
          input.discoverability === 'PUBLIC',
          this.now()
        );
        seat.table_id = table.id;
        if (!reviewSeat(seat, rules)) throw invalidDeck();
        if (!(await acquireCasualParticipation(client, userId, table.id))) throw occupied();
        await insertCasualSeat(client, seat);
      }
      return this.project(client, table, userId);
    });
  }

  /** Browsing/choosing a deck does not call this command or reserve a seat. */
  async join(
    userId: string,
    target: CasualTableCommandTarget,
    input: CasualTableEntryInput
  ): Promise<CasualTableOwnView> {
    parse(targetSchema, target);
    parse(entrySchema, input);
    const initialRules = await this.getPointTable();
    const initialLifecycle = await this.loadLifecycleWindows();
    const existing = await withCasualAdmission(this.database, async (client) => {
      await this.sweep(client, initialRules, initialLifecycle);
      const table = await this.requireTable(client, target);
      const seats = await readCasualSeats(client, table.id);
      return seats.some((seat) => seat.user_id === userId) && table.state !== 'WAITING'
        ? this.project(client, table, userId)
        : null;
    });
    if (existing) return existing;
    await this.assertGameplayAvailable();
    const [deck, rules, lifecycle] = await Promise.all([
      this.loadDeck(userId, input.deckId),
      this.getPointTable(),
      this.loadLifecycleWindows(),
    ]);
    return withCasualAdmission(this.database, async (client) => {
      await this.sweep(client, rules, lifecycle);
      const table = await this.requireTable(client, target);
      const seats = await readCasualSeats(client, table.id);
      if (seats.some((seat) => seat.user_id === userId) && table.state !== 'WAITING') {
        return this.project(client, table, userId);
      }
      assertRevision(table, target);
      if (await readCasualParticipation(client, userId)) throw occupied();
      await this.claim(
        client,
        table,
        makeSeat(userId, deck, input.spectatorEnabled, false, this.now()),
        rules,
        lifecycle
      );
      return this.project(client, table, userId);
    });
  }

  /** Validate the destination before touching the source. A failed claim rolls back both. */
  async switchWaiting(
    userId: string,
    source: CasualTableCommandTarget,
    destination: CasualTableCommandTarget,
    input: CasualTableEntryInput
  ): Promise<CasualTableOwnView> {
    parse(targetSchema, source);
    parse(targetSchema, destination);
    parse(entrySchema, input);
    if (source.tableId === destination.tableId) throw changed();
    await this.assertGameplayAvailable();
    const [deck, rules, lifecycle] = await Promise.all([
      this.loadDeck(userId, input.deckId),
      this.getPointTable(),
      this.loadLifecycleWindows(),
    ]);
    return withCasualAdmission(this.database, async (client) => {
      await this.sweep(client, rules, lifecycle);
      // All casual writers take the admission lock before any table/user row lock.
      const tables: CasualTableRow[] = [];
      for (const target of [source, destination].sort((a, b) =>
        a.tableId.localeCompare(b.tableId)
      )) {
        tables.push(await this.requireTable(client, target));
      }
      const from = tables.find((table) => table.id === source.tableId)!;
      const to = tables.find((table) => table.id === destination.tableId)!;
      assertRevision(from, source);
      assertRevision(to, destination);
      const seats = await readCasualSeats(client, from.id);
      const participation = await readCasualParticipation(client, userId);
      if (
        from.state !== 'WAITING' ||
        seats.length !== 1 ||
        seats[0].user_id !== userId ||
        participation?.casual_table_id !== from.id
      )
        throw changed();
      if (to.state !== 'WAITING' || (await readCasualSeats(client, to.id)).length !== 1)
        throw full();
      const seat = makeSeat(userId, deck, input.spectatorEnabled, false, this.now());
      if (!reviewSeat(seat, rules)) throw invalidDeck();
      await this.close(client, from, 'SWITCHED_ROOM');
      await this.claim(client, to, seat, rules, lifecycle);
      return this.project(client, to, userId);
    });
  }

  async changeDeck(
    userId: string,
    target: CasualTableCommandTarget,
    deckId: string
  ): Promise<CasualTableOwnView> {
    parse(targetSchema, target);
    parse(z.uuid(), deckId);
    const [deck, rules, lifecycle] = await Promise.all([
      this.loadDeck(userId, deckId),
      this.getPointTable(),
      this.loadLifecycleWindows(),
    ]);
    return withCasualAdmission(this.database, async (client) => {
      await this.sweep(client, rules, lifecycle);
      const table = await this.requireTable(client, target);
      assertRevision(table, target);
      const own = await this.requireOwnSeat(client, table, userId);
      if (table.state !== 'WAITING')
        throw new CasualTableServiceError(
          'CASUAL_CANCEL_BEFORE_DECK_CHANGE',
          '请先取消当前配对，再更换卡组'
        );
      const replacement = makeSeat(
        userId,
        deck,
        own.spectator_enabled,
        own.continue_public,
        this.now()
      );
      replacement.table_id = table.id;
      replacement.waiting_since = own.waiting_since;
      if (!reviewSeat(replacement, rules)) throw invalidDeck();
      await client.query('DELETE FROM casual_table_seats WHERE table_id = $1', [table.id]);
      await insertCasualSeat(client, replacement);
      table.round_id = randomUUID();
      table.revision += 1;
      await saveCasualTable(client, table);
      return this.project(client, table, userId);
    });
  }

  async confirm(userId: string, target: CasualTableCommandTarget): Promise<CasualTableOwnView> {
    parse(targetSchema, target);
    await this.assertGameplayAvailable();
    const [rules, lifecycle] = await Promise.all([
      this.getPointTable(),
      this.loadLifecycleWindows(),
    ]);
    const result = await withCasualAdmission(this.database, async (client) => {
      await this.sweep(client, rules, lifecycle);
      const table = await this.requireTable(client, target);
      const own = await this.requireOwnSeat(client, table, userId);
      // The other player's confirmation changes revision, never the frozen input.
      // Round identity fences confirmations; future revisions are never accepted.
      if (target.revision > table.revision) throw changed();
      if (table.state === 'BOUND' || table.state === 'BOOTSTRAPPING') return table;
      if (
        table.state !== 'RESERVED' ||
        !table.confirmation_expires_at ||
        table.confirmation_expires_at.getTime() <= this.now()
      )
        throw changed();
      const seats = await readCasualSeats(client, table.id);
      if (
        seats.length !== 2 ||
        seats.some(
          (seat) =>
            !isAlive(seat, this.now(), lifecycle.heartbeatGraceMs) || !reviewSeat(seat, rules)
        )
      )
        throw invalidDeck();
      if (!own.confirmed_at) {
        await client.query(
          'UPDATE casual_table_seats SET confirmed_at = $3, heartbeat_at = $3 WHERE table_id = $1 AND user_id = $2',
          [table.id, userId, new Date(this.now())]
        );
        table.revision += 1;
      }
      if (seats.every((seat) => seat.user_id === userId || seat.confirmed_at !== null)) {
        table.state = 'BOOTSTRAPPING';
        table.bootstrap_attempts = 1;
        table.bootstrap_lease_until = new Date(this.now() + BOOTSTRAP_LEASE_MS);
      }
      await saveCasualTable(client, table);
      return table;
    });
    if (result.state === 'BOOTSTRAPPING')
      await this.bootstrap(result.id, result.round_id, result.revision);
    // Do not follow a stale confirmation into a newly paired round.
    return withCasualAdmission(this.database, async (client) =>
      this.project(client, await this.requireTable(client, target), userId)
    );
  }

  async cancel(userId: string, target: CasualTableCommandTarget): Promise<CasualTableCurrentView> {
    parse(targetSchema, target);
    const [rules, lifecycle] = await Promise.all([
      this.getPointTable(),
      this.loadLifecycleWindows(),
    ]);
    return withCasualAdmission(this.database, async (client) => {
      await this.sweep(client, rules, lifecycle);
      const table = await this.requireTable(client, target);
      if (table.state === 'CLOSED') return this.current(client, userId);
      assertRevision(table, target);
      await this.requireOwnSeat(client, table, userId);
      if (table.state === 'BOOTSTRAPPING')
        throw new CasualTableServiceError(
          'CASUAL_BOOTSTRAP_IN_PROGRESS',
          '正在准备开局，请等待本轮结果'
        );
      if (table.state === 'BOUND')
        throw new CasualTableServiceError('CASUAL_ALREADY_BOUND', '请在当前房间处理本轮对局');
      await this.recoverPair(client, table, [userId], 'PLAYER_CANCELED', rules, false, lifecycle);
      return this.current(client, userId);
    });
  }

  async heartbeat(
    userId: string,
    target: CasualTableCommandTarget
  ): Promise<CasualTableCurrentView> {
    parse(targetSchema, target);
    const [rules, lifecycle] = await Promise.all([
      this.getPointTable(),
      this.loadLifecycleWindows(),
    ]);
    return withCasualAdmission(this.database, async (client) => {
      // Check expiry before refreshing; an offline page must not revive an old seat.
      await this.sweep(client, rules, lifecycle);
      const table = await this.requireTable(client, target);
      await this.requireOwnSeat(client, table, userId);
      if (
        table.state === 'BOUND' &&
        this.runtime.getCasualTableRuntime(table.id, table.round_id)?.completed
      ) {
        this.runtime.touchCasualMember(table.id, table.round_id, userId);
      }
      if (
        table.state === 'WAITING' ||
        table.state === 'RESERVED' ||
        table.state === 'BOOTSTRAPPING'
      ) {
        await client.query(
          'UPDATE casual_table_seats SET heartbeat_at = $3 WHERE table_id = $1 AND user_id = $2',
          [table.id, userId, new Date(this.now())]
        );
      }
      return this.current(client, userId);
    });
  }

  async getCurrent(userId: string): Promise<CasualTableCurrentView> {
    await this.cleanupExpiredState();
    return withCasualAdmission(this.database, async (client) => this.current(client, userId));
  }

  /** Shared by the server cleanup coordinator and current-room recovery. */
  async cleanupExpiredState(): Promise<void> {
    const [rules, lifecycle] = await Promise.all([
      this.getPointTable(),
      this.loadLifecycleWindows(),
    ]);
    const recoveries = await withCasualAdmission(this.database, async (client) => {
      await this.sweep(client, rules, lifecycle);
      const result = await client.query<CasualTableRow>(
        `SELECT * FROM casual_tables WHERE state = 'BOOTSTRAPPING' AND bootstrap_lease_until <= $1 ORDER BY id FOR UPDATE`,
        [new Date(this.now())]
      );
      await client.query("DELETE FROM casual_tables WHERE state = 'CLOSED' AND closed_at < $1", [
        new Date(this.now() - 24 * 60 * 60 * 1000),
      ]);
      const pending: CasualTableRow[] = [];
      for (const table of result.rows) {
        if (table.bootstrap_attempts >= MAX_BOOTSTRAP_ATTEMPTS) {
          await this.close(client, table, 'BOOTSTRAP_ATTEMPTS_EXHAUSTED');
        } else {
          table.bootstrap_attempts += 1;
          table.revision += 1;
          table.bootstrap_lease_until = new Date(this.now() + BOOTSTRAP_LEASE_MS);
          await saveCasualTable(client, table);
          pending.push(table);
        }
      }
      return pending;
    });
    for (const table of recoveries) await this.bootstrap(table.id, table.round_id, table.revision);
  }

  private async bootstrap(tableId: string, roundId: string, leaseRevision: number): Promise<void> {
    // Policy loading is outside the lock. A delayed loader must pass the lease fence again.
    let rules: DeckPointTableRules;
    let lifecycle: CasualLifecycleWindows;
    try {
      [rules, lifecycle] = await Promise.all([this.getPointTable(), this.loadLifecycleWindows()]);
    } catch {
      return;
    }
    let binding: { tableId: string; roundId: string; generation: string } | null = null;
    try {
      binding = await withCasualAdmission(this.database, async (client) => {
        const table = await readCasualTable(client, tableId);
        if (
          !table ||
          table.round_id !== roundId ||
          table.state !== 'BOOTSTRAPPING' ||
          table.revision !== leaseRevision ||
          !table.bootstrap_lease_until ||
          table.bootstrap_lease_until.getTime() <= this.now()
        )
          return null;
        const seats = await readCasualSeats(client, table.id);
        if (
          seats.length !== 2 ||
          seats.some(
            (seat) =>
              !seat.confirmed_at ||
              !isAlive(seat, this.now(), lifecycle.heartbeatGraceMs) ||
              !reviewSeat(seat, rules)
          )
        ) {
          await this.close(client, table, 'BOOTSTRAP_INPUT_INVALID');
          return null;
        }
        for (const seat of seats) {
          await client.query(
            'UPDATE casual_table_seats SET point_table_version = $3, point_total = $4, point_limit = $5 WHERE table_id = $1 AND user_id = $2',
            [table.id, seat.user_id, seat.point_table_version, seat.point_total, seat.point_limit]
          );
        }
        const runtime = this.runtime.prepareCasualTableRuntime({
          tableId,
          roundId,
          roomCode: table.room_code,
          originKind: seats[1].continue_public ? 'PUBLIC_TABLE' : 'ONLINE_ROOM',
          openingExpiresAt: this.now() + PUBLIC_TABLE_OPENING_TTL_MS,
          members: [runtimeMember(seats[0]), runtimeMember(seats[1])],
        });
        // Lock participants in a fixed order before converting the two rows together.
        const userIds = seats.map((seat) => seat.user_id).sort();
        const eligible = await client.query<{ user_id: string }>(
          `SELECT user_id FROM gameplay_participations WHERE user_id = ANY($1::uuid[])
             AND kind = 'CASUAL_TABLE' AND casual_table_id = $2 ORDER BY user_id FOR UPDATE`,
          [userIds, table.id]
        );
        if (eligible.rowCount !== 2) throw occupied();
        await client.query(
          `UPDATE gameplay_participations SET kind = 'ONLINE_ROOM', room_generation = $2, updated_at = $3
           WHERE casual_table_id = $1 AND user_id = ANY($4::uuid[]) AND kind = 'CASUAL_TABLE'`,
          [table.id, runtime.roomGeneration, new Date(this.now()), userIds]
        );
        table.state = 'BOUND';
        table.room_generation = runtime.roomGeneration;
        table.bootstrap_lease_until = null;
        table.confirmation_expires_at = null;
        table.failure_reason = null;
        table.revision += 1;
        await saveCasualTable(client, table);
        return { tableId, roundId, generation: runtime.roomGeneration };
      });
    } catch (error) {
      // A failed/ambiguous COMMIT may leave a pending runtime. It remains inaccessible
      // until recovery determines whether the DB committed; never expose it here.
      console.error(
        JSON.stringify({
          scope: 'casual_table',
          event: 'BOOTSTRAP_DEFERRED',
          tableId,
          roundId,
          message: error instanceof Error ? error.message : String(error),
        })
      );
      return;
    }
    if (binding)
      this.runtime.activateCasualTableRuntime(binding.tableId, binding.roundId, binding.generation);
  }

  private async existingEntry(
    client: PoolClient,
    userId: string,
    requestId: string,
    find: boolean
  ): Promise<CasualTableOwnView | null> {
    const participation = await readCasualParticipation(client, userId);
    if (participation?.casual_table_id) {
      const table = await readCasualTable(client, participation.casual_table_id);
      if (table && table.state !== 'CLOSED' && (find || table.creation_key === requestId)) {
        return this.project(client, table, userId);
      }
    }
    if (participation) throw occupied();
    const previous = await client.query<CasualTableRow>(
      'SELECT * FROM casual_tables WHERE created_by = $1 AND creation_key = $2 FOR UPDATE',
      [userId, requestId]
    );
    // A public room can pass to its remaining player after a completed game.
    // The original creation key grants no membership in those later rounds.
    if (previous.rows[0] && previous.rows[0].state !== 'CLOSED') throw changed();
    return previous.rows[0] ? this.project(client, previous.rows[0], userId) : null;
  }

  private async claim(
    client: PoolClient,
    table: CasualTableRow,
    seat: CasualSeatRow,
    rules: DeckPointTableRules,
    lifecycle: CasualLifecycleWindows
  ): Promise<void> {
    const seats = await readCasualSeats(client, table.id);
    if (
      table.state !== 'WAITING' ||
      seats.length !== 1 ||
      !isAlive(seats[0], this.now(), lifecycle.heartbeatGraceMs)
    )
      throw full();
    if (seats[0].user_id === seat.user_id) throw occupied();
    if (!reviewSeat(seats[0], rules) || !reviewSeat(seat, rules)) throw invalidDeck();
    if (!(await acquireCasualParticipation(client, seat.user_id, table.id))) throw occupied();
    seat.table_id = table.id;
    seat.seat = 1;
    await insertCasualSeat(client, seat);
    table.state = 'RESERVED';
    table.revision += 1;
    table.confirmation_expires_at = new Date(this.now() + lifecycle.confirmationTtlMs);
    table.failure_reason = null;
    await saveCasualTable(client, table);
  }

  private async newTable(
    client: PoolClient,
    userId: string,
    input: Pick<CreateCasualTableInput, 'requestId' | 'discoverability' | 'note'>,
    waitingSince: number
  ): Promise<CasualTableRow> {
    let roomCode = '';
    for (let attempt = 0; attempt < 32; attempt += 1) {
      roomCode = Array.from(
        { length: 6 },
        () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]
      ).join('');
      const used = await client.query(
        "SELECT id FROM casual_tables WHERE room_code = $1 AND state <> 'CLOSED'",
        [roomCode]
      );
      if (used.rowCount === 0) break;
      roomCode = '';
    }
    if (!roomCode)
      throw new CasualTableServiceError(
        'CASUAL_ROOM_CODE_UNAVAILABLE',
        '暂时无法分配房间号，请重试',
        503
      );
    const table: CasualTableRow = {
      id: randomUUID(),
      room_code: roomCode,
      discoverability: input.discoverability,
      note: input.note,
      environment_id: CASUAL_ENVIRONMENT_ID,
      state: 'WAITING',
      round_id: randomUUID(),
      revision: 1,
      waiting_since: new Date(waitingSince),
      confirmation_expires_at: null,
      bootstrap_lease_until: null,
      bootstrap_attempts: 0,
      room_generation: null,
      created_by: userId,
      creation_key: input.requestId,
      failure_reason: null,
      created_at: new Date(this.now()),
      closed_at: null,
    };
    await insertCasualTable(client, table);
    return table;
  }

  private async finishRetirement(identity: {
    tableId: string;
    roundId: string;
    generation: string;
  }): Promise<void> {
    try {
      await this.runtime.retireCasualTableRuntime(
        identity.tableId,
        identity.roundId,
        identity.generation
      );
    } catch (error) {
      console.warn(
        JSON.stringify({
          scope: 'casual_table',
          event: 'RETIREMENT_DEFERRED',
          ...identity,
          message: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }

  /** Called at admission entry, before this transaction changes a table.
   * Existing round/CLOSED facts distinguish committed retirement from a rollback. */
  private async cleanupCommittedRetirements(client: PoolClient, tableId?: string): Promise<void> {
    for (const identity of this.runtime.listCasualTableRuntimes()) {
      if (tableId && identity.tableId !== tableId) continue;
      const persisted = await readCasualTable(client, identity.tableId);
      if (!persisted || persisted.state === 'CLOSED' || persisted.round_id !== identity.roundId) {
        // A prior transaction already retired this round. Never remove the current BOUND runtime.
        await this.runtime.retireCasualTableRuntime(
          identity.tableId,
          identity.roundId,
          identity.generation
        );
      } else if (persisted.state === 'BOUND' && persisted.room_generation === identity.generation) {
        this.runtime.resumeCasualTableRuntime(
          identity.tableId,
          identity.roundId,
          identity.generation
        );
        const active = new Set(
          (
            await client.query<{ user_id: string }>(
              'SELECT user_id FROM gameplay_participations WHERE casual_table_id=$1',
              [identity.tableId]
            )
          ).rows.map((row) => row.user_id)
        );
        for (const seat of await readCasualSeats(client, identity.tableId)) {
          // These rows precede this transaction's writes: they are committed
          // authority, including when a previous COMMIT acknowledgement was lost.
          await this.runtime.setCasualSpectatorPreference(
            identity.tableId,
            identity.roundId,
            seat.user_id,
            seat.spectator_enabled
          );
          if (!active.has(seat.user_id))
            this.runtime.markCasualMemberLeft(identity.tableId, identity.roundId, seat.user_id);
        }
      }
    }
  }

  private async sweep(
    client: PoolClient,
    rules: DeckPointTableRules,
    lifecycle: CasualLifecycleWindows
  ): Promise<void> {
    await this.cleanupCommittedRetirements(client);
    const result = await client.query<CasualTableRow>(
      "SELECT * FROM casual_tables WHERE state <> 'CLOSED' ORDER BY id FOR UPDATE"
    );
    for (const table of result.rows) {
      if (table.state === 'BOUND') {
        const runtime = this.runtime.getCasualTableRuntime(table.id, table.round_id);
        if (!runtime || runtime.roomGeneration !== table.room_generation || runtime.ended) {
          // A pending allocation can be activated after a committed-but-unacknowledged bind.
          if (!runtime && table.room_generation) {
            try {
              this.runtime.activateCasualTableRuntime(
                table.id,
                table.round_id,
                table.room_generation
              );
              continue;
            } catch {
              /* No valid runtime: close, never recreate a match. */
            }
          }
          await this.close(client, table, runtime?.failureReason ?? 'RUNTIME_UNAVAILABLE');
        }
        continue;
      }
      if (table.state === 'BOOTSTRAPPING') continue;
      const seats = await readCasualSeats(client, table.id);
      if (!seats.length || seats.some((seat) => !reviewSeat(seat, rules))) {
        await this.close(client, table, 'DECK_NO_LONGER_LEGAL');
        continue;
      }
      const expired = seats.filter(
        (seat) => !isAlive(seat, this.now(), lifecycle.heartbeatGraceMs)
      );
      const timeout =
        table.state === 'RESERVED' && (table.confirmation_expires_at?.getTime() ?? 0) <= this.now();
      if (timeout || expired.length) {
        const faultIds = seats
          .filter(
            (seat) =>
              !isAlive(seat, this.now(), lifecycle.heartbeatGraceMs) ||
              (timeout && !seat.confirmed_at)
          )
          .map((seat) => seat.user_id);
        await this.recoverPair(
          client,
          table,
          faultIds,
          timeout ? 'CONFIRMATION_EXPIRED' : 'HEARTBEAT_EXPIRED',
          rules,
          timeout,
          lifecycle
        );
      }
    }
  }

  private async recoverPair(
    client: PoolClient,
    table: CasualTableRow,
    faultIds: readonly string[],
    reason: string,
    rules: DeckPointTableRules,
    timeout: boolean,
    lifecycle: CasualLifecycleWindows
  ): Promise<void> {
    const seats = await readCasualSeats(client, table.id);
    const survivor = seats.find(
      (seat) =>
        !faultIds.includes(seat.user_id) &&
        isAlive(seat, this.now(), lifecycle.heartbeatGraceMs) &&
        reviewSeat(seat, rules) &&
        (!timeout || (seat.confirmed_at !== null && seat.continue_public))
    );
    if (!survivor || (survivor.seat !== 0 && !survivor.continue_public)) {
      await this.close(client, table, reason);
      return;
    }
    if (survivor.seat === 0) {
      await client.query(
        'DELETE FROM gameplay_participations WHERE casual_table_id = $1 AND user_id <> $2',
        [table.id, survivor.user_id]
      );
      await client.query('DELETE FROM casual_table_seats WHERE table_id = $1 AND user_id <> $2', [
        table.id,
        survivor.user_id,
      ]);
      await client.query('UPDATE casual_table_seats SET confirmed_at = NULL WHERE table_id = $1', [
        table.id,
      ]);
      table.state = 'WAITING';
      table.round_id = randomUUID();
      table.revision += 1;
      table.waiting_since = survivor.waiting_since;
      table.confirmation_expires_at = null;
      table.bootstrap_lease_until = null;
      table.bootstrap_attempts = 0;
      table.failure_reason = reason;
      await saveCasualTable(client, table);
    } else {
      await this.close(client, table, reason);
      const replacement = await this.newTable(
        client,
        survivor.user_id,
        {
          requestId: randomUUID(),
          discoverability: 'PUBLIC',
          note: '',
        },
        survivor.waiting_since.getTime()
      );
      survivor.table_id = replacement.id;
      survivor.seat = 0;
      survivor.confirmed_at = null;
      if (!(await acquireCasualParticipation(client, survivor.user_id, replacement.id)))
        throw occupied();
      await insertCasualSeat(client, survivor);
    }
  }

  private async close(client: PoolClient, table: CasualTableRow, reason: string): Promise<void> {
    // Only this table's participation can be released; stale cleanup cannot delete a new mode's claim.
    await client.query('DELETE FROM gameplay_participations WHERE casual_table_id = $1', [
      table.id,
    ]);
    await client.query('UPDATE casual_table_seats SET runtime_deck = NULL WHERE table_id = $1', [
      table.id,
    ]);
    table.state = 'CLOSED';
    table.revision += 1;
    table.failure_reason = reason;
    table.closed_at = new Date(this.now());
    table.bootstrap_lease_until = null;
    table.confirmation_expires_at = null;
    table.room_generation = null;
    await saveCasualTable(client, table);
  }

  private async requireTable(
    client: PoolClient,
    target: CasualTableCommandTarget
  ): Promise<CasualTableRow> {
    await this.cleanupCommittedRetirements(client, target.tableId);
    const table = await readCasualTable(client, target.tableId);
    if (!table || table.round_id !== target.roundId || target.revision > table.revision)
      throw changed();
    return table;
  }

  private async requireOwnSeat(
    client: PoolClient,
    table: CasualTableRow,
    userId: string
  ): Promise<CasualSeatRow> {
    const seat = (await readCasualSeats(client, table.id)).find(
      (candidate) => candidate.user_id === userId
    );
    const participation = await readCasualParticipation(client, userId);
    if (!seat || participation?.casual_table_id !== table.id)
      throw new CasualTableServiceError('CASUAL_FORBIDDEN', '你不在本轮准备中', 403);
    return seat;
  }

  private async current(client: PoolClient, userId: string): Promise<CasualTableCurrentView> {
    const participation = await readCasualParticipation(client, userId);
    if (!participation) {
      const closed = await client.query<{ id: string; room_code: string; failure_reason: string }>(
        `SELECT tables.id, tables.room_code, tables.failure_reason
         FROM casual_tables AS tables JOIN casual_table_seats AS seat ON seat.table_id = tables.id
         WHERE seat.user_id = $1 AND tables.state = 'CLOSED' AND tables.closed_at >= $2
         ORDER BY tables.closed_at DESC, tables.id DESC LIMIT 1`,
        [userId, new Date(this.now() - 24 * 60 * 60 * 1000)]
      );
      const notice = closed.rows[0];
      return {
        table: null,
        otherParticipation: null,
        ...(notice
          ? {
              notice: {
                tableId: notice.id,
                roomCode: notice.room_code,
                reason: notice.failure_reason,
              },
            }
          : {}),
      };
    }
    if (!participation.casual_table_id) {
      const ticket = participation.ticket_id
        ? (
            await client.query<{ queue_kind: string }>(
              'SELECT queue_kind FROM public_table_tickets WHERE id = $1',
              [participation.ticket_id]
            )
          ).rows[0]
        : null;
      const kind = ticket?.queue_kind ?? participation.kind;
      return {
        table: null,
        otherParticipation: {
          kind: participation.kind,
          destination: kind.includes('THEME')
            ? 'theme-table'
            : kind.includes('RANKED')
              ? 'ranked'
              : 'online-room',
          roomGeneration: participation.room_generation,
          matchId: participation.match_id,
        },
      };
    }
    const table = await readCasualTable(client, participation.casual_table_id);
    if (!table) throw new Error('Casual participation references a missing table');
    return { table: await this.project(client, table, userId), otherParticipation: null };
  }

  private async project(
    client: PoolClient,
    table: CasualTableRow,
    userId: string
  ): Promise<CasualTableOwnView> {
    const seats = await readCasualSeats(client, table.id);
    const own = seats.find((seat) => seat.user_id === userId);
    if (!own) throw new CasualTableServiceError('CASUAL_FORBIDDEN', '你不在本轮准备中', 403);
    const runtime =
      table.state === 'BOUND'
        ? (this.runtime.getCasualTableRuntime(table.id, table.round_id)?.view ?? null)
        : null;
    const participants = await client.query<{ user_id: string }>(
      'SELECT user_id FROM gameplay_participations WHERE casual_table_id = $1',
      [table.id]
    );
    return {
      tableId: table.id,
      roundId: table.round_id,
      revision: table.revision,
      roomCode: table.room_code,
      discoverability: table.discoverability,
      note: table.note,
      state: table.state,
      waitingSince: table.waiting_since.getTime(),
      confirmationExpiresAt: table.confirmation_expires_at?.getTime() ?? null,
      ownDeck: own ? { id: own.source_deck_id, name: own.deck_name } : null,
      spectatorEnabled: own?.spectator_enabled ?? false,
      members: seats.map((seat) => ({
        userId: seat.user_id,
        displayName: seat.display_name,
        confirmed: seat.confirmed_at !== null,
      })),
      roomGeneration: table.room_generation,
      failureReason: table.failure_reason,
      runtime,
      canRematch:
        runtime?.status === 'ENDED' &&
        participants.rowCount === 2 &&
        runtime.departedUserIds.length === 0,
      canContinuePublic: runtime?.status === 'ENDED' && participants.rowCount === 1,
    };
  }
}

function makeSeat(
  userId: string,
  deck: OwnedDeckSummary,
  spectatorEnabled: boolean,
  continuePublic: boolean,
  now: number
): CasualSeatRow {
  const encoded = encodePublicTableRuntimeDeck(deck.runtimeDeck);
  return {
    table_id: '',
    seat: 0,
    user_id: userId,
    source_deck_id: deck.deckId,
    deck_name: deck.deckName,
    runtime_deck: JSON.parse(encoded.json) as unknown,
    point_table_version: deck.pointValidation.pointTableVersion,
    point_total: deck.pointValidation.pointTotal,
    point_limit: deck.pointValidation.pointLimit,
    locked_at: new Date(now),
    heartbeat_at: new Date(now),
    waiting_since: new Date(now),
    continue_public: continuePublic,
    spectator_enabled: spectatorEnabled,
    confirmed_at: null,
    display_name: '',
  };
}

function reviewSeat(seat: CasualSeatRow, rules: DeckPointTableRules): boolean {
  const review = revalidateRuntimeDeckPointSnapshot(
    decodePublicTableRuntimeDeck(seat.runtime_deck),
    {
      pointTableVersion: seat.point_table_version,
      pointTotal: seat.point_total,
      pointLimit: seat.point_limit,
    },
    rules
  );
  if (review.valid) {
    seat.point_table_version = review.facts.pointTableVersion;
    seat.point_total = review.facts.pointTotal;
    seat.point_limit = review.facts.pointLimit;
  }
  return review.valid;
}

function runtimeMember(
  seat: CasualSeatRow
): PublicTableRoomMemberInput & { spectatorEnabled: boolean } {
  return {
    userId: seat.user_id,
    displayName: seat.display_name,
    deckId: seat.source_deck_id,
    deckName: seat.deck_name,
    deck: decodePublicTableRuntimeDeck(seat.runtime_deck),
    lockedAt: seat.locked_at.getTime(),
    pointValidation: {
      pointTableVersion: seat.point_table_version,
      pointTotal: seat.point_total,
      pointLimit: seat.point_limit,
    },
    spectatorEnabled: seat.spectator_enabled,
  };
}

function isAlive(seat: CasualSeatRow, now: number, heartbeatGraceMs: number): boolean {
  return seat.heartbeat_at.getTime() > now - heartbeatGraceMs;
}
function assertRevision(table: CasualTableRow, target: CasualTableCommandTarget): void {
  if (table.revision !== target.revision) throw changed();
}
function changed() {
  return new CasualTableServiceError('CASUAL_STATE_CHANGED', '本轮房间状态已经变化，请刷新后重试');
}
function occupied() {
  return new CasualTableServiceError(
    'CASUAL_PARTICIPATION_CONFLICT',
    '你已经在寻找对手、准备房间或进行其他真人对局'
  );
}
function full() {
  return new CasualTableServiceError('CASUAL_ROOM_FULL', '房间已满或不再等待加入');
}
function invalidDeck() {
  return new CasualTableServiceError('CASUAL_DECK_INVALID', '当前卡组不再合法，请重新选择卡组');
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new CasualTableServiceError(
      'CASUAL_INVALID_REQUEST',
      '房间操作参数无效，请刷新后重试',
      400
    );
  return result.data;
}

// Casual admission is independent from ranked/theme ticket queues.
export const casualTableService = new CasualTableService({
  loadRoomLifecycleTimeoutConfig: () => battleTimeoutConfigService.getRoomLifecycleTimeoutConfig(),
});

function lobbyKey(row: CasualRoomSummary): [number, number, string] {
  return [
    { WAITING: 0, RESERVED: 1, OPENING: 1, PLAYING: 2, ENDED: 3 }[row.status],
    row.since,
    row.tableId,
  ];
}
function compareLobbyKeys(a: [number, number, string], b: [number, number, string]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
}
