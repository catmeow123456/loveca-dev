import { describe, expect, it, vi } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { CardType, HeartColor } from '../../src/shared/types/enums';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import {
  MatchRecorderService,
  buildMatchRecorderBeginInputFromOnlineMatch,
  type BeginMatchRecordInput,
  type MatchRecorderQueryClient,
  type MatchRecorderQueryResult,
} from '../../src/server/services/match-recorder-service';
import { rehydrateAuthorityGameState } from '../../src/server/services/replay-payload-serialization';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

interface ExistingTimelineFrameFixture {
  readonly dedupeKey: string;
  readonly row: {
    readonly timeline_seq: number;
    readonly related_checkpoint_seq: number | null;
    readonly payload_hash: string | null;
  };
}

function createTestMemberCard(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    cardText: `${name} 的效果文本`,
    imageFilename: `${cardCode}.webp`,
    rare: 'N',
    product: 'TEST',
  };
}

function createTestLiveCard(cardCode: string, name: string): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
  };
}

function createTestEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: `能量 ${cardCode}`,
    cardType: CardType.ENERGY,
  };
}

function createRuntimeDeck(prefix: string): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: AnyCardData[] = [];

  for (let index = 0; index < 48; index += 1) {
    mainDeck.push(createTestMemberCard(`${prefix}-MEM-${index}`, `${prefix} 成员 ${index}`));
  }

  for (let index = 0; index < 12; index += 1) {
    mainDeck.push(createTestLiveCard(`${prefix}-LIVE-${index}`, `${prefix} Live ${index}`));
    energyDeck.push(createTestEnergyCard(`${prefix}-ENE-${index}`));
  }

  return { mainDeck, energyDeck };
}

function createBeginInput(): BeginMatchRecordInput {
  const cardDataHash = 'sha256:test-card-data';
  return {
    matchId: 'match-recorder-1',
    roomCode: 'REC001',
    startedAt: 1_000,
    participants: {
      FIRST: {
        seat: 'FIRST',
        userId: 'u1',
        displayName: 'Alpha',
        playerId: 'p1',
      },
      SECOND: {
        seat: 'SECOND',
        userId: 'u2',
        displayName: 'Beta',
        playerId: 'p2',
      },
    },
    deckSnapshots: {
      FIRST: {
        seat: 'FIRST',
        userId: 'u1',
        sourceDeckId: 'deck-a',
        sourceDeckName: 'Alpha Deck',
        source: 'ONLINE_RUNTIME_DECK',
        mainDeck: ['A-MEM-1'],
        energyDeck: ['A-ENE-1'],
        cardSummaries: {
          'A-MEM-1': {
            cardCode: 'A-MEM-1',
            name: 'Alpha 成员',
            cardType: 'MEMBER',
            cost: 1,
          },
        },
        validationState: 'RUNTIME_ACCEPTED',
        cardDataVersion: 'ONLINE_RUNTIME_CARD_DATA_SNAPSHOT',
        cardDataHash,
        lockedAt: 900,
      },
      SECOND: {
        seat: 'SECOND',
        userId: 'u2',
        sourceDeckId: 'deck-b',
        sourceDeckName: 'Beta Deck',
        source: 'ONLINE_RUNTIME_DECK',
        mainDeck: ['B-MEM-1'],
        energyDeck: ['B-ENE-1'],
        cardSummaries: {
          'B-MEM-1': {
            cardCode: 'B-MEM-1',
            name: 'Beta 成员',
            cardType: 'MEMBER',
            cost: 1,
          },
        },
        validationState: 'RUNTIME_ACCEPTED',
        cardDataVersion: 'ONLINE_RUNTIME_CARD_DATA_SNAPSHOT',
        cardDataHash,
        lockedAt: 950,
      },
    },
    cardDataHash,
  };
}

function createRecorderHarness(
  cursorOverrides: Partial<Record<string, unknown>> = {},
  options: { readonly existingTimelineFrame?: ExistingTimelineFrameFixture } = {}
) {
  const calls: QueryCall[] = [];
  let generatedDeckSnapshotId = 0;
  const cursorRow = {
    match_id: 'match-recorder-1',
    status: 'IN_PROGRESS',
    completeness: 'FULL',
    turn_count: 9,
    last_timeline_seq: 7,
    last_checkpoint_seq: 3,
    last_public_seq: 2,
    last_private_seq_by_seat: { FIRST: 1, SECOND: 0 },
    last_audit_seq: 2,
    last_command_seq: 1,
    last_game_event_seq: 4,
    ...cursorOverrides,
  };

  const client: MatchRecorderQueryClient = {
    async query<T = unknown>(
      text: string,
      values: readonly unknown[] = []
    ): Promise<MatchRecorderQueryResult<T>> {
      await Promise.resolve();
      calls.push({ text, values });
      if (text.includes('RETURNING id')) {
        generatedDeckSnapshotId += 1;
        return { rows: [{ id: `deck-snapshot-${generatedDeckSnapshotId}` }] as T[] };
      }
      if (text.includes('FROM match_records') && text.includes('FOR UPDATE')) {
        return { rows: [cursorRow] as T[] };
      }
      if (text.includes('FROM match_timeline_entries frame')) {
        if (
          options.existingTimelineFrame &&
          values[0] === cursorRow.match_id &&
          values[1] === options.existingTimelineFrame.dedupeKey
        ) {
          return { rows: [options.existingTimelineFrame.row] as T[] };
        }
        return { rows: [] as T[] };
      }
      if (text.includes('FROM match_records') && !text.includes('FOR UPDATE')) {
        return { rows: [cursorRow] as T[] };
      }
      return { rows: [] as T[] };
    },
  };

  const service = new MatchRecorderService({
    now: () => 2_000,
    queryClient: client,
    transaction: async (callback) => callback(client),
  });

  return { service, calls };
}

function readJsonbParam<T>(value: unknown): T {
  expect(typeof value).toBe('string');
  return JSON.parse(value as string) as T;
}

describe('MatchRecorderService P0a', () => {
  it('beginMatch 写入根记录、双方卡组快照与参与者，并保留独立游标初值', async () => {
    const { service, calls } = createRecorderHarness();

    const result = await service.beginMatch(createBeginInput());

    expect(result).toMatchObject({
      matchId: 'match-recorder-1',
      status: 'IN_PROGRESS',
      completeness: 'FULL',
      turnCount: 0,
      lastTimelineSeq: 0,
      lastCheckpointSeq: 0,
      recordSchemaVersion: 1,
    });
    expect(calls.filter((call) => call.text.includes('INSERT INTO match_records'))).toHaveLength(1);
    expect(
      calls.filter((call) => call.text.includes('INSERT INTO match_deck_snapshots'))
    ).toHaveLength(2);
    expect(
      calls.filter((call) => call.text.includes('INSERT INTO match_participants'))
    ).toHaveLength(2);
    expect(
      calls.some(
        (call) =>
          call.text.includes('INSERT INTO match_participants') &&
          call.values.includes('deck-snapshot-1')
      )
    ).toBe(true);

    const recordInsert = calls.find((call) => call.text.includes('INSERT INTO match_records'));
    expect(recordInsert?.values.slice(2, 6)).toEqual(['ONLINE', 'DEBUG', 'ONLINE_ROOM', 'REC001']);
    expect(readJsonbParam(recordInsert?.values[13])).toEqual([
      'AUTHORITY_CHECKPOINT',
      'PUBLIC_EVENTS',
      'PRIVATE_EVENTS',
      'DECISION_RECORDS_PARTIAL',
    ]);
    expect(readJsonbParam(recordInsert?.values[14])).toEqual([]);

    const firstDeckInsert = calls.find((call) =>
      call.text.includes('INSERT INTO match_deck_snapshots')
    );
    expect(readJsonbParam(firstDeckInsert?.values[6])).toEqual(['A-MEM-1']);
    expect(readJsonbParam(firstDeckInsert?.values[7])).toEqual(['A-ENE-1']);
    expect(readJsonbParam(firstDeckInsert?.values[8])).toMatchObject({
      'A-MEM-1': {
        cardCode: 'A-MEM-1',
        name: 'Alpha 成员',
        cardType: 'MEMBER',
        cost: 1,
      },
    });
  });

  it('recordInitialCheckpoint 分配 recorder checkpointSeq，并保存可复水 payload envelope', async () => {
    const { service, calls } = createRecorderHarness();
    const session = createGameSession();
    session.createGame('match-recorder-1', 'p1', 'Alpha', 'p2', 'Beta');
    const initialized = session.initializeGame(createRuntimeDeck('A'), createRuntimeDeck('B'));
    expect(initialized.success).toBe(true);
    const authorityState = session.getAuthoritySnapshotForRecord();
    expect(authorityState).not.toBeNull();

    const result = await service.recordInitialCheckpoint({
      matchId: 'match-recorder-1',
      authorityState: authorityState!,
      relatedPublicSeq: 2,
      relatedCommandSeq: 1,
      relatedGameEventSeq: 4,
      createdAt: 3_000,
    });

    expect(result.timelineSeq).toBe(8);
    expect(result.checkpointSeq).toBe(4);
    expect(result.payloadHash).toMatch(/^sha256:/);

    const checkpointInsert = calls.find((call) =>
      call.text.includes('INSERT INTO match_checkpoints')
    );
    expect(checkpointInsert).toBeTruthy();
    const payloadEnvelope = readJsonbParam(checkpointInsert!.values[10]);
    expect(payloadEnvelope).toMatchObject({
      serializer: 'TRANSPORT_V1',
      payloadKind: 'AUTHORITY_GAME_STATE',
      sourceSchemaVersion: 'GAME_STATE_V1',
      compressed: true,
      compression: 'GZIP',
      encoding: 'BASE64_JSON',
    });
    expect(typeof payloadEnvelope.payload).toBe('string');
    expect(checkpointInsert!.values[11]).toBe('GZIP');
    const rehydrated = rehydrateAuthorityGameState(payloadEnvelope as never);
    expect(rehydrated.cardRegistry).toBeInstanceOf(Map);
    expect(rehydrated.gameId).toBe('match-recorder-1');
    expect(readJsonbParam(checkpointInsert!.values[13])).toEqual([
      'AUTHORITY_CHECKPOINT',
      'PUBLIC_EVENTS',
      'PRIVATE_EVENTS',
      'DECISION_RECORDS_PARTIAL',
    ]);
  });

  it('appendMatchRecordFrame 为成功命令追加 timeline 与独立 authority checkpoint', async () => {
    const { service, calls } = createRecorderHarness();
    const session = createGameSession();
    session.createGame('match-recorder-1', 'p1', 'Alpha', 'p2', 'Beta');
    const initialized = session.initializeGame(createRuntimeDeck('A'), createRuntimeDeck('B'));
    expect(initialized.success).toBe(true);
    const authorityState = session.getAuthoritySnapshotForRecord();
    expect(authorityState).not.toBeNull();

    const result = await service.appendMatchRecordFrame({
      matchId: 'match-recorder-1',
      frameType: 'COMMAND_ACCEPTED',
      authorityState,
      relatedPublicSeq: 6,
      relatedPrivateSeq: 3,
      relatedAuditSeq: 4,
      relatedCommandSeq: 2,
      relatedGameEventSeq: 5,
      latestPrivateSeqBySeat: { FIRST: 3, SECOND: 1 },
      publicEvents: [
        {
          type: 'PhaseStarted',
          eventId: 'public-event-6',
          matchId: 'match-recorder-1',
          seq: 6,
          timestamp: 3_900,
          source: 'SYSTEM',
          phase: 'MAIN',
          activeSeat: 'FIRST',
        },
      ],
      privateEventsBySeat: {
        FIRST: [
          {
            type: 'HandUpdated',
            eventId: 'private-event-first-3',
            matchId: 'match-recorder-1',
            seq: 3,
            timestamp: 3_950,
            seat: 'FIRST',
            relatedPublicSeq: 6,
            payload: { handCount: 5 },
          },
        ],
        SECOND: [
          {
            type: 'HandUpdated',
            eventId: 'private-event-second-1',
            matchId: 'match-recorder-1',
            seq: 1,
            timestamp: 3_960,
            seat: 'SECOND',
            relatedPublicSeq: 6,
            payload: { handCount: 4 },
          },
        ],
      },
      decisionRecords: [
        {
          decisionId: 'decision-opened-effect-1',
          decisionType: 'ACTIVE_EFFECT_OPENED',
          status: 'OPENED',
          playerId: 'p1',
          eventIds: ['event-1'],
          sourceType: 'CARD_ABILITY',
          sourceCardObjectId: 'source-card-1',
          sourceCardCode: 'PL!HS-bp1-006-P',
          sourceBaseCardCode: 'PL!HS-bp1-006',
          sourceZone: 'MEMBER_SLOT',
          sourceSlot: 'LEFT',
          abilityId: 'test-ability',
          abilityCategory: 'LIVE_START',
          abilitySourceZone: 'STAGE_MEMBER',
          effectTextSnapshot: '测试效果文本',
          stepId: 'select-card',
          stepText: '选择 1 张卡牌',
          waitingSeat: 'FIRST',
          visibleCandidates: [
            {
              cardId: 'candidate-1',
              cardCode: 'PL!HS-bp1-004-P',
              baseCardCode: 'PL!HS-bp1-004',
              name: '夕雾缀理',
            },
          ],
          visibleContextSummary: {
            selectableCardCount: 1,
            hasPrivateCandidates: false,
          },
          minSelect: 1,
          maxSelect: 1,
          canSkip: false,
          transitionSemantics: 'STRUCTURED',
        },
      ],
      createdAt: 4_000,
    });

    expect(result).toMatchObject({
      matchId: 'match-recorder-1',
      timelineSeq: 8,
      checkpointSeq: 4,
    });
    expect(result.payloadHash).toMatch(/^sha256:/);

    const timelineInsert = calls.find((call) =>
      call.text.includes('INSERT INTO match_timeline_entries')
    );
    expect(timelineInsert?.values).toEqual(
      expect.arrayContaining(['COMMAND_ACCEPTED', 4, 6, 3, 4, 2, 5])
    );
    expect(readJsonbParam(timelineInsert?.values[7])).toEqual({ FIRST: 3, SECOND: 1 });

    const checkpointInsert = calls.find((call) =>
      call.text.includes('INSERT INTO match_checkpoints')
    );
    expect(checkpointInsert?.values.slice(0, 6)).toEqual(['match-recorder-1', 4, 8, 6, 2, 5]);

    const publicEventInsert = calls.find((call) =>
      call.text.includes('INSERT INTO match_record_public_events')
    );
    expect(publicEventInsert?.values).toEqual([
      'match-recorder-1',
      8,
      6,
      'public-event-6',
      'PhaseStarted',
      'SYSTEM',
      null,
      '阶段开始：MAIN',
      expect.any(String),
      new Date(3_900),
    ]);
    expect(readJsonbParam(publicEventInsert?.values[8])).toMatchObject({
      type: 'PhaseStarted',
      seq: 6,
      phase: 'MAIN',
    });

    const privateEventInserts = calls.filter((call) =>
      call.text.includes('INSERT INTO match_record_private_events')
    );
    expect(privateEventInserts).toHaveLength(2);
    expect(privateEventInserts[0]?.values).toEqual([
      'match-recorder-1',
      'FIRST',
      8,
      3,
      'private-event-first-3',
      'HandUpdated',
      6,
      '私密事件：HandUpdated',
      expect.any(String),
      new Date(3_950),
    ]);

    const decisionInsert = calls.find((call) =>
      call.text.includes('INSERT INTO match_decision_records')
    );
    expect(decisionInsert?.values.slice(0, 8)).toEqual([
      'match-recorder-1',
      'decision-opened-effect-1',
      8,
      1,
      'ACTIVE_EFFECT_OPENED',
      'OPENED',
      'p1',
      expect.any(String),
    ]);
    expect(readJsonbParam(decisionInsert?.values[7])).toEqual(['event-1']);
    expect(readJsonbParam(decisionInsert?.values[22])).toEqual([
      {
        cardId: 'candidate-1',
        cardCode: 'PL!HS-bp1-004-P',
        baseCardCode: 'PL!HS-bp1-004',
        name: '夕雾缀理',
      },
    ]);
    expect(readJsonbParam(decisionInsert?.values[24])).toMatchObject({
      selectableCardCount: 1,
    });

    const recordUpdate = calls.find((call) =>
      call.text.includes('last_private_seq_by_seat = jsonb_build_object')
    );
    expect(recordUpdate?.values).toEqual([
      'match-recorder-1',
      8,
      4,
      6,
      3,
      1,
      4,
      2,
      5,
      authorityState!.turnCount,
    ]);
  });

  it('appendMatchRecordFrame 为 UNDO_APPLIED 追加撤销 frame、checkpoint 与 timeline 事件身份', async () => {
    const { service, calls } = createRecorderHarness();
    const session = createGameSession();
    session.createGame('match-recorder-1', 'p1', 'Alpha', 'p2', 'Beta');
    const initialized = session.initializeGame(createRuntimeDeck('A'), createRuntimeDeck('B'));
    expect(initialized.success).toBe(true);

    const result = await service.appendMatchRecordFrame({
      matchId: 'match-recorder-1',
      frameType: 'UNDO_APPLIED',
      authorityState: session.getAuthoritySnapshotForRecord(),
      relatedPublicSeq: 2,
      relatedCommandSeq: 1,
      relatedGameEventSeq: 4,
      latestPrivateSeqBySeat: { FIRST: 2 },
      publicEvents: [
        {
          type: 'PhaseStarted',
          eventId: 'public-event-2-branch',
          matchId: 'match-recorder-1',
          seq: 2,
          timestamp: 4_100,
          source: 'SYSTEM',
          phase: 'MAIN',
          activeSeat: 'FIRST',
        },
      ],
      privateEventsBySeat: {
        FIRST: [
          {
            type: 'HandUpdated',
            eventId: 'private-event-first-2-branch',
            matchId: 'match-recorder-1',
            seq: 2,
            timestamp: 4_110,
            seat: 'FIRST',
            relatedPublicSeq: 2,
          },
        ],
      },
      dedupeKey: 'branch-1:UNDO_APPLIED:undo-1',
      createdAt: 4_000,
    });

    expect(result).toMatchObject({
      matchId: 'match-recorder-1',
      timelineSeq: 8,
      checkpointSeq: 4,
    });

    const timelineInsert = calls.find((call) =>
      call.text.includes('INSERT INTO match_timeline_entries')
    );
    expect(timelineInsert?.values).toEqual(
      expect.arrayContaining([
        'UNDO_APPLIED',
        'SYSTEM',
        4,
        2,
        null,
        1,
        4,
        'branch-1:UNDO_APPLIED:undo-1',
      ])
    );
    expect(calls.some((call) => call.text.includes('INSERT INTO match_checkpoints'))).toBe(true);
    expect(
      calls
        .find((call) => call.text.includes('INSERT INTO match_record_public_events'))
        ?.text.includes('ON CONFLICT (match_id, timeline_seq, event_seq) DO NOTHING')
    ).toBe(true);
    expect(
      calls
        .find((call) => call.text.includes('INSERT INTO match_record_private_events'))
        ?.text.includes('ON CONFLICT (match_id, seat, timeline_seq, event_seq) DO NOTHING')
    ).toBe(true);
  });

  it('appendMatchRecordFrame 命中 dedupeKey 时返回既有 timeline，不重复写入', async () => {
    const { service, calls } = createRecorderHarness(
      {},
      {
        existingTimelineFrame: {
          dedupeKey: 'retry-command-2',
          row: {
            timeline_seq: 6,
            related_checkpoint_seq: 3,
            payload_hash: 'sha256:existing-checkpoint',
          },
        },
      }
    );
    const session = createGameSession();
    session.createGame('match-recorder-1', 'p1', 'Alpha', 'p2', 'Beta');
    const initialized = session.initializeGame(createRuntimeDeck('A'), createRuntimeDeck('B'));
    expect(initialized.success).toBe(true);

    const result = await service.appendMatchRecordFrame({
      matchId: 'match-recorder-1',
      frameType: 'COMMAND_ACCEPTED',
      authorityState: session.getAuthoritySnapshotForRecord(),
      relatedCommandSeq: 2,
      dedupeKey: 'retry-command-2',
      createdAt: 4_000,
    });

    expect(result).toEqual({
      matchId: 'match-recorder-1',
      timelineSeq: 6,
      checkpointSeq: 3,
      payloadHash: 'sha256:existing-checkpoint',
    });
    expect(calls.some((call) => call.text.includes('INSERT INTO match_timeline_entries'))).toBe(
      false
    );
    expect(calls.some((call) => call.text.includes('INSERT INTO match_checkpoints'))).toBe(false);
    expect(
      calls.some((call) => call.text.includes('last_private_seq_by_seat = jsonb_build_object'))
    ).toBe(false);
  });

  it('appendMatchRecordFrame 默认 dedupeKey 使用稳定事实序号支持重试幂等', async () => {
    const { service, calls } = createRecorderHarness(
      {},
      {
        existingTimelineFrame: {
          dedupeKey: 'SYSTEM_TRANSITION:public:6',
          row: {
            timeline_seq: 9,
            related_checkpoint_seq: 5,
            payload_hash: 'sha256:existing-system-transition',
          },
        },
      }
    );
    const session = createGameSession();
    session.createGame('match-recorder-1', 'p1', 'Alpha', 'p2', 'Beta');
    const initialized = session.initializeGame(createRuntimeDeck('A'), createRuntimeDeck('B'));
    expect(initialized.success).toBe(true);

    const result = await service.appendMatchRecordFrame({
      matchId: 'match-recorder-1',
      frameType: 'SYSTEM_TRANSITION',
      authorityState: session.getAuthoritySnapshotForRecord(),
      relatedPublicSeq: 6,
      createdAt: 4_000,
    });

    expect(result).toEqual({
      matchId: 'match-recorder-1',
      timelineSeq: 9,
      checkpointSeq: 5,
      payloadHash: 'sha256:existing-system-transition',
    });
    const dedupeLookup = calls.find((call) =>
      call.text.includes('FROM match_timeline_entries frame')
    );
    expect(dedupeLookup?.values).toEqual(['match-recorder-1', 'SYSTEM_TRANSITION:public:6']);
    expect(calls.some((call) => call.text.includes('INSERT INTO match_timeline_entries'))).toBe(
      false
    );
  });

  it('appendMatchRecordFrame 默认 dedupeKey 在 game event 与 public seq 同时存在时优先 game event', async () => {
    const { service, calls } = createRecorderHarness(
      {},
      {
        existingTimelineFrame: {
          dedupeKey: 'SYSTEM_TRANSITION:game-event:5',
          row: {
            timeline_seq: 10,
            related_checkpoint_seq: 6,
            payload_hash: 'sha256:existing-game-event',
          },
        },
      }
    );

    const result = await service.appendMatchRecordFrame({
      matchId: 'match-recorder-1',
      frameType: 'SYSTEM_TRANSITION',
      relatedPublicSeq: 6,
      relatedGameEventSeq: 5,
      createdAt: 4_000,
    });

    expect(result).toEqual({
      matchId: 'match-recorder-1',
      timelineSeq: 10,
      checkpointSeq: 6,
      payloadHash: 'sha256:existing-game-event',
    });
    const dedupeLookup = calls.find((call) =>
      call.text.includes('FROM match_timeline_entries frame')
    );
    expect(dedupeLookup?.values).toEqual(['match-recorder-1', 'SYSTEM_TRANSITION:game-event:5']);
    expect(calls.some((call) => call.text.includes('INSERT INTO match_timeline_entries'))).toBe(
      false
    );
  });

  it('appendMatchRecordFrame 为拒绝命令只追加 timeline，不写 checkpoint', async () => {
    const { service, calls } = createRecorderHarness();
    const session = createGameSession();
    session.createGame('match-recorder-1', 'p1', 'Alpha', 'p2', 'Beta');
    const initialized = session.initializeGame(createRuntimeDeck('A'), createRuntimeDeck('B'));
    expect(initialized.success).toBe(true);

    const result = await service.appendMatchRecordFrame({
      matchId: 'match-recorder-1',
      frameType: 'COMMAND_REJECTED',
      authorityState: session.getAuthoritySnapshotForRecord(),
      relatedCommandSeq: 2,
      relatedAuditSeq: 4,
      createdAt: 4_000,
    });

    expect(result).toMatchObject({
      matchId: 'match-recorder-1',
      timelineSeq: 8,
      checkpointSeq: null,
      payloadHash: null,
    });
    expect(calls.some((call) => call.text.includes('INSERT INTO match_checkpoints'))).toBe(false);
    const timelineInsert = calls.find((call) =>
      call.text.includes('INSERT INTO match_timeline_entries')
    );
    expect(timelineInsert?.values).toEqual(
      expect.arrayContaining(['COMMAND_REJECTED', null, null, null, 4, 2, null])
    );
  });

  it('appendMatchRecordFrame 在缺少 authorityState 时不回退记录 turnCount', async () => {
    const { service, calls } = createRecorderHarness({ turn_count: 12 });

    const result = await service.appendMatchRecordFrame({
      matchId: 'match-recorder-1',
      frameType: 'COMMAND_REJECTED',
      relatedCommandSeq: 2,
      createdAt: 4_000,
    });

    expect(result).toMatchObject({
      matchId: 'match-recorder-1',
      timelineSeq: 8,
      checkpointSeq: null,
      payloadHash: null,
    });
    expect(calls.some((call) => call.text.includes('INSERT INTO match_checkpoints'))).toBe(false);

    const timelineInsert = calls.find((call) =>
      call.text.includes('INSERT INTO match_timeline_entries')
    );
    expect(timelineInsert?.values[13]).toBe(12);

    const recordUpdate = calls.find((call) =>
      call.text.includes('last_private_seq_by_seat = jsonb_build_object')
    );
    expect(recordUpdate?.text).toContain(
      'turn_count = GREATEST(turn_count, COALESCE($10, turn_count))'
    );
    expect(recordUpdate?.values[9]).toBeNull();
  });

  it('从当前 OnlineMatchState 构造 P0a 输入时保留锁卡元数据与卡牌展示摘要', async () => {
    const matchService = new OnlineMatchService({ recorder: null });
    const match = await matchService.createMatch({
      roomCode: 'REC002',
      startedAt: 1_000,
      first: {
        userId: 'u1',
        displayName: 'Alpha',
        deckId: 'deck-a',
        deckName: 'Alpha Deck',
        lockedAt: 900,
        deck: createRuntimeDeck('A'),
      },
      second: {
        userId: 'u2',
        displayName: 'Beta',
        deckId: 'deck-b',
        deckName: 'Beta Deck',
        lockedAt: 950,
        deck: createRuntimeDeck('B'),
      },
    });

    const input = buildMatchRecorderBeginInputFromOnlineMatch(match);

    expect(input.cardDataHash).toMatch(/^sha256:/);
    expect(input.deckSnapshots.FIRST.sourceDeckId).toBe('deck-a');
    expect(input.deckSnapshots.FIRST.sourceDeckName).toBe('Alpha Deck');
    expect(input.deckSnapshots.FIRST.mainDeck).toHaveLength(60);
    expect(input.deckSnapshots.FIRST.energyDeck).toHaveLength(12);
    expect(input.deckSnapshots.FIRST.cardDataHash).toBe(input.cardDataHash);
    expect(input.deckSnapshots.SECOND.cardDataHash).toBe(input.cardDataHash);
    expect(input.deckSnapshots.FIRST.cardSummaries['A-MEM-0']).toMatchObject({
      cardCode: 'A-MEM-0',
      name: 'A 成员 0',
      cardType: CardType.MEMBER,
      cost: 1,
      imageFilename: 'A-MEM-0.webp',
    });
  });

  it('从对墙打 OnlineMatchState 构造输入时保留模式、系统参与者与默认对手卡组来源', async () => {
    const matchService = new OnlineMatchService({ recorder: null });
    const match = await matchService.createMatch({
      roomCode: 'SOL001',
      matchMode: 'SOLITAIRE',
      automationGameMode: 'SOLITAIRE',
      originKind: 'SOLITAIRE',
      originLabel: '对墙打',
      startedAt: 1_000,
      first: {
        userId: 'u1',
        displayName: 'Alpha',
        deckId: 'deck-a',
        deckName: 'Alpha Deck',
        deckSource: 'PUBLISHED_CARDS_SNAPSHOT',
        lockedAt: 900,
        deck: createRuntimeDeck('A'),
      },
      second: {
        userId: 'system:solitaire-opponent',
        displayName: '对手 (AI)',
        deckId: 'solitaire-default-opponent',
        deckName: '缪预组.yaml',
        deckSource: 'SOLITAIRE_DEFAULT_DECK',
        participantKind: 'SYSTEM',
        ownerUserId: 'u1',
        deck: createRuntimeDeck('B'),
      },
    });

    const input = buildMatchRecorderBeginInputFromOnlineMatch(match);

    expect(input).toMatchObject({
      matchMode: 'SOLITAIRE',
      automationGameMode: 'SOLITAIRE',
      originKind: 'SOLITAIRE',
      originLabel: '对墙打',
      replayLimitations: ['SOLITAIRE_AUTOMATION_COMPRESSED'],
    });
    expect(input.participants.SECOND).toMatchObject({
      userId: 'system:solitaire-opponent',
      participantKind: 'SYSTEM',
      ownerUserId: 'u1',
    });
    expect(input.deckSnapshots.FIRST.source).toBe('PUBLISHED_CARDS_SNAPSHOT');
    expect(input.deckSnapshots.SECOND.source).toBe('SOLITAIRE_DEFAULT_DECK');
  });

  it('markPartial 记录追加失败摘要，不伪装成完整记录', async () => {
    const { service, calls } = createRecorderHarness();

    await service.markPartial({
      matchId: 'match-recorder-1',
      status: 'CORRUPTED',
      completeness: 'INCOMPLETE',
      partialReason: 'initial checkpoint failed',
      recorderError: 'db unavailable',
      appendFailureAt: 4_000,
    });

    const update = calls.find((call) => call.text.includes('UPDATE match_records'));
    expect(update?.values).toEqual([
      'match-recorder-1',
      'CORRUPTED',
      'INCOMPLETE',
      'initial checkpoint failed',
      'db unavailable',
      new Date(4_000),
    ]);
  });
});
