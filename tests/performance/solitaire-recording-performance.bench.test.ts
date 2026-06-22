import { describe, expect, it } from 'vitest';
import { createMulliganCommand } from '../../src/application/game-commands';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { serializeReplayPayload } from '../../src/server/services/replay-payload-serialization';
import type { ReplayRecordFrameType } from '../../src/online/replay-types';
import {
  RUN_PERF,
  SAMPLE_COUNT,
  WARMUP_COUNT,
  byteLength,
  createRuntimeDeck,
  measure,
  measureAsync,
} from './performance-bench-helpers';

const describePerf = RUN_PERF ? describe : describe.skip;
const SOLITAIRE_SYSTEM_USER_ID = 'system:solitaire-opponent';
const TOTAL_SAMPLE_CASES = SAMPLE_COUNT + WARMUP_COUNT;

type BenchRecorder = NonNullable<
  NonNullable<ConstructorParameters<typeof OnlineMatchService>[0]>['recorder']
>;

interface PreparedCommandCases {
  readonly matchService: OnlineMatchService;
  readonly matchIds: readonly string[];
  nextIndex: number;
}

describePerf('recorded solitaire match performance benchmark', () => {
  it('locates server-side command costs across recorder modes', async () => {
    const noRecorderCases = await prepareSolitaireCommandCases(null, 'no-recorder');
    const metadataRecorderCases = await prepareSolitaireCommandCases(
      createBenchRecorder({ serializeCheckpoints: false }),
      'metadata-recorder'
    );
    const serializingRecorderCases = await prepareSolitaireCommandCases(
      createBenchRecorder({ serializeCheckpoints: true }),
      'serializing-recorder'
    );
    const authorityState = serializingRecorderCases.matchService
      .getMatch(serializingRecorderCases.matchIds[0]!)!
      .session.getAuthoritySnapshotForRecord();
    expect(authorityState).toBeTruthy();
    const checkpointEnvelope = serializeReplayPayload(
      authorityState,
      'AUTHORITY_GAME_STATE',
      GAME_STATE_SCHEMA_VERSION
    );

    const noRecorderStats = await measureSolitaireMulliganCommand(
      'solitaire command accepted, recorder null',
      noRecorderCases
    );
    const metadataRecorderStats = await measureSolitaireMulliganCommand(
      'solitaire command accepted, metadata recorder',
      metadataRecorderCases
    );
    const serializingRecorderStats = await measureSolitaireMulliganCommand(
      'solitaire command accepted, checkpoint serializing recorder',
      serializingRecorderCases
    );
    const standaloneCloneStats = measure('getAuthoritySnapshotForRecord clone', () => {
      serializingRecorderCases.matchService
        .getMatch(serializingRecorderCases.matchIds[0]!)!
        .session.getAuthoritySnapshotForRecord();
    });
    const standaloneCheckpointStats = measure(
      'serializeReplayPayload(authority checkpoint)',
      () => {
        serializeReplayPayload(authorityState, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION);
      }
    );

    console.log('\nRecorded solitaire performance benchmark');
    console.table({
      config: {
        samples: SAMPLE_COUNT,
        warmup: WARMUP_COUNT,
        preparedMatchesPerMode: TOTAL_SAMPLE_CASES,
        authorityCheckpointBytes: byteLength(checkpointEnvelope),
      },
    });
    console.table([
      noRecorderStats,
      metadataRecorderStats,
      serializingRecorderStats,
      standaloneCloneStats,
      standaloneCheckpointStats,
    ]);
  }, 60_000);
});

async function prepareSolitaireCommandCases(
  recorder: BenchRecorder | null,
  label: string
): Promise<PreparedCommandCases> {
  let idSequence = 0;
  const matchService = new OnlineMatchService({
    recorder,
    idGenerator: () => `perf-${label}-${++idSequence}`,
    now: () => 10_000 + idSequence,
  });
  const matchIds: string[] = [];

  for (let index = 0; index < TOTAL_SAMPLE_CASES; index += 1) {
    const match = await matchService.createMatch({
      roomCode: `SOLPERF-${label}-${index}`,
      matchMode: 'SOLITAIRE',
      automationGameMode: 'SOLITAIRE',
      originKind: 'SOLITAIRE',
      originLabel: '对墙打性能样本',
      first: {
        userId: `u1-${label}-${index}`,
        displayName: 'Alpha',
        deck: createRuntimeDeck(`A-${label}-${index}`),
        participantKind: 'USER',
      },
      second: {
        userId: SOLITAIRE_SYSTEM_USER_ID,
        displayName: '对手 (AI)',
        deck: createRuntimeDeck(`B-${label}-${index}`),
        participantKind: 'SYSTEM',
        ownerUserId: `u1-${label}-${index}`,
      },
    });
    matchIds.push(match.matchId);
  }

  return {
    matchService,
    matchIds,
    nextIndex: 0,
  };
}

async function measureSolitaireMulliganCommand(label: string, cases: PreparedCommandCases) {
  return measureAsync(label, async () => {
    const matchId = cases.matchIds[cases.nextIndex];
    if (!matchId) {
      throw new Error(`Prepared sample exhausted for ${label}`);
    }
    cases.nextIndex += 1;
    const match = cases.matchService.getMatch(matchId);
    if (!match) {
      throw new Error(`Missing prepared match: ${matchId}`);
    }

    const result = await cases.matchService.executeCommand(
      matchId,
      match.participants.FIRST.userId,
      createMulliganCommand('client-player-id-is-ignored', [])
    );
    if (!result?.success || !result.snapshot) {
      throw new Error(result?.error ?? `Expected accepted solitaire command for ${label}`);
    }
  });
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
