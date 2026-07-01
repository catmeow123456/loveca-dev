import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { GameCommandType, type GameCommand } from '../../src/application/game-commands';
import type { GameState } from '../../src/domain/entities/game';
import type { PlayerState } from '../../src/domain/entities/player';
import type {
  MatchDecisionSubmissionSummary,
  ReplaySerializedPayloadEnvelope,
} from '../../src/online/replay-types';
import { projectPlayerViewState } from '../../src/online/projector';
import { rehydrateAuthorityGameState } from '../../src/server/services/replay-payload-serialization';
import { GameMode, type SlotPosition, type SubPhase } from '../../src/shared/types/enums';

const LEGACY_FIXTURE_PATH =
  'data/20260627-cst_20260627T183253Z/loveca-match-replay-2026-06-27-cst-online-only.sql.gz';
const NORMALIZED_FIXTURE_PATH =
  'data/20260627-cst_20260627T183253Z/loveca-match-replay-2026-06-27-cst-online-only.normalized.sql.gz';
const REQUIRE_REAL_DATA = process.env.RUN_REAL_DATA_ONLINE === '1';
const STRICT_STAGE_CARD_STATES = process.env.REAL_DATA_STRICT_STAGE_CARD_STATES === '1';
const EXPLICIT_FIXTURE_PATH = process.env.REAL_DATA_ONLINE_FIXTURE;
const FIXTURE_PATH = EXPLICIT_FIXTURE_PATH
  ? EXPLICIT_FIXTURE_PATH
  : existsSync(NORMALIZED_FIXTURE_PATH)
    ? NORMALIZED_FIXTURE_PATH
    : LEGACY_FIXTURE_PATH;
const USING_NORMALIZED_FIXTURE = FIXTURE_PATH === NORMALIZED_FIXTURE_PATH;
const FIXTURE_EXISTS = existsSync(FIXTURE_PATH);
const describeRealData = FIXTURE_EXISTS || REQUIRE_REAL_DATA ? describe : describe.skip;
const LEGACY_REFRESH_AWARE_MILL_REPLAY_SKIP_REASON =
  'legacy fixture predates refresh-aware mill automation';
const LEGACY_CONFIRM_ONLY_LIVE_PENDING_REPLAY_SKIP_REASON =
  'legacy fixture predates confirm-only no-input LIVE pending replay';
const REFRESH_AWARE_MILL_ABILITY_IDS = new Set([
  'PL!HS-bp5-001-SEC:on-enter-mill-four-gain-blade-if-live',
  'PL!HS-bp1-008:on-enter-mill-three-draw-if-all-members',
]);

type CopyTable =
  | 'match_records'
  | 'match_deck_snapshots'
  | 'match_participants'
  | 'match_timeline_entries'
  | 'match_record_public_events'
  | 'match_record_private_events'
  | 'match_decision_records'
  | 'match_checkpoints';

interface CopyContext {
  readonly table: string;
  readonly columns: readonly string[];
}

interface MatchSummary {
  readonly matchId: string;
  readonly status: string | null;
  readonly completeness: string | null;
  readonly lastTimelineSeq: number;
  readonly lastCheckpointSeq: number;
}

interface ParticipantSummary {
  readonly matchId: string;
  readonly seat: string | null;
  readonly playerId: string;
}

interface TimelineSummary {
  readonly count: number;
  readonly maxSeq: number;
  readonly seqs: Set<number>;
  readonly frameTypes: Map<string, number>;
  readonly rejectedSummaries: string[];
}

interface StageCardStateDrift {
  readonly matchId: string;
  readonly playerId: string;
  readonly cardId: string;
  readonly cardCode: string | null;
  readonly cardName: string | null;
  readonly firstCheckpointSeq: number;
  readonly firstTimelineSeq: number;
  readonly lastCheckpointSeq: number;
  readonly occurrences: number;
  readonly firstActualZone: string;
  readonly lastActualZone: string;
}

interface StateResultMatchSummary {
  matchId: string;
  pairs: number;
  zonePairs: number;
  phasePairs: number;
  subPhasePairs: number;
  turnPairs: number;
  pendingPairs: number;
  activePairs: number;
  eventPairs: number;
  livePairs: number;
  publicPairs: number;
  privatePairs: number;
  actionPairs: number;
}

interface StateResultAudit {
  checkpointPairs: number;
  zonePairs: number;
  phasePairs: number;
  subPhasePairs: number;
  turnPairs: number;
  pendingPairs: number;
  activePairs: number;
  eventPairs: number;
  livePairs: number;
  publicPairs: number;
  privatePairs: number;
  actionPairs: number;
  maxEventLogLength: number;
  maxActionHistoryLength: number;
  perMatch: Map<string, StateResultMatchSummary>;
  checkpointGapCounts: Map<string, number>;
  stateDeltaLabels: Map<string, number>;
  zoneDeltaCounts: Map<string, number>;
  eventLogDeltaCounts: Map<string, number>;
  newGameEventTypes: Map<string, number>;
  newActionTypes: Map<string, number>;
  phaseTransitions: Map<string, number>;
  subPhaseTransitions: Map<string, number>;
  pendingAbilityCountTransitions: Map<string, number>;
  activeEffectTransitions: Map<string, number>;
  liveResolutionTransitions: Map<string, number>;
  publicEventDeltaCounts: Map<string, number>;
  privateEventDeltaCounts: Map<string, number>;
  issues: unknown[];
}

interface CheckpointStateSummary {
  readonly matchId: string;
  readonly checkpointSeq: number;
  readonly timelineSeq: number;
  readonly relatedPublicSeq: number | null;
  readonly turnCount: number;
  readonly phase: string;
  readonly subPhase: string;
  readonly zoneCountsByPlayer: Record<string, Record<string, number>>;
  readonly pendingAbilityCount: number;
  readonly activeEffectKey: string;
  readonly liveResolutionKey: string;
  readonly eventLogLength: number;
  readonly actionHistoryLength: number;
}

interface CheckpointRecord {
  readonly matchId: string;
  readonly checkpointSeq: number;
  readonly timelineSeq: number;
  readonly relatedPublicSeq: number | null;
  readonly relatedCommandSeq: number | null;
  readonly relatedGameEventSeq: number | null;
  readonly turnCount: number;
  readonly phase: string;
  readonly subPhase: string;
  readonly state: GameState;
}

interface DecisionRecordSummary {
  readonly matchId: string;
  readonly decisionId: string;
  readonly timelineSeq: number;
  readonly decisionType: string;
  readonly status: string;
  readonly playerId: string | null;
  readonly sourceCardObjectId: string | null;
  readonly sourceZone: string | null;
  readonly sourceSlot: string | null;
  readonly abilityId: string | null;
  readonly stepId: string | null;
  readonly openedCheckpointSeq: number | null;
  readonly submittedCommandSeq: number | null;
  readonly submission: MatchDecisionSubmissionSummary | null;
}

interface EngineReplayAudit {
  readonly replayedCount: number;
  readonly skippedCount: number;
  readonly failedExecutions: unknown[];
  readonly mismatches: unknown[];
  readonly replayedByDecisionType: Map<string, number>;
  readonly replayedByCommandType: Map<string, number>;
  readonly skippedReasons: Map<string, number>;
}

interface FixtureAudit {
  readonly tableRows: Record<CopyTable, number>;
  readonly matches: Map<string, MatchSummary>;
  readonly participantsByMatch: Map<string, ParticipantSummary[]>;
  readonly timelineByMatch: Map<string, TimelineSummary>;
  readonly publicEventTypes: Map<string, number>;
  readonly privateEventTypes: Map<string, number>;
  readonly decisionStatuses: Map<string, number>;
  readonly checkpointCount: number;
  readonly rehydratedCheckpointCount: number;
  readonly projectedViewCount: number;
  readonly duplicateLocationIssues: unknown[];
  readonly missingLocationIssues: unknown[];
  readonly registryCardCountIssues: unknown[];
  readonly checkpointMismatchIssues: unknown[];
  readonly stageCardStateDrift: StageCardStateDrift[];
  readonly stateResults: StateResultAudit;
  readonly engineReplay: EngineReplayAudit;
  readonly parseIssues: string[];
  readonly fixedCopyTerminatorCount: number;
}

let fixtureAuditPromise: Promise<FixtureAudit> | null = null;

describeRealData('real online replay data harness: 2026-06-27 CST online-only', () => {
  it('parses the SQL gzip export and validates record-level continuity', async () => {
    expect(FIXTURE_EXISTS, `${FIXTURE_PATH} is required for real-data replay harness`).toBe(true);
    const audit = await getFixtureAudit();

    expect(audit.parseIssues).toEqual([]);
    expect(audit.fixedCopyTerminatorCount).toBe(USING_NORMALIZED_FIXTURE ? 0 : 9);
    expect(audit.tableRows).toEqual({
      match_records: 6,
      match_deck_snapshots: 12,
      match_participants: 12,
      match_timeline_entries: 896,
      match_record_public_events: 2214,
      match_record_private_events: 38,
      match_decision_records: 470,
      match_checkpoints: 736,
    });
    expect(countBy(audit.matches.values(), (match) => match.status ?? 'NULL')).toEqual(
      new Map([
        ['COMPLETED', 4],
        ['IN_PROGRESS', 1],
        ['INTERRUPTED', 1],
      ])
    );
    expect(
      [...audit.matches.values()].filter((match) => match.completeness === 'FULL')
    ).toHaveLength(5);
    expect(
      [...audit.matches.values()].filter((match) => match.completeness === 'PARTIAL')
    ).toHaveLength(1);

    for (const [matchId, timeline] of audit.timelineByMatch) {
      expect(timeline.count, `${matchId} timeline row count should match max seq`).toBe(
        timeline.maxSeq
      );
      for (let seq = 1; seq <= timeline.maxSeq; seq += 1) {
        expect(timeline.seqs.has(seq), `${matchId} missing timeline seq ${seq}`).toBe(true);
      }
    }
    expect(audit.timelineByMatch.size).toBe(6);
    expect(sumMap(audit.timelineByMatch, (timeline) => timeline.count)).toBe(896);

    expect(plainRecord(sumFrameTypes(audit.timelineByMatch))).toEqual({
      COMMAND_ACCEPTED: 871,
      COMMAND_REJECTED: 11,
      MATCH_INITIALIZED: 6,
      MATCH_SEALED: 5,
      UNDO_ACCEPTED: 1,
      UNDO_APPLIED: 1,
      UNDO_REQUESTED: 1,
    });
    expect(plainRecord(audit.publicEventTypes)).toEqual({
      CardMovedPublic: 341,
      CardRevealed: 3,
      CardRevealedAndMoved: 93,
      CardsInspectedSummary: 26,
      DeckRefreshed: 8,
      PhaseStarted: 289,
      PlayerDeclared: 834,
      SubPhaseStarted: 257,
      WindowStatusChanged: 363,
    });
    expect(plainRecord(audit.privateEventTypes)).toEqual({
      INSPECTION_CANDIDATES: 26,
      MULLIGAN_RESOLVED: 12,
    });
    expect(plainRecord(audit.decisionStatuses)).toEqual({
      'ACTIVATE_ABILITY_SUBMITTED:SUBMITTED': 28,
      'ACTIVE_EFFECT_OPENED:OPENED': 112,
      'ACTIVE_EFFECT_SUBMITTED:SUBMITTED': 161,
      'MULLIGAN_SUBMITTED:SUBMITTED': 12,
      'PENDING_ABILITY_ORDER_SUBMITTED:SUBMITTED': 24,
      'SELECT_SUCCESS_LIVE_SUBMITTED:SUBMITTED': 17,
      'SET_LIVE_CARD_SUBMITTED:SUBMITTED': 116,
    });

    const rejectedSummaries = [...audit.timelineByMatch.values()].flatMap(
      (timeline) => timeline.rejectedSummaries
    );
    expect(rejectedSummaries).toHaveLength(11);
    if (EXPLICIT_FIXTURE_PATH) {
      expect(rejectedSummaries.every((summary) => summary !== '命令被拒绝')).toBe(true);
    }
  }, 120_000);

  it('rehydrates all checkpoints, projects both player views, and checks card ownership invariants', async () => {
    expect(FIXTURE_EXISTS, `${FIXTURE_PATH} is required for real-data replay harness`).toBe(true);
    const audit = await getFixtureAudit();

    expect(audit.checkpointCount).toBe(736);
    expect(audit.rehydratedCheckpointCount).toBe(736);
    expect(audit.projectedViewCount).toBe(1472);
    expect(audit.checkpointMismatchIssues).toEqual([]);
    expect(audit.registryCardCountIssues).toEqual([]);
    expect(audit.duplicateLocationIssues).toEqual([]);
    expect(audit.missingLocationIssues).toEqual([]);
  }, 120_000);

  it('validates state-result transitions between consecutive authority checkpoints', async () => {
    expect(FIXTURE_EXISTS, `${FIXTURE_PATH} is required for real-data replay harness`).toBe(true);
    const audit = await getFixtureAudit();
    const stateResults = audit.stateResults;

    expect(stateResults.issues).toEqual([]);
    expect(stateResults.checkpointPairs).toBe(730);
    expect(stateResults.zonePairs).toBe(499);
    expect(stateResults.phasePairs).toBe(104);
    expect(stateResults.subPhasePairs).toBe(257);
    expect(stateResults.turnPairs).toBe(21);
    expect(stateResults.pendingPairs).toBe(75);
    expect(stateResults.activePairs).toBe(239);
    expect(stateResults.eventPairs).toBe(254);
    expect(stateResults.livePairs).toBe(213);
    expect(stateResults.publicPairs).toBe(730);
    expect(stateResults.privatePairs).toBe(27);
    expect(stateResults.actionPairs).toBe(722);
    expect(stateResults.maxEventLogLength).toBe(114);
    expect(stateResults.maxActionHistoryLength).toBe(517);

    expect(plainRecord(stateResults.checkpointGapCounts)).toEqual({ '1': 730 });
    expect(plainRecord(stateResults.phaseTransitions)).toEqual({
      'LIVE_RESULT_PHASE->GAME_END': 4,
      'LIVE_RESULT_PHASE->MAIN_PHASE': 21,
      'LIVE_SET_PHASE->LIVE_RESULT_PHASE': 2,
      'LIVE_SET_PHASE->PERFORMANCE_PHASE': 23,
      'MAIN_PHASE->LIVE_SET_PHASE': 25,
      'MULLIGAN_PHASE->MAIN_PHASE': 6,
      'PERFORMANCE_PHASE->LIVE_RESULT_PHASE': 23,
    });
    expect(plainRecord(stateResults.subPhaseTransitions)).toEqual({
      'LIVE_SET_FIRST_PLAYER->LIVE_SET_SECOND_PLAYER': 25,
      'LIVE_SET_SECOND_PLAYER->PERFORMANCE_LIVE_START_EFFECTS': 23,
      'LIVE_SET_SECOND_PLAYER->RESULT_SCORE_CONFIRM': 2,
      'MULLIGAN_FIRST_PLAYER->MULLIGAN_SECOND_PLAYER': 6,
      'MULLIGAN_SECOND_PLAYER->NONE': 6,
      'NONE->LIVE_SET_FIRST_PLAYER': 25,
      'PERFORMANCE_JUDGMENT->PERFORMANCE_LIVE_START_EFFECTS': 14,
      'PERFORMANCE_JUDGMENT->RESULT_FIRST_SUCCESS_EFFECTS': 15,
      'PERFORMANCE_JUDGMENT->RESULT_SCORE_CONFIRM': 1,
      'PERFORMANCE_JUDGMENT->RESULT_SECOND_SUCCESS_EFFECTS': 7,
      'PERFORMANCE_LIVE_START_EFFECTS->PERFORMANCE_JUDGMENT': 37,
      'RESULT_ANIMATION->RESULT_SETTLEMENT': 22,
      'RESULT_FIRST_SUCCESS_EFFECTS->RESULT_SCORE_CONFIRM': 6,
      'RESULT_FIRST_SUCCESS_EFFECTS->RESULT_SECOND_SUCCESS_EFFECTS': 9,
      'RESULT_SCORE_CONFIRM->NONE': 3,
      'RESULT_SCORE_CONFIRM->RESULT_ANIMATION': 22,
      'RESULT_SECOND_SUCCESS_EFFECTS->RESULT_SCORE_CONFIRM': 16,
      'RESULT_SETTLEMENT->NONE': 18,
    });
    expect(plainRecord(stateResults.pendingAbilityCountTransitions)).toEqual({
      '0->1': 2,
      '0->2': 15,
      '0->3': 5,
      '0->4': 3,
      '1->0': 16,
      '2->0': 9,
      '2->1': 14,
      '3->2': 8,
      '4->3': 3,
    });
    expect(plainRecord(stateResults.eventLogDeltaCounts)).toEqual({
      '+1': 189,
      '+2': 50,
      '+3': 12,
      '+4': 2,
      '+5': 1,
    });
    expect(plainRecord(stateResults.newGameEventTypes)).toEqual({
      ON_CHEER: 43,
      ON_ENTER_STAGE: 101,
      ON_ENTER_WAITING_ROOM: 33,
      ON_LEAVE_STAGE: 73,
      ON_LIVE_START: 37,
      ON_LIVE_SUCCESS: 30,
      ON_MEMBER_SLOT_MOVED: 4,
      ON_MEMBER_STATE_CHANGED: 17,
    });
    expect(plainRecord(stateResults.newActionTypes)).toEqual({
      CHEER: 43,
      DRAW_CARD: 12,
      LIVE_JUDGMENT: 112,
      MOVE_CARD: 22,
      PAY_COST: 79,
      PHASE_CHANGE: 502,
      PLAY_MEMBER: 91,
      RESOLVE_ABILITY: 364,
      RULE_ACTION: 71,
      SET_LIVE_CARD: 116,
      TAP_ENERGY: 19,
      TAP_MEMBER: 7,
      TRIGGER_ABILITY: 127,
    });
    expect(plainRecord(stateResults.publicEventDeltaCounts)).toEqual({
      '1': 202,
      '2': 169,
      '3': 179,
      '4': 75,
      '5': 19,
      '6': 25,
      '7': 10,
      '8': 34,
      '9': 6,
      '10': 1,
      '11': 1,
      '12': 1,
      '14': 1,
      '15': 5,
      '20': 1,
      '51': 1,
    });
    expect(plainRecord(stateResults.privateEventDeltaCounts)).toEqual({
      '1': 19,
      '2': 5,
      '3': 3,
    });

    expect(stateResults.zoneDeltaCounts.get('hand:-1')).toBe(202);
    expect(stateResults.zoneDeltaCounts.get('liveZone:+1')).toBe(116);
    expect(stateResults.zoneDeltaCounts.get('mainDeck:-1')).toBe(85);
    expect(stateResults.zoneDeltaCounts.get('energyDeck:-1')).toBe(54);
    expect(stateResults.zoneDeltaCounts.get('energyZone:+1')).toBe(54);
    expect(stateResults.zoneDeltaCounts.get('successZone:+1')).toBe(17);
    expect(stateResults.zoneDeltaCounts.get('memberSlot:-1')).toBe(16);
    expect(stateResults.zoneDeltaCounts.get('memberSlot:+1')).toBe(42);
    expect(
      stateResults.liveResolutionTransitions.get(
        'in:false|perf:0|cheer:0|results:0|scores:0|mods:0|winners:0|successMoved:0->in:true|perf:1|cheer:0|results:0|scores:0|mods:0|winners:0|successMoved:0'
      )
    ).toBe(18);
    expect(
      stateResults.liveResolutionTransitions.get(
        'in:true|perf:1|cheer:3|results:2|scores:2|mods:0|winners:0|successMoved:0->in:true|perf:1|cheer:3|results:2|scores:2|mods:0|winners:1|successMoved:0'
      )
    ).toBe(2);
    expect(sumMap(stateResults.perMatch, (match) => match.pairs)).toBe(730);
  }, 120_000);

  it('replays structured real decisions through GameSession and compares engine results', async () => {
    expect(FIXTURE_EXISTS, `${FIXTURE_PATH} is required for real-data replay harness`).toBe(true);
    const audit = await getFixtureAudit();
    const replay = audit.engineReplay;
    if (process.env.DEBUG_REAL_DATA_REPLAY === '1') {
      console.info(
        JSON.stringify({
          replayedCount: replay.replayedCount,
          skippedCount: replay.skippedCount,
          replayedByDecisionType: plainRecord(replay.replayedByDecisionType),
          replayedByCommandType: plainRecord(replay.replayedByCommandType),
          skippedReasons: plainRecord(replay.skippedReasons),
        })
      );
    }

    expect(replay.failedExecutions).toEqual([]);
    expect(replay.mismatches).toEqual([]);
    expect(replay.replayedCount).toBe(242);
    expect(replay.skippedCount).toBe(228);
    expect(plainRecord(replay.replayedByDecisionType)).toEqual({
      ACTIVE_EFFECT_SUBMITTED: 94,
      PENDING_ABILITY_ORDER_SUBMITTED: 17,
      SELECT_SUCCESS_LIVE_SUBMITTED: 17,
      SET_LIVE_CARD_SUBMITTED: 114,
    });
    expect(plainRecord(replay.replayedByCommandType)).toEqual({
      CONFIRM_EFFECT_STEP: 111,
      SELECT_SUCCESS_LIVE: 17,
      SET_LIVE_CARD: 114,
    });
    expect(plainRecord(replay.skippedReasons)).toEqual({
      'legacy fixture lacks exact before checkpoint for command replay': 31,
      'legacy fixture lacks recorded randomness for mulligan replay': 12,
      'legacy fixture lacks reliable before checkpoint for activate ability': 28,
      [LEGACY_CONFIRM_ONLY_LIVE_PENDING_REPLAY_SKIP_REASON]: 32,
      [LEGACY_REFRESH_AWARE_MILL_REPLAY_SKIP_REASON]: 13,
      'not a submitted player decision': 112,
    });
  }, 120_000);

  it('tracks member slot cardStates drift exposed by the legacy fixture', async () => {
    expect(FIXTURE_EXISTS, `${FIXTURE_PATH} is required for real-data replay harness`).toBe(true);
    const audit = await getFixtureAudit();

    if (STRICT_STAGE_CARD_STATES) {
      expect(audit.stageCardStateDrift).toEqual([]);
      return;
    }

    if (USING_NORMALIZED_FIXTURE) {
      expect(audit.stageCardStateDrift).toEqual([]);
      return;
    }

    // This legacy fixture was recorded before SEND_SOURCE_MEMBER_TO_WAITING_ROOM cleaned
    // cardStates. Keep the baseline explicit until normalized/new fixtures replace it.
    expect(audit.stageCardStateDrift).toHaveLength(20);
    expect(countBy(audit.stageCardStateDrift, (issue) => issue.matchId)).toEqual(
      new Map([
        ['141b4077-aece-4bd6-88d9-260377e0be66', 2],
        ['19ae1b01-34bd-4971-945f-1f09f00d449f', 8],
        ['2e9d5824-f556-4e69-8883-8ef97637d70e', 2],
        ['41ff57df-55c2-4a29-bdba-ef78f1c9e3a7', 4],
        ['5b04e51d-91b0-430c-ae32-325f9ad0a3a6', 4],
      ])
    );
  }, 120_000);
});

async function getFixtureAudit(): Promise<FixtureAudit> {
  fixtureAuditPromise ??= loadFixtureAudit();
  return fixtureAuditPromise;
}

async function loadFixtureAudit(): Promise<FixtureAudit> {
  const tableRows = createTableRowCounter();
  const matches = new Map<string, MatchSummary>();
  const participantsByMatch = new Map<string, ParticipantSummary[]>();
  const timelineByMatch = new Map<string, TimelineSummary>();
  const publicEventTypes = new Map<string, number>();
  const privateEventTypes = new Map<string, number>();
  const decisionStatuses = new Map<string, number>();
  const checkpointMismatchIssues: unknown[] = [];
  const duplicateLocationIssues: unknown[] = [];
  const missingLocationIssues: unknown[] = [];
  const registryCardCountIssues: unknown[] = [];
  const stageCardStateDriftByKey = new Map<string, StageCardStateDrift>();
  const publicEventsByTimelineKey = new Map<string, number>();
  const privateEventsByTimelineKey = new Map<string, number>();
  const stateResults = createStateResultAudit();
  const previousCheckpointsByMatch = new Map<string, CheckpointStateSummary>();
  const checkpoints: CheckpointRecord[] = [];
  const decisions: DecisionRecordSummary[] = [];
  const parseIssues: string[] = [];
  let fixedCopyTerminatorCount = 0;
  let checkpointCount = 0;
  let rehydratedCheckpointCount = 0;
  let projectedViewCount = 0;
  let currentCopy: CopyContext | null = null;

  const input = createReadStream(FIXTURE_PATH).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    const copyHeader = parseCopyHeader(line);
    if (copyHeader) {
      currentCopy = copyHeader;
      continue;
    }

    if (!currentCopy) {
      continue;
    }

    if (isCopyTerminator(line)) {
      if (line === '\\\\.') {
        fixedCopyTerminatorCount += 1;
      }
      currentCopy = null;
      continue;
    }

    if (!isTrackedCopyTable(currentCopy.table)) {
      continue;
    }

    tableRows[currentCopy.table] += 1;
    const row = mapCopyRow(currentCopy.columns, line);
    if (!row) {
      parseIssues.push(`Could not parse ${currentCopy.table} row`);
      continue;
    }

    switch (currentCopy.table) {
      case 'match_records':
        readMatchRecord(row, matches);
        break;
      case 'match_participants':
        readParticipant(row, participantsByMatch);
        break;
      case 'match_timeline_entries':
        readTimelineEntry(row, timelineByMatch);
        break;
      case 'match_record_public_events':
        increment(publicEventTypes, readRequired(row, 'event_type'));
        increment(publicEventsByTimelineKey, timelineEventKey(row));
        break;
      case 'match_record_private_events':
        increment(privateEventTypes, readRequired(row, 'event_type'));
        increment(privateEventsByTimelineKey, timelineEventKey(row));
        break;
      case 'match_decision_records':
        increment(
          decisionStatuses,
          `${readRequired(row, 'decision_type')}:${readRequired(row, 'status')}`
        );
        decisions.push(readDecisionRecord(row));
        break;
      case 'match_checkpoints': {
        checkpointCount += 1;
        const checkpointResult = readCheckpoint(row);
        if (!checkpointResult.ok) {
          parseIssues.push(checkpointResult.error);
          break;
        }

        const { state } = checkpointResult;
        checkpoints.push(checkpointResult);
        rehydratedCheckpointCount += 1;
        if (
          state.gameId !== checkpointResult.matchId ||
          state.turnCount !== checkpointResult.turnCount ||
          String(state.currentPhase) !== checkpointResult.phase ||
          String(state.currentSubPhase) !== checkpointResult.subPhase
        ) {
          checkpointMismatchIssues.push({
            matchId: checkpointResult.matchId,
            checkpointSeq: checkpointResult.checkpointSeq,
            timelineSeq: checkpointResult.timelineSeq,
            stateGameId: state.gameId,
            stateTurnCount: state.turnCount,
            statePhase: String(state.currentPhase),
            stateSubPhase: String(state.currentSubPhase),
          });
        }

        const participants = participantsByMatch.get(checkpointResult.matchId) ?? [];
        for (const participant of participants) {
          projectPlayerViewState(state, participant.playerId, {
            seq: checkpointResult.relatedPublicSeq ?? 0,
            gameMode: GameMode.ONLINE,
          });
          projectedViewCount += 1;
        }

        collectCardOwnershipIssues(state, checkpointResult, {
          duplicateLocationIssues,
          missingLocationIssues,
          registryCardCountIssues,
          stageCardStateDriftByKey,
        });
        collectStateResultAudit(stateResults, checkpointResult, {
          publicEventsByTimelineKey,
          privateEventsByTimelineKey,
          previousCheckpointsByMatch,
        });
        break;
      }
      case 'match_deck_snapshots':
        break;
    }
  }

  return {
    tableRows,
    matches,
    participantsByMatch,
    timelineByMatch,
    publicEventTypes,
    privateEventTypes,
    decisionStatuses,
    checkpointCount,
    rehydratedCheckpointCount,
    projectedViewCount,
    duplicateLocationIssues,
    missingLocationIssues,
    registryCardCountIssues,
    checkpointMismatchIssues,
    stageCardStateDrift: [...stageCardStateDriftByKey.values()].sort((left, right) =>
      left.matchId === right.matchId
        ? left.firstCheckpointSeq - right.firstCheckpointSeq
        : left.matchId.localeCompare(right.matchId)
    ),
    stateResults,
    engineReplay: buildEngineReplayAudit(checkpoints, decisions),
    parseIssues,
    fixedCopyTerminatorCount,
  };
}

function parseCopyHeader(line: string): CopyContext | null {
  const match = line.match(/^COPY (?:public|pg_temp)\.([a-z_]+) \((.*)\) FROM stdin;$/);
  if (!match) {
    return null;
  }

  return {
    table: match[1],
    columns: match[2].split(', '),
  };
}

function isCopyTerminator(line: string): boolean {
  return line === '\\.' || line === '\\\\.';
}

function isTrackedCopyTable(table: string): table is CopyTable {
  return (
    table === 'match_records' ||
    table === 'match_deck_snapshots' ||
    table === 'match_participants' ||
    table === 'match_timeline_entries' ||
    table === 'match_record_public_events' ||
    table === 'match_record_private_events' ||
    table === 'match_decision_records' ||
    table === 'match_checkpoints'
  );
}

function mapCopyRow(
  columns: readonly string[],
  line: string
): Record<string, string | null> | null {
  const fields = splitPostgresCopyTextRow(line);
  if (fields.length !== columns.length) {
    return null;
  }

  return Object.fromEntries(columns.map((column, index) => [column, fields[index]]));
}

function splitPostgresCopyTextRow(line: string): (string | null)[] {
  return line
    .split('\t')
    .map((field) => (field === '\\N' ? null : unescapePostgresCopyText(field)));
}

function unescapePostgresCopyText(field: string): string {
  let result = '';
  for (let index = 0; index < field.length; index += 1) {
    const char = field[index];
    if (char !== '\\') {
      result += char;
      continue;
    }

    index += 1;
    if (index >= field.length) {
      result += '\\';
      break;
    }

    const escaped = field[index];
    switch (escaped) {
      case 'b':
        result += '\b';
        break;
      case 'f':
        result += '\f';
        break;
      case 'n':
        result += '\n';
        break;
      case 'r':
        result += '\r';
        break;
      case 't':
        result += '\t';
        break;
      case 'v':
        result += '\v';
        break;
      case '\\':
        result += '\\';
        break;
      default:
        result += escaped;
        break;
    }
  }
  return result;
}

function readMatchRecord(
  row: Record<string, string | null>,
  matches: Map<string, MatchSummary>
): void {
  const matchId = readRequired(row, 'match_id');
  matches.set(matchId, {
    matchId,
    status: row.status,
    completeness: row.completeness,
    lastTimelineSeq: readNumber(row, 'last_timeline_seq'),
    lastCheckpointSeq: readNumber(row, 'last_checkpoint_seq'),
  });
}

function readParticipant(
  row: Record<string, string | null>,
  participantsByMatch: Map<string, ParticipantSummary[]>
): void {
  const matchId = readRequired(row, 'match_id');
  const participants = participantsByMatch.get(matchId) ?? [];
  participants.push({
    matchId,
    seat: row.seat,
    playerId: readRequired(row, 'player_id'),
  });
  participantsByMatch.set(matchId, participants);
}

function readTimelineEntry(
  row: Record<string, string | null>,
  timelineByMatch: Map<string, TimelineSummary>
): void {
  const matchId = readRequired(row, 'match_id');
  const timeline =
    timelineByMatch.get(matchId) ??
    ({
      count: 0,
      maxSeq: 0,
      seqs: new Set<number>(),
      frameTypes: new Map<string, number>(),
      rejectedSummaries: [],
    } satisfies TimelineSummary);
  const timelineSeq = readNumber(row, 'timeline_seq');
  const frameType = readRequired(row, 'frame_type');
  timeline.seqs.add(timelineSeq);
  increment(timeline.frameTypes, frameType);
  if (frameType === 'COMMAND_REJECTED') {
    timeline.rejectedSummaries.push(readRequired(row, 'summary'));
  }
  timelineByMatch.set(matchId, {
    ...timeline,
    count: timeline.count + 1,
    maxSeq: Math.max(timeline.maxSeq, timelineSeq),
  });
}

function readCheckpoint(row: Record<string, string | null>):
  | {
      readonly ok: true;
      readonly matchId: string;
      readonly checkpointSeq: number;
      readonly timelineSeq: number;
      readonly relatedPublicSeq: number | null;
      readonly relatedCommandSeq: number | null;
      readonly relatedGameEventSeq: number | null;
      readonly turnCount: number;
      readonly phase: string;
      readonly subPhase: string;
      readonly state: GameState;
    }
  | { readonly ok: false; readonly error: string } {
  try {
    const payload = JSON.parse(readRequired(row, 'payload')) as ReplaySerializedPayloadEnvelope;
    const payloadHash = readRequired(row, 'payload_hash');
    if (payload.payloadHash !== payloadHash) {
      return {
        ok: false,
        error: `checkpoint payload_hash mismatch for ${readRequired(row, 'match_id')}#${readRequired(
          row,
          'checkpoint_seq'
        )}`,
      };
    }

    return {
      ok: true,
      matchId: readRequired(row, 'match_id'),
      checkpointSeq: readNumber(row, 'checkpoint_seq'),
      timelineSeq: readNumber(row, 'timeline_seq'),
      relatedPublicSeq: readNullableNumber(row, 'related_public_seq'),
      relatedCommandSeq: readNullableNumber(row, 'related_command_seq'),
      relatedGameEventSeq: readNullableNumber(row, 'related_game_event_seq'),
      turnCount: readNumber(row, 'turn_count'),
      phase: readRequired(row, 'phase'),
      subPhase: readRequired(row, 'sub_phase'),
      state: rehydrateAuthorityGameState(payload),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function readDecisionRecord(row: Record<string, string | null>): DecisionRecordSummary {
  return {
    matchId: readRequired(row, 'match_id'),
    decisionId: readRequired(row, 'decision_id'),
    timelineSeq: readNumber(row, 'timeline_seq'),
    decisionType: readRequired(row, 'decision_type'),
    status: readRequired(row, 'status'),
    playerId: row.player_id,
    sourceCardObjectId: row.source_card_object_id,
    sourceZone: row.source_zone,
    sourceSlot: row.source_slot,
    abilityId: row.ability_id,
    stepId: row.step_id,
    openedCheckpointSeq: readNullableNumber(row, 'opened_checkpoint_seq'),
    submittedCommandSeq: readNullableNumber(row, 'submitted_command_seq'),
    submission: row.submission
      ? (JSON.parse(row.submission) as MatchDecisionSubmissionSummary)
      : null,
  };
}

function collectCardOwnershipIssues(
  state: GameState,
  checkpoint: {
    readonly matchId: string;
    readonly checkpointSeq: number;
    readonly timelineSeq: number;
  },
  output: {
    readonly duplicateLocationIssues: unknown[];
    readonly missingLocationIssues: unknown[];
    readonly registryCardCountIssues: unknown[];
    readonly stageCardStateDriftByKey: Map<string, StageCardStateDrift>;
  }
): void {
  for (const player of state.players) {
    const ownedCards = [...state.cardRegistry.values()].filter(
      (card) => card.ownerId === player.id
    );
    if (ownedCards.length !== 72) {
      output.registryCardCountIssues.push({
        matchId: checkpoint.matchId,
        checkpointSeq: checkpoint.checkpointSeq,
        playerId: player.id,
        count: ownedCards.length,
      });
    }

    for (const card of ownedCards) {
      const locations = findCardLocations(state, player, card.instanceId);
      if (locations.length === 0) {
        output.missingLocationIssues.push({
          matchId: checkpoint.matchId,
          checkpointSeq: checkpoint.checkpointSeq,
          playerId: player.id,
          cardId: card.instanceId,
          cardCode: card.data.cardCode,
        });
      } else if (locations.length > 1) {
        output.duplicateLocationIssues.push({
          matchId: checkpoint.matchId,
          checkpointSeq: checkpoint.checkpointSeq,
          playerId: player.id,
          cardId: card.instanceId,
          cardCode: card.data.cardCode,
          locations,
        });
      }
    }

    const slottedMemberIds = new Set(
      Object.values(player.memberSlots.slots).filter((cardId): cardId is string => cardId !== null)
    );
    for (const cardId of player.memberSlots.cardStates.keys()) {
      if (slottedMemberIds.has(cardId)) {
        continue;
      }

      const card = state.cardRegistry.get(cardId);
      const key = `${checkpoint.matchId}|${player.id}|${cardId}`;
      const actualZone = findCardLocations(state, player, cardId)[0] ?? 'unknown';
      const existing = output.stageCardStateDriftByKey.get(key);
      if (existing) {
        output.stageCardStateDriftByKey.set(key, {
          ...existing,
          lastCheckpointSeq: checkpoint.checkpointSeq,
          occurrences: existing.occurrences + 1,
          lastActualZone: actualZone,
        });
      } else {
        output.stageCardStateDriftByKey.set(key, {
          matchId: checkpoint.matchId,
          playerId: player.id,
          cardId,
          cardCode: card?.data.cardCode ?? null,
          cardName: card?.data.name ?? null,
          firstCheckpointSeq: checkpoint.checkpointSeq,
          firstTimelineSeq: checkpoint.timelineSeq,
          lastCheckpointSeq: checkpoint.checkpointSeq,
          occurrences: 1,
          firstActualZone: actualZone,
          lastActualZone: actualZone,
        });
      }
    }
  }
}

function createStateResultAudit(): StateResultAudit {
  return {
    checkpointPairs: 0,
    zonePairs: 0,
    phasePairs: 0,
    subPhasePairs: 0,
    turnPairs: 0,
    pendingPairs: 0,
    activePairs: 0,
    eventPairs: 0,
    livePairs: 0,
    publicPairs: 0,
    privatePairs: 0,
    actionPairs: 0,
    maxEventLogLength: 0,
    maxActionHistoryLength: 0,
    perMatch: new Map(),
    checkpointGapCounts: new Map(),
    stateDeltaLabels: new Map(),
    zoneDeltaCounts: new Map(),
    eventLogDeltaCounts: new Map(),
    newGameEventTypes: new Map(),
    newActionTypes: new Map(),
    phaseTransitions: new Map(),
    subPhaseTransitions: new Map(),
    pendingAbilityCountTransitions: new Map(),
    activeEffectTransitions: new Map(),
    liveResolutionTransitions: new Map(),
    publicEventDeltaCounts: new Map(),
    privateEventDeltaCounts: new Map(),
    issues: [],
  };
}

function collectStateResultAudit(
  audit: StateResultAudit,
  checkpoint: {
    readonly matchId: string;
    readonly checkpointSeq: number;
    readonly timelineSeq: number;
    readonly relatedPublicSeq: number | null;
    readonly turnCount: number;
    readonly phase: string;
    readonly subPhase: string;
    readonly state: GameState;
  },
  context: {
    readonly publicEventsByTimelineKey: Map<string, number>;
    readonly privateEventsByTimelineKey: Map<string, number>;
    readonly previousCheckpointsByMatch: Map<string, CheckpointStateSummary>;
  }
): void {
  const summary = summarizeCheckpointState(checkpoint);
  audit.maxEventLogLength = Math.max(audit.maxEventLogLength, summary.eventLogLength);
  audit.maxActionHistoryLength = Math.max(
    audit.maxActionHistoryLength,
    summary.actionHistoryLength
  );

  const previous = context.previousCheckpointsByMatch.get(checkpoint.matchId);
  if (!previous) {
    context.previousCheckpointsByMatch.set(checkpoint.matchId, summary);
    ensureStateResultMatchSummary(audit, checkpoint.matchId);
    return;
  }

  audit.checkpointPairs += 1;
  const matchSummary = ensureStateResultMatchSummary(audit, checkpoint.matchId);
  matchSummary.pairs += 1;

  const labels: string[] = [];
  increment(audit.checkpointGapCounts, String(summary.checkpointSeq - previous.checkpointSeq));

  if (summary.timelineSeq <= previous.timelineSeq) {
    audit.issues.push({
      matchId: summary.matchId,
      checkpointSeq: summary.checkpointSeq,
      previousTimelineSeq: previous.timelineSeq,
      timelineSeq: summary.timelineSeq,
      issue: 'timeline seq did not advance',
    });
  }
  if (
    previous.relatedPublicSeq !== null &&
    summary.relatedPublicSeq !== null &&
    summary.relatedPublicSeq < previous.relatedPublicSeq
  ) {
    audit.issues.push({
      matchId: summary.matchId,
      checkpointSeq: summary.checkpointSeq,
      previousPublicSeq: previous.relatedPublicSeq,
      publicSeq: summary.relatedPublicSeq,
      issue: 'related public seq moved backwards',
    });
  }

  if (summary.phase !== previous.phase) {
    audit.phasePairs += 1;
    matchSummary.phasePairs += 1;
    labels.push('phase');
    increment(audit.phaseTransitions, `${previous.phase}->${summary.phase}`);
  }

  if (summary.subPhase !== previous.subPhase) {
    audit.subPhasePairs += 1;
    matchSummary.subPhasePairs += 1;
    labels.push('subPhase');
    increment(audit.subPhaseTransitions, `${previous.subPhase}->${summary.subPhase}`);
  }

  if (summary.turnCount !== previous.turnCount) {
    audit.turnPairs += 1;
    matchSummary.turnPairs += 1;
    labels.push('turn');
  }

  const zoneDeltas = compareZoneCountSummaries(
    previous.zoneCountsByPlayer,
    summary.zoneCountsByPlayer
  );
  if (zoneDeltas.length > 0) {
    audit.zonePairs += 1;
    matchSummary.zonePairs += 1;
    labels.push('zone');
    for (const delta of zoneDeltas) {
      increment(audit.zoneDeltaCounts, delta);
    }
  }

  if (summary.pendingAbilityCount !== previous.pendingAbilityCount) {
    audit.pendingPairs += 1;
    matchSummary.pendingPairs += 1;
    labels.push('pending');
    increment(
      audit.pendingAbilityCountTransitions,
      `${previous.pendingAbilityCount}->${summary.pendingAbilityCount}`
    );
  }

  if (summary.activeEffectKey !== previous.activeEffectKey) {
    audit.activePairs += 1;
    matchSummary.activePairs += 1;
    labels.push('active');
    increment(
      audit.activeEffectTransitions,
      `${previous.activeEffectKey}->${summary.activeEffectKey}`
    );
  }

  if (summary.eventLogLength < previous.eventLogLength) {
    audit.issues.push({
      matchId: summary.matchId,
      checkpointSeq: summary.checkpointSeq,
      previousEventLogLength: previous.eventLogLength,
      eventLogLength: summary.eventLogLength,
      issue: 'eventLog shrank',
    });
  }
  const eventLogDelta = summary.eventLogLength - previous.eventLogLength;
  if (eventLogDelta > 0) {
    audit.eventPairs += 1;
    matchSummary.eventPairs += 1;
    labels.push('eventLog');
    increment(audit.eventLogDeltaCounts, signedCountLabel(eventLogDelta));
    for (const entry of checkpoint.state.eventLog.slice(previous.eventLogLength)) {
      increment(audit.newGameEventTypes, String(entry.event.eventType));
    }
  }

  if (summary.actionHistoryLength < previous.actionHistoryLength) {
    audit.issues.push({
      matchId: summary.matchId,
      checkpointSeq: summary.checkpointSeq,
      previousActionHistoryLength: previous.actionHistoryLength,
      actionHistoryLength: summary.actionHistoryLength,
      issue: 'actionHistory shrank',
    });
  }
  if (summary.actionHistoryLength > previous.actionHistoryLength) {
    audit.actionPairs += 1;
    matchSummary.actionPairs += 1;
    labels.push('actionHistory');
    for (const action of checkpoint.state.actionHistory.slice(previous.actionHistoryLength)) {
      increment(audit.newActionTypes, action.type);
    }
  }

  if (summary.liveResolutionKey !== previous.liveResolutionKey) {
    audit.livePairs += 1;
    matchSummary.livePairs += 1;
    labels.push('liveResolution');
    increment(
      audit.liveResolutionTransitions,
      `${previous.liveResolutionKey}->${summary.liveResolutionKey}`
    );
  }

  const publicDelta = sumTimelineEventCounts(
    context.publicEventsByTimelineKey,
    checkpoint.matchId,
    previous.timelineSeq,
    summary.timelineSeq
  );
  if (publicDelta > 0) {
    audit.publicPairs += 1;
    matchSummary.publicPairs += 1;
    labels.push('publicEvents');
    increment(audit.publicEventDeltaCounts, String(publicDelta));
  }

  const privateDelta = sumTimelineEventCounts(
    context.privateEventsByTimelineKey,
    checkpoint.matchId,
    previous.timelineSeq,
    summary.timelineSeq
  );
  if (privateDelta > 0) {
    audit.privatePairs += 1;
    matchSummary.privatePairs += 1;
    labels.push('privateEvents');
    increment(audit.privateEventDeltaCounts, String(privateDelta));
  }

  increment(audit.stateDeltaLabels, labels.sort().join('+') || 'no-observed-change');
  context.previousCheckpointsByMatch.set(checkpoint.matchId, summary);
}

function ensureStateResultMatchSummary(
  audit: StateResultAudit,
  matchId: string
): StateResultMatchSummary {
  let summary = audit.perMatch.get(matchId);
  if (summary) {
    return summary;
  }

  summary = {
    matchId,
    pairs: 0,
    zonePairs: 0,
    phasePairs: 0,
    subPhasePairs: 0,
    turnPairs: 0,
    pendingPairs: 0,
    activePairs: 0,
    eventPairs: 0,
    livePairs: 0,
    publicPairs: 0,
    privatePairs: 0,
    actionPairs: 0,
  };
  audit.perMatch.set(matchId, summary);
  return summary;
}

function summarizeCheckpointState(checkpoint: {
  readonly matchId: string;
  readonly checkpointSeq: number;
  readonly timelineSeq: number;
  readonly relatedPublicSeq: number | null;
  readonly turnCount: number;
  readonly phase: string;
  readonly subPhase: string;
  readonly state: GameState;
}): CheckpointStateSummary {
  return {
    matchId: checkpoint.matchId,
    checkpointSeq: checkpoint.checkpointSeq,
    timelineSeq: checkpoint.timelineSeq,
    relatedPublicSeq: checkpoint.relatedPublicSeq,
    turnCount: checkpoint.turnCount,
    phase: checkpoint.phase,
    subPhase: checkpoint.subPhase,
    zoneCountsByPlayer: Object.fromEntries(
      checkpoint.state.players.map((player) => [player.id, summarizePlayerZones(player)])
    ),
    pendingAbilityCount: checkpoint.state.pendingAbilities.length,
    activeEffectKey: summarizeActiveEffect(checkpoint.state),
    liveResolutionKey: summarizeLiveResolution(checkpoint.state),
    eventLogLength: checkpoint.state.eventLog.length,
    actionHistoryLength: checkpoint.state.actionHistory.length,
  };
}

function summarizePlayerZones(player: PlayerState): Record<string, number> {
  return {
    hand: player.hand.cardIds.length,
    mainDeck: player.mainDeck.cardIds.length,
    energyDeck: player.energyDeck.cardIds.length,
    waitingRoom: player.waitingRoom.cardIds.length,
    liveZone: player.liveZone.cardIds.length,
    successZone: player.successZone.cardIds.length,
    energyZone: player.energyZone.cardIds.length,
    exileZone: player.exileZone.cardIds.length,
    memberSlot: Object.values(player.memberSlots.slots).filter(
      (cardId): cardId is string => cardId !== null
    ).length,
    energyBelow: Object.values(player.memberSlots.energyBelow).reduce(
      (count, cardIds) => count + cardIds.length,
      0
    ),
    memberBelow: Object.values(player.memberSlots.memberBelow).reduce(
      (count, cardIds) => count + cardIds.length,
      0
    ),
  };
}

function compareZoneCountSummaries(
  previous: Record<string, Record<string, number>>,
  current: Record<string, Record<string, number>>
): string[] {
  const deltas: string[] = [];
  for (const [playerId, previousZones] of Object.entries(previous)) {
    const currentZones = current[playerId] ?? {};
    for (const [zoneName, previousCount] of Object.entries(previousZones)) {
      const delta = (currentZones[zoneName] ?? 0) - previousCount;
      if (delta !== 0) {
        deltas.push(`${zoneName}:${signedCountLabel(delta)}`);
      }
    }
  }
  return deltas.sort();
}

function summarizeActiveEffect(state: GameState): string {
  const effect = state.activeEffect;
  if (!effect) {
    return 'NONE';
  }
  return `${effect.abilityId}:${effect.stepId}:${effect.awaitingPlayerId ? 'await' : 'auto'}`;
}

function summarizeLiveResolution(state: GameState): string {
  const resolution = state.liveResolution;
  return [
    `in:${resolution.isInLive}`,
    `perf:${resolution.performingPlayerId ? 1 : 0}`,
    `cheer:${resolution.firstPlayerCheerCardIds.length + resolution.secondPlayerCheerCardIds.length}`,
    `results:${resolution.liveResults.size}`,
    `scores:${resolution.playerScores.size}`,
    `mods:${resolution.liveModifiers.length}`,
    `winners:${resolution.liveWinnerIds.length}`,
    `successMoved:${resolution.successCardMovedBy.length}`,
  ].join('|');
}

function sumTimelineEventCounts(
  eventCounts: Map<string, number>,
  matchId: string,
  previousTimelineSeq: number,
  currentTimelineSeq: number
): number {
  let count = 0;
  for (
    let timelineSeq = previousTimelineSeq + 1;
    timelineSeq <= currentTimelineSeq;
    timelineSeq += 1
  ) {
    count += eventCounts.get(`${matchId}|${timelineSeq}`) ?? 0;
  }
  return count;
}

function timelineEventKey(row: Record<string, string | null>): string {
  return `${readRequired(row, 'match_id')}|${readRequired(row, 'timeline_seq')}`;
}

function signedCountLabel(count: number): string {
  return count > 0 ? `+${count}` : String(count);
}

function buildEngineReplayAudit(
  checkpoints: readonly CheckpointRecord[],
  decisions: readonly DecisionRecordSummary[]
): EngineReplayAudit {
  const checkpointIndex = createCheckpointIndex(checkpoints);
  const audit: EngineReplayAudit = {
    replayedCount: 0,
    skippedCount: 0,
    failedExecutions: [],
    mismatches: [],
    replayedByDecisionType: new Map(),
    replayedByCommandType: new Map(),
    skippedReasons: new Map(),
  };

  for (const decision of decisions) {
    if (decision.status !== 'SUBMITTED') {
      audit.skippedCount += 1;
      increment(audit.skippedReasons, 'not a submitted player decision');
      continue;
    }

    const commandType = decision.submission?.commandType;
    if (!commandType) {
      audit.skippedCount += 1;
      increment(audit.skippedReasons, 'missing command payload');
      continue;
    }

    const afterCheckpoint = findAfterCheckpoint(checkpointIndex, decision);
    if (!afterCheckpoint) {
      audit.skippedCount += 1;
      increment(audit.skippedReasons, `missing after checkpoint for ${commandType}`);
      continue;
    }

    const beforeCheckpoint = findBeforeCheckpoint(checkpointIndex, decision);
    if (!beforeCheckpoint) {
      audit.skippedCount += 1;
      increment(audit.skippedReasons, `missing before checkpoint for ${commandType}`);
      continue;
    }

    const precheckSkipReason = getDecisionPrecheckSkipReason(decision);
    if (precheckSkipReason) {
      audit.skippedCount += 1;
      increment(audit.skippedReasons, precheckSkipReason);
      continue;
    }

    const replayWindowSkipReason = getReplayWindowSkipReason(decision, beforeCheckpoint);
    if (replayWindowSkipReason) {
      audit.skippedCount += 1;
      increment(audit.skippedReasons, replayWindowSkipReason);
      continue;
    }

    const command = rebuildDecisionCommand(decision, beforeCheckpoint.state);
    if (!command) {
      audit.skippedCount += 1;
      increment(audit.skippedReasons, `unsupported decision command ${commandType}`);
      continue;
    }

    const session = createReplaySession(beforeCheckpoint.state);
    const result = session.executeCommand(command);
    if (!result.success) {
      audit.failedExecutions.push({
        matchId: decision.matchId,
        decisionId: decision.decisionId,
        decisionType: decision.decisionType,
        commandType,
        beforeCheckpointSeq: beforeCheckpoint.checkpointSeq,
        afterCheckpointSeq: afterCheckpoint.checkpointSeq,
        error: result.error,
      });
      continue;
    }

    const actualFingerprint = fingerprintEngineState(result.gameState);
    const expectedFingerprint = fingerprintEngineState(afterCheckpoint.state);
    if (actualFingerprint !== expectedFingerprint) {
      const actualNormalized = normalizeEngineState(result.gameState);
      const expectedNormalized = normalizeEngineState(afterCheckpoint.state);
      const mismatch = {
        matchId: decision.matchId,
        decisionId: decision.decisionId,
        decisionType: decision.decisionType,
        commandType,
        beforeCheckpointSeq: beforeCheckpoint.checkpointSeq,
        afterCheckpointSeq: afterCheckpoint.checkpointSeq,
        diffs: findFirstDifferences(actualNormalized, expectedNormalized, 8),
        actual: summarizeReplayComparisonState(result.gameState),
        expected: summarizeReplayComparisonState(afterCheckpoint.state),
      };
      const skipReason = getExpectedReplayMismatchSkipReason(decision, mismatch);
      if (skipReason) {
        audit.skippedCount += 1;
        increment(audit.skippedReasons, skipReason);
        continue;
      }
      audit.mismatches.push(mismatch);
      continue;
    }

    audit.replayedCount += 1;
    increment(audit.replayedByDecisionType, decision.decisionType);
    increment(audit.replayedByCommandType, command.type);
  }

  return audit;
}

function getExpectedReplayMismatchSkipReason(
  decision: DecisionRecordSummary,
  mismatch: {
    readonly commandType: string;
    readonly decisionId: string;
    readonly diffs: readonly unknown[];
    readonly actual: unknown;
    readonly expected: unknown;
  }
): string | null {
  if (mismatch.commandType !== GameCommandType.CONFIRM_EFFECT_STEP) {
    return null;
  }
  if (isRefreshAwareMillOrderMetadataMismatch(decision, mismatch)) {
    return LEGACY_REFRESH_AWARE_MILL_REPLAY_SKIP_REASON;
  }
  if (isLegacyConfirmOnlyLivePendingOrderMismatch(decision, mismatch)) {
    return LEGACY_CONFIRM_ONLY_LIVE_PENDING_REPLAY_SKIP_REASON;
  }
  if (isLegacyConfirmOnlyLivePendingContinuationMismatch(decision, mismatch)) {
    return LEGACY_CONFIRM_ONLY_LIVE_PENDING_REPLAY_SKIP_REASON;
  }
  if (!referencesRefreshAwareMillAbility(decision, mismatch)) {
    return null;
  }
  if (!hasRefreshAwareMillDriftShape(mismatch.diffs)) {
    return null;
  }
  return LEGACY_REFRESH_AWARE_MILL_REPLAY_SKIP_REASON;
}

function isLegacyConfirmOnlyLivePendingOrderMismatch(
  decision: DecisionRecordSummary,
  mismatch: { readonly decisionId: string; readonly diffs: readonly unknown[] }
): boolean {
  return (
    decision.decisionType === 'PENDING_ABILITY_ORDER_SUBMITTED' &&
    mismatch.decisionId.includes('system%3Aselect-pending-card-effect') &&
    (mismatch.decisionId.includes('ON_LIVE_START') ||
      mismatch.decisionId.includes('ON_LIVE_SUCCESS'))
  );
}

function isRefreshAwareMillOrderMetadataMismatch(
  decision: DecisionRecordSummary,
  mismatch: { readonly decisionId: string; readonly diffs: readonly unknown[] }
): boolean {
  return (
    mismatch.diffs.length === 1 &&
    mismatch.diffs.some(
      (diff) =>
        typeof diff === 'object' &&
        diff !== null &&
        'path' in diff &&
        diff.path === '$.activeEffect.metadata.enqueueWaitingRoomTriggersForRemainder'
    )
  );
}

function isLegacyConfirmOnlyLivePendingContinuationMismatch(
  decision: DecisionRecordSummary,
  mismatch: { readonly actual: unknown; readonly expected: unknown; readonly diffs: readonly unknown[] }
): boolean {
  if (decision.decisionType !== 'ACTIVE_EFFECT_SUBMITTED') {
    return false;
  }
  const expectedAbilityId = activeEffectAbilityId(mismatch.expected);
  const actualAbilityId = activeEffectAbilityId(mismatch.actual);
  if (!isLivePendingAbilityId(expectedAbilityId) && !isLivePendingAbilityId(actualAbilityId)) {
    return false;
  }
  return mismatch.diffs.some(
    (diff) =>
      typeof diff === 'object' &&
      diff !== null &&
      'path' in diff &&
      (diff.path === '$.activeEffect' || diff.path === '$.activeEffect.metadata.confirmOnlyPendingAbility')
  );
}

function referencesRefreshAwareMillAbility(
  decision: DecisionRecordSummary,
  mismatch: { readonly decisionId: string; readonly actual: unknown; readonly expected: unknown }
): boolean {
  const referencedAbilityIds = [
    decision.abilityId,
    activeEffectAbilityId(mismatch.actual),
    activeEffectAbilityId(mismatch.expected),
  ];
  if (
    referencedAbilityIds.some(
      (abilityId) => abilityId && REFRESH_AWARE_MILL_ABILITY_IDS.has(abilityId)
    )
  ) {
    return true;
  }
  return [...REFRESH_AWARE_MILL_ABILITY_IDS].some((abilityId) =>
    mismatch.decisionId.includes(encodeURIComponent(abilityId))
  );
}

function activeEffectAbilityId(summary: unknown): string | null {
  const activeEffect = asRecord(asRecord(summary)?.activeEffect);
  const abilityId = activeEffect?.abilityId;
  return typeof abilityId === 'string' ? abilityId : null;
}

function hasRefreshAwareMillDriftShape(diffs: readonly unknown[]): boolean {
  const paths = diffs
    .map((diff) => asRecord(diff)?.path)
    .filter((path): path is string => typeof path === 'string');
  const hasNewMillPayload = paths.some(
    (path) =>
      path.includes('.payload.milledCardIds') ||
      path.includes('.payload.refreshCount') ||
      path.includes('.metadata.milledCardIds')
  );
  const hasLegacyInspectionShape = paths.some(
    (path) =>
      path.includes('.payload.inspectedCardIds') ||
      path.includes('.inspectionCardIds') ||
      path === '$.inspectionContext' ||
      path.startsWith('$.inspectionZone.')
  );
  return hasNewMillPayload && hasLegacyInspectionShape;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

interface CheckpointIndex {
  readonly byMatchSeq: Map<string, CheckpointRecord>;
  readonly byMatchCommandSeq: Map<string, CheckpointRecord>;
  readonly byMatch: Map<string, readonly CheckpointRecord[]>;
}

function createCheckpointIndex(checkpoints: readonly CheckpointRecord[]): CheckpointIndex {
  const byMatchSeq = new Map<string, CheckpointRecord>();
  const byMatchCommandSeq = new Map<string, CheckpointRecord>();
  const byMatchMutable = new Map<string, CheckpointRecord[]>();

  for (const checkpoint of checkpoints) {
    byMatchSeq.set(matchSeqKey(checkpoint.matchId, checkpoint.checkpointSeq), checkpoint);
    if (checkpoint.relatedCommandSeq !== null) {
      byMatchCommandSeq.set(
        matchSeqKey(checkpoint.matchId, checkpoint.relatedCommandSeq),
        checkpoint
      );
    }
    const matchCheckpoints = byMatchMutable.get(checkpoint.matchId) ?? [];
    matchCheckpoints.push(checkpoint);
    byMatchMutable.set(checkpoint.matchId, matchCheckpoints);
  }

  const byMatch = new Map<string, readonly CheckpointRecord[]>();
  for (const [matchId, matchCheckpoints] of byMatchMutable) {
    byMatch.set(
      matchId,
      [...matchCheckpoints].sort((left, right) => left.checkpointSeq - right.checkpointSeq)
    );
  }

  return { byMatchSeq, byMatchCommandSeq, byMatch };
}

function findAfterCheckpoint(
  index: CheckpointIndex,
  decision: DecisionRecordSummary
): CheckpointRecord | null {
  return decision.submittedCommandSeq === null
    ? null
    : (index.byMatchCommandSeq.get(matchSeqKey(decision.matchId, decision.submittedCommandSeq)) ??
        null);
}

function findBeforeCheckpoint(
  index: CheckpointIndex,
  decision: DecisionRecordSummary
): CheckpointRecord | null {
  if (
    (decision.decisionType === 'ACTIVE_EFFECT_SUBMITTED' ||
      decision.decisionType === 'PENDING_ABILITY_ORDER_SUBMITTED') &&
    decision.openedCheckpointSeq !== null
  ) {
    const openedCheckpoint = index.byMatchSeq.get(
      matchSeqKey(decision.matchId, decision.openedCheckpointSeq)
    );
    if (openedCheckpoint && checkpointMatchesDecisionActiveEffect(openedCheckpoint, decision)) {
      return openedCheckpoint;
    }
  }

  if (decision.submittedCommandSeq === null) {
    return null;
  }

  const exactPreviousCommandCheckpoint = index.byMatchCommandSeq.get(
    matchSeqKey(decision.matchId, decision.submittedCommandSeq - 1)
  );
  if (exactPreviousCommandCheckpoint) {
    return exactPreviousCommandCheckpoint;
  }

  const matchCheckpoints = index.byMatch.get(decision.matchId) ?? [];
  return (
    [...matchCheckpoints]
      .reverse()
      .find(
        (checkpoint) =>
          checkpoint.relatedCommandSeq !== null &&
          checkpoint.relatedCommandSeq < decision.submittedCommandSeq!
      ) ??
    matchCheckpoints[0] ??
    null
  );
}

function checkpointMatchesDecisionActiveEffect(
  checkpoint: CheckpointRecord,
  decision: DecisionRecordSummary
): boolean {
  const effect = checkpoint.state.activeEffect;
  if (!effect) {
    return false;
  }
  if (decision.abilityId && effect.abilityId !== decision.abilityId) {
    return false;
  }
  if (decision.sourceCardObjectId && effect.sourceCardId !== decision.sourceCardObjectId) {
    return false;
  }
  if (decision.playerId && effect.awaitingPlayerId !== decision.playerId) {
    return false;
  }
  if (decision.stepId && effect.stepId !== decision.stepId) {
    return false;
  }
  return true;
}

function getReplayWindowSkipReason(
  decision: DecisionRecordSummary,
  beforeCheckpoint: CheckpointRecord
): string | null {
  if (
    (decision.decisionType === 'ACTIVE_EFFECT_SUBMITTED' ||
      decision.decisionType === 'PENDING_ABILITY_ORDER_SUBMITTED') &&
    decision.openedCheckpointSeq !== null &&
    beforeCheckpoint.checkpointSeq === decision.openedCheckpointSeq &&
    checkpointMatchesDecisionActiveEffect(beforeCheckpoint, decision)
  ) {
    if (isLegacyNoInputLivePendingReplay(decision, beforeCheckpoint.state)) {
      return LEGACY_CONFIRM_ONLY_LIVE_PENDING_REPLAY_SKIP_REASON;
    }
    return null;
  }

  if (
    decision.submittedCommandSeq !== null &&
    beforeCheckpoint.relatedCommandSeq === decision.submittedCommandSeq - 1
  ) {
    if (isLegacyNoInputLivePendingReplay(decision, beforeCheckpoint.state)) {
      return LEGACY_CONFIRM_ONLY_LIVE_PENDING_REPLAY_SKIP_REASON;
    }
    return null;
  }

  return 'legacy fixture lacks exact before checkpoint for command replay';
}

function isLegacyNoInputLivePendingReplay(
  decision: DecisionRecordSummary,
  beforeState: GameState
): boolean {
  if (
    decision.decisionType !== 'ACTIVE_EFFECT_SUBMITTED' ||
    decision.submission?.commandType !== GameCommandType.CONFIRM_EFFECT_STEP ||
    !isLivePendingAbilityId(decision.abilityId)
  ) {
    return false;
  }

  const effect = beforeState.activeEffect;
  if (!effect || effect.metadata?.confirmOnlyPendingAbility === true) {
    return false;
  }
  if (
    hasValues(effect.selectableCardIds) ||
    hasValues(effect.selectableObjectIds) ||
    hasValues(effect.selectableOptions) ||
    effect.numericInput ||
    effect.stageFormationSelection
  ) {
    return false;
  }

  const submission = decision.submission;
  return (
    !submission.selectedCardId &&
    !hasValues(submission.selectedCardIds) &&
    !submission.selectedOptionId &&
    !submission.selectedPendingAbilityId &&
    !submission.selectedSlot &&
    submission.selectedNumber === undefined &&
    !hasValues(submission.stageFormationMoveHistory) &&
    !hasValues(submission.stageFormationPlacements)
  );
}

function isLivePendingAbilityId(abilityId: string | null): boolean {
  return abilityId?.includes(':live-start-') === true || abilityId?.includes(':live-success-') === true;
}

function hasValues(value: readonly unknown[] | null | undefined): boolean {
  return Array.isArray(value) && value.length > 0;
}

function rebuildDecisionCommand(
  decision: DecisionRecordSummary,
  beforeState: GameState
): GameCommand | null {
  const submission = decision.submission;
  const commandType = submission?.commandType;
  const playerId = decision.playerId ?? beforeState.activeEffect?.awaitingPlayerId ?? null;
  if (!submission || !commandType || !playerId) {
    return null;
  }

  switch (commandType) {
    case GameCommandType.MULLIGAN:
      return {
        type: GameCommandType.MULLIGAN,
        playerId,
        cardIdsToMulligan: [...(submission.selectedCardIds ?? [])],
        timestamp: 0,
      };
    case GameCommandType.SET_LIVE_CARD:
      return submission.selectedCardId
        ? {
            type: GameCommandType.SET_LIVE_CARD,
            playerId,
            cardId: submission.selectedCardId,
            faceDown: submission.faceDown ?? true,
            timestamp: 0,
          }
        : null;
    case GameCommandType.SELECT_SUCCESS_LIVE:
      return submission.selectedCardId
        ? {
            type: GameCommandType.SELECT_SUCCESS_LIVE,
            playerId,
            cardId: submission.selectedCardId,
            timestamp: 0,
          }
        : null;
    case GameCommandType.ACTIVATE_ABILITY:
      return submission.selectedCardId && decision.abilityId
        ? {
            type: GameCommandType.ACTIVATE_ABILITY,
            playerId,
            cardId: submission.selectedCardId,
            abilityId: decision.abilityId,
            timestamp: 0,
          }
        : null;
    case GameCommandType.CONFIRM_EFFECT_STEP:
      return beforeState.activeEffect
        ? {
            type: GameCommandType.CONFIRM_EFFECT_STEP,
            playerId,
            effectId: beforeState.activeEffect.id,
            selectedCardId: submission.selectedCardId,
            selectedCardIds: submission.selectedCardIds,
            selectedSlot: submission.selectedSlot as SlotPosition | null | undefined,
            resolveInOrder: submission.resolveInOrder,
            selectedOptionId:
              submission.selectedOptionId ??
              (beforeState.activeEffect.selectableOptions?.some(
                (option) => option.id === submission.selectedPendingAbilityId
              )
                ? submission.selectedPendingAbilityId
                : null),
            selectedNumber: submission.selectedNumber,
            stageFormationMoveHistory: submission.stageFormationMoveHistory as
              | readonly { readonly cardId: string; readonly toSlot: SlotPosition }[]
              | undefined,
            stageFormationPlacements: submission.stageFormationPlacements as
              | readonly { readonly cardId: string; readonly toSlot: SlotPosition }[]
              | undefined,
            timestamp: 0,
          }
        : null;
    default:
      return null;
  }
}

function getDecisionPrecheckSkipReason(decision: DecisionRecordSummary): string | null {
  if (decision.decisionType === 'MULLIGAN_SUBMITTED') {
    return 'legacy fixture lacks recorded randomness for mulligan replay';
  }

  if (
    decision.decisionType === 'ACTIVATE_ABILITY_SUBMITTED' &&
    decision.sourceZone === 'MEMBER_SLOT'
  ) {
    return 'legacy fixture lacks reliable before checkpoint for activate ability';
  }

  return null;
}

function createReplaySession(state: GameState): GameSession {
  const session = createGameSession({ gameMode: GameMode.ONLINE });
  (session as unknown as { authorityState: GameState }).authorityState = state;
  return session;
}

function fingerprintEngineState(state: GameState): string {
  return JSON.stringify(sortObjectKeys(normalizeEngineState(state)));
}

function summarizeReplayComparisonState(state: GameState): unknown {
  return {
    turnCount: state.turnCount,
    phase: state.currentPhase,
    subPhase: state.currentSubPhase,
    activePlayerIndex: state.activePlayerIndex,
    activeEffect: state.activeEffect
      ? {
          abilityId: state.activeEffect.abilityId,
          sourceCardId: state.activeEffect.sourceCardId,
          stepId: state.activeEffect.stepId,
          awaitingPlayerId: state.activeEffect.awaitingPlayerId,
        }
      : null,
    pendingAbilities: state.pendingAbilities.map((ability) => ({
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      sourceSlot: ability.sourceSlot ?? null,
    })),
    zones: state.players.map(summarizeReplayPlayerZones),
    actionHistoryTail: state.actionHistory.slice(-3).map((action) => ({
      type: action.type,
      playerId: action.playerId,
      payloadKeys:
        action.payload && typeof action.payload === 'object'
          ? Object.keys(action.payload as Record<string, unknown>).sort()
          : [],
    })),
    eventLogTail: state.eventLog.slice(-3).map((entry) => ({
      eventType: entry.event.eventType,
      eventKeys: Object.keys(entry.event as Record<string, unknown>).sort(),
    })),
  };
}

function summarizeReplayPlayerZones(player: PlayerState): unknown {
  return {
    playerId: player.id,
    counts: summarizePlayerZones(player),
    liveZone: [...player.liveZone.cardIds],
    successZone: [...player.successZone.cardIds],
    memberSlots: player.memberSlots.slots,
  };
}

function normalizeEngineState(state: GameState): unknown {
  return {
    gameId: state.gameId,
    players: state.players.map(normalizePlayerState),
    cardRegistry: [...state.cardRegistry.entries()]
      .map(([cardId, card]) => [
        cardId,
        {
          instanceId: card.instanceId,
          ownerId: card.ownerId,
          controllerId: card.controllerId,
          cardCode: card.data.cardCode,
          cardType: card.data.cardType,
        },
      ])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
    turnCount: state.turnCount,
    currentPhase: state.currentPhase,
    currentTurnType: state.currentTurnType,
    firstPlayerIndex: state.firstPlayerIndex,
    activePlayerIndex: state.activePlayerIndex,
    currentSubPhase: state.currentSubPhase,
    effectWindowType: state.effectWindowType,
    availableAbilityIds: [...state.availableAbilityIds],
    pendingAbilities: state.pendingAbilities.map((ability) => ({
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      mandatory: ability.mandatory,
      sourceSlot: ability.sourceSlot ?? null,
      metadata: normalizeVolatileValue(ability.metadata ?? null),
    })),
    pendingChoice: normalizeVolatileValue(state.pendingChoice),
    activeEffect: normalizeActiveEffect(state),
    pendingCostPayment: state.pendingCostPayment
      ? {
          playerId: state.pendingCostPayment.playerId,
          source: state.pendingCostPayment.source,
          sourceCardId: state.pendingCostPayment.sourceCardId,
          targetSlot: state.pendingCostPayment.targetSlot ?? null,
          baseCost: state.pendingCostPayment.baseCost,
          finalEnergyCost: state.pendingCostPayment.finalEnergyCost,
          relayDiscount: state.pendingCostPayment.relayDiscount,
          replacedMemberCardId: state.pendingCostPayment.replacedMemberCardId,
          payableEnergyCardIds: [...state.pendingCostPayment.payableEnergyCardIds],
        }
      : null,
    liveSetCardCounts: sortedMapEntries(state.liveSetCardCounts),
    resolutionZone: {
      cardIds: [...state.resolutionZone.cardIds],
      revealedCardIds: [...state.resolutionZone.revealedCardIds],
    },
    inspectionZone: {
      cardIds: [...state.inspectionZone.cardIds],
      revealedCardIds: [...state.inspectionZone.revealedCardIds],
    },
    inspectionContext: state.inspectionContext,
    liveResolution: normalizeLiveResolution(state),
    liveProhibitions: normalizeVolatileValue(state.liveProhibitions),
    memberActivePhaseSkips: normalizeVolatileValue(state.memberActivePhaseSkips),
    isStarted: state.isStarted,
    isEnded: state.isEnded,
    endInfo: normalizeVolatileValue(state.endInfo),
    actionHistory: state.actionHistory.map((action) => ({
      type: action.type,
      playerId: action.playerId,
      payload: normalizeActionPayload(action.payload),
      sequence: action.sequence,
    })),
    actionSequence: state.actionSequence,
    eventLog: state.eventLog.map((entry) => ({
      sequence: entry.sequence,
      event: normalizeVolatileValue(entry.event),
    })),
    eventSequence: state.eventSequence,
    waitingForInput: state.waitingForInput,
    waitingPlayerId: state.waitingPlayerId,
    loopCounter: state.loopCounter,
    liveSetCompletedPlayers: [...state.liveSetCompletedPlayers],
    mulliganCompletedPlayers: [...state.mulliganCompletedPlayers],
  };
}

function normalizePlayerState(player: PlayerState): unknown {
  return {
    id: player.id,
    name: player.name,
    isFirstPlayer: player.isFirstPlayer,
    hand: [...player.hand.cardIds],
    mainDeck: [...player.mainDeck.cardIds],
    energyDeck: [...player.energyDeck.cardIds],
    memberSlots: {
      slots: player.memberSlots.slots,
      cardStates: sortedMapEntries(player.memberSlots.cardStates),
      energyBelow: player.memberSlots.energyBelow,
      memberBelow: player.memberSlots.memberBelow,
    },
    energyZone: {
      cardIds: [...player.energyZone.cardIds],
      cardStates: sortedMapEntries(player.energyZone.cardStates),
    },
    liveZone: {
      cardIds: [...player.liveZone.cardIds],
      cardStates: sortedMapEntries(player.liveZone.cardStates),
    },
    successZone: [...player.successZone.cardIds],
    waitingRoom: [...player.waitingRoom.cardIds],
    exileZone: {
      cardIds: [...player.exileZone.cardIds],
      cardStates: sortedMapEntries(player.exileZone.cardStates),
    },
    movedToStageThisTurn: [...player.movedToStageThisTurn],
    positionMovedThisTurn: [...player.positionMovedThisTurn],
    pendingAutoAbilities: [...player.pendingAutoAbilities],
  };
}

function normalizeActiveEffect(state: GameState): unknown {
  const effect = state.activeEffect;
  if (!effect) {
    return null;
  }
  return {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    effectText: effect.effectText,
    stepId: effect.stepId,
    stepText: effect.stepText,
    awaitingPlayerId: effect.awaitingPlayerId,
    revealedCardIds: effect.revealedCardIds,
    inspectionCardIds: effect.inspectionCardIds,
    selectableCardIds: effect.selectableCardIds,
    selectableCardVisibility: effect.selectableCardVisibility,
    selectableCardMode: effect.selectableCardMode,
    minSelectableCards: effect.minSelectableCards,
    maxSelectableCards: effect.maxSelectableCards,
    selectableSlots: effect.selectableSlots,
    selectableOptions:
      effect.abilityId === 'system:select-pending-card-effect'
        ? effect.selectableOptions?.map((option) => ({ label: option.label }))
        : effect.selectableOptions,
    stageFormation: effect.stageFormation,
    numericInput: effect.numericInput,
    selectionLabel: effect.selectionLabel,
    confirmSelectionLabel: effect.confirmSelectionLabel,
    canResolveInOrder: effect.canResolveInOrder,
    canSkipSelection: effect.canSkipSelection,
    skipSelectionLabel: effect.skipSelectionLabel,
    metadata: normalizeVolatileValue(effect.metadata ?? null),
  };
}

function normalizeLiveResolution(state: GameState): unknown {
  const resolution = state.liveResolution;
  return {
    isInLive: resolution.isInLive,
    performingPlayerId: resolution.performingPlayerId,
    firstPlayerCheerCardIds: [...resolution.firstPlayerCheerCardIds],
    secondPlayerCheerCardIds: [...resolution.secondPlayerCheerCardIds],
    liveResults: sortedMapEntries(resolution.liveResults),
    playerScores: sortedMapEntries(resolution.playerScores),
    playerRemainingHearts: sortedMapEntries(resolution.playerRemainingHearts),
    playerLiveJudgmentHearts: sortedMapEntries(resolution.playerLiveJudgmentHearts),
    playerScoreBonuses: sortedMapEntries(resolution.playerScoreBonuses),
    playerHeartBonuses: sortedMapEntries(resolution.playerHeartBonuses),
    liveRequirementReductions: sortedMapEntries(resolution.liveRequirementReductions),
    liveRequirementModifiers: sortedMapEntries(resolution.liveRequirementModifiers),
    liveModifiers: normalizeVolatileValue(resolution.liveModifiers),
    scoreConfirmedBy: [...resolution.scoreConfirmedBy],
    liveWinnerIds: [...resolution.liveWinnerIds],
    animationConfirmedBy: [...resolution.animationConfirmedBy],
    successCardMovedBy: [...resolution.successCardMovedBy],
    settlementConfirmedBy: [...resolution.settlementConfirmedBy],
  };
}

function normalizeActionPayload(value: unknown, key?: string): unknown {
  if (
    (key === 'kosuzuMemberIds' || key === 'sayakaMemberIds') &&
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
  ) {
    return [...value].sort();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeActionPayload(entry));
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .flatMap((entryKey): readonly [string, unknown][] => {
          if (
            entryKey === 'id' ||
            entryKey === 'eventId' ||
            entryKey === 'eventIds' ||
            entryKey === 'endTimestamp' ||
            entryKey === 'timestamp' ||
            entryKey === 'pendingAbilityId' ||
            entryKey === 'pendingAbilityIds'
          ) {
            return [];
          }
          return [[entryKey, normalizeActionPayload(source[entryKey], entryKey)]];
        })
    );
  }
  return value;
}

function normalizeVolatileValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeVolatileValue(entry));
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .flatMap((key): readonly [string, unknown][] => {
          if (
            key === 'id' ||
            key === 'eventId' ||
            key === 'eventIds' ||
            key === 'endTimestamp' ||
            key === 'timestamp' ||
            key === 'pendingAbilityId' ||
            key === 'pendingAbilityIds'
          ) {
            return [];
          }
          return [[key, normalizeVolatileValue(source[key])]];
        })
    );
  }
  return value;
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeys(entry));
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, sortObjectKeys(source[key])])
    );
  }
  return value;
}

function sortedMapEntries<K, V>(map: ReadonlyMap<K, V>): unknown[] {
  return [...map.entries()]
    .map(([key, value]) => [key, normalizeVolatileValue(value)])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
}

function findFirstDifferences(
  actual: unknown,
  expected: unknown,
  limit: number,
  path = '$'
): unknown[] {
  if (Object.is(actual, expected)) {
    return [];
  }
  if (limit <= 0) {
    return [];
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      return [{ path, actual, expected }];
    }
    if (actual.length !== expected.length) {
      return [{ path: `${path}.length`, actual: actual.length, expected: expected.length }];
    }
    const diffs: unknown[] = [];
    for (let index = 0; index < actual.length && diffs.length < limit; index += 1) {
      diffs.push(
        ...findFirstDifferences(
          actual[index],
          expected[index],
          limit - diffs.length,
          `${path}[${index}]`
        )
      );
    }
    return diffs;
  }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    const actualRecord = actual as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    const keys = [
      ...new Set([...Object.keys(actualRecord), ...Object.keys(expectedRecord)]),
    ].sort();
    const diffs: unknown[] = [];
    for (const key of keys) {
      if (diffs.length >= limit) {
        break;
      }
      diffs.push(
        ...findFirstDifferences(
          actualRecord[key],
          expectedRecord[key],
          limit - diffs.length,
          `${path}.${key}`
        )
      );
    }
    return diffs;
  }
  return [{ path, actual, expected }];
}

function matchSeqKey(matchId: string, seq: number): string {
  return `${matchId}|${seq}`;
}

function findCardLocations(state: GameState, player: PlayerState, cardId: string): string[] {
  const locations: string[] = [];
  const playerZones = [
    ['mainDeck', player.mainDeck.cardIds],
    ['energyDeck', player.energyDeck.cardIds],
    ['hand', player.hand.cardIds],
    ['waitingRoom', player.waitingRoom.cardIds],
    ['liveZone', player.liveZone.cardIds],
    ['successZone', player.successZone.cardIds],
    ['energyZone', player.energyZone.cardIds],
    ['exileZone', player.exileZone.cardIds],
  ] as const;

  for (const [zoneName, cardIds] of playerZones) {
    if (cardIds.includes(cardId)) {
      locations.push(zoneName);
    }
  }

  for (const [slot, slotCardId] of Object.entries(player.memberSlots.slots)) {
    if (slotCardId === cardId) {
      locations.push(`memberSlot:${slot}`);
    }
    if (
      (
        player.memberSlots.energyBelow[slot as keyof typeof player.memberSlots.energyBelow] ?? []
      ).includes(cardId)
    ) {
      locations.push(`energyBelow:${slot}`);
    }
    if (
      (
        player.memberSlots.memberBelow[slot as keyof typeof player.memberSlots.memberBelow] ?? []
      ).includes(cardId)
    ) {
      locations.push(`memberBelow:${slot}`);
    }
  }

  if (state.resolutionZone.cardIds.includes(cardId)) {
    locations.push('resolutionZone');
  }
  if (state.inspectionZone.cardIds.includes(cardId)) {
    locations.push('inspectionZone');
  }

  return locations;
}

function createTableRowCounter(): Record<CopyTable, number> {
  return {
    match_records: 0,
    match_deck_snapshots: 0,
    match_participants: 0,
    match_timeline_entries: 0,
    match_record_public_events: 0,
    match_record_private_events: 0,
    match_decision_records: 0,
    match_checkpoints: 0,
  };
}

function readRequired(row: Record<string, string | null>, column: string): string {
  const value = row[column];
  if (value === undefined || value === null) {
    throw new Error(`Missing required COPY column ${column}`);
  }
  return value;
}

function readNumber(row: Record<string, string | null>, column: string): number {
  const value = Number(readRequired(row, column));
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid number in COPY column ${column}`);
  }
  return value;
}

function readNullableNumber(row: Record<string, string | null>, column: string): number | null {
  return row[column] === null ? null : readNumber(row, column);
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function sumFrameTypes(timelineByMatch: Map<string, TimelineSummary>): Map<string, number> {
  const frameTypes = new Map<string, number>();
  for (const timeline of timelineByMatch.values()) {
    for (const [frameType, count] of timeline.frameTypes) {
      frameTypes.set(frameType, (frameTypes.get(frameType) ?? 0) + count);
    }
  }
  return frameTypes;
}

function sumMap<T>(map: Map<string, T>, selector: (value: T) => number): number {
  return [...map.values()].reduce((sum, value) => sum + selector(value), 0);
}

function countBy<T>(values: Iterable<T>, selector: (value: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    increment(counts, selector(value));
  }
  return counts;
}

function plainRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
}
