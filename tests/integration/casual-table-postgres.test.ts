import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSurrenderCommand } from '../../src/application/game-commands';
import { markGameEnded } from '../../src/domain/entities/game';
import type { DeckConfig } from '../../src/application/game-service';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { toDeckPointTableRules } from '../../src/domain/rules/deck-point-table';
import { getBaseCardCode } from '../../src/shared/utils/card-code';
import { CardType, GameEndReason, HeartColor } from '../../src/shared/types/enums';
import type {
  CasualTableEntryInput,
  CasualTableOwnView,
} from '../../src/online/casual-table-types';
import { CasualTableService } from '../../src/server/services/casual-table-service';
import { GameplayParticipationService } from '../../src/server/services/gameplay-participation-service';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import {
  OnlineRoomService,
  type OwnedDeckSummary,
} from '../../src/server/services/online-room-service';

const databaseUrl = process.env.CASUAL_TABLE_TEST_DATABASE_URL;
const users = Array.from({ length: 5 }, () => randomUUID());
const decks = users.map(() => randomUUID());
const rules = toDeckPointTableRules({
  version: 'test',
  pointLimit: 9,
  effectiveFrom: '2026-01-01T00:00:00Z',
  entries: [],
});
const schema = `casual_test_${randomUUID().replaceAll('-', '')}`;
let database: pg.Pool;
let admin: pg.Client;
let now = 1_800_000_000_000;
let service: CasualTableService;
let runtime: OnlineRoomService;
let matches: OnlineMatchService;
let runtimeRules = rules;
let loadDeck: ReturnType<
  typeof vi.fn<(userId: string, deckId: string) => Promise<OwnedDeckSummary>>
>;

let loadProfile: ReturnType<
  typeof vi.fn<(userId: string) => Promise<{ userId: string; displayName: string }>>
>;

function deck(prefix: string): DeckConfig {
  return {
    mainDeck: [
      ...Array.from({ length: 48 }, (_, index) => ({
        cardCode: `${prefix}-MEM-${index}`,
        name: '成员',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 1,
        hearts: [createHeartIcon(HeartColor.PINK, 1)],
      })),
      ...Array.from({ length: 12 }, (_, index) => ({
        cardCode: `${prefix}-LIVE-${index}`,
        name: '演唱会',
        cardType: CardType.LIVE as const,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
      })),
    ],
    energyDeck: Array.from({ length: 12 }, (_, index) => ({
      cardCode: `${prefix}-ENE-${index}`,
      name: '能量',
      cardType: CardType.ENERGY as const,
    })),
  };
}
function entry(index: number): CasualTableEntryInput {
  return { requestId: randomUUID(), deckId: decks[index], spectatorEnabled: index === 0 };
}
async function create(index: number, discoverability: 'PUBLIC' | 'UNLISTED' = 'PUBLIC') {
  return service.create(users[index], { ...entry(index), discoverability, note: '' });
}
async function current(index: number) {
  return (await service.getCurrent(users[index])).table!;
}
async function pair() {
  const waiting = await create(0);
  const paired = await service.findOpponent(users[1], entry(1));
  expect(paired.tableId).toBe(waiting.tableId);
  return paired;
}
async function confirmPair(paired: CasualTableOwnView) {
  await service.confirm(users[0], paired);
  return service.confirm(users[1], paired);
}
function newService(overrides: Partial<ConstructorParameters<typeof CasualTableService>[0]> = {}) {
  return new CasualTableService({
    database,
    runtime,
    now: () => now,
    loadDeck,
    getPointTable: () => Promise.resolve(rules),
    assertGameplayAvailable: async () => {},
    getGameplayRestriction: () => Promise.resolve(null),
    ...overrides,
  });
}

// Explicit opt-in, local addresses only, random isolated schema. Never use application tables.
describe.skipIf(!databaseUrl)('CasualTableService PostgreSQL admission', () => {
  beforeAll(async () => {
    expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(databaseUrl!).hostname);
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    database = new pg.Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
      max: 10,
    });
    await database.query(`
      CREATE FUNCTION ${schema}.gen_random_uuid() RETURNS uuid LANGUAGE sql AS 'SELECT md5(random()::text)::uuid';
      CREATE TABLE profiles (id uuid PRIMARY KEY, username text NOT NULL, display_name text);
      CREATE TABLE decks (id uuid PRIMARY KEY);
      CREATE TABLE public_table_tickets (id uuid PRIMARY KEY, queue_kind text);
      CREATE TABLE gameplay_participations (user_id uuid PRIMARY KEY REFERENCES profiles(id), kind text NOT NULL,
        ticket_id uuid REFERENCES public_table_tickets(id), room_generation text, match_id text, updated_at timestamptz DEFAULT now(),
        CONSTRAINT gameplay_participations_kind_check CHECK(kind IN ('PUBLIC_QUEUE', 'RANKED_QUEUE', 'THEME_QUEUE', 'ONLINE_ROOM', 'ONLINE_MATCH')));
    `);
    const migration = await readFile(
      new URL('../../drizzle/0042_add_casual_tables.sql', import.meta.url),
      'utf8'
    );
    await database.query(migration.replaceAll('"public".', `"${schema}".`));
  });
  afterAll(async () => {
    await database?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    now = 1_800_000_000_000;
    runtimeRules = rules;
    await database.query(
      'TRUNCATE gameplay_participations, casual_table_seats, casual_tables, profiles, decks, public_table_tickets CASCADE'
    );
    for (let i = 0; i < users.length; i += 1) {
      await database.query('INSERT INTO profiles VALUES ($1, $2, $2)', [users[i], `玩家${i}`]);
      await database.query('INSERT INTO decks VALUES ($1)', [decks[i]]);
    }
    loadDeck = vi.fn((userId, deckId) =>
      Promise.resolve({
        deckId,
        deckName: `私有卡组-${userId}`,
        runtimeDeck: deck(userId),
        pointTable: rules,
        pointValidation: { pointTableVersion: rules.version, pointTotal: 0, pointLimit: 9 },
      })
    );
    matches = new OnlineMatchService({ now: () => now, recorder: null });
    loadProfile = vi.fn((userId) =>
      Promise.resolve({ userId, displayName: `玩家${users.indexOf(userId)}` })
    );
    runtime = new OnlineRoomService({
      now: () => now,
      matchService: matches,
      loadUserProfile: loadProfile,
      getCurrentPointTableRules: () => Promise.resolve(runtimeRules),
      participationService: new GameplayParticipationService(database),
    });
    service = newService();
  });

  it('pairs simultaneous find requests into one stable room and cannot start before both confirm', async () => {
    const results = await Promise.all([
      service.findOpponent(users[0], entry(0)),
      service.findOpponent(users[1], entry(1)),
    ]);
    expect(results[0].roomCode).toBe(results[1].roomCode);
    const paired = await current(0);
    expect(paired.state).toBe('RESERVED');
    await expect(runtime.getRoomView(paired.roomCode, users[0])).rejects.toMatchObject({
      code: 'ONLINE_ROOM_NOT_FOUND',
    });
    const confirmed = await service.confirm(users[0], paired);
    expect(confirmed.state).toBe('RESERVED');
    expect(
      (
        await database.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM gameplay_participations'
        )
      ).rows[0].count
    ).toBe(2);
    const bound = await service.confirm(users[1], paired);
    expect(bound.state).toBe('BOUND');
    expect(bound.roomCode).toBe(paired.roomCode);
    expect((await runtime.getRoomView(bound.roomCode, users[0])).status).toBe('OPENING');
  });

  it('shares manually created public supply with find, but never automatically joins an unlisted room', async () => {
    const privateRoom = await create(0, 'UNLISTED');
    const publicRoom = await create(1);
    const found = await service.findOpponent(users[2], entry(2));
    expect(found.tableId).toBe(publicRoom.tableId);
    expect((await current(0)).state).toBe('WAITING');
    const directed = await service.join(users[3], privateRoom, entry(3));
    expect(directed.discoverability).toBe('UNLISTED');
    expect(directed.members).toHaveLength(2);
  });

  it('admits exactly one contender, leaving the loser without a participation', async () => {
    const waiting = await create(0);
    const results = await Promise.allSettled([
      service.join(users[1], waiting, entry(1)),
      service.join(users[2], waiting, entry(2)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const loser = results[0].status === 'rejected' ? 1 : 2;
    expect((await service.getCurrent(users[loser])).table).toBeNull();
    expect(
      (
        await database.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM casual_table_seats'
        )
      ).rows[0].count
    ).toBe(2);
  });

  it('makes create, join and confirm retries idempotent', async () => {
    const input = { ...entry(0), discoverability: 'PUBLIC' as const, note: '' };
    const waiting = await service.create(users[0], input);
    expect((await service.create(users[0], input)).tableId).toBe(waiting.tableId);
    const guest = entry(1);
    const paired = await service.join(users[1], waiting, guest);
    loadDeck.mockRejectedValueOnce(new Error('source deck no longer exists'));
    expect((await service.join(users[1], waiting, guest)).roundId).toBe(paired.roundId);
    expect(loadDeck).toHaveBeenCalledTimes(2);
    await service.confirm(users[0], paired);
    await service.confirm(users[0], paired);
    await confirmPair(paired);
    expect(
      (await database.query<{ count: number }>('SELECT count(*)::int AS count FROM casual_tables'))
        .rows[0].count
    ).toBe(1);
  });

  it('preserves the original waiting order after a direct guest cancels and rejects previous-round confirmation', async () => {
    const waiting = await create(0);
    now += 10_000;
    const paired = await service.join(users[1], waiting, entry(1));
    await service.cancel(users[1], paired);
    const recovered = await current(0);
    expect(recovered.state).toBe('WAITING');
    expect(recovered.waitingSince).toBe(waiting.waitingSince);
    expect(recovered.roundId).not.toBe(paired.roundId);
    expect((await service.getCurrent(users[1])).table).toBeNull();
    const next = await service.join(users[2], recovered, entry(2));
    await expect(service.confirm(users[0], paired)).rejects.toMatchObject({
      code: 'CASUAL_STATE_CHANGED',
    });
    expect((await current(0)).members.every((member) => !member.confirmed)).toBe(true);
    expect(next.roundId).toBe(recovered.roundId);
  });

  it('only requeues a confirmed, online player with explicit public intent after timeout', async () => {
    const paired = await pair();
    await service.confirm(users[0], paired);
    now += 40_000;
    await service.heartbeat(users[0], paired);
    now += 21_000;
    await service.cleanupExpiredState();
    const recovered = await current(0);
    expect(recovered.state).toBe('WAITING');
    expect(recovered.waitingSince).toBe(paired.waitingSince);
    expect((await service.getCurrent(users[1])).table).toBeNull();
  });

  it('never converts a direct guest into public supply when the host cancels', async () => {
    const waiting = await create(0);
    const paired = await service.join(users[1], waiting, entry(1));
    await service.cancel(users[0], paired);
    expect((await service.getCurrent(users[1])).table).toBeNull();
    expect(
      (await database.query("SELECT id FROM casual_tables WHERE state = 'WAITING'")).rows
    ).toEqual([]);
  });

  it('requeues an automatic guest with the original intent time when the host cancels', async () => {
    const paired = await pair();
    await service.cancel(users[0], paired);
    const recovered = await current(1);
    expect(recovered.state).toBe('WAITING');
    expect(recovered.tableId).not.toBe(paired.tableId);
    expect(recovered.discoverability).toBe('PUBLIC');
  });

  it('does not requeue either player when neither confirms', async () => {
    await pair();
    now += 61_000;
    await service.cleanupExpiredState();
    expect((await database.query('SELECT * FROM gameplay_participations')).rows).toEqual([]);
    expect(
      (
        await database.query<{ runtime_deck: unknown }>(
          'SELECT runtime_deck FROM casual_table_seats'
        )
      ).rows.every((seat) => seat.runtime_deck === null)
    ).toBe(true);
  });

  it('rejects stale heartbeats instead of reviving an offline waiting seat', async () => {
    const waiting = await create(0);
    now += 46_000;
    await expect(service.heartbeat(users[0], waiting)).rejects.toMatchObject({
      code: 'CASUAL_FORBIDDEN',
    });
    const status = await service.getCurrent(users[0]);
    expect(status.table).toBeNull();
    expect(status.notice?.reason).toBe('HEARTBEAT_EXPIRED');
  });

  it('keeps the source wait when switching fails, and atomically moves it on success', async () => {
    const from = await create(0);
    const to = await create(1);
    await service.join(users[2], to, entry(2));
    await expect(service.switchWaiting(users[0], from, to, entry(0))).rejects.toMatchObject({
      code: 'CASUAL_STATE_CHANGED',
    });
    expect((await current(0)).tableId).toBe(from.tableId);
    const other = await create(3);
    const switched = await service.switchWaiting(users[0], from, other, entry(0));
    expect(switched.tableId).toBe(other.tableId);
    expect(
      (
        await database.query<{ state: string }>('SELECT state FROM casual_tables WHERE id = $1', [
          from.tableId,
        ])
      ).rows[0].state
    ).toBe('CLOSED');
  });

  it.each(['RANKED_QUEUE', 'THEME_QUEUE', 'ONLINE_ROOM', 'ONLINE_MATCH'])(
    'shares the unique user claim with %s',
    async (kind) => {
      await database.query(
        'INSERT INTO gameplay_participations (user_id, kind, room_generation) VALUES ($1, $2, $3)',
        [users[0], kind, 'other-room']
      );
      await expect(create(0)).rejects.toMatchObject({ code: 'CASUAL_PARTICIPATION_CONFLICT' });
      expect((await service.getCurrent(users[0])).otherParticipation?.kind).toBe(kind);
      expect((await database.query('SELECT * FROM casual_tables')).rows).toEqual([]);
    }
  );

  it('freezes a transport-safe snapshot and only exposes the caller deck identity', async () => {
    const paired = await pair();
    const serialized = JSON.stringify(paired);
    expect(serialized).toContain(`私有卡组-${users[1]}`);
    expect(serialized).not.toContain(`私有卡组-${users[0]}`);
    expect(serialized).not.toContain('runtime_deck');
    expect(serialized).not.toContain('mainDeck');
    const bound = await confirmPair(paired);
    const view = await runtime.getRoomView(bound.roomCode, users[0]);
    expect(view.members.find((member) => member.userId === users[1])?.lockedDeckName).toBeNull();
    await expect(runtime.joinRoom(bound.roomCode, users[2])).rejects.toMatchObject({
      code: 'ONLINE_ROOM_FORBIDDEN',
    });
    await expect(runtime.lockDeck(bound.roomCode, users[0], decks[0])).rejects.toMatchObject({
      code: 'ONLINE_CASUAL_PREPARATION_REQUIRED',
    });
    expect(view.members.find((member) => member.userId === users[0])?.lockedDeckName).toBe(
      `私有卡组-${users[0]}`
    );
  });

  it('continues through the existing opening commands and preserves the casual association when a match starts', async () => {
    const bound = await confirmPair(await pair());
    await runtime.getRoomView(bound.roomCode, users[0]);
    await runtime.getRoomView(bound.roomCode, users[1]);
    await runtime.submitOpeningRps(bound.roomCode, users[0], 'ROCK');
    await runtime.submitOpeningRps(bound.roomCode, users[1], 'SCISSORS');
    const started = await runtime.chooseOpeningTurnOrder(bound.roomCode, users[0], 'SELF_FIRST');
    expect(started.status).toBe('IN_GAME');
    expect(started.matchId).toBeTruthy();
    const participations = await database.query(
      'SELECT kind, casual_table_id, match_id FROM gameplay_participations'
    );
    expect(participations.rows).toEqual(
      expect.arrayContaining(
        users.slice(0, 2).map(() => ({
          kind: 'ONLINE_MATCH',
          casual_table_id: bound.tableId,
          match_id: started.matchId,
        }))
      )
    );
    expect(matches.getMatch(started.matchId!)?.participants.FIRST.userId).toBe(users[0]);
  });

  it('bounds repeated bootstrap failures and releases both claims after three attempts', async () => {
    const paired = await pair();
    const prepare = vi.spyOn(runtime, 'prepareCasualTableRuntime').mockImplementation(() => {
      throw new Error('injected allocation failure');
    });
    await service.confirm(users[0], paired);
    expect((await service.confirm(users[1], paired)).state).toBe('BOOTSTRAPPING');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      now += 31_000;
      const status = await current(0);
      // Heartbeats during bootstrap keep input alive, independently of the lease.
      if (status) await service.heartbeat(users[0], status);
      const guest = await current(1);
      if (guest) await service.heartbeat(users[1], guest);
    }
    now += 31_000;
    await service.cleanupExpiredState();
    expect(prepare).toHaveBeenCalledTimes(3);
    expect((await database.query('SELECT * FROM gameplay_participations')).rows).toEqual([]);
    expect(
      (await database.query<{ failure_reason: string }>('SELECT failure_reason FROM casual_tables'))
        .rows[0].failure_reason
    ).toBe('BOOTSTRAP_ATTEMPTS_EXHAUSTED');
  });

  it('does not revive a canceled creation or reload a deleted source deck on retry', async () => {
    const input = { ...entry(0), discoverability: 'PUBLIC' as const, note: '' };
    const waiting = await service.create(users[0], input);
    loadDeck.mockRejectedValueOnce(new Error('source deck no longer exists'));
    expect((await service.create(users[0], input)).tableId).toBe(waiting.tableId);
    expect(loadDeck).toHaveBeenCalledTimes(1);
    await service.cancel(users[0], waiting);
    expect((await service.create(users[0], input)).state).toBe('CLOSED');
    expect((await database.query('SELECT * FROM gameplay_participations')).rows).toEqual([]);
  });

  it('uses one authoritative result when confirming and canceling race', async () => {
    const paired = await pair();
    await service.confirm(users[0], paired);
    const target = await current(1);
    const results = await Promise.allSettled([
      service.confirm(users[1], target),
      service.cancel(users[0], target),
    ]);
    const table = (await service.getCurrent(users[1])).table;
    if (table?.state === 'BOUND') {
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(runtime.getCasualTableRuntime(table.tableId, table.roundId)).not.toBeNull();
    } else {
      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('fulfilled');
      expect(runtime.getCasualTableRuntime(paired.tableId, paired.roundId)).toBeNull();
    }
  });

  it('fences a delayed bootstrap worker after a new lease binds the same round', async () => {
    const paired = await pair();
    await service.confirm(users[0], paired);
    let unblock!: (value: typeof rules) => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let reads = 0;
    const slow = newService({
      getPointTable: async () => {
        reads += 1;
        if (reads === 2) {
          entered();
          return new Promise<typeof rules>((resolve) => {
            unblock = resolve;
          });
        }
        return rules;
      },
    });
    const prepare = vi.spyOn(runtime, 'prepareCasualTableRuntime');
    const staleWorker = slow.confirm(users[1], paired);
    await blocked;
    now += 31_000;
    await service.cleanupExpiredState();
    const recovered = await current(0);
    expect(recovered.state).toBe('BOUND');
    unblock(rules);
    expect((await staleWorker).roomGeneration).toBe(recovered.roomGeneration);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('keeps a runtime inaccessible if binding rolls back, then reuses the allocation on retry', async () => {
    const paired = await pair();
    await service.confirm(users[0], paired);
    let fail = true;
    const failingDatabase = {
      connect: async () => {
        const client = await database.connect();
        return {
          query: async (sql: string, values?: unknown[]) => {
            if (fail && sql.includes('UPDATE casual_tables SET') && values?.[1] === 'BOUND') {
              fail = false;
              throw new Error('injected bind failure');
            }
            return client.query(sql, values);
          },
          release: () => client.release(),
        } as pg.PoolClient;
      },
    };
    const prepare = vi.spyOn(runtime, 'prepareCasualTableRuntime');
    const deferred = await newService({ database: failingDatabase }).confirm(users[1], paired);
    expect(deferred.state).toBe('BOOTSTRAPPING');
    await expect(runtime.getRoomView(paired.roomCode, users[0])).rejects.toMatchObject({
      code: 'ONLINE_ROOM_NOT_FOUND',
    });
    now += 31_000;
    await service.cleanupExpiredState();
    const recovered = await current(0);
    expect(recovered.state).toBe('BOUND');
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.results[0].value).toEqual(prepare.mock.results[1].value);
  });

  it('activates a committed binding after its COMMIT acknowledgement was lost', async () => {
    const paired = await pair();
    await service.confirm(users[0], paired);
    let fail = true;
    const ambiguousDatabase = {
      connect: async () => {
        const client = await database.connect();
        let binding = false;
        return {
          query: async (sql: string, values?: unknown[]) => {
            if (sql.includes('UPDATE casual_tables SET') && values?.[1] === 'BOUND') binding = true;
            const result = await client.query(sql, values);
            if (fail && binding && sql === 'COMMIT') {
              fail = false;
              throw new Error('injected lost commit acknowledgement');
            }
            return result;
          },
          release: () => client.release(),
        } as pg.PoolClient;
      },
    };
    const prepare = vi.spyOn(runtime, 'prepareCasualTableRuntime');
    const bound = await newService({ database: ambiguousDatabase }).confirm(users[1], paired);
    expect(bound.state).toBe('BOUND');
    const recovered = await current(0);
    expect(recovered.roomGeneration).toBe(bound.roomGeneration);
    expect((await runtime.getRoomView(bound.roomCode, users[0])).status).toBe('OPENING');
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('revalidates PT policy and stops an illegal snapshot before pairing', async () => {
    const waiting = await create(0);
    const changedRules = toDeckPointTableRules({
      version: 'new',
      pointLimit: 0,
      effectiveFrom: '2026-01-01T00:00:00Z',
      entries: [{ baseCardCode: getBaseCardCode(`${users[0]}-MEM-0`), points: 1 }],
    });
    const updated = newService({ getPointTable: () => Promise.resolve(changedRules) });
    const status = await updated.getCurrent(users[0]);
    expect(status.table).toBeNull();
    expect(status.notice?.reason).toBe('DECK_NO_LONGER_LEGAL');
    expect(
      (
        await database.query<{ runtime_deck: unknown }>(
          'SELECT runtime_deck FROM casual_table_seats WHERE table_id = $1',
          [waiting.tableId]
        )
      ).rows
    ).toEqual([{ runtime_deck: null }]);
  });

  it('ends a managed opening if PT legality changes after binding, without reopening legacy preparation', async () => {
    const bound = await confirmPair(await pair());
    await runtime.getRoomView(bound.roomCode, users[0]);
    await runtime.getRoomView(bound.roomCode, users[1]);
    await runtime.submitOpeningRps(bound.roomCode, users[0], 'ROCK');
    await runtime.submitOpeningRps(bound.roomCode, users[1], 'SCISSORS');
    runtimeRules = toDeckPointTableRules({
      version: 'changed',
      pointLimit: 0,
      effectiveFrom: '2026-01-01T00:00:00Z',
      entries: [{ baseCardCode: getBaseCardCode(`${users[0]}-MEM-0`), points: 1 }],
    });
    await expect(
      runtime.chooseOpeningTurnOrder(bound.roomCode, users[0], 'SELF_FIRST')
    ).rejects.toMatchObject({ code: 'ONLINE_DECK_POINT_TABLE_CHANGED' });
    const ended = await runtime.getRoomView(bound.roomCode, users[0]);
    expect(ended.status).toBe('ENDED');
    expect(ended.endInfo?.reason).toBe('DECK_POINT_TABLE_CHANGED');
    await expect(runtime.lockDeck(bound.roomCode, users[0], decks[0])).rejects.toMatchObject({
      code: 'ONLINE_CASUAL_PREPARATION_REQUIRED',
    });
    expect((await service.getCurrent(users[1])).notice?.reason).toBe('DECK_POINT_TABLE_CHANGED');
  });

  it('changes decks only while waiting and invalidates the previous round without losing waiting order', async () => {
    const waiting = await create(0);
    const changed = await service.changeDeck(users[0], waiting, decks[0]);
    expect(changed.roundId).not.toBe(waiting.roundId);
    expect(changed.waitingSince).toBe(waiting.waitingSince);
    await expect(service.join(users[1], waiting, entry(1))).rejects.toMatchObject({
      code: 'CASUAL_STATE_CHANGED',
    });
    const paired = await service.join(users[1], changed, entry(1));
    await expect(service.changeDeck(users[0], paired, decks[0])).rejects.toMatchObject({
      code: 'CASUAL_CANCEL_BEFORE_DECK_CHANGE',
    });
  });

  it('races legacy room admission against the same user unique key', async () => {
    const participation = new GameplayParticipationService(database);
    const results = await Promise.allSettled([
      create(0),
      participation.acquireOnlineRoom(users[0], 'legacy-room'),
    ]);
    const claims = await database.query(
      'SELECT kind FROM gameplay_participations WHERE user_id = $1',
      [users[0]]
    );
    expect(claims.rowCount).toBe(1);
    if (results[0].status === 'fulfilled')
      expect(results[1]).toMatchObject({ status: 'fulfilled', value: false });
    else expect(results[1]).toMatchObject({ status: 'fulfilled', value: true });
  });

  it('recovers persistent preparation after service recreation but closes a lost bound runtime', async () => {
    const paired = await pair();
    service = newService();
    expect((await current(0)).roundId).toBe(paired.roundId);
    const bound = await confirmPair(paired);
    runtime.clear();
    await service.cleanupExpiredState();
    service = newService();
    const status = await service.getCurrent(users[0]);
    expect((await service.getCurrent(users[1])).notice?.reason).toBe('RUNTIME_UNAVAILABLE');
    expect(status.table).toBeNull();
    expect(status.notice?.reason).toBe('RUNTIME_UNAVAILABLE');
    expect((await database.query('SELECT * FROM gameplay_participations')).rows).toEqual([]);
    expect(
      (
        await database.query<{ room_generation: string | null }>(
          'SELECT room_generation FROM casual_tables WHERE id = $1',
          [bound.tableId]
        )
      ).rows[0].room_generation
    ).toBeNull();
  });
  async function started(discoverability: 'PUBLIC' | 'UNLISTED' = 'PUBLIC') {
    const waiting = await create(0, discoverability);
    const paired = await service.join(users[1], waiting, entry(1));
    const bound = await confirmPair(paired);
    await runtime.getRoomView(bound.roomCode, users[0]);
    await runtime.getRoomView(bound.roomCode, users[1]);
    await runtime.submitOpeningRps(bound.roomCode, users[0], 'ROCK');
    await runtime.submitOpeningRps(bound.roomCode, users[1], 'SCISSORS');
    const room = await runtime.chooseOpeningTurnOrder(bound.roomCode, users[0], 'SELF_FIRST');
    expect(room.matchId).toBeTruthy();
    return { bound: await current(0), matchId: room.matchId! };
  }
  async function completed(discoverability: 'PUBLIC' | 'UNLISTED' = 'PUBLIC') {
    const game = await started(discoverability);
    const result = await matches.executeCommand(
      game.matchId,
      users[0],
      createSurrenderCommand('ignored')
    );
    expect(result?.success).toBe(true);
    return { ...game, bound: await current(0) };
  }

  it.each([GameEndReason.VICTORY_CONDITION, GameEndReason.DRAW])(
    'retains both seats after %s, then releases only the leaver and closes on final departure',
    async (reason) => {
      const { bound, matchId } = await started();
      const match = matches.getMatch(matchId)!;
      // Seed a completed rules checkpoint to test room lifecycle independently of LIVE rules.
      const ended = markGameEnded(
        match.session.state!,
        reason,
        reason === GameEndReason.DRAW ? null : match.participants.FIRST.playerId
      );
      match.session.restoreRuntimeState({
        authorityState: { ...ended, endInfo: { ...ended.endInfo!, endTimestamp: now } },
        currentPublicSeq: match.session.getCurrentPublicEventSeq(),
      });
      expect((await runtime.getRoomView(bound.roomCode, users[0])).status).toBe('IN_GAME');
      expect((await current(0)).runtime?.status).toBe('ENDED');
      expect((await current(0)).canRematch).toBe(true);
      expect((await current(1)).canRematch).toBe(true);
      const lobby = await service.list(users[2]);
      expect(lobby.counts.playing).toBe(0);
      expect(lobby.rooms).toEqual([
        expect.objectContaining({ tableId: bound.tableId, status: 'ENDED', spectatorViews: [] }),
      ]);

      await service.leave(users[0], await current(0));
      expect((await service.getCurrent(users[0])).table).toBeNull();
      const survivor = await current(1);
      expect(survivor.state).toBe('BOUND');
      expect(survivor.canContinuePublic).toBe(true);
      expect(survivor.canRematch).toBe(false);
      expect(matches.getMatch(matchId)).not.toBeNull();

      await service.leave(users[1], survivor);
      expect(matches.getMatch(matchId)).toBeNull();
      expect((await service.getCurrent(users[1])).table).toBeNull();
      expect(
        (await database.query('SELECT state FROM casual_tables WHERE id = $1', [bound.tableId]))
          .rows[0].state
      ).toBe('CLOSED');
    }
  );

  it('excludes unlisted rooms and deck identities from public counts, searches and projections', async () => {
    const hidden = await create(0, 'UNLISTED');
    const visible = await create(1);
    const lobby = await service.list(users[2]);
    expect(lobby.counts).toEqual({ waiting: 1, preparing: 0, playing: 0 });
    expect(lobby.rooms.map((row) => row.roomCode)).toEqual([visible.roomCode]);
    expect((await service.list(users[2], { search: hidden.roomCode })).rooms).toEqual([]);
    expect((await service.preview(users[2], hidden.roomCode)).roomCode).toBe(hidden.roomCode);
    const payload = JSON.stringify(lobby);
    expect(payload).not.toContain(decks[1]);
    expect(payload).not.toContain('私有卡组');
    expect(payload).not.toContain('runtime_deck');
    expect(payload).not.toContain('spectatorToken');
  });

  it('paginates more than fifty rooms without losing or duplicating rows and fences changed filters', async () => {
    for (let index = 0; index < 54; index++) {
      const userId = randomUUID();
      const deckId = randomUUID();
      await database.query('INSERT INTO profiles VALUES ($1,$2,$2)', [userId, `访客${index}`]);
      await database.query('INSERT INTO decks VALUES ($1)', [deckId]);
      await service.create(userId, {
        requestId: randomUUID(),
        deckId,
        spectatorEnabled: false,
        discoverability: 'PUBLIC',
        note: '',
      });
    }
    const first = await service.list(users[0]);
    expect(first.rooms).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await service.list(users[0], { cursor: first.nextCursor! });
    expect(second.rooms).toHaveLength(4);
    expect(new Set([...first.rooms, ...second.rooms].map((row) => row.tableId)).size).toBe(54);
    await expect(
      service.list(users[0], { cursor: first.nextCursor!, filter: 'WAITING' })
    ).rejects.toMatchObject({ code: 'CASUAL_CURSOR_EXPIRED' });
  }, 20_000);

  it('projects actual game status and rechecks revoked spectator permissions', async () => {
    const { bound, matchId } = await started();
    expect(
      (await service.list(users[2], { filter: 'PLAYING', spectatable: true })).rooms
    ).toHaveLength(1);
    expect(await runtime.getRoomSpectatorEntry(bound.roomCode, users[2], true)).toBeNull();
    const link = await service.spectate(users[2], bound, 'FIRST');
    expect(link.token).toBeTruthy();
    await service.setSpectatorPreference(users[0], bound, false);
    expect((await service.list(users[2], { spectatable: true })).rooms).toEqual([]);
    await expect(service.spectate(users[2], bound, 'FIRST')).rejects.toThrow();
    await expect(service.leave(users[0], await current(0))).rejects.toThrow();
    await matches.executeCommand(matchId, users[0], createSurrenderCommand('ignored'));
    expect((await current(0)).runtime?.status).toBe('ENDED');
    expect((await service.list(users[2])).counts.playing).toBe(0);
  });

  it('starts rematches as new fenced preparation rounds, requiring two new confirmations', async () => {
    const { bound, matchId } = await completed();
    const requested = await service.requestRematch(users[0], bound, decks[0], false);
    expect(requested.runtime?.rematch?.requesterUserId).toBe(users[0]);
    const responder = await current(1);
    const next = await service.respondRematch(
      users[1],
      responder,
      responder.runtime!.rematch!.requestId,
      decks[1],
      false
    );
    expect(next.state).toBe('RESERVED');
    expect(next.roundId).not.toBe(bound.roundId);
    expect(next.members.every((member) => !member.confirmed)).toBe(true);
    expect(matches.getMatch(matchId)).toBeNull();
    await expect(service.confirm(users[0], bound)).rejects.toMatchObject({
      code: 'CASUAL_STATE_CHANGED',
    });
    const one = await service.confirm(users[0], next);
    expect(one.state).toBe('RESERVED');
    const two = await service.confirm(users[1], next);
    expect(two.state).toBe('BOUND');
    expect(two.roomGeneration).not.toBe(bound.roomGeneration);
  });

  it('rejects legacy departure after completion and keeps both persistent claims for fenced leave', async () => {
    const { bound, matchId } = await completed();
    await expect(runtime.leaveRoom(bound.roomCode, users[0])).rejects.toMatchObject({
      code: 'ONLINE_CASUAL_PREPARATION_REQUIRED',
    });
    expect((await current(0)).canRematch).toBe(true);
    expect((await current(1)).runtime?.departedUserIds).toEqual([]);
    expect(matches.getMatch(matchId)).not.toBeNull();

    await service.leave(users[0], await current(0));
    expect((await service.getCurrent(users[0])).table).toBeNull();
    expect((await current(1)).canContinuePublic).toBe(true);
  });

  it('rejects legacy local-game abandonment before surrendering a managed match', async () => {
    const { bound, matchId } = await started();
    await expect(runtime.abandonRoomForLocalGame(bound.roomCode, users[0])).rejects.toMatchObject({
      code: 'ONLINE_CASUAL_PREPARATION_REQUIRED',
    });
    expect(matches.isMatchCompleted(matchId)).toBe(false);
    expect((await current(0)).runtime?.status).toBe('PLAYING');
    expect((await current(1)).runtime?.departedUserIds).toEqual([]);
  });

  it('rejects new room-code spectator admission after a casual match ends', async () => {
    const { bound } = await completed();
    expect(await runtime.getRoomSpectatorEntry(bound.roomCode, users[2])).toBeNull();
    await expect(
      runtime.createRoomCodeSpectatorLink(bound.roomCode, 'FIRST', users[2], bound.roomGeneration!)
    ).rejects.toMatchObject({ code: 'ONLINE_ROOM_SPECTATOR_UNAVAILABLE' });
    expect((await current(0)).runtime?.status).toBe('ENDED');
  });

  it('does not create a rematch request when the chosen deck is invalid', async () => {
    const { bound } = await completed();
    const invalid = newService({
      loadDeck: () => Promise.reject(new Error('invalid deck')),
    });
    await expect(invalid.requestRematch(users[0], bound, decks[0], false)).rejects.toThrow(
      'invalid deck'
    );
    expect((await current(1)).runtime?.rematch).toBeNull();
  });

  it('can decline and withdraw a rematch without resetting the completed round', async () => {
    const { bound } = await completed();
    await service.requestRematch(users[0], bound, decks[0], false);
    let own = await current(1);
    await service.respondRematch(users[1], own, own.runtime!.rematch!.requestId, null, null);
    own = await current(0);
    expect(own.runtime?.rematch).toBeNull();
    await service.requestRematch(users[0], own, decks[0], false);
    own = await current(0);
    await service.respondRematch(users[0], own, own.runtime!.rematch!.requestId, null, null);
    expect((await current(0)).roundId).toBe(bound.roundId);
  });

  it('keeps lobby rematch consent across temporary room-page absence', async () => {
    const { bound } = await completed();
    const requested = await service.requestRematch(users[0], bound, decks[0], false);
    now += 20_000;
    await runtime.cleanupExpiredRuntimeState();
    const responder = await current(1);
    expect(responder.runtime?.rematch?.requestId).toBe(requested.runtime?.rematch?.requestId);
    const next = await service.respondRematch(
      users[1],
      responder,
      responder.runtime!.rematch!.requestId,
      decks[1],
      false
    );
    expect(next.state).toBe('RESERVED');
  });

  it('requires explicit publication and a new room when a private survivor continues publicly', async () => {
    const { bound } = await completed('UNLISTED');
    await service.leave(users[1], await current(1));
    const survivor = await current(0);
    expect(survivor.canContinuePublic).toBe(true);
    await expect(service.continuePublic(users[0], survivor, entry(0), false)).rejects.toThrow();
    expect((await service.list(users[2])).rooms).toHaveLength(0);
    const next = await service.continuePublic(users[0], survivor, entry(0), true);
    expect(next.state).toBe('WAITING');
    expect(next.discoverability).toBe('PUBLIC');
    expect(next.tableId).not.toBe(bound.tableId);
    expect(next.roomCode).not.toBe(bound.roomCode);
    expect((await service.list(users[2])).rooms).toHaveLength(1);
  });

  it('keeps a completed room alive across lobby pages and restarts public waiting time after an opponent leaves', async () => {
    const { bound } = await completed();
    for (let index = 0; index < 5; index++) {
      now += 20_000;
      await service.heartbeat(users[0], await current(0));
      await service.heartbeat(users[1], await current(1));
      await runtime.cleanupExpiredRuntimeState();
    }
    expect((await current(0)).canRematch).toBe(true);
    await service.leave(users[1], await current(1));
    const next = await service.continuePublic(users[0], await current(0), entry(0), false);
    expect(next.tableId).toBe(bound.tableId);
    expect(next.roomCode).toBe(bound.roomCode);
    expect(next.waitingSince).toBe(now);
    expect(next.state).toBe('WAITING');
    expect((await service.getCurrent(users[1])).table).toBeNull();
  });
  it('rejects a delayed pre-binding leave instead of aborting the opening', async () => {
    const paired = await pair();
    const bound = await confirmPair(paired);
    await expect(service.leave(users[0], paired)).rejects.toMatchObject({
      code: 'CASUAL_STATE_CHANGED',
    });
    expect((await current(0)).state).toBe('BOUND');
    expect(runtime.getCasualTableRuntime(bound.tableId, bound.roundId)?.ended).toBe(false);
  });
  it('closes an abandoned opening and releases both persistent claims', async () => {
    const bound = await confirmPair(await pair());
    now += 61_000;
    await runtime.cleanupExpiredRuntimeState();
    expect((await service.getCurrent(users[0])).table).toBeNull();
    expect((await service.getCurrent(users[1])).table).toBeNull();
    expect(
      (
        await database.query<{ runtime_deck: unknown }>(
          'SELECT runtime_deck FROM casual_table_seats WHERE table_id=$1',
          [bound.tableId]
        )
      ).rows.every((row) => row.runtime_deck === null)
    ).toBe(true);
  });
  it('serializes simultaneous final departures and clears only this room', async () => {
    const { bound, matchId } = await completed();
    const other = await create(2);
    await Promise.all([service.leave(users[0], bound), service.leave(users[1], bound)]);
    expect((await service.getCurrent(users[0])).table).toBeNull();
    expect((await service.getCurrent(users[1])).table).toBeNull();
    expect((await current(2)).tableId).toBe(other.tableId);
    expect(matches.getMatch(matchId)).toBeNull();
    expect(runtime.getCasualTableRuntime(bound.tableId, bound.roundId)).toBeNull();
  });

  it('does not grant the original creator a later survivor round through an old creation key', async () => {
    const { bound } = await completed();
    const creation = (
      await database.query<{ creation_key: string }>(
        'SELECT creation_key FROM casual_tables WHERE id=$1',
        [bound.tableId]
      )
    ).rows[0];
    await service.leave(users[0], await current(0));
    const waiting = await service.continuePublic(users[1], await current(1), entry(1), false);
    await expect(
      service.create(users[0], {
        ...entry(0),
        requestId: creation.creation_key,
        discoverability: 'PUBLIC',
        note: '',
      })
    ).rejects.toMatchObject({ code: 'CASUAL_STATE_CHANGED' });
    expect((await service.getCurrent(users[0])).table).toBeNull();
    expect((await current(1)).roundId).toBe(waiting.roundId);
  });
  it('cannot accept a withdrawn or expired request, nor a request after the opponent leaves', async () => {
    const { bound } = await completed();
    const requested = await service.requestRematch(users[0], bound, decks[0], false);
    const id = requested.runtime!.rematch!.requestId;
    await service.respondRematch(users[0], requested, id, null, null);
    await expect(
      service.respondRematch(users[1], await current(1), id, decks[1], false)
    ).rejects.toMatchObject({ code: 'CASUAL_STATE_CHANGED' });
    const another = await service.requestRematch(users[0], await current(0), decks[0], false);
    now += 61_000;
    await expect(
      service.respondRematch(
        users[1],
        await current(1),
        another.runtime!.rematch!.requestId,
        decks[1],
        false
      )
    ).rejects.toMatchObject({ code: 'CASUAL_STATE_CHANGED' });
    const again = await service.requestRematch(users[0], await current(0), decks[0], false);
    await service.leave(users[0], await current(0));
    await expect(
      service.respondRematch(
        users[1],
        await current(1),
        again.runtime!.rematch!.requestId,
        decks[1],
        false
      )
    ).rejects.toThrow();
  });
  it('keeps the completed round intact when old-match sealing fails', async () => {
    const { bound, matchId } = await completed();
    await service.requestRematch(users[0], bound, decks[0], false);
    vi.spyOn(matches, 'sealCompletedMatchForRemoval').mockResolvedValueOnce(false);
    const responder = await current(1);
    await expect(
      service.respondRematch(
        users[1],
        responder,
        responder.runtime!.rematch!.requestId,
        decks[1],
        false
      )
    ).rejects.toMatchObject({ code: 'ONLINE_RESTART_SEAL_FAILED' });
    expect((await current(0)).roundId).toBe(bound.roundId);
    expect((await current(1)).runtime?.status).toBe('ENDED');
    expect(matches.getMatch(matchId)).toBeTruthy();
    expect(
      (await database.query<{ n: number }>('SELECT count(*)::int n FROM gameplay_participations'))
        .rows[0].n
    ).toBe(2);
  });
  it('retains the final participant when sealing fails, then permits a successful leave retry', async () => {
    const { bound, matchId } = await completed();
    await service.leave(users[0], bound);
    vi.spyOn(matches, 'sealCompletedMatchForRemoval').mockResolvedValueOnce(false);
    const target = await current(1);
    await expect(service.leave(users[1], target)).rejects.toMatchObject({
      code: 'ONLINE_RESTART_SEAL_FAILED',
    });
    expect((await current(1)).tableId).toBe(bound.tableId);
    expect(matches.getMatch(matchId)).toBeTruthy();
    await expect(create(1)).rejects.toMatchObject({ code: 'CASUAL_PARTICIPATION_CONFLICT' });
    await service.leave(users[1], await current(1));
    expect((await service.getCurrent(users[1])).table).toBeNull();
    expect(matches.getMatch(matchId)).toBeNull();
  });
  it('serializes accepting a rematch against an opponent departure without a half-owned new round', async () => {
    const { bound } = await completed();
    const requested = await service.requestRematch(users[0], bound, decks[0], false);
    const requestId = requested.runtime!.rematch!.requestId;
    const [responder, requester] = await Promise.all([current(1), current(0)]);
    const results = await Promise.allSettled([
      service.respondRematch(users[1], responder, requestId, decks[1], false),
      service.leave(users[0], requester),
    ]);
    const participants = (
      await database.query<{ user_id: string }>(
        'SELECT user_id FROM gameplay_participations WHERE casual_table_id=$1',
        [bound.tableId]
      )
    ).rows;
    if (results[0].status === 'fulfilled') {
      expect(results[1].status).toBe('rejected');
      expect(participants).toHaveLength(2);
      expect((await current(1)).state).toBe('RESERVED');
      expect((await current(1)).members.every((member) => !member.confirmed)).toBe(true);
    } else {
      expect(results[1].status).toBe('fulfilled');
      expect(participants.map((row) => row.user_id)).toEqual([users[1]]);
      expect((await current(1)).canRematch).toBe(false);
    }
  });
  it('rejects a future revision heartbeat without changing a valid waiting seat', async () => {
    const waiting = await create(0);
    await expect(
      service.heartbeat(users[0], { ...waiting, revision: waiting.revision + 1 })
    ).rejects.toMatchObject({ code: 'CASUAL_STATE_CHANGED' });
    expect((await current(0)).roundId).toBe(waiting.roundId);
  });

  it('does not let lobby heartbeat replace live-match presence or keep a fully abandoned game alive', async () => {
    const { bound, matchId } = await started();
    now += 20_000;
    await service.heartbeat(users[0], bound);
    await service.heartbeat(users[1], bound);
    await runtime.cleanupExpiredRuntimeState();
    now += 41_000;
    await service.heartbeat(users[0], bound);
    await runtime.cleanupExpiredRuntimeState();
    expect(matches.getMatch(matchId)).toBeNull();
    expect((await service.getCurrent(users[0])).table).toBeNull();
    expect((await service.getCurrent(users[1])).table).toBeNull();
  });
  function failingTransition(state: string, point: 'WRITE' | 'COMMIT' | 'ACK') {
    let fail = true;
    return {
      connect: async () => {
        const client = await database.connect();
        let changed = false;
        return {
          query: async (sql: string, values?: unknown[]) => {
            if (
              (sql.includes('UPDATE casual_tables SET') && values?.[1] === state) ||
              (state === 'DEPARTURE' &&
                sql.includes('DELETE FROM gameplay_participations WHERE casual_table_id') &&
                sql.includes('AND user_id = $2'))
            ) {
              changed = true;
              if (fail && point === 'WRITE') {
                fail = false;
                throw new Error('injected transition write failure');
              }
            }
            if (fail && changed && sql === 'COMMIT' && point === 'COMMIT') {
              fail = false;
              throw new Error('injected transition commit failure');
            }
            const result = await client.query(sql, values);
            if (fail && changed && sql === 'COMMIT' && point === 'ACK') {
              fail = false;
              throw new Error('injected transition acknowledgement loss');
            }
            return result;
          },
          release: () => client.release(),
        } as pg.PoolClient;
      },
    };
  }
  it.each(['WRITE', 'COMMIT'] as const)(
    'retains the sealed old runtime when rematch %s fails and supports a retry',
    async (point) => {
      const { bound, matchId } = await completed();
      const request = await service.requestRematch(users[0], bound, decks[0], false);
      const responder = await current(1);
      await expect(
        newService({ database: failingTransition('RESERVED', point) }).respondRematch(
          users[1],
          responder,
          request.runtime!.rematch!.requestId,
          decks[1],
          false
        )
      ).rejects.toThrow('injected transition');
      expect((await current(0)).roundId).toBe(bound.roundId);
      expect(matches.getMatch(matchId)).toBeTruthy();
      const next = await service.respondRematch(
        users[1],
        await current(1),
        request.runtime!.rematch!.requestId,
        decks[1],
        false
      );
      expect(next.state).toBe('RESERVED');
    }
  );
  it('recovers retirement after a rematch COMMIT response is lost, before binding the next round', async () => {
    const { bound, matchId } = await completed();
    const request = await service.requestRematch(users[0], bound, decks[0], false);
    await expect(
      newService({ database: failingTransition('RESERVED', 'ACK') }).respondRematch(
        users[1],
        await current(1),
        request.runtime!.rematch!.requestId,
        decks[1],
        false
      )
    ).rejects.toThrow('acknowledgement');
    const row = (
      await database.query<{ id: string; round_id: string; revision: number; state: string }>(
        'SELECT id,round_id,revision,state FROM casual_tables WHERE id=$1',
        [bound.tableId]
      )
    ).rows[0];
    expect(row.state).toBe('RESERVED');
    expect(matches.getMatch(matchId)).toBeTruthy();
    const target = { tableId: row.id, roundId: row.round_id, revision: row.revision };
    await service.confirm(users[0], target);
    expect(matches.getMatch(matchId)).toBeNull();
    expect((await service.confirm(users[1], target)).state).toBe('BOUND');
  });
  it.each(['PUBLIC', 'UNLISTED'] as const)(
    'retains a %s survivor room if public continuation fails to commit',
    async (visibility) => {
      const { bound, matchId } = await completed(visibility);
      await service.leave(users[1], await current(1));
      await expect(
        newService({
          database: failingTransition(visibility === 'PUBLIC' ? 'WAITING' : 'CLOSED', 'COMMIT'),
        }).continuePublic(users[0], await current(0), entry(0), true)
      ).rejects.toThrow('injected transition');
      expect((await current(0)).roundId).toBe(bound.roundId);
      expect(matches.getMatch(matchId)).toBeTruthy();
      const next = await service.continuePublic(users[0], await current(0), entry(0), true);
      expect(next.state).toBe('WAITING');
      expect(matches.getMatch(matchId)).toBeNull();
    }
  );
  it('retains an opening runtime on a failed leave commit', async () => {
    const bound = await confirmPair(await pair());
    await expect(
      newService({ database: failingTransition('CLOSED', 'COMMIT') }).leave(users[0], bound)
    ).rejects.toThrow('injected transition');
    await expect(runtime.getRoomView(bound.roomCode, users[0])).rejects.toMatchObject({
      code: 'ONLINE_CASUAL_TRANSITION_PENDING',
    });
    expect((await current(0)).state).toBe('BOUND');
    expect(runtime.getCasualTableRuntime(bound.tableId, bound.roundId)).toBeTruthy();
    expect((await runtime.getRoomView(bound.roomCode, users[0])).status).toBe('OPENING');
    await service.leave(users[0], bound);
    expect((await service.getCurrent(users[1])).table).toBeNull();
    expect(runtime.getCasualTableRuntime(bound.tableId, bound.roundId)).toBeNull();
  });
  it('retries post-commit runtime removal before next-round confirmation without losing persisted preparation', async () => {
    const { bound, matchId } = await completed();
    const request = await service.requestRematch(users[0], bound, decks[0], false);
    vi.spyOn(matches, 'deleteMatch').mockResolvedValueOnce(false);
    const next = await service.respondRematch(
      users[1],
      await current(1),
      request.runtime!.rematch!.requestId,
      decks[1],
      false
    );
    expect(next.state).toBe('RESERVED');
    expect(matches.getMatch(matchId)).toBeTruthy();
    await service.confirm(users[0], next);
    expect(matches.getMatch(matchId)).toBeNull();
    expect((await service.confirm(users[1], next)).state).toBe('BOUND');
  });
  it('applies both players explicit rematch spectator choices to the next runtime', async () => {
    const { bound } = await completed();
    const request = await service.requestRematch(users[0], bound, decks[0], false);
    const next = await service.respondRematch(
      users[1],
      await current(1),
      request.runtime!.rematch!.requestId,
      decks[1],
      true
    );
    expect(next.spectatorEnabled).toBe(true);
    expect((await current(0)).spectatorEnabled).toBe(false);
    const opening = await confirmPair(next);
    await runtime.getRoomView(opening.roomCode, users[0]);
    await runtime.getRoomView(opening.roomCode, users[1]);
    await runtime.submitOpeningRps(opening.roomCode, users[0], 'ROCK');
    await runtime.submitOpeningRps(opening.roomCode, users[1], 'SCISSORS');
    await runtime.chooseOpeningTurnOrder(opening.roomCode, users[0], 'SELF_FIRST');
    expect((await current(0)).runtime?.spectatorViews).toEqual([
      { seat: 'SECOND', displayName: '玩家1' },
    ]);
  });
  it('fences old opening commands after a committed leave loses its response and then reaps that generation', async () => {
    const bound = await confirmPair(await pair());
    await expect(
      newService({ database: failingTransition('CLOSED', 'ACK') }).leave(users[0], bound)
    ).rejects.toThrow('acknowledgement');
    await expect(runtime.submitOpeningRps(bound.roomCode, users[0], 'ROCK')).rejects.toMatchObject({
      code: 'ONLINE_CASUAL_TRANSITION_PENDING',
    });
    expect((await service.getCurrent(users[0])).table).toBeNull();
    expect(runtime.getCasualTableRuntime(bound.tableId, bound.roundId)).toBeNull();
    expect((await service.getCurrent(users[1])).table).toBeNull();
  });
  it.each(['PUBLIC', 'UNLISTED'] as const)(
    'recovers a committed %s continuation despite a lost response',
    async (visibility) => {
      const { bound, matchId } = await completed(visibility);
      await service.leave(users[1], await current(1));
      await expect(
        newService({
          database: failingTransition(visibility === 'PUBLIC' ? 'WAITING' : 'CLOSED', 'ACK'),
        }).continuePublic(users[0], await current(0), entry(0), true)
      ).rejects.toThrow('acknowledgement');
      expect(matches.getMatch(matchId)).toBeTruthy();
      const next = await current(0);
      expect(next.state).toBe('WAITING');
      expect(next.discoverability).toBe('PUBLIC');
      expect(next.tableId === bound.tableId).toBe(visibility === 'PUBLIC');
      expect(matches.getMatch(matchId)).toBeNull();
      expect(runtime.getCasualTableRuntime(bound.tableId, bound.roundId)).toBeNull();
    }
  );
  it.each(['WRITE', 'COMMIT'] as const)(
    'preserves both members and their rematch if a completed departure %s rolls back',
    async (point) => {
      const { bound } = await completed();
      const request = await service.requestRematch(users[0], bound, decks[0], false);
      await expect(
        newService({ database: failingTransition('DEPARTURE', point) }).leave(users[0], bound)
      ).rejects.toThrow('injected transition');
      const own = await current(0);
      expect(own.canRematch).toBe(true);
      expect(own.runtime?.departedUserIds).toEqual([]);
      expect(own.runtime?.rematch?.requestId).toBe(request.runtime!.rematch!.requestId);
      const next = await service.respondRematch(
        users[1],
        await current(1),
        request.runtime!.rematch!.requestId,
        decks[1],
        false
      );
      expect(next.state).toBe('RESERVED');
    }
  );
  it('reconciles a committed departure after response loss and prevents a stale tab from reentering', async () => {
    const { bound } = await completed();
    await service.requestRematch(users[0], bound, decks[0], false);
    await expect(
      newService({ database: failingTransition('DEPARTURE', 'ACK') }).leave(users[0], bound)
    ).rejects.toThrow('acknowledgement');
    const survivor = await current(1);
    expect(survivor.runtime?.departedUserIds).toEqual([users[0]]);
    expect(survivor.runtime?.rematch).toBeNull();
    expect(survivor.canRematch).toBe(false);
    expect(survivor.canContinuePublic).toBe(true);
    await expect(runtime.getRoomView(bound.roomCode, users[0])).rejects.toMatchObject({
      code: 'ONLINE_CASUAL_ROOM_LEFT',
    });
    expect((await service.getCurrent(users[0])).table).toBeNull();
    expect((await service.continuePublic(users[1], survivor, entry(1), false)).state).toBe(
      'WAITING'
    );
  });
  it('does not let an in-flight room read reactivate a member after their departure commits', async () => {
    const { bound } = await completed();
    let release!: (profile: { userId: string; displayName: string }) => void;
    loadProfile.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const reading = runtime.getRoomView(bound.roomCode, users[0]);
    await service.leave(users[0], bound);
    release({ userId: users[0], displayName: '玩家0' });
    await expect(reading).rejects.toMatchObject({ code: 'ONLINE_CASUAL_ROOM_LEFT' });
    expect((await current(1)).runtime?.departedUserIds).toEqual([users[0]]);
    expect((await service.getCurrent(users[0])).table).toBeNull();
  });
});
