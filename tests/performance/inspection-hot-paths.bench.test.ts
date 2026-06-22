import { describe, expect, it } from 'vitest';
import {
  createFinishInspectionCommand,
  createFinishInspectionWithArrangementCommand,
  createMoveInspectedCardToTopCommand,
  createOpenInspectionCommand,
} from '../../src/application/game-commands';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { serializeReplayPayload } from '../../src/server/services/replay-payload-serialization';
import type { ReplayRecordFrameType } from '../../src/online/replay-types';
import { GamePhase, SubPhase, ZoneType } from '../../src/shared/types/enums';
import {
  RUN_PERF,
  SAMPLE_COUNT,
  WARMUP_COUNT,
  byteLength,
  createRuntimeDeck,
  measureAsync,
} from './performance-bench-helpers';

const describePerf = RUN_PERF ? describe : describe.skip;
const TOTAL_SAMPLE_CASES = SAMPLE_COUNT + WARMUP_COUNT;

type BenchRecorder = NonNullable<
  NonNullable<ConstructorParameters<typeof OnlineMatchService>[0]>['recorder']
>;

interface PreparedInspectionCases {
  readonly matchService: OnlineMatchService;
  readonly cases: readonly PreparedInspectionCase[];
  nextIndex: number;
}

interface PreparedInspectionCase {
  readonly matchId: string;
  readonly userId: string;
}

describePerf('inspection command hot path benchmark', () => {
  it('measures open, single-card move, legacy close, and batch close costs', async () => {
    const openNoRecorderCases = await prepareInspectionCases({
      label: 'open-no-recorder',
      recorder: null,
      setup: 'none',
    });
    const moveNoRecorderCases = await prepareInspectionCases({
      label: 'move-no-recorder',
      recorder: null,
      setup: 'opened',
    });
    const legacyCloseNoRecorderCases = await prepareInspectionCases({
      label: 'legacy-close-no-recorder',
      recorder: null,
      setup: 'opened',
    });
    const batchCloseNoRecorderCases = await prepareInspectionCases({
      label: 'batch-close-no-recorder',
      recorder: null,
      setup: 'opened',
    });
    const openSerializingCases = await prepareInspectionCases({
      label: 'open-serializing',
      recorder: createBenchRecorder({ serializeCheckpoints: true }),
      setup: 'none',
    });
    const moveSerializingCases = await prepareInspectionCases({
      label: 'move-serializing',
      recorder: createBenchRecorder({ serializeCheckpoints: true }),
      setup: 'opened',
    });
    const batchCloseSerializingCases = await prepareInspectionCases({
      label: 'batch-close-serializing',
      recorder: createBenchRecorder({ serializeCheckpoints: true }),
      setup: 'opened',
    });

    const authorityState = batchCloseNoRecorderCases.matchService
      .getMatch(batchCloseNoRecorderCases.cases[0]!.matchId)!
      .session.getAuthoritySnapshotForRecord();
    expect(authorityState).toBeTruthy();
    const checkpointEnvelope = serializeReplayPayload(
      authorityState,
      'AUTHORITY_GAME_STATE',
      GAME_STATE_SCHEMA_VERSION
    );

    const stats = [
      await measureInspectionOpen('OPEN_INSPECTION count=5, recorder null', openNoRecorderCases),
      await measureSingleInspectedCardMove(
        'MOVE_INSPECTED_CARD_TO_TOP, recorder null',
        moveNoRecorderCases
      ),
      await measureLegacyCloseToTop(
        'inspection close to top, legacy 5 moves + finish, recorder null',
        legacyCloseNoRecorderCases
      ),
      await measureBatchCloseToTop(
        'inspection close to top, batch arrangement, recorder null',
        batchCloseNoRecorderCases
      ),
      await measureInspectionOpen(
        'OPEN_INSPECTION count=5, checkpoint serializing recorder',
        openSerializingCases
      ),
      await measureSingleInspectedCardMove(
        'MOVE_INSPECTED_CARD_TO_TOP, checkpoint serializing recorder',
        moveSerializingCases
      ),
      await measureBatchCloseToTop(
        'inspection close to top, batch arrangement, checkpoint serializing recorder',
        batchCloseSerializingCases
      ),
    ];

    console.log('\nInspection command hot path benchmark');
    console.table({
      config: {
        samples: SAMPLE_COUNT,
        warmup: WARMUP_COUNT,
        preparedMatchesPerCase: TOTAL_SAMPLE_CASES,
        inspectedCardCount: 5,
        authorityCheckpointBytes: byteLength(checkpointEnvelope),
      },
    });
    console.table(stats);
  }, 60_000);
});

async function prepareInspectionCases(input: {
  readonly label: string;
  readonly recorder: BenchRecorder | null;
  readonly setup: 'none' | 'opened';
}): Promise<PreparedInspectionCases> {
  let idSequence = 0;
  const matchService = new OnlineMatchService({
    recorder: input.recorder,
    idGenerator: () => `perf-inspection-${input.label}-${++idSequence}`,
    now: () => 20_000 + idSequence,
  });
  const cases: PreparedInspectionCase[] = [];

  for (let index = 0; index < TOTAL_SAMPLE_CASES; index += 1) {
    const userId = `u1-${input.label}-${index}`;
    const match = await matchService.createMatch({
      roomCode: `INSPERF-${input.label}-${index}`,
      matchMode: 'SOLITAIRE',
      automationGameMode: 'SOLITAIRE',
      originKind: 'SOLITAIRE',
      originLabel: '检视性能样本',
      first: {
        userId,
        displayName: 'Alpha',
        deck: createRuntimeDeck(`A-${input.label}-${index}`),
        participantKind: 'USER',
      },
      second: {
        userId: `system:${input.label}-${index}`,
        displayName: '对手',
        deck: createRuntimeDeck(`B-${input.label}-${index}`),
        participantKind: 'SYSTEM',
        ownerUserId: userId,
      },
    });
    forceMainPhase(match);
    if (input.setup === 'opened') {
      const result = await matchService.executeCommand(
        match.matchId,
        userId,
        createOpenInspectionCommand('client-player-id-is-ignored', ZoneType.MAIN_DECK, 5)
      );
      if (!result?.success) {
        throw new Error(result?.error ?? `Failed to prepare inspection case ${match.matchId}`);
      }
    }
    cases.push({ matchId: match.matchId, userId });
  }

  return {
    matchService,
    cases,
    nextIndex: 0,
  };
}

async function measureInspectionOpen(label: string, cases: PreparedInspectionCases) {
  return measureAsync(label, async () => {
    const prepared = nextPreparedCase(label, cases);
    const result = await cases.matchService.executeCommand(
      prepared.matchId,
      prepared.userId,
      createOpenInspectionCommand('client-player-id-is-ignored', ZoneType.MAIN_DECK, 5)
    );
    if (!result?.success || !result.snapshot) {
      throw new Error(result?.error ?? `Expected accepted open inspection command for ${label}`);
    }
  });
}

async function measureSingleInspectedCardMove(label: string, cases: PreparedInspectionCases) {
  return measureAsync(label, async () => {
    const prepared = nextPreparedCase(label, cases);
    const match = cases.matchService.getMatch(prepared.matchId);
    const cardId = match?.session.state?.inspectionZone.cardIds.at(-1);
    if (!cardId) {
      throw new Error(`Missing inspected card for ${label}`);
    }
    const result = await cases.matchService.executeCommand(
      prepared.matchId,
      prepared.userId,
      createMoveInspectedCardToTopCommand('client-player-id-is-ignored', cardId)
    );
    if (!result?.success || !result.snapshot) {
      throw new Error(result?.error ?? `Expected accepted inspected card move for ${label}`);
    }
  });
}

async function measureLegacyCloseToTop(label: string, cases: PreparedInspectionCases) {
  return measureAsync(label, async () => {
    const prepared = nextPreparedCase(label, cases);
    const match = cases.matchService.getMatch(prepared.matchId);
    const cardIds = [...(match?.session.state?.inspectionZone.cardIds ?? [])];
    if (cardIds.length !== 5) {
      throw new Error(`Expected 5 inspected cards for ${label}`);
    }
    for (const cardId of [...cardIds].reverse()) {
      const result = await cases.matchService.executeCommand(
        prepared.matchId,
        prepared.userId,
        createMoveInspectedCardToTopCommand('client-player-id-is-ignored', cardId)
      );
      if (!result?.success || !result.snapshot) {
        throw new Error(result?.error ?? `Expected accepted legacy close move for ${label}`);
      }
    }
    const finishResult = await cases.matchService.executeCommand(
      prepared.matchId,
      prepared.userId,
      createFinishInspectionCommand('client-player-id-is-ignored')
    );
    if (!finishResult?.success || !finishResult.snapshot) {
      throw new Error(finishResult?.error ?? `Expected accepted finish inspection for ${label}`);
    }
  });
}

async function measureBatchCloseToTop(label: string, cases: PreparedInspectionCases) {
  return measureAsync(label, async () => {
    const prepared = nextPreparedCase(label, cases);
    const match = cases.matchService.getMatch(prepared.matchId);
    const cardIds = [...(match?.session.state?.inspectionZone.cardIds ?? [])];
    if (cardIds.length !== 5) {
      throw new Error(`Expected 5 inspected cards for ${label}`);
    }
    const result = await cases.matchService.executeCommand(
      prepared.matchId,
      prepared.userId,
      createFinishInspectionWithArrangementCommand(
        'client-player-id-is-ignored',
        cardIds,
        ZoneType.MAIN_DECK,
        'TOP'
      )
    );
    if (!result?.success || !result.snapshot) {
      throw new Error(result?.error ?? `Expected accepted batch inspection close for ${label}`);
    }
  });
}

function nextPreparedCase(label: string, cases: PreparedInspectionCases): PreparedInspectionCase {
  const prepared = cases.cases[cases.nextIndex];
  if (!prepared) {
    throw new Error(`Prepared sample exhausted for ${label}`);
  }
  cases.nextIndex += 1;
  return prepared;
}

function forceMainPhase(match: NonNullable<ReturnType<OnlineMatchService['getMatch']>>): void {
  const state = match.session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.NONE;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
}

function createBenchRecorder(options: { readonly serializeCheckpoints: boolean }): BenchRecorder {
  let timelineSeq = 0;
  let checkpointSeq = 0;
  let commandSeq = 0;
  let gameEventSeq = 0;

  return {
    async beginMatch(input) {
      return {
        matchId: input.matchId,
        status: 'IN_PROGRESS',
        completeness: 'FULL',
        turnCount: 0,
        lastTimelineSeq: timelineSeq,
        lastCheckpointSeq: checkpointSeq,
        lastPublicSeq: 0,
        lastPrivateSeqBySeat: { FIRST: 0, SECOND: 0 },
        lastAuditSeq: 0,
        lastCommandSeq: commandSeq,
        lastGameEventSeq: gameEventSeq,
        recordSchemaVersion: 1,
      };
    },
    async recordInitialCheckpoint(input) {
      timelineSeq += 1;
      checkpointSeq += 1;
      if (options.serializeCheckpoints) {
        serializeReplayPayload(
          input.authorityState,
          'AUTHORITY_GAME_STATE',
          GAME_STATE_SCHEMA_VERSION
        );
      }
      return {
        matchId: input.matchId,
        timelineSeq,
        checkpointSeq,
        payloadHash: `sha256:perf-initial-${checkpointSeq}`,
      };
    },
    async markPartial() {
      return undefined;
    },
    async sealMatch(input) {
      timelineSeq += 1;
      return {
        matchId: input.matchId,
        timelineSeq,
        status: input.status,
        completeness: input.completeness ?? (input.status === 'COMPLETED' ? 'FULL' : 'PARTIAL'),
      };
    },
    async getRecordCursor(matchId) {
      return {
        matchId,
        status: 'IN_PROGRESS',
        completeness: 'FULL',
        turnCount: 0,
        lastTimelineSeq: timelineSeq,
        lastCheckpointSeq: checkpointSeq,
        lastPublicSeq: 0,
        lastPrivateSeqBySeat: { FIRST: 0, SECOND: 0 },
        lastAuditSeq: 0,
        lastCommandSeq: commandSeq,
        lastGameEventSeq: gameEventSeq,
      };
    },
    async appendMatchRecordFrame(input) {
      timelineSeq += 1;
      commandSeq = Math.max(commandSeq, input.relatedCommandSeq ?? commandSeq);
      gameEventSeq = Math.max(gameEventSeq, input.relatedGameEventSeq ?? gameEventSeq);

      const checkpointWritten = shouldWriteCheckpoint(
        input.frameType,
        input.writeAuthorityCheckpoint
      );
      if (checkpointWritten && input.authorityState) {
        checkpointSeq += 1;
        if (options.serializeCheckpoints) {
          serializeReplayPayload(
            input.authorityState,
            'AUTHORITY_GAME_STATE',
            GAME_STATE_SCHEMA_VERSION
          );
        }
      }

      return {
        matchId: input.matchId,
        timelineSeq,
        checkpointSeq: checkpointWritten ? checkpointSeq : null,
        payloadHash: checkpointWritten ? `sha256:perf-frame-${checkpointSeq}` : null,
      };
    },
  };
}

function shouldWriteCheckpoint(
  frameType: ReplayRecordFrameType,
  writeAuthorityCheckpoint: boolean | undefined
): boolean {
  return frameType !== 'COMMAND_REJECTED' && writeAuthorityCheckpoint !== false;
}
