import { acquireHextechBatch } from '../../src/application/hextech/acquire';
import { DARK_HEXTECH_RULES_VERSION } from '../../src/domain/hextech/catalog';
import { GameCommandType } from '../../src/application/game-commands';
import { GamePhase } from '../../src/shared/types/enums';
import { sealedCards, seededRandom } from '../helpers/sealed-cards';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSurrenderCommand } from '../../src/application/game-commands';
import type { DeckConfig } from '../../src/application/game-service';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { toDeckPointTableRules } from '../../src/domain/rules/deck-point-table';
import { CardType, HeartColor } from '../../src/shared/types/enums';
import type {
  CasualRuleMode,
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

const users = Array.from({ length: 5 }, () => randomUUID());
const decks = users.map(() => randomUUID());
const rules = toDeckPointTableRules({
  version: 'test',
  pointLimit: 9,
  effectiveFrom: '2026-01-01T00:00:00Z',
  entries: [],
});
let database: pg.Pool;
let engine: PGlite;
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
async function current(index: number) {
  return (await service.getCurrent(users[index])).table!;
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
    loadSealedCards: () => Promise.resolve(sealedCards()),
    randomInt: seededRandom(42),
    getPointTable: () => Promise.resolve(rules),
    assertGameplayAvailable: async () => {},
    getGameplayRestriction: () => Promise.resolve(null),
    ...overrides,
  });
}

// Real PostgreSQL in WASM. Sequential admission/recovery only; lock concurrency stays in the opt-in PostgreSQL suite.
describe('黑暗海克斯卡池数据库与联机链路', () => {
  beforeAll(async () => {
    engine = new PGlite();
    const query = async (sql: string, values?: unknown[]) => {
      const result = await engine.query(sql, values);
      return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
    };
    database = {
      query,
      connect: () => Promise.resolve({ query, release() {} }),
    } as unknown as pg.Pool;
    await engine.exec(`
      CREATE FUNCTION gen_random_uuid() RETURNS uuid LANGUAGE sql AS 'SELECT md5(random()::text)::uuid';
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
    await engine.exec(migration);
    await engine.exec(
      "ALTER TABLE casual_tables ADD CONSTRAINT casual_tables_environment_check CHECK(environment_id IN ('CASUAL_TABLE_V1', 'CASUAL_UNLIMITED_PT_V1'))"
    );
    await engine.exec(
      await readFile(new URL('../../drizzle/0045_add_bp7_sealed.sql', import.meta.url), 'utf8')
    );
    await engine.exec(
      await readFile(
        new URL('../../drizzle/0048_add_hextech_casual_format.sql', import.meta.url),
        'utf8'
      )
    );
    await engine.exec(
      await readFile(
        new URL('../../drizzle/0049_switch_sealed_to_bp8.sql', import.meta.url),
        'utf8'
      )
    );
    await engine.exec(
      await readFile(
        new URL('../../drizzle/0050_add_dark_hextech_pool.sql', import.meta.url),
        'utf8'
      )
    );
  });
  afterAll(async () => {
    await engine?.close();
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
  it.each(['NORMAL', 'DARK'] as const)(
    '%s海克斯按卡池隔离匹配，支持换组、正式开局及再战',
    async (pool) => {
      const hexEntry = (index: number) => ({
        ...entry(index, 'UNLIMITED'),
        format: 'HEXTECH' as const,
        hextechPool: pool,
      });
      const ordinary = await service.findOpponent(users[2], {
        ...hexEntry(2),
        hextechPool: pool === 'DARK' ? 'NORMAL' : 'DARK',
      });
      const hex = await service.findOpponent(users[0], hexEntry(0));
      expect(hex.tableId).not.toBe(ordinary.tableId);
      expect(hex.format).toBe('HEXTECH');
      expect(hex.hextechPool).toBe(pool);
      await expect(
        service.join(users[1], hex, {
          ...hexEntry(1),
          hextechPool: pool === 'DARK' ? 'NORMAL' : 'DARK',
        })
      ).rejects.toThrow();
      expect(hex.ruleMode).toBe('UNLIMITED');
      await expect(service.join(users[1], hex, entry(1, 'UNLIMITED'))).rejects.toThrow();
      const changed = await service.changeDeck(users[0], hex, decks[0]);
      const paired = await service.join(users[1], changed, hexEntry(1));
      const bound = await confirmPair(paired);
      await runtime.getRoomView(bound.roomCode, users[0]);
      await runtime.getRoomView(bound.roomCode, users[1]);
      await runtime.submitOpeningRps(bound.roomCode, users[0], 'ROCK');
      await runtime.submitOpeningRps(bound.roomCode, users[1], 'SCISSORS');
      const opened = await runtime.chooseOpeningTurnOrder(bound.roomCode, users[0], 'SELF_FIRST');
      const match = matches.getMatch(opened.matchId!)!;
      expect(match.session.state!.hextech!.draft).toEqual({ completedRounds: 0 });
      expect(match.session.state!.hextech!.rulesVersion).toBe(
        pool === 'DARK' ? 'DARK_HEXTECH_V1' : 'HEXTECH_V1'
      );
      expect(match.session.state!.rulesetId).toBe('STANDARD');
      await matches.executeCommand(match.matchId, users[0], createSurrenderCommand('ignored'));
      const requested = await service.requestRematch(users[0], await current(0), decks[0], false);
      const next = await service.respondRematch(
        users[1],
        await current(1),
        requested.runtime!.rematch!.requestId,
        decks[1],
        false
      );
      expect(next.format).toBe('HEXTECH');
      expect(next.hextechPool).toBe(pool);
      expect(next.roundId).not.toBe(bound.roundId);
      expect((await service.getCurrent(users[2])).table!.hextechPool).toBe(
        pool === 'DARK' ? 'NORMAL' : 'DARK'
      );
    }
  );

  it('取得弃牌的网络快照只向当前选择者发候选，观战不发，重复提交不重复抽牌', async () => {
    const participant = (index: number) => ({
      userId: users[index],
      displayName: `玩家${index}`,
      deck: deck(users[index]),
      pointValidation: { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 },
    });
    const match = await matches.createMatch({
      roomCode: 'DARK99',
      first: participant(0),
      second: participant(1),
      hextechPool: 'DARK',
      hextechRoundSelection: true,
    });
    const source = match.session.state!;
    const firstId = source.players[0].id;
    const secondId = source.players[1].id;
    const acquired = acquireHextechBatch(
      {
        ...source,
        turnCount: 1,
        currentPhase: GamePhase.MAIN_PHASE,
        hextech: { rulesVersion: DARK_HEXTECH_RULES_VERSION, owned: [] },
      },
      [{ playerId: firstId, definitionId: 'dark-rewrite-script', instanceId: 'reset' }],
      () => 0
    ).gameState;
    match.session.restoreRuntimeState({ authorityState: acquired, currentPublicSeq: 0 });
    const first = await matches.getMatchSnapshot(match.matchId, users[0]);
    const second = await matches.getMatchSnapshot(match.matchId, users[1]);
    expect(
      first &&
        'playerViewState' in first &&
        first.playerViewState.activeEffect?.selectableObjectIds?.length
    ).toBe(6);
    expect(
      second &&
        'playerViewState' in second &&
        second.playerViewState.activeEffect?.selectableObjectIds
    ).toBeUndefined();
    const link = matches.createRoomCodePlayerViewSpectatorLink(
      match.matchId,
      'FIRST',
      ['FIRST', 'SECOND'],
      'test-generation'
    )!;
    const spectator = await matches.joinSpectatorLink(link.token, { clientId: 'observer' });
    expect(spectator.snapshot).toHaveProperty(
      'playerViewState.match.hextech.rulesVersion',
      DARK_HEXTECH_RULES_VERSION
    );
    expect(spectator.snapshot).toHaveProperty(
      'playerViewState.activeEffect.selectableObjectIds',
      undefined
    );
    for (const [index, playerId] of [firstId, secondId].entries()) {
      const effect = match.session.state!.activeEffect!;
      expect(effect.awaitingPlayerId).toBe(playerId);
      const command = {
        type: GameCommandType.CONFIRM_EFFECT_STEP as const,
        playerId,
        effectId: effect.id,
        selectedCardIds: effect.selectableCardIds!.slice(0, effect.minSelectableCards),
        timestamp: 1,
        idempotencyKey: `reset-${index}`,
      };
      expect((await matches.executeCommand(match.matchId, users[index], command))!.success).toBe(
        true
      );
      const counts = match.session.state!.players.map((player) => player.hand.cardIds.length);
      await matches.executeCommand(match.matchId, users[index], command);
      expect(match.session.state!.players.map((player) => player.hand.cardIds.length)).toEqual(
        counts
      );
    }
    expect(match.session.state!.hextech!.pendingAcquisition).toBeUndefined();
    expect(match.session.state!.players.map((player) => player.hand.cardIds.length)).toEqual([
      6, 6,
    ]);
  });
});
