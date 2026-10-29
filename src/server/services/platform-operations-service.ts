import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import {
  ReplayRetentionError,
  runReplayRetention,
  type ReplayRetentionProgress,
  type ReplayRetentionReport,
} from './replay-retention.js';
import {
  createRankedAnalysisZip,
  type RankedAnalysisDeckObservationRow,
  type RankedAnalysisMatchRow,
  type RankedAnalysisProjectionRow,
  type RankedAnalysisRatingEventRow,
  type RankedAnalysisRatingStepRow,
  type RankedAnalysisSeasonRow,
  type RankedAnalysisSeedRow,
} from './ranked-analysis-export.js';

const RETENTION_DAYS = 10;
const RETENTION_BATCH_SIZE = 100;
const MAX_REPLAY_RETENTION_JOBS = 20;
export const REPLAY_RETENTION_CONFIRMATION = '清理10天前回放数据';

export type { ReplayRetentionReport } from './replay-retention.js';

export type ReplayRetentionJobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export interface ReplayRetentionJob {
  readonly id: string;
  readonly status: ReplayRetentionJobStatus;
  readonly progress: ReplayRetentionProgress;
  readonly report: ReplayRetentionReport | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export class PlatformOperationsServiceError extends Error {
  constructor(
    readonly code:
      | 'CONFIRMATION_REQUIRED'
      | 'RANKED_OBSERVATION_BLOCKED'
      | 'REPLAY_RETENTION_IN_PROGRESS'
      | 'REPLAY_RETENTION_JOB_NOT_FOUND'
      | 'ANALYSIS_EXPORT_UNAVAILABLE',
    message: string
  ) {
    super(message);
  }
}
const cutoffFor = (now: Date) =>
  new Date(now.getTime() - RETENTION_DAYS * 86_400_000).toISOString();

export class PlatformOperationsService {
  private readonly replayRetentionJobs = new Map<string, ReplayRetentionJob>();
  private activeReplayRetentionJobId: string | null = null;

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

  startReplayRetention(
    confirmation: string,
    adminUserId: string,
    now = new Date()
  ): ReplayRetentionJob {
    if (confirmation !== REPLAY_RETENTION_CONFIRMATION)
      throw new PlatformOperationsServiceError(
        'CONFIRMATION_REQUIRED',
        `请输入“${REPLAY_RETENTION_CONFIRMATION}”以确认`
      );

    if (this.activeReplayRetentionJobId) {
      const active = this.replayRetentionJobs.get(this.activeReplayRetentionJobId);
      if (active && (active.status === 'QUEUED' || active.status === 'RUNNING')) {
        throw new PlatformOperationsServiceError(
          'REPLAY_RETENTION_IN_PROGRESS',
          '已有一项回放清理正在进行，请等待当前任务完成'
        );
      }
    }

    this.pruneReplayRetentionJobs();
    const timestamp = now.toISOString();
    const job: ReplayRetentionJob = {
      id: randomUUID(),
      status: 'QUEUED',
      progress: {
        phase: 'preparing',
        candidateMatchCount: 0,
        processedMatchCount: 0,
        metadataRowsUpdated: 0,
        replayRows: 0,
        checkpointRows: 0,
        eventRows: 0,
        decisionRows: 0,
        blockedRankedMatchCount: 0,
      },
      report: null,
      error: null,
      startedAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };
    this.replayRetentionJobs.set(job.id, job);
    this.activeReplayRetentionJobId = job.id;
    void this.executeReplayRetentionJob(job.id, adminUserId, now);
    return job;
  }

  getReplayRetentionJob(jobId: string): ReplayRetentionJob {
    const job = this.replayRetentionJobs.get(jobId);
    if (!job)
      throw new PlatformOperationsServiceError(
        'REPLAY_RETENTION_JOB_NOT_FOUND',
        '回放清理任务不存在或已过期'
      );
    return job;
  }

  private async executeReplayRetentionJob(
    jobId: string,
    adminUserId: string,
    now: Date
  ): Promise<void> {
    const job = this.replayRetentionJobs.get(jobId);
    if (!job) return;
    const cutoff = cutoffFor(now);
    this.updateReplayRetentionJob(jobId, { status: 'RUNNING' });
    const client = await pool.connect().catch((error: unknown) => {
      console.error('[PlatformOperations] Replay retention job connection failed:', {
        jobId,
        adminUserId,
        error,
      });
      this.failReplayRetentionJob(jobId, 'INTERNAL_ERROR', '清理回放数据失败，请稍后重试');
      return null;
    });
    if (!client) {
      if (this.activeReplayRetentionJobId === jobId) this.activeReplayRetentionJobId = null;
      return;
    }
    try {
      const report = await runReplayRetention(client, {
        mode: 'apply',
        retentionDays: RETENTION_DAYS,
        batchSize: RETENTION_BATCH_SIZE,
        cutoff,
        onProgress: (progress) => this.updateReplayRetentionJob(jobId, { progress }),
      });
      this.updateReplayRetentionJob(jobId, {
        status: 'SUCCEEDED',
        report,
        completedAt: new Date().toISOString(),
        progress: {
          phase: 'completed',
          candidateMatchCount: report.candidateMatchCount,
          processedMatchCount: report.processedMatchCount,
          metadataRowsUpdated: report.metadataRowsUpdated,
          replayRows: report.replayRows,
          checkpointRows: report.checkpointRows,
          eventRows: report.eventRows,
          decisionRows: report.decisionRows,
          blockedRankedMatchCount: report.blockedRankedMatchCount,
        },
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
    } catch (error) {
      if (error instanceof ReplayRetentionError) {
        this.failReplayRetentionJob(
          jobId,
          'RANKED_OBSERVATION_BLOCKED',
          `有 ${error.blockedRankedMatchCount} 局排位对局缺少完整卡组观察，不能清理`
        );
      } else {
        this.failReplayRetentionJob(jobId, 'INTERNAL_ERROR', '清理回放数据失败，请稍后重试');
        console.error('[PlatformOperations] Replay retention job failed:', error);
      }
    } finally {
      client.release();
      if (this.activeReplayRetentionJobId === jobId) this.activeReplayRetentionJobId = null;
    }
  }

  private updateReplayRetentionJob(
    jobId: string,
    patch: Partial<
      Pick<ReplayRetentionJob, 'status' | 'progress' | 'report' | 'error' | 'completedAt'>
    >
  ): void {
    const current = this.replayRetentionJobs.get(jobId);
    if (!current) return;
    this.replayRetentionJobs.set(jobId, {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }

  private failReplayRetentionJob(jobId: string, code: string, message: string): void {
    this.updateReplayRetentionJob(jobId, {
      status: 'FAILED',
      error: { code, message },
      completedAt: new Date().toISOString(),
    });
  }

  private pruneReplayRetentionJobs(): void {
    if (this.replayRetentionJobs.size < MAX_REPLAY_RETENTION_JOBS) return;
    for (const [id, job] of this.replayRetentionJobs) {
      if (job.status === 'QUEUED' || job.status === 'RUNNING') continue;
      this.replayRetentionJobs.delete(id);
      if (this.replayRetentionJobs.size < MAX_REPLAY_RETENTION_JOBS) break;
    }
  }

  async exportRankedAnalysis(
    seasonId: string,
    adminUserId: string,
    now = new Date()
  ): Promise<{ readonly filename: string; readonly buffer: Buffer }> {
    let client: PoolClient | null = null;
    let transactionOpen = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      transactionOpen = true;
      await client.query("SET LOCAL statement_timeout TO '60000ms'");
      await client.query("SET LOCAL lock_timeout TO '2000ms'");
      const season = (
        await client.query<RankedAnalysisSeasonRow>(
          `/* ranked-analysis:season */
           SELECT
             season_key, name, lifecycle, starts_at, scheduled_ends_at, closed_at,
             rules_version, card_catalog_version, card_catalog_hash, deck_policy_version,
             rating_algorithm_version, rating_config, leaderboard_minimum_match_count,
             ledger_revision
           FROM ranked_seasons
           WHERE id = $1`,
          [seasonId]
        )
      ).rows[0];
      if (!season) throw new Error('ranked season not found');

      const matches = await client.query<RankedAnalysisMatchRow>(
        `/* ranked-analysis:matches */
         SELECT
           match_id, first_user_id, second_user_id, rating_status, winner_seat, result_type,
           used_free, rules_version, card_catalog_version, card_catalog_hash,
           deck_policy_version, rating_algorithm_version, ended_at, settled_at, created_at
         FROM ranked_matches
         WHERE season_id = $1
         ORDER BY created_at ASC, match_id ASC`,
        [seasonId]
      );
      const ratingEvents = await client.query<RankedAnalysisRatingEventRow>(
        `/* ranked-analysis:rating-events */
         SELECT
           id, event_sequence, event_type, match_id, target_event_id, first_user_id,
           second_user_id, winner_seat, result_type, rated_at, algorithm_version, created_at
         FROM ranked_rating_events
         WHERE season_id = $1
         ORDER BY event_sequence ASC, id ASC`,
        [seasonId]
      );
      const ratingSteps = await client.query<RankedAnalysisRatingStepRow>(
        `/* ranked-analysis:rating-steps */
         SELECT
           step.event_id, step.step_index, step.source_result_event_id, step.match_id,
           step.first_user_id, step.second_user_id, step.winner_seat, step.rated_at,
           step.first_before_rating, step.first_before_deviation, step.first_before_match_count,
           step.first_before_last_rated_at, step.first_after_rating, step.first_after_deviation,
           step.first_after_match_count, step.first_after_last_rated_at,
           step.second_before_rating, step.second_before_deviation, step.second_before_match_count,
           step.second_before_last_rated_at, step.second_after_rating, step.second_after_deviation,
           step.second_after_match_count, step.second_after_last_rated_at, step.created_at
         FROM ranked_rating_event_steps AS step
         JOIN ranked_rating_events AS event ON event.id = step.event_id
         WHERE event.season_id = $1
         ORDER BY event.event_sequence ASC, step.step_index ASC`,
        [seasonId]
      );
      const seeds = await client.query<RankedAnalysisSeedRow>(
        `/* ranked-analysis:seeds */
         SELECT
           seed.user_id, source.season_key AS source_season_key, seed.rating,
           seed.rating_deviation, seed.created_at
         FROM ranked_player_seeds AS seed
         LEFT JOIN ranked_seasons AS source ON source.id = seed.source_season_id
         WHERE seed.season_id = $1
         ORDER BY seed.user_id ASC`,
        [seasonId]
      );
      const projections = await client.query<RankedAnalysisProjectionRow>(
        `/* ranked-analysis:projections */
         SELECT
           user_id, rating, rating_deviation, rated_match_count, last_rated_at,
           ledger_revision, updated_at
         FROM ranked_player_ratings
         WHERE season_id = $1
         ORDER BY user_id ASC`,
        [seasonId]
      );
      const deckObservations = await client.query<RankedAnalysisDeckObservationRow>(
        `/* ranked-analysis:deck-observations */
         SELECT
           match_id, seat, user_id, deck_fingerprint, main_deck_cards, observed_at
         FROM ranked_deck_observations
         WHERE season_id = $1
         ORDER BY match_id ASC, seat ASC`,
        [seasonId]
      );
      await client.query('COMMIT');
      transactionOpen = false;

      const result = await createRankedAnalysisZip(
        {
          season,
          matches: matches.rows,
          ratingEvents: ratingEvents.rows,
          ratingSteps: ratingSteps.rows,
          seeds: seeds.rows,
          projections: projections.rows,
          deckObservations: deckObservations.rows,
        },
        now
      );
      console.info(
        JSON.stringify({
          event: 'ranked-analysis-exported',
          adminUserId,
          seasonKey: season.season_key,
          matchCount: matches.rows.length,
          deckObservationCount: deckObservations.rows.length,
        })
      );
      return result;
    } catch (error) {
      if (client && transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
      console.error('[PlatformOperations] Ranked analysis export failed:', error);
      throw new PlatformOperationsServiceError(
        'ANALYSIS_EXPORT_UNAVAILABLE',
        '生成赛季分析数据失败，请稍后重试'
      );
    } finally {
      client?.release();
    }
  }
}

export const platformOperationsService = new PlatformOperationsService();
