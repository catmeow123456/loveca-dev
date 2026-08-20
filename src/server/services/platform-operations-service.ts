import { pool } from '../db/pool.js';
import {
  ReplayRetentionError,
  runReplayRetention,
  type ReplayRetentionReport,
} from './replay-retention.js';

const RETENTION_DAYS = 10;
const RETENTION_BATCH_SIZE = 100;
export const REPLAY_RETENTION_CONFIRMATION = '清理10天前回放数据';

export type { ReplayRetentionReport } from './replay-retention.js';

export class PlatformOperationsServiceError extends Error {
  constructor(
    readonly code: 'CONFIRMATION_REQUIRED' | 'RANKED_OBSERVATION_BLOCKED' | 'REPORT_UNAVAILABLE',
    message: string
  ) {
    super(message);
  }
}
const cutoffFor = (now: Date) =>
  new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();

export class PlatformOperationsService {
  async previewReplayRetention(now = new Date()): Promise<ReplayRetentionReport> {
    const cutoff = cutoffFor(now);
    const client = await pool.connect();
    try {
      return await runReplayRetention(client, {
        mode: 'dry-run',
        retentionDays: RETENTION_DAYS,
        batchSize: RETENTION_BATCH_SIZE,
        cutoff,
      });
    } finally {
      client.release();
    }
  }
  async applyReplayRetention(
    confirmation: string,
    adminUserId: string,
    now = new Date()
  ): Promise<ReplayRetentionReport> {
    if (confirmation !== REPLAY_RETENTION_CONFIRMATION)
      throw new PlatformOperationsServiceError(
        'CONFIRMATION_REQUIRED',
        `请输入“${REPLAY_RETENTION_CONFIRMATION}”以确认`
      );
    const cutoff = cutoffFor(now);
    const client = await pool.connect();
    try {
      const report = await runReplayRetention(client, {
        mode: 'apply',
        retentionDays: RETENTION_DAYS,
        batchSize: RETENTION_BATCH_SIZE,
        cutoff,
      });
      console.info(
        JSON.stringify({
          event: 'replay-retention-applied',
          adminUserId,
          cutoff,
          candidateMatchCount: report.candidateMatchCount,
          metadataRowsUpdated: report.metadataRowsUpdated,
        })
      );
      return report;
    } catch (error) {
      if (error instanceof ReplayRetentionError) {
        throw new PlatformOperationsServiceError(
          'RANKED_OBSERVATION_BLOCKED',
          `有 ${error.blockedRankedMatchCount} 局排位对局缺少完整卡组观察，不能清理`
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }
  async generateRankedVolatilityReport(
    seasonId?: string
  ): Promise<{ report: unknown; markdown: string }> {
    try {
      const module = (await import(
        new URL('../../../scripts/generate-ranked-volatility-report.mjs', import.meta.url).href
      )) as {
        RANKED_VOLATILITY_REPORT_SQL: string;
        buildRankedVolatilityReport(payload: unknown, now?: Date): unknown;
        formatRankedVolatilityReportMarkdown(report: unknown): string;
      };
      const client = await pool.connect();
      try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        await client.query("SET LOCAL statement_timeout TO '60000ms'");
        await client.query("SET LOCAL lock_timeout TO '2000ms'");
        const payload = (
          await client.query(module.RANKED_VOLATILITY_REPORT_SQL, [seasonId ?? null])
        ).rows[0];
        await client.query('COMMIT');
        const report = module.buildRankedVolatilityReport(payload, new Date());
        return { report, markdown: module.formatRankedVolatilityReportMarkdown(report) };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('[PlatformOperations] Ranked volatility report failed:', error);
      throw new PlatformOperationsServiceError(
        'REPORT_UNAVAILABLE',
        '生成赛季报告失败，请稍后重试'
      );
    }
  }
}

export const platformOperationsService = new PlatformOperationsService();
