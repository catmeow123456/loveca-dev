import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import {
  ReplayRetentionError,
  runReplayRetention,
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
export const REPLAY_RETENTION_CONFIRMATION = '清理10天前回放数据';

export type { ReplayRetentionReport } from './replay-retention.js';

export class PlatformOperationsServiceError extends Error {
  constructor(
    readonly code:
      'CONFIRMATION_REQUIRED' | 'RANKED_OBSERVATION_BLOCKED' | 'ANALYSIS_EXPORT_UNAVAILABLE',
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
