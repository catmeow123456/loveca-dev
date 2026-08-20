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
import {
  runReplayRetention,
  type ReplayRetentionMode,
  type ReplayRetentionQueryClient,
  type ReplayRetentionReport,
} from '../../src/server/services/replay-retention.js';

type MigrationMode = ReplayRetentionMode;

export type PurgeReplayQueryClient = ReplayRetentionQueryClient;

export interface PurgeReplayArgs {
  readonly mode: MigrationMode;
  readonly retentionDays: number;
  readonly batchSize: number;
  readonly cutoff: string;
  readonly yes: boolean;
}

export interface PurgeReplayReport extends ReplayRetentionReport {
  readonly script: 'purge-expired-match-replay-data';
  readonly mode: MigrationMode;
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
  const report = await runReplayRetention(queryClient, args);
  return {
    ...report,
    script: 'purge-expired-match-replay-data',
    mode: args.mode,
  };
}

function parsePositiveInteger(value: string, prefix: string): number {
  const parsed = Number(value.slice(prefix.length));
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`Invalid ${prefix} value: ${value}`);
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
