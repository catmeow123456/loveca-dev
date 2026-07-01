import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { GameState } from '../../src/domain/entities/game';
import type {
  ReplayPayloadKind,
  ReplaySerializedPayloadEnvelope,
} from '../../src/online/replay-types';
import {
  parseArgs,
  runCheckpointCompressionMigration,
  type MigrationQueryClient,
} from '../../src/scripts/compress-match-replay-checkpoints';
import {
  serializeReplayPayload,
  stableJsonStringify,
  toReplayJsonValue,
} from '../../src/server/services/replay-payload-serialization';
import { GamePhase, SubPhase } from '../../src/shared/types/enums';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

interface HarnessRow {
  id: string;
  match_id: string;
  checkpoint_seq: number;
  timeline_seq: number;
  checkpoint_type: string;
  turn_count: number;
  phase: string;
  sub_phase: string;
  schema_version: string;
  payload: ReplaySerializedPayloadEnvelope;
  payload_compression: string;
  payload_hash: string;
}

function createMinimalState(matchId: string, turnCount = 1): GameState {
  return {
    gameId: matchId,
    turnCount,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
  } as GameState;
}

function createLegacyReplayPayloadEnvelope(
  payload: unknown,
  payloadKind: ReplayPayloadKind,
  sourceSchemaVersion: string
): ReplaySerializedPayloadEnvelope {
  const transportPayload = toReplayJsonValue(payload);
  const stablePayloadJson = stableJsonStringify(transportPayload);
  const byteLength = Buffer.byteLength(stablePayloadJson, 'utf8');

  return {
    payloadSchemaVersion: 1,
    serializer: 'TRANSPORT_V1',
    payloadKind,
    sourceSchemaVersion,
    compressed: false,
    compression: 'NONE',
    encoding: 'JSON_VALUE',
    payloadHash: `sha256:${createHash('sha256').update(stablePayloadJson).digest('hex')}`,
    uncompressedByteLength: byteLength,
    compressedByteLength: byteLength,
    payload: transportPayload,
  };
}

function createRow(
  overrides: Partial<HarnessRow> & { payload?: ReplaySerializedPayloadEnvelope } = {}
): HarnessRow {
  const matchId = overrides.match_id ?? 'match-1';
  const turnCount = overrides.turn_count ?? 1;
  const payload =
    overrides.payload ??
    createLegacyReplayPayloadEnvelope(
      createMinimalState(matchId, turnCount),
      'AUTHORITY_GAME_STATE',
      'GAME_STATE_V1'
    );

  return {
    id: overrides.id ?? `checkpoint-${matchId}-${overrides.checkpoint_seq ?? 1}`,
    match_id: matchId,
    checkpoint_seq: overrides.checkpoint_seq ?? 1,
    timeline_seq: overrides.timeline_seq ?? 10,
    checkpoint_type: overrides.checkpoint_type ?? 'AUTHORITY',
    turn_count: turnCount,
    phase: overrides.phase ?? GamePhase.MAIN_PHASE,
    sub_phase: overrides.sub_phase ?? SubPhase.NONE,
    schema_version: overrides.schema_version ?? 'GAME_STATE_V1',
    payload,
    payload_compression: overrides.payload_compression ?? payload.compression,
    payload_hash: overrides.payload_hash ?? payload.payloadHash,
  };
}

function createHarness(rows: HarnessRow[]): {
  readonly client: MigrationQueryClient;
  readonly rows: HarnessRow[];
  readonly calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  const mutableRows = rows;
  const client: MigrationQueryClient = {
    async query<T = unknown>(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values });

      if (text.includes('pg_total_relation_size')) {
        return {
          rows: [
            {
              match_checkpoints_total_size: '100000',
              match_checkpoints_toast_size: '50000',
            },
          ] as T[],
        };
      }

      if (text.includes('pg_column_size($1::jsonb)')) {
        const json = values[0] as string;
        return {
          rows: [{ compressed_pg_column_size: Buffer.byteLength(json, 'utf8') }] as T[],
        };
      }

      if (text.trim().startsWith('SELECT count(*)')) {
        const count = mutableRows.filter(
          (row) =>
            row.checkpoint_type === 'AUTHORITY' &&
            (row.payload_compression !== 'GZIP' ||
              row.payload.compression !== 'GZIP' ||
              row.payload.encoding !== 'BASE64_JSON' ||
              row.payload_hash !== row.payload.payloadHash)
        ).length;
        return { rows: [{ remaining_invalid_count: count }] as T[] };
      }

      if (text.trim().startsWith('SELECT') && text.includes('FROM match_checkpoints')) {
        const limit = Number(values.at(-1));
        let candidates = [...mutableRows].sort((left, right) =>
          left.match_id === right.match_id
            ? left.checkpoint_seq - right.checkpoint_seq
            : left.match_id.localeCompare(right.match_id)
        );
        if (text.includes('match_id = $1')) {
          candidates = candidates.filter((row) => row.match_id === values[0]);
        }
        if (text.includes('checkpoint_seq >')) {
          const cursorMatchId = values.at(-3) as string;
          const cursorSeq = values.at(-2) as number;
          candidates = candidates.filter(
            (row) =>
              row.match_id > cursorMatchId ||
              (row.match_id === cursorMatchId && row.checkpoint_seq > cursorSeq)
          );
        }
        return {
          rows: candidates.slice(0, limit).map((row) => ({
            ...row,
            payload_pg_column_size: Buffer.byteLength(stableJsonStringify(row.payload), 'utf8'),
          })) as T[],
        };
      }

      if (text.trim().startsWith('UPDATE match_checkpoints')) {
        const [id, nextPayloadJson, compression, hash, oldHash] = values as [
          string,
          string,
          string,
          string,
          string,
        ];
        const row = mutableRows.find((candidate) => candidate.id === id);
        if (!row || row.payload_hash !== oldHash || row.payload_compression !== 'NONE') {
          return { rows: [] as T[], rowCount: 0 };
        }
        row.payload = JSON.parse(nextPayloadJson) as ReplaySerializedPayloadEnvelope;
        row.payload_compression = compression;
        row.payload_hash = hash;
        return { rows: [] as T[], rowCount: 1 };
      }

      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) {
        return { rows: [] as T[], rowCount: null };
      }

      throw new Error(`Unhandled query: ${text}`);
    },
  };

  return { client, rows: mutableRows, calls };
}

describe('compress-match-replay-checkpoints', () => {
  it('parseArgs defaults to dry-run and validates mutually exclusive modes', () => {
    expect(parseArgs([])).toMatchObject({
      mode: 'dry-run',
      batchSize: 100,
      matchId: null,
      limit: null,
    });
    expect(parseArgs(['--apply', '--yes', '--match-id=match-1', '--batch-size=2'])).toMatchObject({
      mode: 'apply',
      yes: true,
      matchId: 'match-1',
      batchSize: 2,
    });
    expect(() => parseArgs(['--dry-run', '--apply'])).toThrow(
      '--dry-run and --apply cannot be used together'
    );
  });

  it('dry-run validates legacy and current checkpoints and plans only legacy updates', async () => {
    const legacyRow = createRow({ id: 'legacy-1', checkpoint_seq: 1 });
    const currentPayload = serializeReplayPayload(
      createMinimalState('match-1', 2),
      'AUTHORITY_GAME_STATE',
      'GAME_STATE_V1'
    );
    const currentRow = createRow({
      id: 'current-2',
      checkpoint_seq: 2,
      timeline_seq: 11,
      turn_count: 2,
      payload: currentPayload,
    });
    const { client } = createHarness([legacyRow, currentRow]);

    const report = await runCheckpointCompressionMigration(client, {
      mode: 'dry-run',
      matchId: null,
      batchSize: 10,
      limit: null,
      reportPath: null,
      yes: false,
    });

    expect(report.blockingErrors).toEqual([]);
    expect(report.stats).toMatchObject({
      scannedCheckpointCount: 2,
      legacyCheckpointCount: 1,
      alreadyMigratedCheckpointCount: 1,
      updatePlannedCount: 1,
    });
    expect(report.applied.updatedCount).toBe(0);
    expect(report.remainingInvalidCheckpointCount).toBe(1);
    expect(report.stats.uncompressedPayloadBytes).toBeGreaterThan(0);
    expect(report.stats.targetCompressedPayloadBytes).toBeGreaterThan(0);
  });

  it('apply rewrites legacy checkpoints in a single transaction and is rerunnable', async () => {
    const row = createRow({ id: 'legacy-1' });
    const harness = createHarness([row]);

    const report = await runCheckpointCompressionMigration(harness.client, {
      mode: 'apply',
      matchId: null,
      batchSize: 1,
      limit: null,
      reportPath: null,
      yes: true,
    });

    expect(report.blockingErrors).toEqual([]);
    expect(report.applied.updatedCount).toBe(1);
    expect(report.remainingInvalidCheckpointCount).toBe(0);
    expect(harness.rows[0].payload_compression).toBe('GZIP');
    expect(harness.rows[0].payload.compression).toBe('GZIP');
    expect(harness.calls.map((call) => call.text)).toEqual(
      expect.arrayContaining(['BEGIN', 'COMMIT'])
    );

    const rerun = await runCheckpointCompressionMigration(harness.client, {
      mode: 'apply',
      matchId: null,
      batchSize: 1,
      limit: null,
      reportPath: null,
      yes: true,
    });

    expect(rerun.stats.legacyCheckpointCount).toBe(0);
    expect(rerun.stats.alreadyMigratedCheckpointCount).toBe(1);
    expect(rerun.applied.updatedCount).toBe(0);
  });

  it('reports blocking errors and does not apply when table/envelope compression disagree', async () => {
    const row = createRow({ payload_compression: 'GZIP' });
    const harness = createHarness([row]);

    const report = await runCheckpointCompressionMigration(harness.client, {
      mode: 'apply',
      matchId: null,
      batchSize: 10,
      limit: null,
      reportPath: null,
      yes: true,
    });

    expect(report.blockingErrors).toEqual([
      expect.objectContaining({ code: 'PAYLOAD_COMPRESSION_MISMATCH' }),
    ]);
    expect(report.applied.updatedCount).toBe(0);
    expect(harness.calls.some((call) => call.text === 'BEGIN')).toBe(false);
  });

  it('respects match-id and limit filters for staging rehearsals', async () => {
    const harness = createHarness([
      createRow({ id: 'match-1-cp1', match_id: 'match-1', checkpoint_seq: 1 }),
      createRow({ id: 'match-1-cp2', match_id: 'match-1', checkpoint_seq: 2 }),
      createRow({ id: 'match-2-cp1', match_id: 'match-2', checkpoint_seq: 1 }),
    ]);

    const report = await runCheckpointCompressionMigration(harness.client, {
      mode: 'dry-run',
      matchId: 'match-1',
      batchSize: 10,
      limit: 1,
      reportPath: null,
      yes: false,
    });

    expect(report.stats.scannedCheckpointCount).toBe(1);
    expect(report.stats.legacyCheckpointCount).toBe(1);
    expect(report.matchId).toBe('match-1');
    expect(report.limit).toBe(1);
  });
});
