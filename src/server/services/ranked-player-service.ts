import type {
  RankedAvailabilityView,
  RankedLeaderboardEntryView,
  RankedOverviewView,
  RankedPlayerSeasonView,
  RankedRecentMatchView,
  RankedSeasonPublicView,
} from '../../online/ranked-types.js';
import { pool } from '../db/pool.js';
import { assertValidRankedRatingConfig, type RankedRatingConfig } from '../rating/ranked-rating.js';
import { publicTableService, type MatchmakingQueueContext } from './public-table-service.js';
import {
  getRankedQueueWindowTiming,
  type RankedSeasonOpenWindow,
} from './ranked-season-service.js';

interface PublicSeasonRow {
  readonly id: string;
  readonly season_key: string;
  readonly name: string;
  readonly announcement: string;
  readonly lifecycle: 'DRAFT' | 'ACTIVE' | 'FINALIZING' | 'CLOSED';
  readonly queue_admission: 'OPEN' | 'PAUSED';
  readonly competitive_environment_id: string;
  readonly platform_time_zone: string;
  readonly open_windows: RankedSeasonOpenWindow[];
  readonly starts_at: Date | string;
  readonly scheduled_ends_at: Date | string;
  readonly closed_at: Date | string | null;
  readonly rating_algorithm_version: string;
  readonly rating_config: unknown;
  readonly leaderboard_minimum_match_count: number;
}

interface PlayerRatingRow {
  readonly rating: number;
  readonly rating_deviation: number;
  readonly rated_match_count: number;
}

interface PlayerRecordRow {
  readonly completed_matches: number | string;
  readonly wins: number | string;
  readonly losses: number | string;
}

interface RecentMatchRow {
  readonly match_id: string;
  readonly rating_status: 'SETTLED' | 'VOIDED';
  readonly winner_seat: 'FIRST' | 'SECOND' | null;
  readonly result_type: string | null;
  readonly first_user_id: string;
  readonly second_user_id: string;
  readonly opponent_display_name: string;
  readonly ended_at: Date | string | null;
  readonly rating_delta: number | null;
}

interface LeaderboardRow {
  readonly user_id: string;
  readonly display_name: string;
  readonly rating: number;
  readonly rating_deviation: number;
  readonly rated_match_count: number;
}

interface QueueContextRow {
  readonly season_id: string;
  readonly environment_id: string;
}

export class RankedPlayerServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'RankedPlayerServiceError';
  }
}

export class RankedPlayerService {
  private readonly now: () => Date;

  constructor(options: { readonly now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async getOverview(userId: string, requestedSeasonId?: string): Promise<RankedOverviewView> {
    const ticketContext = await this.loadUserQueueContext(userId);
    const season = requestedSeasonId
      ? await this.loadPublicSeasonById(requestedSeasonId)
      : ticketContext?.seasonId
        ? await this.loadSeasonById(ticketContext.seasonId)
        : await this.loadCurrentPublicSeason();
    const queueContext = ticketContext ?? (season ? toQueueContext(season) : null);
    const queue = queueContext
      ? await publicTableService.getStatus(userId, queueContext)
      : await publicTableService.getStatus(userId, {
          queueKind: 'RANKED',
          participationKind: 'RANKED_QUEUE',
          environmentId: 'NO_ACTIVE_RANKED_SEASON',
          seasonId: null,
        });

    if (!season) {
      return {
        season: null,
        availability: {
          state: 'NO_SEASON',
          canJoin: false,
          message: '当前没有开放中的赛季',
          nextOpensAt: null,
          currentWindowEndsAt: null,
        },
        player: null,
        queue,
        recentMatches: [],
        leaderboard: [],
      };
    }

    readRatingConfig(season.rating_config);
    const availability = this.buildAvailability(season);
    const [player, recentMatches, leaderboard] = await Promise.all([
      this.loadPlayerSeason(season.id, userId, season.leaderboard_minimum_match_count),
      this.loadRecentMatches(season.id, userId),
      this.loadLeaderboard(season.id, season.leaderboard_minimum_match_count),
    ]);
    return {
      season: mapSeason(season),
      availability,
      player,
      queue,
      recentMatches,
      leaderboard,
    };
  }

  async listPublicSeasons(): Promise<RankedSeasonPublicView[]> {
    const result = await pool.query<PublicSeasonRow>(
      `SELECT *
       FROM ranked_seasons
       WHERE lifecycle IN ('ACTIVE', 'FINALIZING', 'CLOSED')
       ORDER BY
         CASE lifecycle WHEN 'ACTIVE' THEN 0 WHEN 'FINALIZING' THEN 1 ELSE 2 END,
         starts_at DESC`
    );
    return result.rows.map((season) => {
      readRatingConfig(season.rating_config);
      return mapSeason(season);
    });
  }

  async join(userId: string, deckId: string) {
    const season = await this.requireActiveSeason();
    readRatingConfig(season.rating_config);
    const availability = this.buildAvailability(season);
    if (!availability.canJoin) {
      throw playerError('RANKED_QUEUE_CLOSED', availability.message, 409);
    }
    return publicTableService.join(userId, deckId, 'DIRECT', toQueueContext(season));
  }

  async heartbeat(userId: string) {
    const context = await this.requireUserQueueContext(userId);
    const season = await this.loadSeasonById(context.seasonId!);
    const status = await publicTableService.getStatus(userId, context);
    if (status.state === 'WAITING') {
      readRatingConfig(season.rating_config);
      const availability = this.buildAvailability(season);
      if (!availability.canJoin) {
        await publicTableService.expireWaitingTickets(context, 'RANKED_WINDOW_CLOSED');
        return publicTableService.getStatus(userId, context);
      }
    }
    return publicTableService.heartbeat(userId, context);
  }

  async confirm(userId: string) {
    const context = await this.requireUserQueueContext(userId);
    return publicTableService.confirm(userId, context);
  }

  async cancel(userId: string) {
    const context = await this.loadUserQueueContext(userId);
    if (!context) {
      return publicTableService.getStatus(userId, {
        queueKind: 'RANKED',
        participationKind: 'RANKED_QUEUE',
        environmentId: 'NO_ACTIVE_RANKED_SEASON',
        seasonId: null,
      });
    }
    return publicTableService.cancel(userId, context);
  }

  private buildAvailability(season: PublicSeasonRow): RankedAvailabilityView {
    const now = this.now();
    const startsAt = new Date(season.starts_at);
    const scheduledEndsAt = new Date(season.scheduled_ends_at);
    const timing = getRankedQueueWindowTiming(
      now,
      season.platform_time_zone,
      season.open_windows,
      startsAt,
      scheduledEndsAt
    );
    const base = {
      nextOpensAt: timing.nextOpensAt?.getTime() ?? null,
      currentWindowEndsAt: timing.currentWindowEndsAt?.getTime() ?? null,
    };
    if (season.lifecycle === 'FINALIZING') {
      return {
        state: 'FINALIZING',
        canJoin: false,
        message: '本赛季正在结算',
        ...base,
      };
    }
    if (season.lifecycle === 'CLOSED') {
      return {
        state: 'CLOSED',
        canJoin: false,
        message: '本赛季已结束',
        ...base,
      };
    }
    if (now.getTime() < startsAt.getTime()) {
      return {
        state: 'UPCOMING',
        canJoin: false,
        message: '赛季尚未开始',
        nextOpensAt: timing.nextOpensAt?.getTime() ?? startsAt.getTime(),
        currentWindowEndsAt: null,
      };
    }
    if (season.queue_admission === 'PAUSED') {
      return {
        state: 'PAUSED',
        canJoin: false,
        message: '排位暂时关闭',
        ...base,
      };
    }
    if (!timing.withinOpenWindow) {
      return {
        state: 'OUTSIDE_WINDOW',
        canJoin: false,
        message: '当前不在开放时段',
        ...base,
      };
    }
    return {
      state: 'OPEN',
      canJoin: true,
      message: '可以开始排位',
      ...base,
    };
  }

  private async loadCurrentPublicSeason(): Promise<PublicSeasonRow | null> {
    const result = await pool.query<PublicSeasonRow>(
      `SELECT *
       FROM ranked_seasons
       WHERE lifecycle IN ('ACTIVE', 'FINALIZING')
       ORDER BY starts_at DESC
       LIMIT 1`
    );
    if (result.rows[0]) {
      return result.rows[0];
    }
    const closed = await pool.query<PublicSeasonRow>(
      `SELECT *
       FROM ranked_seasons
       WHERE lifecycle = 'CLOSED'
       ORDER BY closed_at DESC NULLS LAST, scheduled_ends_at DESC
       LIMIT 1`
    );
    return closed.rows[0] ?? null;
  }

  private async requireActiveSeason(): Promise<PublicSeasonRow> {
    const result = await pool.query<PublicSeasonRow>(
      `SELECT *
       FROM ranked_seasons
       WHERE lifecycle = 'ACTIVE'
       ORDER BY starts_at DESC
       LIMIT 1`
    );
    const season = result.rows[0];
    if (!season) {
      throw playerError('RANKED_ACTIVE_SEASON_NOT_FOUND', '当前没有开放中的赛季', 404);
    }
    return season;
  }

  private async loadSeasonById(seasonId: string): Promise<PublicSeasonRow> {
    const result = await pool.query<PublicSeasonRow>(
      `SELECT *
       FROM ranked_seasons
       WHERE id = $1`,
      [seasonId]
    );
    const season = result.rows[0];
    if (!season) {
      throw playerError('RANKED_SEASON_NOT_FOUND', '排位赛季不存在', 404);
    }
    return season;
  }

  private async loadPublicSeasonById(seasonId: string): Promise<PublicSeasonRow> {
    const season = await this.loadSeasonById(seasonId);
    if (season.lifecycle === 'DRAFT') {
      throw playerError('RANKED_SEASON_NOT_FOUND', '排位赛季不存在', 404);
    }
    return season;
  }

  private async loadUserQueueContext(userId: string): Promise<MatchmakingQueueContext | null> {
    const result = await pool.query<QueueContextRow>(
      `SELECT ticket.season_id, ticket.environment_id
       FROM gameplay_participations AS participation
       JOIN public_table_tickets AS ticket ON ticket.id = participation.ticket_id
       WHERE participation.user_id = $1
         AND ticket.queue_kind = 'RANKED'
         AND ticket.season_id IS NOT NULL
       LIMIT 1`,
      [userId]
    );
    const row = result.rows[0];
    return row
      ? {
          queueKind: 'RANKED',
          participationKind: 'RANKED_QUEUE',
          environmentId: row.environment_id,
          seasonId: row.season_id,
        }
      : null;
  }

  private async requireUserQueueContext(userId: string): Promise<MatchmakingQueueContext> {
    const context = await this.loadUserQueueContext(userId);
    if (!context) {
      throw playerError('RANKED_QUEUE_TICKET_NOT_FOUND', '当前没有进行中的排位匹配', 404);
    }
    return context;
  }

  private async loadPlayerSeason(
    seasonId: string,
    userId: string,
    leaderboardMinimumMatchCount: number
  ): Promise<RankedPlayerSeasonView> {
    const [ratingResult, recordResult] = await Promise.all([
      pool.query<PlayerRatingRow>(
        `SELECT rating, rating_deviation, rated_match_count
         FROM ranked_player_ratings
         WHERE season_id = $1
           AND user_id = $2`,
        [seasonId, userId]
      ),
      pool.query<PlayerRecordRow>(
        `SELECT
           COUNT(*) FILTER (WHERE rating_status = 'SETTLED') AS completed_matches,
           COUNT(*) FILTER (
             WHERE rating_status = 'SETTLED'
               AND (
                 (first_user_id = $2 AND winner_seat = 'FIRST')
                 OR (second_user_id = $2 AND winner_seat = 'SECOND')
               )
           ) AS wins,
           COUNT(*) FILTER (
             WHERE rating_status = 'SETTLED'
               AND (
                 (first_user_id = $2 AND winner_seat = 'SECOND')
                 OR (second_user_id = $2 AND winner_seat = 'FIRST')
               )
           ) AS losses
         FROM ranked_matches
         WHERE season_id = $1
           AND (first_user_id = $2 OR second_user_id = $2)`,
        [seasonId, userId]
      ),
    ]);
    const rating = ratingResult.rows[0];
    const record = recordResult.rows[0];
    const completedMatches = Number(record?.completed_matches ?? 0);
    const wins = Number(record?.wins ?? 0);
    const losses = Number(record?.losses ?? 0);
    const ratedMatchCount = rating?.rated_match_count ?? 0;
    const hasSettledRating = ratedMatchCount > 0;
    const placement = ratedMatchCount < leaderboardMinimumMatchCount;
    let rank: number | null = null;
    if (rating && !placement) {
      const rankResult = await pool.query<{ readonly rank: number | string }>(
        `SELECT 1 + COUNT(*) AS rank
         FROM ranked_player_ratings
         WHERE season_id = $1
           AND rated_match_count >= $2
           AND (
             rating > $3
             OR (rating = $3 AND user_id < $4)
           )`,
        [seasonId, leaderboardMinimumMatchCount, rating.rating, userId]
      );
      rank = Number(rankResult.rows[0]?.rank ?? 1);
    }
    return {
      placement,
      placementCompleted: Math.min(ratedMatchCount, leaderboardMinimumMatchCount),
      placementRequired: leaderboardMinimumMatchCount,
      rating: rating && hasSettledRating ? Math.round(rating.rating) : null,
      ratingDeviation: rating && hasSettledRating ? Math.round(rating.rating_deviation) : null,
      rank,
      completedMatches,
      wins,
      losses,
      winRate: completedMatches === 0 ? null : wins / completedMatches,
    };
  }

  private async loadRecentMatches(
    seasonId: string,
    userId: string
  ): Promise<RankedRecentMatchView[]> {
    const result = await pool.query<RecentMatchRow>(
      `SELECT
         ranked_match.match_id,
         ranked_match.rating_status,
         ranked_match.winner_seat,
         ranked_match.result_type,
         ranked_match.first_user_id,
         ranked_match.second_user_id,
         COALESCE(opponent.display_name, opponent.username) AS opponent_display_name,
         ranked_match.ended_at,
         CASE
           WHEN step.first_user_id = $2
             THEN step.first_after_rating - step.first_before_rating
           WHEN step.second_user_id = $2
             THEN step.second_after_rating - step.second_before_rating
           ELSE NULL
         END AS rating_delta
       FROM ranked_matches AS ranked_match
       JOIN profiles AS opponent
         ON opponent.id = CASE
           WHEN ranked_match.first_user_id = $2
             THEN ranked_match.second_user_id
           ELSE ranked_match.first_user_id
         END
       LEFT JOIN LATERAL (
         SELECT materialized_step.*
         FROM ranked_rating_event_steps AS materialized_step
         JOIN ranked_rating_events AS materialized_event
           ON materialized_event.id = materialized_step.event_id
         WHERE materialized_step.match_id = ranked_match.match_id
         ORDER BY materialized_event.event_sequence DESC
         LIMIT 1
       ) AS step ON true
       WHERE ranked_match.season_id = $1
         AND (ranked_match.first_user_id = $2 OR ranked_match.second_user_id = $2)
         AND ranked_match.rating_status IN ('SETTLED', 'VOIDED')
       ORDER BY ranked_match.ended_at DESC NULLS LAST, ranked_match.match_id DESC
       LIMIT 10`,
      [seasonId, userId]
    );
    return result.rows.map((row) => ({
      matchId: row.match_id,
      opponentDisplayName: row.opponent_display_name,
      result:
        row.rating_status === 'VOIDED'
          ? 'VOIDED'
          : (row.first_user_id === userId && row.winner_seat === 'FIRST') ||
              (row.second_user_id === userId && row.winner_seat === 'SECOND')
            ? 'WIN'
            : 'LOSS',
      resultType: row.result_type,
      endedAt: row.ended_at === null ? null : new Date(row.ended_at).getTime(),
      ratingDelta:
        row.rating_status === 'VOIDED' || row.rating_delta === null
          ? null
          : Math.round(row.rating_delta),
    }));
  }

  private async loadLeaderboard(
    seasonId: string,
    leaderboardMinimumMatchCount: number
  ): Promise<RankedLeaderboardEntryView[]> {
    const result = await pool.query<LeaderboardRow>(
      `SELECT
         rating.user_id,
         COALESCE(profile.display_name, profile.username) AS display_name,
         rating.rating,
         rating.rating_deviation,
         rating.rated_match_count
       FROM ranked_player_ratings AS rating
       JOIN profiles AS profile ON profile.id = rating.user_id
       WHERE rating.season_id = $1
         AND rating.rated_match_count >= $2
       ORDER BY rating.rating DESC, rating.user_id ASC
       LIMIT 100`,
      [seasonId, leaderboardMinimumMatchCount]
    );
    return result.rows.map((row, index) => ({
      rank: index + 1,
      userId: row.user_id,
      displayName: row.display_name,
      rating: Math.round(row.rating),
      ratingDeviation: Math.round(row.rating_deviation),
      ratedMatchCount: row.rated_match_count,
    }));
  }
}

function toQueueContext(season: PublicSeasonRow): MatchmakingQueueContext {
  return {
    queueKind: 'RANKED',
    participationKind: 'RANKED_QUEUE',
    environmentId: season.competitive_environment_id,
    seasonId: season.id,
  };
}

function readRatingConfig(value: unknown): RankedRatingConfig {
  const config = value as RankedRatingConfig;
  try {
    assertValidRankedRatingConfig(config);
  } catch {
    throw playerError('RANKED_CONFIG_INVALID', '排位赛季评分配置无效', 500);
  }
  return config;
}

function mapSeason(season: PublicSeasonRow): RankedSeasonPublicView {
  if (season.lifecycle === 'DRAFT') {
    throw playerError('RANKED_SEASON_NOT_PUBLIC', '排位赛季尚未公开', 404);
  }
  return {
    id: season.id,
    seasonKey: season.season_key,
    name: season.name,
    announcement: season.announcement,
    lifecycle: season.lifecycle,
    platformTimeZone: season.platform_time_zone,
    startsAt: new Date(season.starts_at).getTime(),
    scheduledEndsAt: new Date(season.scheduled_ends_at).getTime(),
    closedAt: season.closed_at === null ? null : new Date(season.closed_at).getTime(),
    ratingAlgorithmVersion: season.rating_algorithm_version,
    placementMatchCount: season.leaderboard_minimum_match_count,
  };
}

function playerError(code: string, message: string, statusCode = 400): RankedPlayerServiceError {
  return new RankedPlayerServiceError(code, message, statusCode);
}

export const rankedPlayerService = new RankedPlayerService();
