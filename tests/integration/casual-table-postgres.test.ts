import { sealedCards, seededRandom } from '../helpers/sealed-cards';
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
  CasualRuleMode,
  CasualTableEntryInput,
  CasualTableOwnView,
} from '../../src/online/casual-table-types';
import { CasualTableService } from '../../src/server/services/casual-table-service';
import { CASUAL_ENVIRONMENT_ID } from '../../src/server/services/casual-table-repository';
import { DEFAULT_ROOM_LIFECYCLE_TIMEOUT_CONFIG } from '../../src/online/room-lifecycle-policy';
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
function entry(index: number, ruleMode: CasualRuleMode = 'NORMAL'): CasualTableEntryInput {
  return {
    format: 'CONSTRUCTED',
    ruleMode,
    requestId: randomUUID(),
    deckId: decks[index],
    spectatorEnabled: index === 0,
  };
}
async function create(
  index: number,
  discoverability: 'PUBLIC' | 'UNLISTED' = 'PUBLIC',
  ruleMode: CasualRuleMode = 'NORMAL'
) {
  return service.create(users[index], { ...entry(index, ruleMode), discoverability, note: '' });
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
    loadSealedCards: async () => sealedCards(),
    randomInt: seededRandom(42),
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
    await database.query(
      "ALTER TABLE casual_tables ADD CONSTRAINT casual_tables_environment_check CHECK(environment_id IN ('CASUAL_TABLE_V1', 'CASUAL_UNLIMITED_PT_V1'))"
    );
    await database.query(
      await readFile(new URL('../../drizzle/0045_add_bp7_sealed.sql', import.meta.url), 'utf8')
    );
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

  it.each([
    ['PUBLIC', 'NORMAL'],
    ['UNLISTED', 'UNLIMITED'],
  ] as const)(
    'creates a %s %s room with a custom code, recovers retries and releases the code on closure',
    async (discoverability, ruleMode) => {
      const input = { ...entry(0, ruleMode), discoverability, note: '', roomCode: '  friends42  ' };
      const waiting = await service.create(users[0], input);
      expect(waiting.roomCode).toBe('FRIENDS42');
      expect((await service.preview(users[1], 'friends42')).tableId).toBe(waiting.tableId);
      expect((await service.create(users[0], input)).tableId).toBe(waiting.tableId);
      await service.cancel(users[0], waiting);
      const reused = await service.create(users[1], { ...input, ...entry(1, ruleMode) });
      expect(reused.roomCode).toBe('FRIENDS42');
      expect(reused.tableId).not.toBe(waiting.tableId);
    }
  );

  it('awards a contested custom code to exactly one creator across both modes', async () => {
    const results = await Promise.allSettled([
      service.create(users[0], {
        ...entry(0),
        discoverability: 'PUBLIC',
        note: '',
        roomCode: 'friends42',
      }),
      service.create(users[1], {
        ...entry(1, 'UNLIMITED'),
        discoverability: 'PUBLIC',
        note: '',
        roomCode: 'FRIENDS42',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'CASUAL_ROOM_CODE_TAKEN', statusCode: 409 });
    const loser = results[0].status === 'rejected' ? 0 : 1;
    expect((await service.getCurrent(users[loser])).table).toBeNull();
    expect((await database.query('SELECT * FROM casual_tables')).rowCount).toBe(1);
    expect((await database.query('SELECT * FROM gameplay_participations')).rowCount).toBe(1);
  });

  it('rejects a custom code already held by another runtime before reserving a seat', async () => {
    await runtime.createRoom('FRIENDS42', users[4]);
    await expect(
      service.create(users[0], {
        ...entry(0),
        discoverability: 'PUBLIC',
        note: '',
        roomCode: 'FRIENDS42',
      })
    ).rejects.toMatchObject({ code: 'CASUAL_ROOM_CODE_TAKEN' });
    expect((await service.getCurrent(users[0])).table).toBeNull();
    expect((await database.query('SELECT * FROM casual_tables')).rowCount).toBe(0);
  });

  it.each(['', '   '])(
    'automatically allocates a room code for blank input %j',
    async (roomCode) => {
      const waiting = await service.create(users[0], {
        ...entry(0),
        discoverability: 'PUBLIC',
        note: '',
        roomCode,
      });
      expect(waiting.roomCode).toMatch(/^[A-Z0-9]{6}$/);
    }
  );

  it.each(['abc', 'abcdefghijklm', 'ab-cd', '房间号', 'ab cd'])(
    'rejects invalid custom code %j before allocating authority',
    async (roomCode) => {
      await expect(
        service.create(users[0], { ...entry(0), discoverability: 'PUBLIC', note: '', roomCode })
      ).rejects.toMatchObject({ code: 'CASUAL_INVALID_ROOM_CODE', statusCode: 400 });
      expect(loadDeck).not.toHaveBeenCalled();
      expect((await database.query('SELECT * FROM casual_tables')).rowCount).toBe(0);
    }
  );

  it('isolates public listings, counts and automatic matching by rule, while code lookup stays direct', async () => {
    const normal = await create(0);
    const unlimited = await create(1, 'PUBLIC', 'UNLIMITED');
    const hidden = await create(2, 'UNLISTED', 'UNLIMITED');
    expect((await service.list(users[4])).rooms.map((room) => room.tableId)).toEqual([
      normal.tableId,
    ]);
    const list = await service.list(users[4], { ruleMode: 'UNLIMITED' });
    expect(list.rooms.map((room) => room.tableId)).toEqual([unlimited.tableId]);
    expect(list.counts).toEqual({ waiting: 1, preparing: 0, playing: 0 });
    expect(JSON.stringify(list)).not.toContain('私有卡组');
    expect(JSON.stringify(list)).not.toContain('pointTotal');
    expect((await service.preview(users[4], hidden.roomCode)).ruleMode).toBe('UNLIMITED');
    const found = await service.findOpponent(users[3], entry(3, 'UNLIMITED'));
    expect(found.tableId).toBe(unlimited.tableId);
    expect((await current(0)).state).toBe('WAITING');
    await expect(service.findOpponent(users[3], entry(3))).rejects.toMatchObject({
      code: 'CASUAL_RULE_MODE_MISMATCH',
    });
  });

  it('requires explicit target rules on direct join without altering either room or user occupancy', async () => {
    const room = await create(0, 'PUBLIC', 'UNLIMITED');
    await expect(service.join(users[1], room, entry(1))).rejects.toMatchObject({
      code: 'CASUAL_RULE_MODE_MISMATCH',
    });
    expect((await service.getCurrent(users[1])).table).toBeNull();
    expect((await current(0)).state).toBe('WAITING');
    expect((await service.join(users[1], room, entry(1, 'UNLIMITED'))).ruleMode).toBe('UNLIMITED');
  });

  it('refreshes the owners actual point summary after a PT rollover without closing entertainment waiting', async () => {
    const waiting = await create(0, 'PUBLIC', 'UNLIMITED');
    const changedRules = toDeckPointTableRules({
      version: 'rollover',
      pointLimit: 9,
      effectiveFrom: '2026-01-01T00:00:00Z',
      entries: [{ baseCardCode: getBaseCardCode(`${users[0]}-MEM-0`), points: 20 }],
    });
    const updated = newService({ getPointTable: () => Promise.resolve(changedRules) });
    const latest = (await updated.getCurrent(users[0])).table!;
    expect(latest.tableId).toBe(waiting.tableId);
    expect(latest.state).toBe('WAITING');
    // The synthetic runtime members share one base identifier.
    expect(latest.ownDeck?.pointTotal).toBe(48 * 20);
  });

  it('admits over-PT decks only in entertainment, including waiting deck changes and confirmation', async () => {
    const high = toDeckPointTableRules({
      version: 'high',
      pointLimit: 9,
      effectiveFrom: '2026-01-01T00:00:00Z',
      entries: [{ baseCardCode: getBaseCardCode(`${users[0]}-MEM-0`), points: 20 }],
    });
    service = newService({ getPointTable: () => Promise.resolve(high) });
    await expect(create(0)).rejects.toMatchObject({ code: 'CASUAL_DECK_INVALID' });
    const room = await create(0, 'PUBLIC', 'UNLIMITED');
    expect(room.ownDeck?.pointTotal).toBeGreaterThan(9);
    const changed = await service.changeDeck(users[0], room, decks[0]);
    const paired = await service.join(users[1], changed, entry(1, 'UNLIMITED'));
    expect((await confirmPair(paired)).ruleMode).toBe('UNLIMITED');
    expect(loadDeck).toHaveBeenCalledWith(users[0], decks[0], 'UNLIMITED');
  });

  it('preserves entertainment through a PT rollover at final opening and a rematch with ordinary decks', async () => {
    const { bound, matchId } = await completed('PUBLIC', 'UNLIMITED');
    expect(matches.getMatch(matchId)?.casualRuleMode).toBe('UNLIMITED');
    const requested = await service.requestRematch(users[0], bound, decks[0], false);
    const responder = await current(1);
    const next = await service.respondRematch(
      users[1],
      responder,
      requested.runtime!.rematch!.requestId,
      decks[1],
      false
    );
    expect(next.ruleMode).toBe('UNLIMITED');
    expect(next.tableId).toBe(bound.tableId);
    expect(next.roundId).not.toBe(bound.roundId);
    const newBound = await confirmPair(next);
    await runtime.getRoomView(newBound.roomCode, users[0]);
    await runtime.getRoomView(newBound.roomCode, users[1]);
    await runtime.submitOpeningRps(newBound.roomCode, users[0], 'ROCK');
    await runtime.submitOpeningRps(newBound.roomCode, users[1], 'SCISSORS');
    runtimeRules = toDeckPointTableRules({
      version: 'rollover',
      pointLimit: 9,
      effectiveFrom: '2026-01-01T00:00:00Z',
      entries: [{ baseCardCode: getBaseCardCode(`${users[0]}-MEM-0`), points: 20 }],
    });
    const opened = await runtime.chooseOpeningTurnOrder(newBound.roomCode, users[0], 'SELF_FIRST');
    expect(opened.matchId).toBeTruthy();
    expect(opened.casualTable?.ruleMode).toBe('UNLIMITED');
    expect(matches.getMatch(opened.matchId!)?.casualRuleMode).toBe('UNLIMITED');
    expect((await matches.getMatchSnapshot(opened.matchId!, users[0]))?.casualRuleMode).toBe(
      'UNLIMITED'
    );
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

  it.each(['create', 'find', 'join'] as const)(
    'recovers a committed %s without reloading the deck during restrictions, but rejects new admission',
    async (kind) => {
      let restricted = false;
      const configured = newService({
        assertGameplayAvailable: undefined,
        getGameplayRestriction: async () => (restricted ? { title: '维护', summary: null } : null),
      });
      const waiting = kind === 'join' ? await create(0) : null;
      const input = entry(1);
      const enter = (userId: string, data: CasualTableEntryInput) =>
        kind === 'create'
          ? configured.create(userId, { ...data, discoverability: 'PUBLIC', note: '' })
          : kind === 'find'
            ? configured.findOpponent(userId, data)
            : configured.join(userId, waiting!, data);
      const committed = await enter(users[1], input);
      const deckLoads = loadDeck.mock.calls.length;
      restricted = true;
      loadDeck.mockRejectedValue(new Error('source deck was deleted'));
      const recovered = await enter(users[1], input);
      expect(recovered).toMatchObject({
        tableId: committed.tableId,
        roundId: committed.roundId,
        ownDeck: committed.ownDeck,
      });
      await expect(enter(users[2], entry(2))).rejects.toMatchObject({
        code: 'CASUAL_UNAVAILABLE',
        statusCode: 503,
      });
      expect(loadDeck).toHaveBeenCalledTimes(deckLoads);
      expect(
        (await database.query('SELECT count(*)::int AS count FROM casual_tables')).rows[0].count
      ).toBe(1);
      expect(
        (
          await database.query('SELECT * FROM gameplay_participations WHERE user_id = $1', [
            users[2],
          ])
        ).rowCount
      ).toBe(0);
    }
  );

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
  it('applies the platform-configured heartbeat grace and confirmation deadline', async () => {
    const configured = newService({
      loadRoomLifecycleTimeoutConfig: () =>
        Promise.resolve({
          roomDestroyAfterAllAbsentSeconds: 60,
          casualHeartbeatGraceSeconds: 90,
          casualConfirmationTtlSeconds: 30,
        }),
    });
    const waiting = await configured.create(users[0], {
      ...entry(0),
      discoverability: 'PUBLIC',
      note: '',
    });

    // 心跳停止 60 秒：默认 45 秒宽限会让席位失效并拒绝入座，配置的 90 秒仍允许配对。
    now += 60_000;
    const paired = await configured.join(users[1], waiting, entry(1));
    expect(paired.state).toBe('RESERVED');
    const reserved = (
      await database.query<{ confirmation_expires_at: Date | null }>(
        'SELECT confirmation_expires_at FROM casual_tables WHERE id = $1',
        [paired.tableId]
      )
    ).rows[0];
    // 确认期限按配置的 30 秒计算，而不是默认的 60 秒。
    expect(reserved.confirmation_expires_at?.getTime()).toBe(now + 30_000);

    // 超过配置期限 1 秒：按无过错超时回收本轮配对。
    now += 31_000;
    await configured.cleanupExpiredState();
    const closed = (
      await database.query<{ state: string; failure_reason: string }>(
        'SELECT state, failure_reason FROM casual_tables WHERE id = $1',
        [paired.tableId]
      )
    ).rows[0];
    expect(closed).toMatchObject({ state: 'CLOSED', failure_reason: 'CONFIRMATION_EXPIRED' });

    // 心跳停止 91 秒：超过配置的 90 秒宽限，席位失效。
    const next = await configured.create(users[2], {
      ...entry(2),
      discoverability: 'PUBLIC',
      note: '',
    });
    now += 91_000;
    await expect(configured.heartbeat(users[2], next)).rejects.toMatchObject({
      code: 'CASUAL_FORBIDDEN',
    });
    expect((await configured.getCurrent(users[2])).notice?.reason).toBe('HEARTBEAT_EXPIRED');
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
  async function started(
    discoverability: 'PUBLIC' | 'UNLISTED' = 'PUBLIC',
    ruleMode: CasualRuleMode = 'NORMAL'
  ) {
    const waiting = await create(0, discoverability, ruleMode);
    const paired = await service.join(users[1], waiting, entry(1, ruleMode));
    const bound = await confirmPair(paired);
    await runtime.getRoomView(bound.roomCode, users[0]);
    await runtime.getRoomView(bound.roomCode, users[1]);
    await runtime.submitOpeningRps(bound.roomCode, users[0], 'ROCK');
    await runtime.submitOpeningRps(bound.roomCode, users[1], 'SCISSORS');
    const room = await runtime.chooseOpeningTurnOrder(bound.roomCode, users[0], 'SELF_FIRST');
    expect(room.matchId).toBeTruthy();
    return { bound: await current(0), matchId: room.matchId! };
  }
  async function completed(
    discoverability: 'PUBLIC' | 'UNLISTED' = 'PUBLIC',
    ruleMode: CasualRuleMode = 'NORMAL'
  ) {
    const game = await started(discoverability, ruleMode);
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

  it('reads the public lobby in one query while admission and seat locks are held', async () => {
    const mine = await create(0);
    await create(1, 'UNLISTED');
    const other = await create(2);
    const readerPool = new pg.Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
      max: 1,
      statement_timeout: 500,
    });
    const queries = vi.fn();
    const reader = newService({
      database: {
        connect: async () => {
          const client = await readerPool.connect();
          return {
            query: (sql: string, values?: unknown[]) => {
              queries(sql);
              return client.query(sql, values);
            },
            release: () => client.release(),
          } as pg.PoolClient;
        },
      },
    });
    const blocker = await database.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT pg_advisory_xact_lock(hashtext($1))', [CASUAL_ENVIRONMENT_ID]);
      await blocker.query('SELECT * FROM casual_tables FOR UPDATE');
      await blocker.query('SELECT * FROM casual_table_seats FOR UPDATE');
      const lobby = await reader.list(users[0]);
      expect(lobby.counts).toEqual({ waiting: 2, preparing: 0, playing: 0 });
      expect(lobby.rooms).toHaveLength(2);
      expect(lobby.rooms).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tableId: mine.tableId, isMine: true, canJoin: true }),
          expect.objectContaining({ tableId: other.tableId, isMine: false, canJoin: true }),
        ])
      );
      expect(queries).toHaveBeenCalledTimes(1);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await readerPool.end();
    }
  });

  it.each(['WAITING', 'RESERVED'] as const)(
    'omits expired %s supply without mutating it on lobby reads',
    async (state) => {
      const table = state === 'WAITING' ? await create(0) : await pair();
      now += 60_001;
      const lobby = await service.list(users[2]);
      expect(lobby.rooms).toEqual([]);
      expect(lobby.counts).toEqual({ waiting: 0, preparing: 0, playing: 0 });
      expect(
        (await database.query('SELECT state FROM casual_tables WHERE id = $1', [table.tableId]))
          .rows[0].state
      ).toBe(state);
      await service.cleanupExpiredState();
      expect(
        (await database.query('SELECT state FROM casual_tables WHERE id = $1', [table.tableId]))
          .rows[0].state
      ).toBe('CLOSED');
    }
  );

  it('paginates more than fifty rooms without losing or duplicating rows and fences changed filters', async () => {
    for (let index = 0; index < 54; index++) {
      const userId = randomUUID();
      const deckId = randomUUID();
      await database.query('INSERT INTO profiles VALUES ($1,$2,$2)', [userId, `访客${index}`]);
      await database.query('INSERT INTO decks VALUES ($1)', [deckId]);
      await service.create(userId, {
        format: 'CONSTRUCTED',
        ruleMode: 'NORMAL',
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

  it('loads lifecycle policy before acquiring a client for concurrent previews and spectator admission', async () => {
    const { bound } = await started();
    const limitedPool = new pg.Pool({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
      max: 1,
      connectionTimeoutMillis: 500,
    });
    const configured = newService({
      database: limitedPool,
      loadRoomLifecycleTimeoutConfig: async () => {
        await limitedPool.query('SELECT 1');
        return DEFAULT_ROOM_LIFECYCLE_TIMEOUT_CONFIG;
      },
    });
    try {
      const results = await Promise.all(
        Array.from({ length: 6 }, async () => {
          const preview = await configured.preview(users[2], bound.roomCode);
          const link = await configured.spectate(users[2], preview, 'FIRST');
          return { preview, link };
        })
      );
      for (const { preview, link } of results) {
        expect(preview).toMatchObject({ tableId: bound.tableId, status: 'PLAYING' });
        expect(link.token).toBeTruthy();
      }
    } finally {
      await limitedPool.end();
    }
  });

  it.each(['WRITE', 'COMMIT'] as const)(
    'preserves spectator authorization when a preference %s fails',
    async (point) => {
      const { bound } = await started();
      for (const [userIndex, enabled, seat] of [
        [1, true, 'SECOND'],
        [0, false, 'FIRST'],
      ] as const) {
        const before = runtime.getCasualTableRuntime(bound.tableId, bound.roundId)!.view
          .spectatorViews;
        await expect(
          newService({ database: failingTransition('SPECTATOR', point) }).setSpectatorPreference(
            users[userIndex],
            bound,
            enabled
          )
        ).rejects.toThrow('injected transition');
        expect(
          runtime.getCasualTableRuntime(bound.tableId, bound.roundId)!.view.spectatorViews
        ).toEqual(before);
        expect(
          (
            await database.query(
              'SELECT spectator_enabled FROM casual_table_seats WHERE table_id = $1 AND user_id = $2',
              [bound.tableId, users[userIndex]]
            )
          ).rows[0].spectator_enabled
        ).toBe(!enabled);
        if (enabled) {
          await expect(
            runtime.createCasualSpectatorLink(bound.tableId, bound.roundId, users[2], seat)
          ).rejects.toMatchObject({ code: 'ONLINE_ROOM_SPECTATOR_CLOSED' });
        } else {
          expect(
            (await runtime.createCasualSpectatorLink(bound.tableId, bound.roundId, users[2], seat))
              .token
          ).toBeTruthy();
        }
      }
    }
  );

  it('does not expose a spectator view until its preference transaction commits', async () => {
    const { bound } = await started();
    let reachedCommit!: () => void;
    let finishCommit!: () => void;
    const commitReached = new Promise<void>((resolve) => {
      reachedCommit = resolve;
    });
    const commitAllowed = new Promise<void>((resolve) => {
      finishCommit = resolve;
    });
    const configured = newService({
      database: {
        connect: async () => {
          const client = await database.connect();
          let changed = false;
          return {
            query: async (sql: string, values?: unknown[]) => {
              if (sql.includes('UPDATE casual_table_seats SET spectator_enabled')) changed = true;
              if (changed && sql === 'COMMIT') {
                reachedCommit();
                await commitAllowed;
              }
              return client.query(sql, values);
            },
            release: () => client.release(),
          } as pg.PoolClient;
        },
      },
    });
    const updating = configured.setSpectatorPreference(users[1], bound, true);
    try {
      await commitReached;
      expect(
        runtime
          .getCasualTableRuntime(bound.tableId, bound.roundId)!
          .view.spectatorViews.map((view) => view.seat)
      ).toEqual(['FIRST']);
      await expect(
        runtime.createCasualSpectatorLink(bound.tableId, bound.roundId, users[2], 'SECOND')
      ).rejects.toMatchObject({ code: 'ONLINE_ROOM_SPECTATOR_CLOSED' });
    } finally {
      finishCommit();
      await updating;
    }
    const view = await updating;
    expect(view.runtime!.spectatorViews.map((entry) => entry.seat)).toEqual(['FIRST', 'SECOND']);
    expect((await service.spectate(users[2], view, 'SECOND')).token).toBeTruthy();
  });

  it.each([true, false])(
    'reconciles committed spectator preference %s after losing the COMMIT acknowledgement',
    async (enabled) => {
      const { bound } = await started();
      const userIndex = enabled ? 1 : 0;
      await expect(
        newService({ database: failingTransition('SPECTATOR', 'ACK') }).setSpectatorPreference(
          users[userIndex],
          bound,
          enabled
        )
      ).rejects.toThrow('acknowledgement');
      const recovered = await current(userIndex);
      expect(recovered.spectatorEnabled).toBe(enabled);
      expect(recovered.runtime!.spectatorViews.map((view) => view.seat)).toEqual(
        enabled ? ['FIRST', 'SECOND'] : []
      );
    }
  );

  it('does not overwrite a later spectator choice when an earlier COMMIT response is delayed', async () => {
    const { bound } = await started();
    let reachedCommit!: () => void;
    let acknowledgeCommit!: () => void;
    const committed = new Promise<void>((resolve) => {
      reachedCommit = resolve;
    });
    const acknowledged = new Promise<void>((resolve) => {
      acknowledgeCommit = resolve;
    });
    const delayed = newService({
      database: {
        connect: async () => {
          const client = await database.connect();
          let changed = false;
          return {
            query: async (sql: string, values?: unknown[]) => {
              if (sql.includes('UPDATE casual_table_seats SET spectator_enabled')) changed = true;
              const result = await client.query(sql, values);
              if (changed && sql === 'COMMIT') {
                reachedCommit();
                await acknowledged;
              }
              return result;
            },
            release: () => client.release(),
          } as pg.PoolClient;
        },
      },
    });
    const earlier = delayed.setSpectatorPreference(users[1], bound, true);
    let latest!: CasualTableOwnView;
    try {
      await committed;
      latest = await service.setSpectatorPreference(users[1], await current(1), false);
      expect(latest.spectatorEnabled).toBe(false);
    } finally {
      acknowledgeCommit();
      await earlier;
    }
    expect(await earlier).toMatchObject({ revision: latest.revision, spectatorEnabled: false });
    expect(
      runtime
        .getCasualTableRuntime(bound.tableId, bound.roundId)!
        .view.spectatorViews.map((view) => view.seat)
    ).toEqual(['FIRST']);
    await expect(service.spectate(users[2], latest, 'SECOND')).rejects.toMatchObject({
      code: 'CASUAL_SPECTATOR_UNAVAILABLE',
    });
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
              (state === 'SPECTATOR' &&
                sql.includes('UPDATE casual_table_seats SET spectator_enabled')) ||
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
  const sealedEntry = (): CasualTableEntryInput => ({
    format: 'SEALED_BP7',
    ruleMode: 'UNLIMITED',
    requestId: randomUUID(),
    spectatorEnabled: false,
  });
  async function sealedBuilding() {
    const first = await service.findOpponent(users[0], sealedEntry());
    const paired = await service.findOpponent(users[1], sealedEntry());
    expect(paired.tableId).toBe(first.tableId);
    expect(paired.sealedPool).toBeNull();
    await service.confirm(users[0], paired);
    return service.confirm(users[1], paired);
  }
  async function selectSealed(index: number) {
    const own = await current(index);
    const indices = own
      .sealedPool!.cards.filter((card) => card.cardType === CardType.MEMBER)
      .slice(0, 24)
      .map((card) => card.index);
    return service.saveSealedDraft(users[index], own, own.sealedPool!.draftRevision, indices);
  }
  async function sealedBound() {
    await sealedBuilding();
    const first = await selectSealed(0);
    const second = await selectSealed(1);
    const results = await Promise.all([
      service.setSealedReady(users[0], first, first.sealedPool!.draftRevision, true),
      service.setSealedReady(users[1], second, second.sealedPool!.draftRevision, true),
    ]);
    expect(results.some((result) => result.state === 'BOUND')).toBe(true);
    return current(0);
  }
  it('separates sealed matching, freezes both pools once and restores only the caller pool/draft', async () => {
    const constructed = await service.create(users[2], {
      ...entry(2, 'UNLIMITED'),
      note: '',
      discoverability: 'PUBLIC',
    });
    const building = await sealedBuilding();
    expect(building.state).toBe('BUILDING');
    expect(building.tableId).not.toBe(constructed.tableId);
    expect(building.confirmationExpiresAt).toBe(now + 900_000);
    expect(building.sealedPool!.cards).toHaveLength(50);
    for (const card of building.sealedPool!.cards) {
      // Fixture Lives have two pink + one blue printed hearts, projected as three gray.
      expect(card.baseRequiredHearts).toBe(card.cardType === CardType.LIVE ? 3 : null);
    }
    const other = await current(0);
    expect(JSON.stringify(building)).not.toContain(other.sealedPool!.poolId);
    expect(loadDeck).toHaveBeenCalledTimes(1);
    const saved = await selectSealed(0);
    service = newService();
    expect((await current(0)).sealedPool).toEqual(saved.sealedPool);
    expect((await service.confirm(users[0], building)).sealedPool).toEqual(saved.sealedPool);
    expect(
      (await service.list(users[3], { ruleMode: 'UNLIMITED', format: 'SEALED_BP7' })).rooms.map(
        (r) => r.tableId
      )
    ).toEqual([building.tableId]);
    expect(
      JSON.stringify(await service.list(users[3], { ruleMode: 'UNLIMITED', format: 'SEALED_BP7' }))
    ).not.toContain('sealedPool');
  });
  it('rejects invalid/stale selections, locks ready drafts and boots a half-deck match once', async () => {
    const building = await sealedBuilding();
    await expect(
      service.saveSealedDraft(users[1], building, building.sealedPool!.draftRevision, [0, 0])
    ).rejects.toThrow();
    await expect(
      service.setSealedReady(users[1], building, building.sealedPool!.draftRevision, true)
    ).rejects.toThrow('24');
    const first = await selectSealed(0);
    await expect(
      service.saveSealedDraft(users[0], first, first.sealedPool!.draftRevision - 1, [])
    ).rejects.toMatchObject({ code: 'CASUAL_STATE_CHANGED' });
    await service.setSealedReady(users[0], first, first.sealedPool!.draftRevision, true);
    await expect(
      service.saveSealedDraft(users[0], first, first.sealedPool!.draftRevision, [])
    ).rejects.toThrow();
    await service.setSealedReady(users[0], first, first.sealedPool!.draftRevision, false);
    const second = await selectSealed(1);
    await Promise.all([
      service.setSealedReady(users[0], first, first.sealedPool!.draftRevision, true),
      service.setSealedReady(users[1], second, second.sealedPool!.draftRevision, true),
    ]);
    const bound = await current(0);
    expect(bound.state).toBe('BOUND');
    await service.setSealedReady(users[1], second, second.sealedPool!.draftRevision, true);
    expect((await current(0)).roomGeneration).toBe(bound.roomGeneration);
    await runtime.getRoomView(bound.roomCode, users[0]);
    await runtime.getRoomView(bound.roomCode, users[1]);
    await runtime.submitOpeningRps(bound.roomCode, users[0], 'ROCK');
    await runtime.submitOpeningRps(bound.roomCode, users[1], 'SCISSORS');
    const room = await runtime.chooseOpeningTurnOrder(bound.roomCode, users[0], 'SELF_FIRST');
    const match = matches.getMatch(room.matchId!)!;
    expect(match.session.state!.rulesetId).toBe('SEALED_HALF_GRAY_V1');
    expect(match.deckSnapshots.FIRST.mainDeck).toHaveLength(30);
    expect(match.deckSnapshots.FIRST.energyDeck).toHaveLength(12);
  });
  it('keeps a construction pool through disconnects but cancels timeout/exit without a match', async () => {
    const building = await sealedBuilding();
    now += 120_000;
    expect((await current(1)).sealedPool).toEqual(building.sealedPool);
    now += 780_001;
    expect((await service.getCurrent(users[0])).table).toBeNull();
    expect((await service.getCurrent(users[1])).notice?.reason).toBe('SEALED_BUILDING_EXPIRED');
    expect(runtime.listCasualTableRuntimes()).toHaveLength(0);
    const next = await sealedBuilding();
    await service.cancel(users[0], next);
    expect((await service.getCurrent(users[1])).table).toBeNull();
  });
  it.each(['SAME_POOL', 'REBOX'] as const)(
    'requires both players consent for sealed rematch %s',
    async (kind) => {
      const bound = await sealedBound();
      await runtime.getRoomView(bound.roomCode, users[0]);
      await runtime.getRoomView(bound.roomCode, users[1]);
      await runtime.submitOpeningRps(bound.roomCode, users[0], 'ROCK');
      await runtime.submitOpeningRps(bound.roomCode, users[1], 'SCISSORS');
      const room = await runtime.chooseOpeningTurnOrder(bound.roomCode, users[0], 'SELF_FIRST');
      await matches.executeCommand(room.matchId!, users[0], createSurrenderCommand('ignored'));
      const before = await current(0);
      const requested = await service.requestSealedRematch(users[0], before, randomUUID(), kind);
      expect(requested.sealedPool).toEqual(before.sealedPool);
      await expect(
        service.respondSealedRematch(users[0], requested, requested.sealedRematch!.requestId, true)
      ).rejects.toThrow();
      await service.respondSealedRematch(
        users[1],
        await current(1),
        requested.sealedRematch!.requestId,
        true
      );
      const after = await current(0);
      expect(after.state).toBe('BUILDING');
      expect(after.roundId).not.toBe(before.roundId);
      if (kind === 'SAME_POOL') {
        expect(after.sealedPool!.poolId).toBe(before.sealedPool!.poolId);
        expect(after.sealedPool!.selectedIndices).toEqual(before.sealedPool!.selectedIndices);
      } else {
        expect(after.sealedPool!.poolId).not.toBe(before.sealedPool!.poolId);
        expect(after.sealedPool!.selectedIndices).toEqual([]);
      }
      await expect(
        service.respondSealedRematch(users[1], requested, requested.sealedRematch!.requestId, true)
      ).rejects.toThrow();
      expect((await current(0)).sealedPool).toEqual(after.sealedPool);
    }
  );
});
