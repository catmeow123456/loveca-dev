/**
 * Compress persisted match replay authority checkpoints.
 *
 * Default mode is dry-run. Formal apply is intended for a maintenance window
 * after stopping new match writes and taking a database backup.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... pnpm exec tsx src/scripts/compress-match-replay-checkpoints.ts --dry-run
 *   DATABASE_URL=postgresql://... pnpm exec tsx src/scripts/compress-match-replay-checkpoints.ts --apply --yes
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { GameState } from '../domain/entities/game.js';
import type {
  ReplayCompression,
  ReplaySerializedPayloadEnvelope,
} from '../online/replay-types.js';
import { GAME_STATE_SCHEMA_VERSION } from '../server/services/replay-constants.js';
import {
  ReplayPayloadSerializationError,
  compressLegacyReplayPayloadEnvelopeForMigration,
  rehydrateAuthorityGameState,
  rehydrateLegacyReplayPayloadForMigration,
  stableJsonStringify,
} from '../server/services/replay-payload-serialization.js';

type MigrationMode = 'dry-run' | 'apply';

export interface CompressReplayCheckpointArgs {
  readonly mode: MigrationMode;
  readonly matchId: string | null;
  readonly batchSize: number;
  readonly limit: number | null;
  readonly reportPath: string | null;
  readonly yes: boolean;
}

export interface MigrationQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ readonly rows: T[]; readonly rowCount?: number | null }>;
}

interface CheckpointRow {
  readonly id: string;
  readonly match_id: string;
  readonly checkpoint_seq: number;
  readonly timeline_seq: number;
  readonly checkpoint_type: string;
  readonly turn_count: number;
  readonly phase: string;
  readonly sub_phase: string;
  readonly schema_version: string;
  readonly payload: unknown;
  readonly payload_compression: string;
  readonly payload_hash: string;
  readonly payload_pg_column_size: number | string;
}

interface SizeRow {
  readonly match_checkpoints_total_size: number | string | null;
  readonly match_checkpoints_toast_size: number | string | null;
}

interface CompressedColumnSizeRow {
  readonly compressed_pg_column_size: number | string | null;
}

interface RemainingInvalidRow {
  readonly remaining_invalid_count: number | string;
}

export interface BlockingError {
  readonly code: string;
  readonly message: string;
  readonly checkpoint?: {
    readonly id: string;
    readonly matchId: string;
    readonly checkpointSeq: number;
    readonly timelineSeq: number;
  };
}

interface CheckpointUpdatePlan {
  readonly id: string;
  readonly matchId: string;
  readonly checkpointSeq: number;
  readonly timelineSeq: number;
  readonly oldPayloadHash: string;
  readonly nextPayloadHash: string;
  readonly nextPayloadCompression: ReplayCompression;
  readonly nextPayload: ReplaySerializedPayloadEnvelope;
}

interface MigrationStats {
  readonly scannedCheckpointCount: number;
  readonly legacyCheckpointCount: number;
  readonly alreadyMigratedCheckpointCount: number;
  readonly updatePlannedCount: number;
  readonly uncompressedPayloadBytes: number;
  readonly targetCompressedPayloadBytes: number;
  readonly originalEnvelopeJsonBytes: number;
  readonly targetEnvelopeJsonBytes: number;
  readonly estimatedEnvelopeJsonSavingsBytes: number;
  readonly estimatedEnvelopeJsonSavingsPercent: number;
}

interface PostgresStorageStats {
  readonly relationSizeBefore: {
    readonly matchCheckpointsTotalBytes: number;
    readonly toastTotalBytes: number;
  };
  readonly relationSizeAfter: {
    readonly matchCheckpointsTotalBytes: number;
    readonly toastTotalBytes: number;
  } | null;
  readonly columnSizeSample: {
    readonly sampledRows: number;
    readonly originalBytes: number;
    readonly targetBytes: number;
    readonly estimatedSavingsBytes: number;
    readonly estimatedSavingsPercent: number;
  };
}

export interface CompressReplayCheckpointReport {
  readonly script: 'compress-match-replay-checkpoints';
  readonly generatedAt: string;
  readonly mode: MigrationMode;
  readonly matchId: string | null;
  readonly batchSize: number;
  readonly limit: number | null;
  readonly stats: MigrationStats;
  readonly postgresql: PostgresStorageStats;
  readonly blockingErrors: readonly BlockingError[];
  readonly applied: {
    readonly attempted: boolean;
    readonly updatedCount: number;
    readonly transactionMode: 'single-transaction' | null;
  };
  readonly remainingInvalidCheckpointCount: number | null;
}

interface AnalysisResult {
  readonly stats: MigrationStats;
  readonly updates: readonly CheckpointUpdatePlan[];
  readonly blockingErrors: readonly BlockingError[];
  readonly postgresqlBefore: PostgresStorageStats['relationSizeBefore'];
  readonly columnSizeSample: PostgresStorageStats['columnSizeSample'];
}

const SCRIPT_NAME = 'compress-match-replay-checkpoints';
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_COLUMN_SIZE_SAMPLE_LIMIT = 20;

export function parseArgs(argv: readonly string[]): CompressReplayCheckpointArgs {
  let mode: MigrationMode = 'dry-run';
  let sawDryRun = false;
  let sawApply = false;
  let matchId: string | null = null;
  let batchSize = DEFAULT_BATCH_SIZE;
  let limit: number | null = null;
  let reportPath: string | null = null;
  let yes = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      sawDryRun = true;
      mode = 'dry-run';
    } else if (arg === '--apply') {
      sawApply = true;
      mode = 'apply';
    } else if (arg === '--yes') {
      yes = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith('--match-id=')) {
      matchId = requireNonEmptyArg(arg, '--match-id=');
    } else if (arg.startsWith('--batch-size=')) {
      batchSize = parsePositiveIntegerArg(arg, '--batch-size=');
    } else if (arg.startsWith('--limit=')) {
      limit = parsePositiveIntegerArg(arg, '--limit=');
    } else if (arg.startsWith('--report=')) {
      reportPath = requireNonEmptyArg(arg, '--report=');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (sawDryRun && sawApply) {
    throw new Error('--dry-run and --apply cannot be used together');
  }

  return { mode, matchId, batchSize, limit, reportPath, yes };
}

export async function runCheckpointCompressionMigration(
  queryClient: MigrationQueryClient,
  args: CompressReplayCheckpointArgs
): Promise<CompressReplayCheckpointReport> {
  const analysis = await analyzeCheckpoints(queryClient, args);
  let updatedCount = 0;
  let relationSizeAfter: PostgresStorageStats['relationSizeAfter'] = null;
  let remainingInvalidCheckpointCount: number | null = null;

  if (analysis.blockingErrors.length === 0 && args.mode === 'apply') {
    updatedCount = await applyCheckpointUpdates(queryClient, analysis.updates, args.batchSize);
    remainingInvalidCheckpointCount = await countRemainingInvalidCheckpoints(queryClient, args);
    relationSizeAfter = await readRelationSize(queryClient);
  } else if (analysis.blockingErrors.length === 0) {
    remainingInvalidCheckpointCount = await countRemainingInvalidCheckpoints(queryClient, args);
  }

  return {
    script: SCRIPT_NAME,
    generatedAt: new Date().toISOString(),
    mode: args.mode,
    matchId: args.matchId,
    batchSize: args.batchSize,
    limit: args.limit,
    stats: analysis.stats,
    postgresql: {
      relationSizeBefore: analysis.postgresqlBefore,
      relationSizeAfter,
      columnSizeSample: analysis.columnSizeSample,
    },
    blockingErrors: analysis.blockingErrors,
    applied: {
      attempted: args.mode === 'apply',
      updatedCount,
      transactionMode: args.mode === 'apply' ? 'single-transaction' : null,
    },
    remainingInvalidCheckpointCount,
  };
}

async function analyzeCheckpoints(
  queryClient: MigrationQueryClient,
  args: CompressReplayCheckpointArgs
): Promise<AnalysisResult> {
  const relationSizeBefore = await readRelationSize(queryClient);
  const updates: CheckpointUpdatePlan[] = [];
  const blockingErrors: BlockingError[] = [];
  const samplePlans: Array<{
    readonly originalPgColumnSize: number;
    readonly targetPayload: ReplaySerializedPayloadEnvelope;
  }> = [];
  let scannedCheckpointCount = 0;
  let legacyCheckpointCount = 0;
  let alreadyMigratedCheckpointCount = 0;
  let uncompressedPayloadBytes = 0;
  let targetCompressedPayloadBytes = 0;
  let originalEnvelopeJsonBytes = 0;
  let targetEnvelopeJsonBytes = 0;
  let cursor: { readonly matchId: string; readonly checkpointSeq: number } | null = null;

  while (args.limit === null || scannedCheckpointCount < args.limit) {
    const remaining =
      args.limit === null ? args.batchSize : Math.min(args.batchSize, args.limit - scannedCheckpointCount);
    if (remaining <= 0) {
      break;
    }
    const rows = await fetchCheckpointRows(queryClient, args, cursor, remaining);
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      scannedCheckpointCount += 1;
      cursor = { matchId: row.match_id, checkpointSeq: row.checkpoint_seq };

      const analyzed = analyzeCheckpointRow(row);
      if (!analyzed.ok) {
        blockingErrors.push(analyzed.error);
        continue;
      }

      uncompressedPayloadBytes += analyzed.uncompressedPayloadBytes;
      targetCompressedPayloadBytes += analyzed.targetCompressedPayloadBytes;
      originalEnvelopeJsonBytes += analyzed.originalEnvelopeJsonBytes;
      targetEnvelopeJsonBytes += analyzed.targetEnvelopeJsonBytes;

      if (analyzed.kind === 'legacy') {
        legacyCheckpointCount += 1;
        updates.push(analyzed.update);
        if (samplePlans.length < DEFAULT_COLUMN_SIZE_SAMPLE_LIMIT) {
          samplePlans.push({
            originalPgColumnSize: toNumber(row.payload_pg_column_size),
            targetPayload: analyzed.update.nextPayload,
          });
        }
      } else {
        alreadyMigratedCheckpointCount += 1;
      }
    }
  }

  const estimatedEnvelopeJsonSavingsBytes = originalEnvelopeJsonBytes - targetEnvelopeJsonBytes;
  const stats: MigrationStats = {
    scannedCheckpointCount,
    legacyCheckpointCount,
    alreadyMigratedCheckpointCount,
    updatePlannedCount: updates.length,
    uncompressedPayloadBytes,
    targetCompressedPayloadBytes,
    originalEnvelopeJsonBytes,
    targetEnvelopeJsonBytes,
    estimatedEnvelopeJsonSavingsBytes,
    estimatedEnvelopeJsonSavingsPercent: percent(estimatedEnvelopeJsonSavingsBytes, originalEnvelopeJsonBytes),
  };

  return {
    stats,
    updates,
    blockingErrors,
    postgresqlBefore: relationSizeBefore,
    columnSizeSample: await estimateColumnSizeSample(queryClient, samplePlans),
  };
}

type AnalyzeRowResult =
  | {
      readonly ok: true;
      readonly kind: 'legacy';
      readonly update: CheckpointUpdatePlan;
      readonly uncompressedPayloadBytes: number;
      readonly targetCompressedPayloadBytes: number;
      readonly originalEnvelopeJsonBytes: number;
      readonly targetEnvelopeJsonBytes: number;
    }
  | {
      readonly ok: true;
      readonly kind: 'already-migrated';
      readonly uncompressedPayloadBytes: number;
      readonly targetCompressedPayloadBytes: number;
      readonly originalEnvelopeJsonBytes: number;
      readonly targetEnvelopeJsonBytes: number;
    }
  | { readonly ok: false; readonly error: BlockingError };

function analyzeCheckpointRow(row: CheckpointRow): AnalyzeRowResult {
  try {
    if (row.checkpoint_type !== 'AUTHORITY') {
      return blockingError(row, 'NON_AUTHORITY_CHECKPOINT', '非 AUTHORITY checkpoint 进入迁移集合');
    }

    const envelope = parsePayloadEnvelope(row.payload);
    if (row.payload_hash !== envelope.payloadHash) {
      return blockingError(row, 'PAYLOAD_HASH_MISMATCH', 'payload_hash 与 envelope payloadHash 不一致');
    }
    if (row.payload_compression !== envelope.compression) {
      return blockingError(
        row,
        'PAYLOAD_COMPRESSION_MISMATCH',
        'payload_compression 与 envelope compression 不一致'
      );
    }
    if (row.schema_version !== GAME_STATE_SCHEMA_VERSION || envelope.sourceSchemaVersion !== GAME_STATE_SCHEMA_VERSION) {
      return blockingError(row, 'SCHEMA_VERSION_UNSUPPORTED', 'checkpoint GameState schema version 不兼容');
    }

    if (isLegacyEnvelope(envelope, row.payload_compression)) {
      const authorityState = rehydrateLegacyReplayPayloadForMigration<GameState>(
        envelope,
        'AUTHORITY_GAME_STATE'
      );
      const validationError = validateAuthorityState(row, authorityState);
      if (validationError) {
        return validationError;
      }

      const nextPayload = compressLegacyReplayPayloadEnvelopeForMigration(
        envelope,
        'AUTHORITY_GAME_STATE'
      );
      return {
        ok: true,
        kind: 'legacy',
        update: {
          id: row.id,
          matchId: row.match_id,
          checkpointSeq: row.checkpoint_seq,
          timelineSeq: row.timeline_seq,
          oldPayloadHash: row.payload_hash,
          nextPayloadHash: nextPayload.payloadHash,
          nextPayloadCompression: nextPayload.compression,
          nextPayload,
        },
        uncompressedPayloadBytes: nextPayload.uncompressedByteLength,
        targetCompressedPayloadBytes: nextPayload.compressedByteLength,
        originalEnvelopeJsonBytes: Buffer.byteLength(stableJsonStringify(envelope), 'utf8'),
        targetEnvelopeJsonBytes: Buffer.byteLength(stableJsonStringify(nextPayload), 'utf8'),
      };
    }

    if (isCurrentEnvelope(envelope, row.payload_compression)) {
      const authorityState = rehydrateAuthorityGameState(envelope);
      const validationError = validateAuthorityState(row, authorityState);
      if (validationError) {
        return validationError;
      }
      const envelopeBytes = Buffer.byteLength(stableJsonStringify(envelope), 'utf8');
      return {
        ok: true,
        kind: 'already-migrated',
        uncompressedPayloadBytes: envelope.uncompressedByteLength,
        targetCompressedPayloadBytes: envelope.compressedByteLength,
        originalEnvelopeJsonBytes: envelopeBytes,
        targetEnvelopeJsonBytes: envelopeBytes,
      };
    }

    return blockingError(
      row,
      'PAYLOAD_FORMAT_UNSUPPORTED',
      `未知 checkpoint payload 格式: ${row.payload_compression}/${envelope.compression}/${envelope.encoding}`
    );
  } catch (error) {
    const code =
      error instanceof ReplayPayloadSerializationError
        ? 'PAYLOAD_SERIALIZATION_INVALID'
        : 'PAYLOAD_VALIDATION_FAILED';
    return blockingError(row, code, error instanceof Error ? error.message : String(error));
  }
}

function validateAuthorityState(row: CheckpointRow, state: GameState): AnalyzeRowResult | null {
  if (
    state.gameId !== row.match_id ||
    state.turnCount !== row.turn_count ||
    String(state.currentPhase) !== row.phase ||
    String(state.currentSubPhase) !== row.sub_phase
  ) {
    return blockingError(row, 'AUTHORITY_STATE_MISMATCH', 'checkpoint 元数据与复水权威状态不一致');
  }
  return null;
}

function isLegacyEnvelope(
  envelope: ReplaySerializedPayloadEnvelope,
  payloadCompression: string
): boolean {
  return (
    payloadCompression === 'NONE' &&
    envelope.compressed === false &&
    envelope.compression === 'NONE' &&
    envelope.encoding === 'JSON_VALUE'
  );
}

function isCurrentEnvelope(
  envelope: ReplaySerializedPayloadEnvelope,
  payloadCompression: string
): boolean {
  return (
    payloadCompression === 'GZIP' &&
    envelope.compressed === true &&
    envelope.compression === 'GZIP' &&
    envelope.encoding === 'BASE64_JSON'
  );
}

async function fetchCheckpointRows(
  queryClient: MigrationQueryClient,
  args: CompressReplayCheckpointArgs,
  cursor: { readonly matchId: string; readonly checkpointSeq: number } | null,
  limit: number
): Promise<readonly CheckpointRow[]> {
  const whereSql = ["checkpoint_type = 'AUTHORITY'"];
  const values: unknown[] = [];

  if (args.matchId) {
    values.push(args.matchId);
    whereSql.push(`match_id = $${values.length}`);
  }
  if (cursor) {
    values.push(cursor.matchId, cursor.checkpointSeq);
    const matchParam = values.length - 1;
    const seqParam = values.length;
    whereSql.push(
      `(match_id > $${matchParam} OR (match_id = $${matchParam} AND checkpoint_seq > $${seqParam}))`
    );
  }
  values.push(limit);

  const result = await queryClient.query<CheckpointRow>(
    `SELECT
      id,
      match_id,
      checkpoint_seq,
      timeline_seq,
      checkpoint_type,
      turn_count,
      phase,
      sub_phase,
      schema_version,
      payload,
      payload_compression,
      payload_hash,
      pg_column_size(payload) AS payload_pg_column_size
    FROM match_checkpoints
    WHERE ${whereSql.join(' AND ')}
    ORDER BY match_id ASC, checkpoint_seq ASC
    LIMIT $${values.length}`,
    values
  );

  return result.rows;
}

async function estimateColumnSizeSample(
  queryClient: MigrationQueryClient,
  samplePlans: readonly {
    readonly originalPgColumnSize: number;
    readonly targetPayload: ReplaySerializedPayloadEnvelope;
  }[]
): Promise<PostgresStorageStats['columnSizeSample']> {
  let originalBytes = 0;
  let targetBytes = 0;

  for (const plan of samplePlans) {
    originalBytes += plan.originalPgColumnSize;
    const result = await queryClient.query<CompressedColumnSizeRow>(
      `SELECT pg_column_size($1::jsonb) AS compressed_pg_column_size`,
      [JSON.stringify(plan.targetPayload)]
    );
    targetBytes += toNumber(result.rows[0]?.compressed_pg_column_size ?? 0);
  }

  return {
    sampledRows: samplePlans.length,
    originalBytes,
    targetBytes,
    estimatedSavingsBytes: originalBytes - targetBytes,
    estimatedSavingsPercent: percent(originalBytes - targetBytes, originalBytes),
  };
}

async function applyCheckpointUpdates(
  queryClient: MigrationQueryClient,
  updates: readonly CheckpointUpdatePlan[],
  batchSize: number
): Promise<number> {
  let updatedCount = 0;
  await queryClient.query('BEGIN');
  try {
    for (let index = 0; index < updates.length; index += batchSize) {
      const batch = updates.slice(index, index + batchSize);
      for (const update of batch) {
        const result = await queryClient.query(
          `UPDATE match_checkpoints
          SET
            payload = $2::jsonb,
            payload_compression = $3,
            payload_hash = $4
          WHERE id = $1
            AND checkpoint_type = 'AUTHORITY'
            AND payload_hash = $5
            AND payload_compression = 'NONE'`,
          [
            update.id,
            JSON.stringify(update.nextPayload),
            update.nextPayloadCompression,
            update.nextPayloadHash,
            update.oldPayloadHash,
          ]
        );
        if ((result.rowCount ?? 0) !== 1) {
          throw new Error(
            `checkpoint update affected ${result.rowCount ?? 0} rows for ${update.matchId}#${update.checkpointSeq}`
          );
        }
        updatedCount += 1;
      }
    }
    await queryClient.query('COMMIT');
    return updatedCount;
  } catch (error) {
    await queryClient.query('ROLLBACK');
    throw error;
  }
}

async function readRelationSize(
  queryClient: MigrationQueryClient
): Promise<PostgresStorageStats['relationSizeBefore']> {
  const result = await queryClient.query<SizeRow>(
    `SELECT
      pg_total_relation_size('match_checkpoints'::regclass) AS match_checkpoints_total_size,
      COALESCE((
        SELECT pg_total_relation_size(reltoastrelid)
        FROM pg_class
        WHERE oid = 'match_checkpoints'::regclass
          AND reltoastrelid <> 0
      ), 0) AS match_checkpoints_toast_size`
  );
  const row = result.rows[0];
  return {
    matchCheckpointsTotalBytes: toNumber(row?.match_checkpoints_total_size ?? 0),
    toastTotalBytes: toNumber(row?.match_checkpoints_toast_size ?? 0),
  };
}

async function countRemainingInvalidCheckpoints(
  queryClient: MigrationQueryClient,
  args: CompressReplayCheckpointArgs
): Promise<number> {
  const values: unknown[] = [];
  const whereSql = ["checkpoint_type = 'AUTHORITY'"];
  if (args.matchId) {
    values.push(args.matchId);
    whereSql.push(`match_id = $${values.length}`);
  }
  const result = await queryClient.query<RemainingInvalidRow>(
    `SELECT count(*)::int AS remaining_invalid_count
    FROM match_checkpoints
    WHERE ${whereSql.join(' AND ')}
      AND (
        payload_compression <> 'GZIP'
        OR payload->>'compression' <> 'GZIP'
        OR payload->>'encoding' <> 'BASE64_JSON'
        OR payload_hash <> payload->>'payloadHash'
      )`,
    values
  );
  return toNumber(result.rows[0]?.remaining_invalid_count ?? 0);
}

function parsePayloadEnvelope(payload: unknown): ReplaySerializedPayloadEnvelope {
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('checkpoint payload 不是对象');
  }
  return parsed as ReplaySerializedPayloadEnvelope;
}

function blockingError(row: CheckpointRow, code: string, message: string): AnalyzeRowResult {
  return {
    ok: false,
    error: {
      code,
      message,
      checkpoint: {
        id: row.id,
        matchId: row.match_id,
        checkpointSeq: row.checkpoint_seq,
        timelineSeq: row.timeline_seq,
      },
    },
  };
}

function requireNonEmptyArg(arg: string, prefix: string): string {
  const value = arg.slice(prefix.length).trim();
  if (!value) {
    throw new Error(`${prefix}<value> must not be empty`);
  }
  return value;
}

function parsePositiveIntegerArg(arg: string, prefix: string): number {
  const raw = requireNonEmptyArg(arg, prefix);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${prefix}<n> must be a positive integer`);
  }
  return value;
}

function toNumber(value: number | string | null | undefined): number {
  if (value == null) {
    return 0;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }
  return parsed;
}

function percent(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Number(((part / total) * 100).toFixed(2));
}

function printUsage(): void {
  console.log(`
Usage:
  DATABASE_URL=postgresql://... pnpm exec tsx src/scripts/compress-match-replay-checkpoints.ts --dry-run
  DATABASE_URL=postgresql://... pnpm exec tsx src/scripts/compress-match-replay-checkpoints.ts --apply --yes

Options:
  --dry-run             Scan and report only. This is the default.
  --apply               Rewrite legacy NONE/JSON_VALUE authority checkpoints as GZIP/BASE64_JSON.
  --yes                 Required for non-interactive apply.
  --match-id=<id>       Limit scan/apply to one match id.
  --batch-size=<n>      Scan and update batch size. Default: ${DEFAULT_BATCH_SIZE}.
  --limit=<n>           Staging-only scan/apply cap.
  --report=<path>       Write a machine-readable JSON report.
`);
}

function printReportSummary(report: CompressReplayCheckpointReport): void {
  console.log('\nMatch replay checkpoint compression report');
  console.log(`  Mode: ${report.mode}`);
  console.log(`  Match id: ${report.matchId ?? '(all)'}`);
  console.log(`  Scanned authority checkpoints: ${report.stats.scannedCheckpointCount}`);
  console.log(`  Legacy checkpoints to migrate: ${report.stats.legacyCheckpointCount}`);
  console.log(`  Already migrated checkpoints: ${report.stats.alreadyMigratedCheckpointCount}`);
  console.log(`  Planned updates: ${report.stats.updatePlannedCount}`);
  console.log(
    `  Envelope JSON bytes: ${report.stats.originalEnvelopeJsonBytes} -> ${report.stats.targetEnvelopeJsonBytes} (${report.stats.estimatedEnvelopeJsonSavingsPercent}% saved)`
  );
  console.log(
    `  Payload bytes: ${report.stats.uncompressedPayloadBytes} -> ${report.stats.targetCompressedPayloadBytes}`
  );
  console.log(
    `  pg_column_size sample: ${report.postgresql.columnSizeSample.originalBytes} -> ${report.postgresql.columnSizeSample.targetBytes} (${report.postgresql.columnSizeSample.sampledRows} rows)`
  );
  console.log(
    `  Relation size before: ${report.postgresql.relationSizeBefore.matchCheckpointsTotalBytes} bytes, TOAST ${report.postgresql.relationSizeBefore.toastTotalBytes} bytes`
  );
  if (report.postgresql.relationSizeAfter) {
    console.log(
      `  Relation size after: ${report.postgresql.relationSizeAfter.matchCheckpointsTotalBytes} bytes, TOAST ${report.postgresql.relationSizeAfter.toastTotalBytes} bytes`
    );
  }
  if (report.remainingInvalidCheckpointCount !== null) {
    console.log(`  Remaining invalid/non-GZIP checkpoints: ${report.remainingInvalidCheckpointCount}`);
  }
  if (report.blockingErrors.length > 0) {
    console.error(`  Blocking errors: ${report.blockingErrors.length}`);
    for (const error of report.blockingErrors.slice(0, 20)) {
      const checkpoint = error.checkpoint
        ? `${error.checkpoint.matchId}#${error.checkpoint.checkpointSeq}`
        : '(unknown)';
      console.error(`    - [${error.code}] ${checkpoint}: ${error.message}`);
    }
    if (report.blockingErrors.length > 20) {
      console.error(`    ... and ${report.blockingErrors.length - 20} more`);
    }
  }
  if (report.applied.attempted) {
    console.log(`  Updated checkpoints: ${report.applied.updatedCount}`);
  }
}

function writeReport(reportPath: string | null, report: CompressReplayCheckpointReport): void {
  if (!reportPath) {
    return;
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nReport written: ${reportPath}`);
}

async function confirmApply(args: CompressReplayCheckpointArgs): Promise<void> {
  if (args.mode !== 'apply' || args.yes) {
    return;
  }
  if (!process.stdin.isTTY) {
    throw new Error('--apply in non-interactive mode requires --yes');
  }

  console.log('\nBefore applying, confirm that new match writes are stopped and the database is backed up.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('Type APPLY to compress replay checkpoints: ');
    if (answer !== 'APPLY') {
      throw new Error('Apply confirmation rejected');
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  await confirmApply(args);
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    const report = await runCheckpointCompressionMigration(client, args);
    printReportSummary(report);
    writeReport(args.reportPath, report);
    if (report.blockingErrors.length > 0) {
      process.exitCode = 1;
    }
    if (
      args.mode === 'apply' &&
      args.limit === null &&
      report.remainingInvalidCheckpointCount !== 0
    ) {
      process.exitCode = 1;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
