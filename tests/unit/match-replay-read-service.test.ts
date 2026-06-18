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
import { createPublicObjectId } from '../../src/online/projector';
import { CardType, HeartColor } from '../../src/shared/types/enums';
import {
  MatchReplayReadService,
  type MatchReplayReadQueryClient,
} from '../../src/server/services/match-replay-read-service';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { serializeReplayPayload } from '../../src/server/services/replay-payload-serialization';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

function createTestMemberCard(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
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

function createHarness() {
  const session = createGameSession();
  session.createGame('match-read-1', 'p1', 'Alpha', 'p2', 'Beta');
  const initialized = session.initializeGame(createRuntimeDeck('A'), createRuntimeDeck('B'));
  expect(initialized.success).toBe(true);
  const authorityState = session.getAuthoritySnapshotForRecord();
  expect(authorityState).not.toBeNull();
  const payload = serializeReplayPayload(
    authorityState!,
    'AUTHORITY_GAME_STATE',
    GAME_STATE_SCHEMA_VERSION
  );
  const initialTimelineRow = {
    timeline_seq: 1,
    frame_type: 'MATCH_INITIALIZED',
    visibility_scope: 'ADMIN',
    summary: '初始化权威检查点',
    created_at: new Date(1_000),
    related_checkpoint_seq: 1,
    related_public_seq: null,
    related_private_seq: null,
    related_private_seq_by_seat: { FIRST: 0, SECOND: 0 },
    related_command_seq: null,
    related_game_event_seq: null,
    turn_count: authorityState!.turnCount,
    phase: String(authorityState!.currentPhase),
    sub_phase: String(authorityState!.currentSubPhase),
  };
  const timelineRow = {
    timeline_seq: 2,
    frame_type: 'COMMAND_ACCEPTED',
    visibility_scope: 'PRIVATE',
    summary: '命令已接受并保存权威检查点',
    created_at: new Date(2_000),
    related_checkpoint_seq: 1,
    related_public_seq: 3,
    related_private_seq: 2,
    related_private_seq_by_seat: { FIRST: 2, SECOND: 0 },
    related_command_seq: 1,
    related_game_event_seq: 4,
    turn_count: authorityState!.turnCount,
    phase: String(authorityState!.currentPhase),
    sub_phase: String(authorityState!.currentSubPhase),
  };
  const opponentOnlyTimelineRow = {
    timeline_seq: 3,
    frame_type: 'COMMAND_ACCEPTED',
    visibility_scope: 'PRIVATE',
    summary: '对手私有事件批次',
    created_at: new Date(3_000),
    related_checkpoint_seq: null,
    related_public_seq: null,
    related_private_seq: 4,
    related_private_seq_by_seat: { FIRST: 2, SECOND: 4 },
    related_command_seq: 2,
    related_game_event_seq: null,
    turn_count: authorityState!.turnCount,
    phase: String(authorityState!.currentPhase),
    sub_phase: String(authorityState!.currentSubPhase),
  };
  const publicEventRow = {
    timeline_seq: 2,
    event_seq: 3,
    event_id: 'public-event-3',
    event_type: 'PhaseStarted',
    source: 'SYSTEM',
    actor_seat: null,
    summary: '阶段开始：MAIN',
    payload: {
      type: 'PhaseStarted',
      eventId: 'public-event-3',
      matchId: 'match-read-1',
      seq: 3,
      timestamp: 2_000,
      source: 'SYSTEM',
      phase: 'MAIN',
      activeSeat: 'FIRST',
    },
    created_at: new Date(2_000),
    turn_count: authorityState!.turnCount,
    phase: String(authorityState!.currentPhase),
    sub_phase: String(authorityState!.currentSubPhase),
  };
  const firstPrivateEventRow = {
    timeline_seq: 2,
    event_seq: 2,
    event_id: 'private-event-first-2',
    event_type: 'HandUpdated',
    summary: '私密事件：HandUpdated',
    payload: {
      type: 'HandUpdated',
      eventId: 'private-event-first-2',
      matchId: 'match-read-1',
      seq: 2,
      timestamp: 2_000,
      seat: 'FIRST',
      relatedPublicSeq: 3,
      payload: { visibleHandObjectIds: ['self-card'] },
    },
    created_at: new Date(2_000),
    turn_count: authorityState!.turnCount,
    phase: String(authorityState!.currentPhase),
    sub_phase: String(authorityState!.currentSubPhase),
  };
  const secondPrivateEventRow = {
    ...firstPrivateEventRow,
    event_seq: 4,
    event_id: 'private-event-second-4',
    payload: {
      type: 'HandUpdated',
      eventId: 'private-event-second-4',
      matchId: 'match-read-1',
      seq: 4,
      timestamp: 3_000,
      seat: 'SECOND',
      relatedPublicSeq: 3,
      payload: { visibleHandObjectIds: ['opponent-secret-card'] },
    },
  };
  const firstDecisionRow = {
    decision_id: 'decision-opened-first',
    timeline_seq: 2,
    decision_schema_version: 1,
    decision_type: 'ACTIVE_EFFECT_OPENED',
    status: 'OPENED',
    player_id: 'p1',
    event_ids: ['event-1'],
    ability_id: 'test-ability',
    source_card_object_id: 'source-card-1',
    source_card_code: 'PL!HS-bp1-006-P',
    source_base_card_code: 'PL!HS-bp1-006',
    source_zone: 'MEMBER_SLOT',
    source_slot: 'LEFT',
    effect_text_snapshot: '测试效果文本',
    step_id: 'select-card',
    step_text: '选择 1 张卡牌',
    waiting_seat: 'FIRST',
    visible_candidates: [
      {
        cardId: 'candidate-1',
        cardCode: 'PL!HS-bp1-004-P',
        baseCardCode: 'PL!HS-bp1-004',
        name: '夕雾缀理',
      },
    ],
    visible_context_summary: {
      selectableCardCount: 1,
      hasPrivateCandidates: false,
    },
    min_select: 1,
    max_select: 1,
    can_skip: false,
    submitted_timeline_seq: null,
    submitted_command_seq: null,
    submission: null,
    result_summary: null,
    replay_capability: 'DECISION_RECORDS_PARTIAL',
    transition_semantics: 'STRUCTURED',
    created_at: new Date(2_000),
  };
  const opponentDecisionRow = {
    ...firstDecisionRow,
    decision_id: 'decision-opened-second',
    waiting_seat: 'SECOND',
    visible_candidates: [
      {
        cardId: 'opponent-secret-candidate',
        cardCode: 'SECRET-CARD',
        baseCardCode: 'SECRET',
        name: '对手隐藏候选',
      },
    ],
  };
  const accessRow = {
    match_id: 'match-read-1',
    room_code: 'READ1',
    status: 'IN_PROGRESS',
    completeness: 'PARTIAL',
    started_at: new Date(1_000),
    ended_at: null,
    sealed_at: null,
    winner_seat: null,
    end_reason: null,
    turn_count: authorityState!.turnCount,
    last_timeline_seq: 2,
    last_checkpoint_seq: 1,
    replay_capabilities: ['AUTHORITY_CHECKPOINT'],
    partial_reason: 'command_accepted append failed: database stack',
    viewer_seat: 'FIRST',
    viewer_player_id: 'p1',
    opponent_seat: 'SECOND',
    opponent_user_id: 'u2',
    opponent_display_name: 'Beta',
  };

  const client: MatchReplayReadQueryClient = {
    async query<T = unknown>(text: string, values: readonly unknown[] = []) {
      await Promise.resolve();
      if (text.includes('FROM match_records record')) {
        const requestedUserId = text.includes('record.match_id = $1') ? values[1] : values[0];
        return { rows: requestedUserId === 'u1' ? ([accessRow] as T[]) : [] };
      }
      if (text.includes('FROM match_participants')) {
        return {
          rows: [
            { seat: 'FIRST', user_id: 'u1', display_name: 'Alpha', player_id: 'p1' },
            { seat: 'SECOND', user_id: 'u2', display_name: 'Beta', player_id: 'p2' },
          ] as T[],
        };
      }
      if (text.includes('FROM match_deck_snapshots')) {
        return {
          rows: [
            {
              seat: 'FIRST',
              source_deck_id: 'deck-a',
              source_deck_name: 'Alpha Deck',
              source: 'ONLINE_RUNTIME_DECK',
              main_deck: ['A-MEM-1', 'A-LIVE-1'],
              energy_deck: ['A-ENE-1'],
              validation_state: 'RUNTIME_ACCEPTED',
              card_data_version: 'ONLINE_RUNTIME_CARD_DATA_SNAPSHOT',
              card_data_hash: 'sha256:cards',
              locked_at: new Date(900),
            },
          ] as T[],
        };
      }
      if (text.includes('FROM match_checkpoints')) {
        return {
          rows: [
            {
              checkpoint_seq: 1,
              timeline_seq: 2,
              checkpoint_type: 'AUTHORITY',
              related_public_seq: 3,
              related_command_seq: 1,
              related_game_event_seq: 4,
              turn_count: authorityState!.turnCount,
              phase: String(authorityState!.currentPhase),
              sub_phase: String(authorityState!.currentSubPhase),
              payload,
              payload_hash: payload.payloadHash,
              capabilities: ['AUTHORITY_CHECKPOINT'],
              created_at: new Date(2_000),
            },
          ] as T[],
        };
      }
      if (text.includes('FROM match_record_public_events')) {
        return { rows: [publicEventRow] as T[] };
      }
      if (text.includes('FROM match_record_private_events')) {
        return {
          rows: (values[1] === 'FIRST' ? [firstPrivateEventRow] : [secondPrivateEventRow]) as T[],
        };
      }
      if (text.includes('FROM match_decision_records')) {
        return {
          rows: (values[1] === 'FIRST' ? [firstDecisionRow] : [opponentDecisionRow]) as T[],
        };
      }
      if (text.includes('FROM match_timeline_entries')) {
        if (text.includes('timeline_seq = $2')) {
          return { rows: [timelineRow] as T[] };
        }
        if (text.includes('timeline_seq <= $2')) {
          return { rows: [initialTimelineRow, timelineRow] as T[] };
        }
        return { rows: [initialTimelineRow, timelineRow, opponentOnlyTimelineRow] as T[] };
      }
      return { rows: [] as T[] };
    },
  };

  return {
    authorityState: authorityState!,
    service: new MatchReplayReadService({ queryClient: client }),
  };
}

describe('MatchReplayReadService P1b', () => {
  it('列出当前用户历史对局，并只返回脱敏的不完整原因摘要', async () => {
    const { service } = createHarness();

    const records = await service.listMatchRecordsForUser('u1');

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      matchId: 'match-read-1',
      viewerSeat: 'FIRST',
      opponentDisplayName: 'Beta',
      partialReasonSummary: '记录不完整，部分回放节点可能缺失',
    });
    expect(JSON.stringify(records)).not.toContain('database stack');
  });

  it('从 authority checkpoint 复水为当前玩家视角，不返回权威 payload 或对手隐藏手牌', async () => {
    const { authorityState, service } = createHarness();
    const opponentHiddenCardId = authorityState.players[1].hand.cardIds[0];

    const replay = await service.getMatchRecordReplay('match-read-1', 'u1', 1);

    expect(replay?.viewerSeat).toBe('FIRST');
    expect(replay?.checkpointInfo.checkpointSeq).toBe(1);
    expect(replay?.playerViewState.match.viewerSeat).toBe('FIRST');
    expect(
      replay?.playerViewState.objects[createPublicObjectId(opponentHiddenCardId)]
    ).toBeUndefined();
    expect(JSON.stringify(replay)).not.toContain('payloadEnvelope');
    expect(JSON.stringify(replay)).not.toContain('AUTHORITY_GAME_STATE');
  });

  it('普通 timeline 与 replay 事件模型只暴露当前玩家可见事实', async () => {
    const { service } = createHarness();

    const timeline = await service.getMatchRecordTimeline('match-read-1', 'u1');
    const replay = await service.getMatchRecordReplay('match-read-1', 'u1', 1);

    expect(timeline?.timelineSummary.map((entry) => entry.timelineSeq)).toEqual([1, 2]);
    expect(timeline?.timelineSummary[1]).toMatchObject({
      relatedPrivateSeq: 2,
      relatedPrivateSeqForViewer: 2,
    });
    expect(JSON.stringify(timeline)).not.toContain('对手私有事件批次');
    expect(replay?.visibleEvents).toEqual([
      expect.objectContaining({
        timelineSeq: 2,
        eventSeq: 3,
        eventId: 'public-event-3',
        eventType: 'PhaseStarted',
      }),
    ]);
    expect(replay?.visibleEvents[0]?.payload).toMatchObject({ phase: 'MAIN' });
    expect(replay?.visiblePrivateEvents).toEqual([
      expect.objectContaining({
        timelineSeq: 2,
        eventSeq: 2,
        eventId: 'private-event-first-2',
        eventType: 'HandUpdated',
      }),
    ]);
    expect(replay?.visiblePrivateEvents[0]?.payload).toMatchObject({
      payload: { visibleHandObjectIds: ['self-card'] },
    });
    expect(replay?.visibleDecisions).toEqual([
      expect.objectContaining({
        decisionId: 'decision-opened-first',
        decisionType: 'ACTIVE_EFFECT_OPENED',
        status: 'OPENED',
        waitingSeat: 'FIRST',
        eventIds: ['event-1'],
        sourceBaseCardCode: 'PL!HS-bp1-006',
        stepId: 'select-card',
        visibleCandidates: [
          {
            cardId: 'candidate-1',
            cardCode: 'PL!HS-bp1-004-P',
            baseCardCode: 'PL!HS-bp1-004',
            name: '夕雾缀理',
          },
        ],
      }),
    ]);
    expect(JSON.stringify(replay)).not.toContain('opponent-secret-card');
    expect(JSON.stringify(replay)).not.toContain('opponent-secret-candidate');
  });

  it('非参与者不能读取历史详情', async () => {
    const { service } = createHarness();

    await expect(service.getMatchRecordDetail('match-read-1', 'u3')).resolves.toBeNull();
  });
});
