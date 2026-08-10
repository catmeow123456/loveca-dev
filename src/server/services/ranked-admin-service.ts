import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import {
  getFormalRankedAlgorithmConfig,
  hasFormalRankedAlgorithm,
  RANKED_ALGORITHM_DESCRIPTORS,
} from '../rating/ranked-algorithm-registry.js';
import {
  createInitialGlickoRatingState,
  type GlickoRatingState,
  type GlickoSoftResetMode,
} from '../rating/glicko.js';
import { assertValidRankedRatingConfig, type RankedRatingConfig } from '../rating/ranked-rating.js';
import {
  buildRankedCompetitiveEnvironmentIdentity,
  getCurrentRankedCardCatalogIdentity,
} from '../rating/ranked-environment.js';
import {
  materializeRankedRatingLedger,
  type RankedRatingEvent,
  type RankedRatingEventType,
  type RankedResultType,
  type RankedWinnerSeat,
} from '../rating/ranked-ledger.js';
import {
  RankedRatingService,
  type CorrectRankedMatchInput,
  type RankedRatingMutationResult,
} from './ranked-rating-service.js';
import {
  isRankedQueueWindowOpen,
  RankedSeasonService,
  type RankedSeasonOpenWindow,
  type RankedSeasonRecord,
} from './ranked-season-service.js';
import { stableJsonStringify } from './replay-payload-serialization.js';

export interface RankedAdminSeasonDraftInput {
  readonly seasonKey: string;
  readonly name: string;
  readonly announcement?: string;
  readonly platformTimeZone: string;
  readonly openWindows: readonly RankedSeasonOpenWindow[];
  readonly startsAt: Date;
  readonly scheduledEndsAt: Date;
  readonly finalizingDeadlineAt: Date;
  readonly ratingAlgorithmVersion: string;
  readonly softReset: {
    readonly mode: GlickoSoftResetMode;
    readonly center: number;
    readonly retention: number;
    readonly minimumDeviation: number;
  };
  readonly leaderboardMinimumMatchCount: number;
}

export interface RankedAdminActiveSeasonOperationsInput {
  readonly name: string;
  readonly announcement?: string;
  readonly openWindows: readonly RankedSeasonOpenWindow[];
  readonly leaderboardMinimumMatchCount: number;
}

export interface RankedAdminSeasonView extends RankedSeasonRecord {
  readonly withinOpenWindow: boolean;
  readonly effectiveQueueOpen: boolean;
}

export interface RankedAdminCorrectionPreviewInput {
  readonly seasonId: string;
  readonly matchId: string;
  readonly action: 'VOID' | 'REPLACE';
  readonly replacementWinnerSeat?: RankedWinnerSeat;
  readonly replacementResultType?: Exclude<RankedResultType, 'PLATFORM_NO_CONTEST'>;
}

export interface RankedAdminCorrectionExecuteInput extends CorrectRankedMatchInput {
  readonly previewToken: string;
}

export interface RankedAdminMatchFilter {
  readonly seasonId?: string;
  readonly ratingStatus?: 'PENDING' | 'SETTLED' | 'VOIDED';
  readonly userQuery?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface RankedAdminOverview {
  readonly seasonId: string;
  readonly generatedAt: Date;
  readonly health: {
    readonly waitingTickets: number;
    readonly activeReservations: number;
    readonly runningMatches: number;
    readonly pendingMatches: number;
    readonly oldestPendingEndedAt: Date | null;
  };
  readonly statistics: {
    readonly totalParticipants: number;
    readonly placementCompletedPlayers: number;
    readonly leaderboardPlayers: number;
    readonly totalSettledMatches: number;
    readonly matchesToday: number;
    readonly matchesLast7Days: number;
    readonly activePlayersLast7Days: number;
    readonly averageMatchesPerPlayer: number;
    readonly leaderboardCutoffRating: number | null;
  };
  readonly matchCountDistribution: readonly {
    readonly label: string;
    readonly minimum: number;
    readonly maximum: number | null;
    readonly playerCount: number;
  }[];
  readonly ratingDistribution: readonly {
    readonly minimumRating: number;
    readonly maximumRatingExclusive: number;
    readonly playerCount: number;
  }[];
}

interface RankedAdminQueryResult<T> {
  readonly rows: T[];
}

interface RankedAdminQuery {
  <T = unknown>(text: string, values?: readonly unknown[]): Promise<RankedAdminQueryResult<T>>;
}

interface RankedAdminServiceDeps {
  readonly seasonService?: RankedSeasonService;
  readonly ratingService?: RankedRatingService;
  readonly query?: RankedAdminQuery;
  readonly getCardCatalogIdentity?: typeof getCurrentRankedCardCatalogIdentity;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly audit?: (event: RankedAdminAuditEvent) => void;
  readonly previewSecret?: string;
}

interface RankedAdminAuditEvent {
  readonly event: string;
  readonly adminUserId: string;
  readonly seasonId?: string;
  readonly matchId?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

interface RankedAdminMatchRow {
  readonly match_id: string;
  readonly season_id: string;
  readonly season_key: string;
  readonly rating_status: 'PENDING' | 'SETTLED' | 'VOIDED';
  readonly winner_seat: RankedWinnerSeat | null;
  readonly result_type: string | null;
  readonly prior_result_type: Exclude<RankedResultType, 'PLATFORM_NO_CONTEST'> | null;
  readonly first_user_id: string;
  readonly first_username: string;
  readonly first_display_name: string | null;
  readonly second_user_id: string;
  readonly second_username: string;
  readonly second_display_name: string | null;
  readonly record_status: string;
  readonly completeness: string;
  readonly sealed_at: Date | string | null;
  readonly ended_at: Date | string | null;
  readonly settled_at: Date | string | null;
  readonly created_at: Date | string;
  readonly first_rating_delta: number | string | null;
  readonly second_rating_delta: number | string | null;
}

interface RankedAdminMatchCountRow {
  readonly total: number | string;
}

interface RankedAdminDeckObservationRow {
  readonly seat: 'FIRST' | 'SECOND';
  readonly user_id: string;
  readonly deck_fingerprint: string;
  readonly main_deck_cards: unknown;
  readonly source_deck_name: string | null;
}

interface RankedAdminDeckCard {
  readonly baseCardCode: string;
  readonly cardCode: string;
  readonly name: string;
  readonly cardType: 'MEMBER' | 'LIVE';
  readonly count: number;
  readonly imageFilename: string | null;
}

interface RankedAdminOverviewSeasonRow {
  readonly platform_time_zone: string;
  readonly rating_algorithm_version: string;
  readonly rating_config: unknown;
  readonly leaderboard_minimum_match_count: number;
}

interface RankedAdminOverviewHealthRow {
  readonly waiting_tickets: number | string;
  readonly active_reservations: number | string;
  readonly running_matches: number | string;
  readonly pending_matches: number | string;
  readonly oldest_pending_ended_at: Date | string | null;
}

interface RankedAdminOverviewStatisticsRow {
  readonly total_participants: number | string;
  readonly placement_completed_players: number | string;
  readonly leaderboard_players: number | string;
  readonly total_settled_matches: number | string;
  readonly matches_today: number | string;
  readonly matches_last_7_days: number | string;
  readonly active_players_last_7_days: number | string;
  readonly average_matches_per_player: number | string;
  readonly leaderboard_cutoff_rating: number | string | null;
}

interface RankedAdminMatchCountDistributionRow {
  readonly label: string;
  readonly minimum: number | string;
  readonly maximum: number | string | null;
  readonly player_count: number | string;
}

interface RankedAdminRatingDistributionRow {
  readonly minimum_rating: number | string;
  readonly maximum_rating_exclusive: number | string;
  readonly player_count: number | string;
}

interface RankedAdminEventRow {
  readonly id: string;
  readonly event_sequence: number;
  readonly event_type: RankedRatingEventType;
  readonly match_id: string;
  readonly target_event_id: string | null;
  readonly first_user_id: string;
  readonly second_user_id: string;
  readonly winner_seat: RankedWinnerSeat | null;
  readonly result_type: RankedResultType;
  readonly rated_at: Date | string;
  readonly algorithm_version: string;
  readonly reason: string | null;
  readonly created_by: string | null;
  readonly created_at: Date | string;
}

interface PreviewSeasonRow {
  readonly lifecycle: RankedSeasonRecord['lifecycle'];
  readonly ledger_revision: number;
  readonly rating_algorithm_version: string;
  readonly rating_config: unknown;
}

interface PreviewRatingRow {
  readonly user_id: string;
  readonly rating: number;
  readonly rating_deviation: number;
  readonly rated_match_count: number;
  readonly last_rated_at: Date | string | null;
}

export class RankedAdminServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'RankedAdminServiceError';
  }
}

export class RankedAdminService {
  private readonly seasonService: RankedSeasonService;
  private readonly ratingService: RankedRatingService;
  private readonly query: RankedAdminQuery;
  private readonly getCardCatalogIdentity: typeof getCurrentRankedCardCatalogIdentity;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly audit: (event: RankedAdminAuditEvent) => void;
  private readonly previewSecret: string;

  constructor(deps: RankedAdminServiceDeps = {}) {
    this.seasonService = deps.seasonService ?? new RankedSeasonService();
    this.ratingService = deps.ratingService ?? new RankedRatingService();
    this.query =
      deps.query ??
      (async <T>(text: string, values?: readonly unknown[]) => {
        const result = await pool.query(text, values as unknown[]);
        return { rows: result.rows as T[] };
      });
    this.getCardCatalogIdentity =
      deps.getCardCatalogIdentity ?? getCurrentRankedCardCatalogIdentity;
    this.now = deps.now ?? (() => new Date());
    this.createId = deps.createId ?? randomUUID;
    this.audit = deps.audit ?? writeRankedAdminAudit;
    this.previewSecret = deps.previewSecret ?? config.jwtSecret;
  }

  async getEnvironmentPreview() {
    const catalog = await this.getCardCatalogIdentity();
    const algorithms = RANKED_ALGORITHM_DESCRIPTORS.map((descriptor) => ({
      algorithmVersion: descriptor.algorithmVersion,
      status: descriptor.status,
      config: descriptor.config,
      environment: buildRankedCompetitiveEnvironmentIdentity(catalog, descriptor.config),
    }));
    return {
      catalog,
      algorithms,
      persistentSeasonReady: hasFormalRankedAlgorithm(),
    };
  }

  async listSeasons(): Promise<RankedAdminSeasonView[]> {
    const seasons = await this.seasonService.listSeasons();
    const now = this.now();
    return seasons.map((season) => projectSeason(season, now));
  }

  async getSeason(seasonId: string) {
    const season = await this.seasonService.getSeason(seasonId);
    const catalog = await this.getCardCatalogIdentity();
    const currentEnvironment = buildRankedCompetitiveEnvironmentIdentity(
      catalog,
      season.ratingConfig
    );
    return {
      ...projectSeason(season, this.now()),
      currentEnvironment,
      environmentMatchesCurrent:
        currentEnvironment.competitiveEnvironmentId === season.competitiveEnvironmentId,
    };
  }

  async createDraft(
    input: RankedAdminSeasonDraftInput,
    adminUserId: string
  ): Promise<RankedAdminSeasonView> {
    const { config, environment } = await this.resolveFormalEnvironment(input);
    const season = await this.seasonService.createDraft({
      ...input,
      environment,
      ratingConfig: config,
      adminUserId,
    });
    this.audit({
      event: 'RANKED_SEASON_DRAFT_CREATED',
      adminUserId,
      seasonId: season.id,
      detail: {
        seasonKey: season.seasonKey,
        announcementLength: season.announcement.length,
        leaderboardMinimumMatchCount: season.leaderboardMinimumMatchCount,
      },
    });
    return projectSeason(season, this.now());
  }

  async updateDraft(
    seasonId: string,
    input: RankedAdminSeasonDraftInput,
    adminUserId: string
  ): Promise<RankedAdminSeasonView> {
    const { config, environment } = await this.resolveFormalEnvironment(input);
    const season = await this.seasonService.updateDraft(seasonId, {
      ...input,
      environment,
      ratingConfig: config,
      adminUserId,
    });
    this.audit({
      event: 'RANKED_SEASON_DRAFT_UPDATED',
      adminUserId,
      seasonId,
      detail: {
        seasonKey: season.seasonKey,
        announcementLength: season.announcement.length,
        leaderboardMinimumMatchCount: season.leaderboardMinimumMatchCount,
      },
    });
    return projectSeason(season, this.now());
  }

  async updateActiveOperations(
    seasonId: string,
    input: RankedAdminActiveSeasonOperationsInput,
    adminUserId: string
  ): Promise<RankedAdminSeasonView> {
    const season = await this.seasonService.updateActiveOperations(seasonId, {
      ...input,
      adminUserId,
    });
    this.audit({
      event: 'RANKED_SEASON_ACTIVE_OPERATIONS_UPDATED',
      adminUserId,
      seasonId,
      detail: {
        name: season.name,
        announcementLength: season.announcement.length,
        openWindows: season.openWindows,
        leaderboardMinimumMatchCount: season.leaderboardMinimumMatchCount,
      },
    });
    return projectSeason(season, this.now());
  }

  async activateSeason(seasonId: string, adminUserId: string): Promise<RankedAdminSeasonView> {
    const draft = await this.seasonService.getSeason(seasonId);
    const config = buildSeasonRatingConfig(draft.ratingAlgorithmVersion, {
      mode: draft.ratingConfig.softResetMode,
      center: draft.ratingConfig.softResetCenter,
      retention: draft.ratingConfig.softResetRetention,
      minimumDeviation: draft.ratingConfig.softResetMinimumDeviation,
    });
    if (stableJsonStringify(config) !== stableJsonStringify(draft.ratingConfig)) {
      throw new RankedAdminServiceError(
        'RANKED_STORED_CONFIG_INVALID',
        '赛季草稿包含未获准的评分参数变更',
        500
      );
    }
    const environment = buildRankedCompetitiveEnvironmentIdentity(
      await this.getCardCatalogIdentity(true),
      config
    );
    const season = await this.seasonService.activate(
      seasonId,
      environment,
      config,
      adminUserId,
      this.now()
    );
    this.audit({ event: 'RANKED_SEASON_ACTIVATED', adminUserId, seasonId });
    return projectSeason(season, this.now());
  }

  async setQueueAdmission(
    seasonId: string,
    admission: 'OPEN' | 'PAUSED',
    adminUserId: string
  ): Promise<RankedAdminSeasonView> {
    const season = await this.seasonService.setQueueAdmission(seasonId, admission, adminUserId);
    this.audit({
      event: 'RANKED_QUEUE_ADMISSION_CHANGED',
      adminUserId,
      seasonId,
      detail: { admission },
    });
    return projectSeason(season, this.now());
  }

  async beginFinalizing(seasonId: string, adminUserId: string): Promise<RankedAdminSeasonView> {
    const season = await this.seasonService.beginFinalizing(seasonId, adminUserId);
    this.audit({ event: 'RANKED_SEASON_FINALIZING_STARTED', adminUserId, seasonId });
    return projectSeason(season, this.now());
  }

  async closeSeason(seasonId: string, adminUserId: string): Promise<RankedAdminSeasonView> {
    const season = await this.seasonService.close(seasonId, adminUserId, this.now());
    this.audit({ event: 'RANKED_SEASON_CLOSED', adminUserId, seasonId });
    return projectSeason(season, this.now());
  }

  async getOverview(seasonId: string): Promise<RankedAdminOverview> {
    const generatedAt = this.now();
    const seasonResult = await this.query<RankedAdminOverviewSeasonRow>(
      `SELECT platform_time_zone, rating_algorithm_version, rating_config,
              leaderboard_minimum_match_count
       FROM ranked_seasons
       WHERE id = $1`,
      [seasonId]
    );
    const season = seasonResult.rows[0];
    if (!season) {
      throw adminError('RANKED_SEASON_NOT_FOUND', '排位赛季不存在', 404);
    }
    const ratingConfig = readPersistentConfig(
      season.rating_algorithm_version,
      season.rating_config
    );
    const placementMatchCount = ratingConfig.placementMatchCount;
    const leaderboardMinimumMatchCount = season.leaderboard_minimum_match_count;

    const [healthResult, statisticsResult, matchCountResult, ratingResult] = await Promise.all([
      this.query<RankedAdminOverviewHealthRow>(
        `SELECT
           (SELECT COUNT(*)
            FROM public_table_tickets
            WHERE season_id = $1
              AND queue_kind = 'RANKED'
              AND state = 'WAITING') AS waiting_tickets,
           (SELECT COUNT(*)
            FROM public_table_reservations
            WHERE season_id = $1
              AND queue_kind = 'RANKED'
              AND (state IN ('PENDING_CONFIRMATION', 'CREATING_ROOM')
                   OR (state = 'MATCHED' AND match_id IS NULL))) AS active_reservations,
           (SELECT COUNT(*)
           FROM ranked_matches AS ranked_match
            JOIN match_records AS record ON record.match_id = ranked_match.match_id
            WHERE ranked_match.season_id = $1
              AND ranked_match.rating_status = 'PENDING'
              AND record.status = 'IN_PROGRESS') AS running_matches,
           (SELECT COUNT(*)
            FROM ranked_matches AS ranked_match
            JOIN match_records AS record ON record.match_id = ranked_match.match_id
            WHERE ranked_match.season_id = $1
              AND ranked_match.rating_status = 'PENDING'
              AND record.status <> 'IN_PROGRESS') AS pending_matches,
           (SELECT MIN(COALESCE(ranked_match.ended_at, record.ended_at))
            FROM ranked_matches AS ranked_match
            JOIN match_records AS record ON record.match_id = ranked_match.match_id
            WHERE ranked_match.season_id = $1
              AND ranked_match.rating_status = 'PENDING'
              AND record.status <> 'IN_PROGRESS') AS oldest_pending_ended_at`,
        [seasonId]
      ),
      this.query<RankedAdminOverviewStatisticsRow>(
        `WITH participants AS (
           SELECT rating, rated_match_count
           FROM ranked_player_ratings
           WHERE season_id = $1
             AND rated_match_count > 0
         ), settled_matches AS (
           SELECT ranked_match.first_user_id,
                  ranked_match.second_user_id,
                  COALESCE(ranked_match.ended_at, record.ended_at, ranked_match.settled_at)
                    AS played_at
           FROM ranked_matches AS ranked_match
           JOIN match_records AS record ON record.match_id = ranked_match.match_id
           WHERE ranked_match.season_id = $1
             AND ranked_match.rating_status = 'SETTLED'
         ), recent_active_players AS (
           SELECT first_user_id AS user_id
           FROM settled_matches
           WHERE played_at >= $2::timestamptz - INTERVAL '7 days'
             AND played_at <= $2::timestamptz
           UNION
           SELECT second_user_id AS user_id
           FROM settled_matches
           WHERE played_at >= $2::timestamptz - INTERVAL '7 days'
             AND played_at <= $2::timestamptz
         )
         SELECT
           COUNT(*) AS total_participants,
           COUNT(*) FILTER (WHERE rated_match_count >= $4) AS placement_completed_players,
           COUNT(*) FILTER (WHERE rated_match_count >= $5) AS leaderboard_players,
           (SELECT COUNT(*) FROM settled_matches) AS total_settled_matches,
           (SELECT COUNT(*)
            FROM settled_matches
            WHERE (played_at AT TIME ZONE $3)::date =
                  ($2::timestamptz AT TIME ZONE $3)::date) AS matches_today,
           (SELECT COUNT(*)
            FROM settled_matches
            WHERE played_at >= $2::timestamptz - INTERVAL '7 days'
              AND played_at <= $2::timestamptz) AS matches_last_7_days,
           (SELECT COUNT(*) FROM recent_active_players) AS active_players_last_7_days,
           COALESCE(AVG(rated_match_count), 0)::float8 AS average_matches_per_player,
           MIN(rating) FILTER (WHERE rated_match_count >= $5) AS leaderboard_cutoff_rating
         FROM participants`,
        [
          seasonId,
          generatedAt,
          season.platform_time_zone,
          placementMatchCount,
          leaderboardMinimumMatchCount,
        ]
      ),
      this.query<RankedAdminMatchCountDistributionRow>(
        `WITH buckets(label, minimum, maximum, sort_order) AS (
           VALUES
             ('1–4', 1, 4, 1),
             ('5–9', 5, 9, 2),
             ('10–19', 10, 19, 3),
             ('20–39', 20, 39, 4),
             ('40+', 40, NULL::integer, 5)
         )
         SELECT buckets.label, buckets.minimum, buckets.maximum,
                COUNT(rating.user_id) AS player_count
         FROM buckets
         LEFT JOIN ranked_player_ratings AS rating
           ON rating.season_id = $1
          AND rating.rated_match_count >= buckets.minimum
          AND (buckets.maximum IS NULL OR rating.rated_match_count <= buckets.maximum)
         GROUP BY buckets.label, buckets.minimum, buckets.maximum, buckets.sort_order
         ORDER BY buckets.sort_order`,
        [seasonId]
      ),
      this.query<RankedAdminRatingDistributionRow>(
        `SELECT (FLOOR(rating / 100.0) * 100)::float8 AS minimum_rating,
                (FLOOR(rating / 100.0) * 100 + 100)::float8 AS maximum_rating_exclusive,
                COUNT(*) AS player_count
         FROM ranked_player_ratings
         WHERE season_id = $1
           AND rated_match_count > 0
         GROUP BY FLOOR(rating / 100.0)
         ORDER BY minimum_rating`,
        [seasonId]
      ),
    ]);

    const health = healthResult.rows[0];
    const statistics = statisticsResult.rows[0];
    if (!health || !statistics) {
      throw adminError('RANKED_OVERVIEW_QUERY_FAILED', '排位赛季概览查询失败', 500);
    }
    return {
      seasonId,
      generatedAt,
      health: {
        waitingTickets: Number(health.waiting_tickets),
        activeReservations: Number(health.active_reservations),
        runningMatches: Number(health.running_matches),
        pendingMatches: Number(health.pending_matches),
        oldestPendingEndedAt:
          health.oldest_pending_ended_at === null ? null : new Date(health.oldest_pending_ended_at),
      },
      statistics: {
        totalParticipants: Number(statistics.total_participants),
        placementCompletedPlayers: Number(statistics.placement_completed_players),
        leaderboardPlayers: Number(statistics.leaderboard_players),
        totalSettledMatches: Number(statistics.total_settled_matches),
        matchesToday: Number(statistics.matches_today),
        matchesLast7Days: Number(statistics.matches_last_7_days),
        activePlayersLast7Days: Number(statistics.active_players_last_7_days),
        averageMatchesPerPlayer: Number(statistics.average_matches_per_player),
        leaderboardCutoffRating:
          statistics.leaderboard_cutoff_rating === null
            ? null
            : Number(statistics.leaderboard_cutoff_rating),
      },
      matchCountDistribution: matchCountResult.rows.map((row) => ({
        label: row.label,
        minimum: Number(row.minimum),
        maximum: row.maximum === null ? null : Number(row.maximum),
        playerCount: Number(row.player_count),
      })),
      ratingDistribution: ratingResult.rows.map((row) => ({
        minimumRating: Number(row.minimum_rating),
        maximumRatingExclusive: Number(row.maximum_rating_exclusive),
        playerCount: Number(row.player_count),
      })),
    };
  }

  async listMatches(filter: RankedAdminMatchFilter) {
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (filter.seasonId) {
      values.push(filter.seasonId);
      conditions.push(`ranked_match.season_id = $${values.length}`);
    }
    if (filter.ratingStatus) {
      values.push(filter.ratingStatus);
      conditions.push(`ranked_match.rating_status = $${values.length}`);
    }
    if (filter.userQuery?.trim()) {
      values.push(`%${escapeLikePattern(filter.userQuery.trim())}%`);
      conditions.push(`(
        ranked_match.first_user_id::text ILIKE $${values.length} ESCAPE '\\'
        OR ranked_match.second_user_id::text ILIKE $${values.length} ESCAPE '\\'
        OR first_profile.username ILIKE $${values.length} ESCAPE '\\'
        OR COALESCE(first_profile.display_name, '') ILIKE $${values.length} ESCAPE '\\'
        OR second_profile.username ILIKE $${values.length} ESCAPE '\\'
        OR COALESCE(second_profile.display_name, '') ILIKE $${values.length} ESCAPE '\\'
      )`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const from = `FROM ranked_matches AS ranked_match
       JOIN ranked_seasons AS season ON season.id = ranked_match.season_id
       JOIN match_records AS record ON record.match_id = ranked_match.match_id
       JOIN profiles AS first_profile ON first_profile.id = ranked_match.first_user_id
       JOIN profiles AS second_profile ON second_profile.id = ranked_match.second_user_id`;
    const countResult = await this.query<RankedAdminMatchCountRow>(
      `SELECT COUNT(*) AS total
       ${from}
       ${where}`,
      values
    );
    const pageValues = [...values, filter.limit, filter.offset];
    const limitParam = pageValues.length - 1;
    const offsetParam = pageValues.length;
    const result = await this.query<RankedAdminMatchRow>(
      `SELECT
         ranked_match.match_id,
         ranked_match.season_id,
         season.season_key,
         ranked_match.rating_status,
         ranked_match.winner_seat,
         ranked_match.result_type,
         (
           SELECT event.result_type
           FROM ranked_rating_events AS event
           WHERE event.season_id = ranked_match.season_id
             AND event.match_id = ranked_match.match_id
             AND event.event_type IN ('SETTLEMENT', 'REPLACEMENT')
           ORDER BY event.event_sequence DESC
           LIMIT 1
         ) AS prior_result_type,
         ranked_match.first_user_id,
         first_profile.username AS first_username,
         first_profile.display_name AS first_display_name,
         ranked_match.second_user_id,
         second_profile.username AS second_username,
         second_profile.display_name AS second_display_name,
         CASE
           WHEN ranked_match.rating_status = 'SETTLED'
             THEN materialized_step.first_after_rating - materialized_step.first_before_rating
           ELSE NULL
         END AS first_rating_delta,
         CASE
           WHEN ranked_match.rating_status = 'SETTLED'
             THEN materialized_step.second_after_rating - materialized_step.second_before_rating
           ELSE NULL
         END AS second_rating_delta,
         record.status AS record_status,
         record.completeness,
         record.sealed_at,
         COALESCE(ranked_match.ended_at, record.ended_at) AS ended_at,
         ranked_match.settled_at,
         ranked_match.created_at
       ${from}
       LEFT JOIN LATERAL (
         SELECT step.first_before_rating, step.first_after_rating,
                step.second_before_rating, step.second_after_rating
         FROM ranked_rating_event_steps AS step
         JOIN ranked_rating_events AS event ON event.id = step.event_id
         WHERE step.match_id = ranked_match.match_id
         ORDER BY event.event_sequence DESC
         LIMIT 1
       ) AS materialized_step ON true
       ${where}
       ORDER BY ranked_match.created_at DESC, ranked_match.match_id ASC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      pageValues
    );
    return {
      matches: result.rows.map(mapAdminMatch),
      total: Number(countResult.rows[0]?.total ?? 0),
    };
  }

  async getMatch(matchId: string) {
    const matchResult = await this.query<RankedAdminMatchRow>(
      `SELECT
         ranked_match.match_id,
         ranked_match.season_id,
         season.season_key,
         ranked_match.rating_status,
         ranked_match.winner_seat,
         ranked_match.result_type,
         (
           SELECT event.result_type
           FROM ranked_rating_events AS event
           WHERE event.season_id = ranked_match.season_id
             AND event.match_id = ranked_match.match_id
             AND event.event_type IN ('SETTLEMENT', 'REPLACEMENT')
           ORDER BY event.event_sequence DESC
           LIMIT 1
         ) AS prior_result_type,
         ranked_match.first_user_id,
         first_profile.username AS first_username,
         first_profile.display_name AS first_display_name,
         ranked_match.second_user_id,
         second_profile.username AS second_username,
         second_profile.display_name AS second_display_name,
         CASE
           WHEN ranked_match.rating_status = 'SETTLED'
             THEN materialized_step.first_after_rating - materialized_step.first_before_rating
           ELSE NULL
         END AS first_rating_delta,
         CASE
           WHEN ranked_match.rating_status = 'SETTLED'
             THEN materialized_step.second_after_rating - materialized_step.second_before_rating
           ELSE NULL
         END AS second_rating_delta,
         record.status AS record_status,
         record.completeness,
         record.sealed_at,
         COALESCE(ranked_match.ended_at, record.ended_at) AS ended_at,
         ranked_match.settled_at,
         ranked_match.created_at
       FROM ranked_matches AS ranked_match
       JOIN ranked_seasons AS season ON season.id = ranked_match.season_id
       JOIN match_records AS record ON record.match_id = ranked_match.match_id
       JOIN profiles AS first_profile ON first_profile.id = ranked_match.first_user_id
       JOIN profiles AS second_profile ON second_profile.id = ranked_match.second_user_id
       LEFT JOIN LATERAL (
         SELECT step.first_before_rating, step.first_after_rating,
                step.second_before_rating, step.second_after_rating
         FROM ranked_rating_event_steps AS step
         JOIN ranked_rating_events AS event ON event.id = step.event_id
         WHERE step.match_id = ranked_match.match_id
         ORDER BY event.event_sequence DESC
         LIMIT 1
       ) AS materialized_step ON true
       WHERE ranked_match.match_id = $1`,
      [matchId]
    );
    const match = matchResult.rows[0];
    if (!match) {
      throw adminError('RANKED_MATCH_NOT_FOUND', '排位对局不存在', 404);
    }
    const [eventRows, deckResult] = await Promise.all([
      this.loadEventRows(match.season_id, matchId),
      this.query<RankedAdminDeckObservationRow>(
        `SELECT
           observation.seat,
           observation.user_id,
           observation.deck_fingerprint,
           observation.main_deck_cards,
           snapshot.source_deck_name
         FROM ranked_deck_observations AS observation
         LEFT JOIN match_deck_snapshots AS snapshot
           ON snapshot.match_id = observation.match_id
          AND snapshot.seat = observation.seat
         WHERE observation.match_id = $1
           AND observation.season_id = $2
           AND (
             (observation.seat = 'FIRST' AND observation.user_id = $3)
             OR (observation.seat = 'SECOND' AND observation.user_id = $4)
           )
         ORDER BY CASE observation.seat WHEN 'FIRST' THEN 0 ELSE 1 END`,
        [matchId, match.season_id, match.first_user_id, match.second_user_id]
      ),
    ]);
    return {
      ...mapAdminMatch(match),
      events: eventRows.map(mapAdminEvent),
      decks: deckResult.rows.map(mapAdminDeckObservation),
    };
  }

  async settleMatch(matchId: string, adminUserId: string): Promise<RankedRatingMutationResult> {
    const result = await this.ratingService.settleMatch(matchId);
    this.audit({
      event: 'RANKED_MATCH_SETTLEMENT_RETRIED',
      adminUserId,
      seasonId: result.seasonId,
      matchId,
      detail: { alreadyApplied: result.alreadyApplied },
    });
    return result;
  }

  async previewCorrection(input: RankedAdminCorrectionPreviewInput) {
    validatePreviewInput(input);
    const seasonResult = await this.query<PreviewSeasonRow>(
      `SELECT lifecycle, ledger_revision, rating_algorithm_version, rating_config
       FROM ranked_seasons
       WHERE id = $1`,
      [input.seasonId]
    );
    const season = seasonResult.rows[0];
    if (!season) {
      throw adminError('RANKED_SEASON_NOT_FOUND', '排位赛季不存在', 404);
    }
    if (season.lifecycle !== 'ACTIVE' && season.lifecycle !== 'FINALIZING') {
      throw adminError('RANKED_SEASON_NOT_CORRECTABLE', '当前赛季不能执行评分更正', 409);
    }
    const config = readPersistentConfig(season.rating_algorithm_version, season.rating_config);
    const events = (await this.loadEventRows(input.seasonId)).map(mapLedgerEvent);
    const latest = [...events].reverse().find((event) => event.matchId === input.matchId);
    if (!latest) {
      throw adminError('RANKED_CORRECTION_TARGET_NOT_FOUND', '找不到可以更正的排位结算', 404);
    }
    const correction: RankedRatingEvent = {
      eventId: this.createId(),
      eventSequence: season.ledger_revision + 1,
      eventType: input.action === 'VOID' ? 'VOID' : 'REPLACEMENT',
      matchId: latest.matchId,
      targetEventId: latest.eventId,
      firstUserId: latest.firstUserId,
      secondUserId: latest.secondUserId,
      winnerSeat: input.action === 'VOID' ? null : input.replacementWinnerSeat!,
      resultType: input.action === 'VOID' ? 'PLATFORM_NO_CONTEST' : input.replacementResultType!,
      ratedAt: latest.ratedAt,
      algorithmVersion: config.algorithmVersion,
    };
    const seeds = await this.loadRatingSeeds(input.seasonId);
    const materialization = materializeRankedRatingLedger([...events, correction], config, seeds);
    const currentRatings = await this.loadCurrentRatings(input.seasonId);
    const userIds = new Set([...currentRatings.keys(), ...materialization.players.keys()]);
    const playerChanges = [...userIds]
      .sort()
      .map((userId) => {
        const before = currentRatings.get(userId) ?? createInitialGlickoRatingState(config);
        const after = materialization.players.get(userId) ?? createInitialGlickoRatingState(config);
        return {
          userId,
          before,
          after,
          ratingDelta: after.rating - before.rating,
          ratingDeviationDelta: after.ratingDeviation - before.ratingDeviation,
          ratedMatchCountDelta: after.ratedMatchCount - before.ratedMatchCount,
        };
      })
      .filter(
        (change) =>
          change.ratingDelta !== 0 ||
          change.ratingDeviationDelta !== 0 ||
          change.ratedMatchCountDelta !== 0
      );
    const previewToken = createCorrectionPreviewToken(
      {
        seasonId: input.seasonId,
        matchId: input.matchId,
        targetEventId: latest.eventId,
        action: input.action,
        replacementWinnerSeat: input.replacementWinnerSeat ?? null,
        replacementResultType:
          input.action === 'VOID' ? 'PLATFORM_NO_CONTEST' : input.replacementResultType!,
        ledgerRevision: season.ledger_revision,
      },
      this.previewSecret
    );
    return {
      seasonId: input.seasonId,
      matchId: input.matchId,
      action: input.action,
      targetEventId: latest.eventId,
      currentLedgerRevision: season.ledger_revision,
      previewToken,
      projectedLedgerRevision: season.ledger_revision + 1,
      materializedMatchCount: materialization.steps.length,
      affectedPlayerCount: playerChanges.length,
      playerChanges,
      advisory: true,
    };
  }

  async executeCorrection(input: RankedAdminCorrectionExecuteInput) {
    const expectedToken = createCorrectionPreviewToken(
      {
        seasonId: input.seasonId,
        matchId: input.matchId,
        targetEventId: input.expectedTargetEventId,
        action: input.action,
        replacementWinnerSeat: input.replacementWinnerSeat ?? null,
        replacementResultType:
          input.action === 'VOID' ? 'PLATFORM_NO_CONTEST' : input.replacementResultType!,
        ledgerRevision: input.expectedLedgerRevision,
      },
      this.previewSecret
    );
    if (!safeTokenEquals(input.previewToken, expectedToken)) {
      throw adminError(
        'RANKED_CORRECTION_PREVIEW_MISMATCH',
        '执行参数与更正预览不一致，请重新预览',
        409
      );
    }
    const result = await this.ratingService.correctMatch(input);
    this.audit({
      event: 'RANKED_MATCH_CORRECTED',
      adminUserId: input.adminUserId,
      seasonId: input.seasonId,
      matchId: input.matchId,
      detail: {
        action: input.action,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        replacementWinnerSeat: input.replacementWinnerSeat ?? null,
        replacementResultType:
          input.action === 'VOID' ? 'PLATFORM_NO_CONTEST' : input.replacementResultType,
        alreadyApplied: result.alreadyApplied,
      },
    });
    return result;
  }

  async getMonitoringSummary(seasonId?: string) {
    const values: unknown[] = [];
    const where = seasonId ? 'WHERE ranked_match.season_id = $1' : '';
    if (seasonId) {
      values.push(seasonId);
    }
    const result = await this.query<{
      readonly rating_status: 'PENDING' | 'SETTLED' | 'VOIDED';
      readonly count: number | string;
      readonly oldest_ended_at: Date | string | null;
    }>(
      `SELECT
         rating_status,
         COUNT(*) AS count,
         MIN(COALESCE(ranked_match.ended_at, record.ended_at)) AS oldest_ended_at
       FROM ranked_matches AS ranked_match
       JOIN match_records AS record ON record.match_id = ranked_match.match_id
       ${where}
       GROUP BY ranked_match.rating_status`,
      values
    );
    const byStatus = Object.fromEntries(
      result.rows.map((row) => [
        row.rating_status,
        {
          count: Number(row.count),
          oldestEndedAt: row.oldest_ended_at === null ? null : new Date(row.oldest_ended_at),
        },
      ])
    );
    return {
      seasonId: seasonId ?? null,
      generatedAt: this.now(),
      byStatus,
    };
  }

  private async resolveFormalEnvironment(input: RankedAdminSeasonDraftInput) {
    const config = buildSeasonRatingConfig(input.ratingAlgorithmVersion, input.softReset);
    const catalog = await this.getCardCatalogIdentity(true);
    return {
      config,
      environment: buildRankedCompetitiveEnvironmentIdentity(catalog, config),
    };
  }

  private async loadEventRows(seasonId: string, matchId?: string): Promise<RankedAdminEventRow[]> {
    const values: unknown[] = [seasonId];
    const matchCondition = matchId ? 'AND match_id = $2' : '';
    if (matchId) {
      values.push(matchId);
    }
    const result = await this.query<RankedAdminEventRow>(
      `SELECT
         id,
         event_sequence,
         event_type,
         match_id,
         target_event_id,
         first_user_id,
         second_user_id,
         winner_seat,
         result_type,
         rated_at,
         algorithm_version,
         reason,
         created_by,
         created_at
       FROM ranked_rating_events
       WHERE season_id = $1
         ${matchCondition}
       ORDER BY event_sequence`,
      values
    );
    return result.rows;
  }

  private async loadCurrentRatings(
    seasonId: string
  ): Promise<ReadonlyMap<string, GlickoRatingState>> {
    const result = await this.query<PreviewRatingRow>(
      `SELECT user_id, rating, rating_deviation, rated_match_count, last_rated_at
       FROM ranked_player_ratings
       WHERE season_id = $1`,
      [seasonId]
    );
    return new Map(
      result.rows.map((row) => [
        row.user_id,
        {
          rating: row.rating,
          ratingDeviation: row.rating_deviation,
          ratedMatchCount: row.rated_match_count,
          lastRatedAt: row.last_rated_at === null ? null : new Date(row.last_rated_at),
        },
      ])
    );
  }

  private async loadRatingSeeds(seasonId: string): Promise<ReadonlyMap<string, GlickoRatingState>> {
    const result = await this.query<{
      readonly user_id: string;
      readonly rating: number;
      readonly rating_deviation: number;
    }>(
      `SELECT user_id, rating, rating_deviation
       FROM ranked_player_seeds
       WHERE season_id = $1`,
      [seasonId]
    );
    return new Map(
      result.rows.map((row) => [
        row.user_id,
        {
          rating: Number(row.rating),
          ratingDeviation: Number(row.rating_deviation),
          ratedMatchCount: 0,
          lastRatedAt: null,
        },
      ])
    );
  }
}

function projectSeason(season: RankedSeasonRecord, now: Date): RankedAdminSeasonView {
  const withinOpenWindow = isRankedQueueWindowOpen(
    now,
    season.platformTimeZone,
    season.openWindows,
    season.startsAt,
    season.scheduledEndsAt
  );
  return {
    ...season,
    withinOpenWindow,
    effectiveQueueOpen:
      season.lifecycle === 'ACTIVE' && season.queueAdmission === 'OPEN' && withinOpenWindow,
  };
}

function mapAdminMatch(row: RankedAdminMatchRow) {
  return {
    matchId: row.match_id,
    seasonId: row.season_id,
    seasonKey: row.season_key,
    ratingStatus: row.rating_status,
    winnerSeat: row.winner_seat,
    resultType: row.result_type,
    priorResultType: row.prior_result_type,
    firstPlayer: {
      userId: row.first_user_id,
      username: row.first_username,
      displayName: row.first_display_name,
    },
    secondPlayer: {
      userId: row.second_user_id,
      username: row.second_username,
      displayName: row.second_display_name,
    },
    firstRatingDelta:
      row.rating_status === 'SETTLED' && row.first_rating_delta != null
        ? Number(row.first_rating_delta)
        : null,
    secondRatingDelta:
      row.rating_status === 'SETTLED' && row.second_rating_delta != null
        ? Number(row.second_rating_delta)
        : null,
    recordStatus: row.record_status,
    completeness: row.completeness,
    sealedAt: row.sealed_at === null ? null : new Date(row.sealed_at),
    endedAt: row.ended_at === null ? null : new Date(row.ended_at),
    settledAt: row.settled_at === null ? null : new Date(row.settled_at),
    createdAt: new Date(row.created_at),
  };
}

function mapLedgerEvent(row: RankedAdminEventRow): RankedRatingEvent {
  return {
    eventId: row.id,
    eventSequence: row.event_sequence,
    eventType: row.event_type,
    matchId: row.match_id,
    targetEventId: row.target_event_id,
    firstUserId: row.first_user_id,
    secondUserId: row.second_user_id,
    winnerSeat: row.winner_seat,
    resultType: row.result_type,
    ratedAt: new Date(row.rated_at),
    algorithmVersion: row.algorithm_version,
  };
}

function mapAdminEvent(row: RankedAdminEventRow) {
  return {
    eventId: row.id,
    eventSequence: row.event_sequence,
    eventType: row.event_type,
    targetEventId: row.target_event_id,
    winnerSeat: row.winner_seat,
    resultType: row.result_type,
    ratedAt: new Date(row.rated_at),
    algorithmVersion: row.algorithm_version,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
  };
}

function mapAdminDeckObservation(row: RankedAdminDeckObservationRow) {
  return {
    seat: row.seat,
    userId: row.user_id,
    sourceDeckName: row.source_deck_name,
    deckFingerprint: row.deck_fingerprint,
    mainDeckCards: readAdminDeckCards(row.main_deck_cards),
  };
}

function readAdminDeckCards(value: unknown): RankedAdminDeckCard[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw adminError('RANKED_DECK_OBSERVATION_INVALID', '排位对局的卡组观察数据无效', 500);
  }
  const baseCardCodes = new Set<string>();
  let totalCount = 0;
  const cards = value.map((entry): RankedAdminDeckCard => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw adminError('RANKED_DECK_OBSERVATION_INVALID', '排位对局的卡组观察数据无效', 500);
    }
    const card = entry as Record<string, unknown>;
    const baseCardCode = readRequiredDeckString(card.baseCardCode);
    const cardCode = readRequiredDeckString(card.cardCode);
    const name = readRequiredDeckString(card.name);
    const cardType = card.cardType;
    const count = card.count;
    const imageFilename =
      card.imageFilename === undefined || card.imageFilename === null
        ? null
        : readRequiredDeckString(card.imageFilename);
    if (
      baseCardCode === null ||
      cardCode === null ||
      name === null ||
      (cardType !== 'MEMBER' && cardType !== 'LIVE') ||
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      (card.imageFilename !== undefined && card.imageFilename !== null && imageFilename === null) ||
      baseCardCodes.has(baseCardCode)
    ) {
      throw adminError('RANKED_DECK_OBSERVATION_INVALID', '排位对局的卡组观察数据无效', 500);
    }
    baseCardCodes.add(baseCardCode);
    totalCount += count;
    return {
      baseCardCode,
      cardCode,
      name,
      cardType,
      count,
      imageFilename,
    };
  });
  if (totalCount !== 60) {
    throw adminError('RANKED_DECK_OBSERVATION_INVALID', '排位对局的卡组观察数据无效', 500);
  }
  return cards;
}

function readRequiredDeckString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function validatePreviewInput(input: RankedAdminCorrectionPreviewInput): void {
  if (input.action === 'REPLACE' && !input.replacementWinnerSeat) {
    throw adminError('RANKED_REPLACEMENT_WINNER_REQUIRED', '替换结算必须指定新的胜方');
  }
  if (input.action === 'VOID' && input.replacementWinnerSeat) {
    throw adminError('RANKED_VOID_WINNER_FORBIDDEN', '作废结算不能指定替换胜方');
  }
  if (
    input.action === 'REPLACE' &&
    input.replacementResultType !== 'NORMAL' &&
    input.replacementResultType !== 'SURRENDER' &&
    input.replacementResultType !== 'DISCONNECT_FORFEIT'
  ) {
    throw adminError('RANKED_REPLACEMENT_RESULT_TYPE_REQUIRED', '替换结算必须指定合法结果类型');
  }
}

function readPersistentConfig(algorithmVersion: string, value: unknown): RankedRatingConfig {
  const config = value as RankedRatingConfig;
  try {
    assertValidRankedRatingConfig(config);
  } catch {
    throw adminError('RANKED_STORED_CONFIG_INVALID', '赛季冻结的评分配置无效', 500);
  }
  if (config.algorithmVersion !== algorithmVersion || config.algorithmVersion.includes('SHADOW')) {
    throw adminError('RANKED_STORED_CONFIG_INVALID', '赛季冻结的正式评分算法版本无效', 500);
  }
  return config;
}

interface CorrectionPreviewTokenPayload {
  readonly seasonId: string;
  readonly matchId: string;
  readonly targetEventId: string;
  readonly action: 'VOID' | 'REPLACE';
  readonly replacementWinnerSeat: RankedWinnerSeat | null;
  readonly replacementResultType: RankedResultType;
  readonly ledgerRevision: number;
}

function createCorrectionPreviewToken(
  payload: CorrectionPreviewTokenPayload,
  secret: string
): string {
  return createHmac('sha256', secret).update(stableJsonStringify(payload)).digest('base64url');
}

function safeTokenEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function writeRankedAdminAudit(event: RankedAdminAuditEvent): void {
  console.info(
    JSON.stringify({
      scope: 'ranked_admin',
      occurredAt: new Date().toISOString(),
      ...event,
    })
  );
}

function adminError(code: string, message: string, statusCode = 400): RankedAdminServiceError {
  return new RankedAdminServiceError(code, message, statusCode);
}

function buildSeasonRatingConfig(
  algorithmVersion: string,
  softReset: RankedAdminSeasonDraftInput['softReset']
): RankedRatingConfig {
  const baseConfig = getFormalRankedAlgorithmConfig(algorithmVersion);
  const config: RankedRatingConfig = {
    ...baseConfig,
    softResetMode: softReset.mode,
    softResetCenter: softReset.center,
    softResetRetention: softReset.retention,
    softResetMinimumDeviation: softReset.minimumDeviation,
  };
  try {
    assertValidRankedRatingConfig(config);
  } catch (error) {
    throw new RankedAdminServiceError(
      'RANKED_SOFT_RESET_CONFIG_INVALID',
      `软重置参数无效：${readErrorMessage(error)}`,
      400
    );
  }
  return config;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export const rankedAdminService = new RankedAdminService();
