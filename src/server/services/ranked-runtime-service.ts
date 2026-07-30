import { pool } from '../db/pool.js';
import { publicTableService, type MatchmakingQueueContext } from './public-table-service.js';
import { rankedRatingService } from './ranked-rating-service.js';
import { isRankedQueueWindowOpen, type RankedSeasonOpenWindow } from './ranked-season-service.js';

interface RankedQueueSeasonRow {
  readonly season_id: string;
  readonly environment_id: string;
  readonly lifecycle: 'ACTIVE' | 'FINALIZING' | 'CLOSED';
  readonly queue_admission: 'OPEN' | 'PAUSED';
  readonly platform_time_zone: string;
  readonly open_windows: RankedSeasonOpenWindow[];
  readonly starts_at: Date | string;
  readonly scheduled_ends_at: Date | string;
}

export interface RankedRuntimeCleanupSummary {
  readonly seasonsEnteredFinalizing: number;
  readonly expiredWaitingTickets: number;
  readonly settlementCandidates: number;
  readonly settledMatches: number;
  readonly deferredSettlements: number;
  readonly voidedExpiredMatches: number;
}

export class RankedRuntimeService {
  private readonly now: () => Date;

  constructor(options: { readonly now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async cleanup(): Promise<RankedRuntimeCleanupSummary> {
    const seasonsEnteredFinalizing = await this.transitionEndedSeasons();
    const expiredWaitingTickets = await this.expireClosedWaitingQueues();
    const settlement = await this.retryPendingSettlements();
    const voidedExpiredMatches = await this.voidExpiredPendingMatches();
    return {
      seasonsEnteredFinalizing,
      expiredWaitingTickets,
      ...settlement,
      voidedExpiredMatches,
    };
  }

  async transitionEndedSeasons(): Promise<number> {
    const result = await pool.query<{ readonly id: string }>(
      `UPDATE ranked_seasons
       SET lifecycle = 'FINALIZING',
           queue_admission = 'PAUSED',
           updated_at = NOW()
       WHERE lifecycle = 'ACTIVE'
         AND scheduled_ends_at <= $1
       RETURNING id`,
      [this.now()]
    );
    for (const row of result.rows) {
      console.info(
        JSON.stringify({
          scope: 'ranked_season',
          event: 'RANKED_SEASON_AUTO_FINALIZING',
          seasonId: row.id,
        })
      );
    }
    return result.rowCount ?? 0;
  }

  async expireClosedWaitingQueues(): Promise<number> {
    const result = await pool.query<RankedQueueSeasonRow>(
      `SELECT DISTINCT
         ticket.season_id,
         ticket.environment_id,
         season.lifecycle,
         season.queue_admission,
         season.platform_time_zone,
         season.open_windows,
         season.starts_at,
         season.scheduled_ends_at
       FROM public_table_tickets AS ticket
       JOIN ranked_seasons AS season ON season.id = ticket.season_id
       WHERE ticket.queue_kind = 'RANKED'
         AND ticket.state = 'WAITING'`
    );
    const now = this.now();
    let expired = 0;
    for (const row of result.rows) {
      if (
        row.lifecycle === 'ACTIVE' &&
        row.queue_admission === 'OPEN' &&
        isRankedQueueWindowOpen(
          now,
          row.platform_time_zone,
          row.open_windows,
          new Date(row.starts_at),
          new Date(row.scheduled_ends_at)
        )
      ) {
        continue;
      }
      const context: MatchmakingQueueContext = {
        queueKind: 'RANKED',
        participationKind: 'RANKED_QUEUE',
        environmentId: row.environment_id,
        seasonId: row.season_id,
      };
      expired += await publicTableService.expireWaitingTickets(context, 'RANKED_QUEUE_CLOSED');
    }
    return expired;
  }

  async retryPendingSettlements(): Promise<{
    readonly settlementCandidates: number;
    readonly settledMatches: number;
    readonly deferredSettlements: number;
  }> {
    const result = await pool.query<{ readonly match_id: string }>(
      `SELECT ranked_match.match_id
       FROM ranked_matches AS ranked_match
       JOIN ranked_seasons AS season ON season.id = ranked_match.season_id
       JOIN match_records AS record ON record.match_id = ranked_match.match_id
       WHERE ranked_match.rating_status = 'PENDING'
         AND season.lifecycle IN ('ACTIVE', 'FINALIZING')
         AND record.origin_kind = 'RANKED'
         AND record.completeness = 'FULL'
         AND record.status IN ('COMPLETED', 'SURRENDERED')
         AND record.sealed_at IS NOT NULL
         AND record.ended_at IS NOT NULL
       ORDER BY record.ended_at, ranked_match.match_id
       LIMIT 50`
    );
    let settledMatches = 0;
    let deferredSettlements = 0;
    for (const row of result.rows) {
      try {
        await rankedRatingService.settleMatch(row.match_id);
        settledMatches += 1;
      } catch (error) {
        deferredSettlements += 1;
        console.error(
          JSON.stringify({
            scope: 'ranked_settlement',
            event: 'RANKED_SETTLEMENT_RETRY_DEFERRED',
            matchId: row.match_id,
            message: readErrorMessage(error),
          })
        );
      }
    }
    return {
      settlementCandidates: result.rows.length,
      settledMatches,
      deferredSettlements,
    };
  }

  async voidExpiredPendingMatches(): Promise<number> {
    const result = await pool.query<{ readonly match_id: string; readonly season_id: string }>(
      `UPDATE ranked_matches AS ranked_match
       SET rating_status = 'VOIDED',
           winner_seat = NULL,
           result_type = 'PLATFORM_NO_CONTEST',
           ended_at = COALESCE(ranked_match.ended_at, $1),
           settled_at = $1,
           updated_at = $1
       FROM ranked_seasons AS season
       WHERE season.id = ranked_match.season_id
         AND season.lifecycle = 'FINALIZING'
         AND season.finalizing_deadline_at <= $1
         AND ranked_match.rating_status = 'PENDING'
       RETURNING ranked_match.match_id, ranked_match.season_id`,
      [this.now()]
    );
    for (const row of result.rows) {
      console.warn(
        JSON.stringify({
          scope: 'ranked_settlement',
          event: 'RANKED_MATCH_DEADLINE_VOIDED',
          seasonId: row.season_id,
          matchId: row.match_id,
          reason: 'FINALIZING_DEADLINE_EXCEEDED',
        })
      );
    }
    return result.rowCount ?? 0;
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const rankedRuntimeService = new RankedRuntimeService();
