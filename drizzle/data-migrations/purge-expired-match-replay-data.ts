/**
 * 清理超过保留期限的对局回放数据，同时保留对局元信息。
 *
 * 脚本默认以 dry-run 模式运行。完成备份并进入维护窗口后，才可执行实际清理：
 *   DATABASE_URL=... pnpm exec tsx drizzle/data-migrations/purge-expired-match-replay-data.ts --dry-run
 *   DATABASE_URL=... pnpm exec tsx drizzle/data-migrations/purge-expired-match-replay-data.ts --apply --yes
 *
 * 实际清理按批次在独立事务中删除时间线、检查点、公开/私密事件和决策记录，
 * 清空卡组明细，并将对局标记为 METADATA_ONLY。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

type MigrationMode = 'dry-run' | 'apply';

export interface PurgeReplayArgs {
  readonly mode: MigrationMode;
  readonly retentionDays: number;
  readonly batchSize: number;
  readonly cutoff: string;
  readonly yes: boolean;
}

export interface PurgeReplayQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<{ readonly rows: T[]; readonly rowCount?: number | null }>;
}

interface CandidateRow {
  readonly match_id: string;
  readonly replay_rows: number | string;
  readonly checkpoint_rows: number | string;
  readonly event_rows: number | string;
  readonly decision_rows: number | string;
}

interface CountRow {
  readonly count: number | string;
}

export interface PurgeReplayReport {
  readonly script: 'purge-expired-match-replay-data';
  readonly mode: MigrationMode;
  readonly retentionDays: number;
  readonly cutoff: string;
  readonly candidateMatchCount: number;
  readonly replayRows: number;
  readonly checkpointRows: number;
  readonly eventRows: number;
  readonly decisionRows: number;
  readonly metadataRowsUpdated: number;
}

const DEFAULT_RETENTION_DAYS = 10;
const DEFAULT_BATCH_SIZE = 100;

export function parseArgs(argv: readonly string[], now = new Date()): PurgeReplayArgs {
  let mode: MigrationMode = 'dry-run';
  let retentionDays = DEFAULT_RETENTION_DAYS;
  let batchSize = DEFAULT_BATCH_SIZE;
  let explicitCutoff: string | null = null;
  let yes = false;

  for (const arg of argv) {
    if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--apply') mode = 'apply';
    else if (arg === '--yes') yes = true;
    else if (arg.startsWith('--retention-days=')) {
      retentionDays = parsePositiveInteger(arg, '--retention-days=');
    } else if (arg.startsWith('--batch-size=')) {
      batchSize = parsePositiveInteger(arg, '--batch-size=');
    } else if (arg.startsWith('--cutoff=')) {
      const value = arg.slice('--cutoff='.length);
      if (!value || Number.isNaN(Date.parse(value)))
        throw new Error(`Invalid --cutoff value: ${value}`);
      explicitCutoff = new Date(value).toISOString();
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: ... [--dry-run|--apply --yes] [--retention-days=10] [--batch-size=100] [--cutoff=ISO]'
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (mode === 'apply' && !yes) throw new Error('--apply requires --yes');
  const cutoff =
    explicitCutoff ?? new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  return { mode, retentionDays, batchSize, cutoff, yes };
}

export async function runPurgeReplayMigration(
  queryClient: PurgeReplayQueryClient,
  args: PurgeReplayArgs
): Promise<PurgeReplayReport> {
  const candidates = await queryClient.query<CandidateRow>(candidateSql(), [args.cutoff]);
  const totals = candidates.rows.reduce(
    (result, row) => ({
      candidateMatchCount: result.candidateMatchCount + 1,
      replayRows: result.replayRows + number(row.replay_rows),
      checkpointRows: result.checkpointRows + number(row.checkpoint_rows),
      eventRows: result.eventRows + number(row.event_rows),
      decisionRows: result.decisionRows + number(row.decision_rows),
    }),
    { candidateMatchCount: 0, replayRows: 0, checkpointRows: 0, eventRows: 0, decisionRows: 0 }
  );

  if (args.mode === 'dry-run') {
    const count = await queryClient.query<CountRow>(countSql(), [args.cutoff]);
    return {
      ...totals,
      script: 'purge-expired-match-replay-data',
      mode: args.mode,
      retentionDays: args.retentionDays,
      cutoff: args.cutoff,
      candidateMatchCount: number(count.rows[0]?.count ?? totals.candidateMatchCount),
      metadataRowsUpdated: 0,
    };
  }

  let metadataRowsUpdated = 0;
  while (true) {
    const batch = await queryClient.query<{ match_id: string }>(candidateIdsSql(), [
      args.cutoff,
      args.batchSize,
    ]);
    if (batch.rows.length === 0) break;
    const ids = batch.rows.map((row) => row.match_id);
    await queryClient.query('BEGIN');
    try {
      const updated = await queryClient.query<{ count: number }>(purgeBatchSql(), [
        ids,
        args.cutoff,
      ]);
      await queryClient.query('COMMIT');
      metadataRowsUpdated += number(updated.rows[0]?.count ?? updated.rowCount ?? ids.length);
    } catch (error) {
      await queryClient.query('ROLLBACK');
      throw error;
    }
  }

  return {
    ...totals,
    script: 'purge-expired-match-replay-data',
    mode: args.mode,
    retentionDays: args.retentionDays,
    cutoff: args.cutoff,
    metadataRowsUpdated,
  };
}

function candidateSql(): string {
  return `SELECT record.match_id,
    (SELECT count(*) FROM match_timeline_entries WHERE match_id = record.match_id) +
    (SELECT count(*) FROM match_checkpoints WHERE match_id = record.match_id) +
    (SELECT count(*) FROM match_record_public_events WHERE match_id = record.match_id) +
    (SELECT count(*) FROM match_record_private_events WHERE match_id = record.match_id) AS replay_rows,
    (SELECT count(*) FROM match_checkpoints WHERE match_id = record.match_id) AS checkpoint_rows,
    (SELECT count(*) FROM match_record_public_events WHERE match_id = record.match_id) +
    (SELECT count(*) FROM match_record_private_events WHERE match_id = record.match_id) AS event_rows,
    (SELECT count(*) FROM match_decision_records WHERE match_id = record.match_id) AS decision_rows
    FROM match_records record
    WHERE record.status <> 'IN_PROGRESS'
      AND record.sealed_at IS NOT NULL
      AND record.sealed_at < $1
      AND record.completeness <> 'METADATA_ONLY'
    ORDER BY record.sealed_at ASC, record.match_id ASC`;
}

function countSql(): string {
  return `SELECT count(*) FROM match_records record
    WHERE record.status <> 'IN_PROGRESS' AND record.sealed_at IS NOT NULL
      AND record.sealed_at < $1 AND record.completeness <> 'METADATA_ONLY'`;
}

function candidateIdsSql(): string {
  return `SELECT match_id FROM match_records
    WHERE status <> 'IN_PROGRESS' AND sealed_at IS NOT NULL AND sealed_at < $1
      AND completeness <> 'METADATA_ONLY'
    ORDER BY sealed_at ASC, match_id ASC LIMIT $2`;
}

function purgeBatchSql(): string {
  return `WITH selected AS (
      SELECT match_id FROM match_records
      WHERE match_id = ANY($1::text[]) AND status <> 'IN_PROGRESS'
        AND sealed_at IS NOT NULL AND sealed_at < $2 AND completeness <> 'METADATA_ONLY'
    ),
    deleted_decisions AS (DELETE FROM match_decision_records WHERE match_id IN (SELECT match_id FROM selected)),
    deleted_checkpoints AS (DELETE FROM match_checkpoints WHERE match_id IN (SELECT match_id FROM selected)),
    deleted_public AS (DELETE FROM match_record_public_events WHERE match_id IN (SELECT match_id FROM selected)),
    deleted_private AS (DELETE FROM match_record_private_events WHERE match_id IN (SELECT match_id FROM selected)),
    deleted_timeline AS (DELETE FROM match_timeline_entries WHERE match_id IN (SELECT match_id FROM selected)),
    updated_decks AS (UPDATE match_deck_snapshots SET main_deck = '[]'::jsonb, energy_deck = '[]'::jsonb, card_summaries = '{}'::jsonb WHERE match_id IN (SELECT match_id FROM selected)),
    updated_records AS (
      UPDATE match_records SET completeness = 'METADATA_ONLY', replay_capabilities = '[]'::jsonb,
        replay_limitations = CASE WHEN replay_limitations @> '["REPLAY_DATA_PURGED"]'::jsonb
          THEN replay_limitations ELSE replay_limitations || '["REPLAY_DATA_PURGED"]'::jsonb END,
        partial_reason = '回放数据已按保留策略清理', updated_at = now()
      WHERE match_id IN (SELECT match_id FROM selected)
      RETURNING match_id
    )
    SELECT count(*)::int AS count FROM updated_records`;
}

function parsePositiveInteger(value: string, prefix: string): number {
  const parsed = Number(value.slice(prefix.length));
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`Invalid ${prefix} value: ${value}`);
  return parsed;
}

function number(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`Invalid numeric migration result: ${String(value)}`);
  return parsed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const report = await runPurgeReplayMigration(client, args);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
