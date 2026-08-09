/**
 * 清理超过保留期限的对局回放数据，同时保留对局元信息。
 *
 * 脚本默认以 dry-run 模式运行。完成备份并进入维护窗口后，才可执行实际清理：
 *   DATABASE_URL=... pnpm exec tsx drizzle/data-migrations/purge-expired-match-replay-data.ts --dry-run
 *   DATABASE_URL=... pnpm exec tsx drizzle/data-migrations/purge-expired-match-replay-data.ts --apply --yes
 *
 * 实际清理按批次在独立事务中删除时间线、检查点、公开/私密事件和决策记录，
 * 清空卡组明细，并将对局标记为 METADATA_ONLY。排位对局必须已持久化双方
 * 赛季环境卡组观察记录；任一候选排位对局缺失完整观察时，apply 会在删除前阻断。
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
  readonly blockedRankedMatchCount: number;
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

  const blockerCount = await queryClient.query<CountRow>(rankedObservationBlockerCountSql(), [
    args.cutoff,
  ]);
  const blockedRankedMatchCount = number(blockerCount.rows[0]?.count ?? 0);

  if (args.mode === 'dry-run') {
    const count = await queryClient.query<CountRow>(countSql(), [args.cutoff]);
    return {
      ...totals,
      script: 'purge-expired-match-replay-data',
      mode: args.mode,
      retentionDays: args.retentionDays,
      cutoff: args.cutoff,
      candidateMatchCount: number(count.rows[0]?.count ?? totals.candidateMatchCount),
      blockedRankedMatchCount,
      metadataRowsUpdated: 0,
    };
  }

  if (blockedRankedMatchCount > 0) {
    throw new Error(
      `Replay purge blocked: ${blockedRankedMatchCount} ranked candidate match(es) do not have two complete deck observations`
    );
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
    blockedRankedMatchCount,
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

function rankedObservationBlockerCountSql(): string {
  return `SELECT count(*) AS count
    FROM match_records AS record
    JOIN ranked_matches AS ranked_match ON ranked_match.match_id = record.match_id
    WHERE record.status <> 'IN_PROGRESS' AND record.sealed_at IS NOT NULL
      AND record.sealed_at < $1 AND record.completeness <> 'METADATA_ONLY'
      AND NOT (${rankedObservationReadySql('record')})`;
}

function candidateIdsSql(): string {
  return `SELECT record.match_id FROM match_records AS record
    WHERE record.status <> 'IN_PROGRESS' AND record.sealed_at IS NOT NULL
      AND record.sealed_at < $1 AND record.completeness <> 'METADATA_ONLY'
      AND ${rankedObservationReadySql('record')}
    ORDER BY record.sealed_at ASC, record.match_id ASC LIMIT $2`;
}

function purgeBatchSql(): string {
  return `WITH selected AS (
      SELECT record.match_id FROM match_records AS record
      WHERE record.match_id = ANY($1::text[]) AND record.status <> 'IN_PROGRESS'
        AND record.sealed_at IS NOT NULL AND record.sealed_at < $2
        AND record.completeness <> 'METADATA_ONLY'
        AND ${rankedObservationReadySql('record')}
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

function rankedObservationReadySql(recordAlias: string): string {
  return `NOT EXISTS (
        SELECT 1
        FROM ranked_matches AS protected_ranked_match
        WHERE protected_ranked_match.match_id = ${recordAlias}.match_id
          AND (
            (SELECT count(*)
             FROM ranked_deck_observations AS observation
             WHERE observation.match_id = protected_ranked_match.match_id) <> 2
            OR NOT EXISTS (
              SELECT 1
              FROM ranked_deck_observations AS first_observation
              WHERE first_observation.match_id = protected_ranked_match.match_id
                AND first_observation.season_id = protected_ranked_match.season_id
                AND first_observation.seat = 'FIRST'
                AND first_observation.user_id = protected_ranked_match.first_user_id
            )
            OR NOT EXISTS (
              SELECT 1
              FROM ranked_deck_observations AS second_observation
              WHERE second_observation.match_id = protected_ranked_match.match_id
                AND second_observation.season_id = protected_ranked_match.season_id
                AND second_observation.seat = 'SECOND'
                AND second_observation.user_id = protected_ranked_match.second_user_id
            )
          )
      )`;
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
