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
import {
  hashDeckClassifierSnapshot,
  readDeckClassifierSnapshot,
} from './deck-classifier-release.js';
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

export interface RankedAdminPlayerSearchCandidate {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string | null;
}

export type RankedAdminPlayerStatus = 'PLACEMENT' | 'PLACED_NOT_ELIGIBLE' | 'RANKED';

export interface RankedAdminPlayerContextPlayer extends RankedAdminPlayerSearchCandidate {
  readonly rating: number;
  readonly ratingDeviation: number;
  readonly ratedMatchCount: number;
  readonly wins: number;
  readonly losses: number;
  readonly placementCompleted: boolean;
  readonly leaderboardEligible: boolean;
  readonly status: RankedAdminPlayerStatus;
  readonly rank: number | null;
  readonly deckClassification: RankedAdminPlayerDeckClassification;
}

export interface RankedAdminPlayerListItem extends RankedAdminPlayerContextPlayer {
  readonly listPosition: number;
}

export type RankedAdminPlayerDeckClassificationCoverage = 'NONE' | 'PARTIAL' | 'COMPLETE';

export interface RankedAdminPlayerDeckClassification {
  readonly release: { readonly id: string; readonly version: number } | null;
  readonly observedMatchCount: number;
  readonly classifiedMatchCount: number;
  readonly coverageStatus: RankedAdminPlayerDeckClassificationCoverage;
  readonly isTied: boolean;
  readonly leaders: readonly {
    readonly archetypeId: string;
    readonly name: string;
    readonly matchCount: number;
  }[];
}

export interface RankedAdminPlayerContextNeighbor extends RankedAdminPlayerSearchCandidate {
  readonly rating: number;
  readonly ratingDeviation: number;
  readonly ratedMatchCount: number;
  readonly wins: number;
  readonly losses: number;
  readonly deckClassification: RankedAdminPlayerDeckClassification;
  readonly rank: number;
  readonly isTarget: boolean;
}

export interface RankedAdminPlayerContext {
  readonly seasonId: string;
  readonly generatedAt: Date;
  readonly ledgerRevision: number;
  readonly placementRequired: number;
  readonly leaderboardMinimumMatchCount: number;
  readonly player: RankedAdminPlayerContextPlayer;
  readonly neighbors: {
    readonly rows: readonly RankedAdminPlayerContextNeighbor[];
  };
}

export interface RankedAdminDeckStatisticsPlayer extends RankedAdminPlayerSearchCandidate {
  readonly appearanceCount: number;
  readonly winnerCount: number;
  readonly lossCount: number;
  readonly winRate: number;
}

export interface RankedAdminDeckStatisticsCategory {
  readonly archetypeId: string;
  readonly categoryKey: string;
  readonly name: string;
  readonly groupName: string;
  readonly color: string;
  readonly sortOrder: number;
  readonly classificationStatus: 'CLASSIFIED' | 'UNKNOWN' | 'AMBIGUOUS';
  readonly appearanceCount: number;
  readonly winnerCount: number;
  readonly lossCount: number;
  readonly playerCount: number;
  readonly winRate: number | null;
  readonly players: readonly RankedAdminDeckStatisticsPlayer[];
}

export interface RankedAdminDeckStatistics {
  readonly seasonId: string;
  readonly generatedAt: Date;
  readonly available: boolean;
  readonly release: {
    readonly id: string;
    readonly version: number;
    readonly publishedAt: number;
  } | null;
  readonly sample: {
    readonly settledMatchCount: number;
    readonly observedMatchCount: number;
    readonly analyzedMatchCount: number;
    readonly deckObservationCount: number;
    readonly assignedDeckObservationCount: number;
    readonly recognizedDeckObservationCount: number;
    readonly invalidDeckObservationCount: number;
    readonly excludedDeckObservationCount: number;
    readonly observationCoverageRate: number;
    readonly classificationCoverageRate: number;
  };
  readonly categories: readonly RankedAdminDeckStatisticsCategory[];
}

export interface RankedAdminPlayerListPage {
  readonly seasonId: string;
  readonly generatedAt: Date;
  readonly ledgerRevision: number;
  readonly placementRequired: number;
  readonly leaderboardMinimumMatchCount: number;
  readonly classificationRelease: { readonly id: string; readonly version: number } | null;
  readonly query: string;
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
  readonly players: readonly RankedAdminPlayerListItem[];
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

interface RankedAdminPlayerSearchRow {
  readonly user_id: string;
  readonly username: string;
  readonly display_name: string | null;
}

interface RankedAdminPlayerContextRow {
  readonly season_id: string;
  readonly rating_algorithm_version: string;
  readonly rating_config: unknown;
  readonly leaderboard_minimum_match_count: number;
  readonly ledger_revision: number;
  readonly target_user_id: string | null;
  readonly target_username: string | null;
  readonly target_display_name: string | null;
  readonly target_rating: number | string | null;
  readonly target_rating_deviation: number | string | null;
  readonly target_rated_match_count: number | string | null;
  readonly target_wins: number | string;
  readonly target_losses: number | string;
  readonly active_release_id: string | null;
  readonly active_release_version: number | string | null;
  readonly active_release_snapshot_json: unknown;
  readonly active_release_config_hash: string | null;
  readonly observed_deck_match_count: number | string;
  readonly classified_deck_match_count: number | string;
  readonly leading_deck_match_count: number | string;
  readonly leading_archetype_ids: readonly string[] | null;
  readonly target_rank: number | string | null;
  readonly neighbor_user_id: string | null;
  readonly neighbor_username: string | null;
  readonly neighbor_display_name: string | null;
  readonly neighbor_rating: number | string | null;
  readonly neighbor_rating_deviation: number | string | null;
  readonly neighbor_rated_match_count: number | string | null;
  readonly neighbor_wins: number | string | null;
  readonly neighbor_losses: number | string | null;
  readonly neighbor_observed_deck_match_count: number | string | null;
  readonly neighbor_classified_deck_match_count: number | string | null;
  readonly neighbor_leading_deck_match_count: number | string | null;
  readonly neighbor_leading_archetype_ids: readonly string[] | null;
  readonly neighbor_rank: number | string | null;
}

interface RankedAdminInsightsSeasonRow {
  readonly season_id: string;
  readonly rating_algorithm_version: string;
  readonly rating_config: unknown;
  readonly leaderboard_minimum_match_count: number;
  readonly ledger_revision: number;
  readonly active_release_id: string | null;
  readonly active_release_version: number | string | null;
  readonly active_release_snapshot_json: unknown;
  readonly active_release_config_hash: string | null;
  readonly active_release_published_at: Date | string | null;
  readonly active_release_activated_at: Date | string | null;
}

interface RankedAdminDeckStatisticsDisplayRow {
  readonly id: string;
  readonly color_key: string;
}

interface RankedAdminDeckStatisticsRow {
  readonly settled_match_count: number | string;
  readonly observed_match_count: number | string;
  readonly assigned_observation_count: number | string;
  readonly recognized_observation_count: number | string;
  readonly invalid_observation_count: number | string;
  readonly excluded_observation_count: number | string;
  readonly match_id: string | null;
  readonly seat: 'FIRST' | 'SECOND' | null;
  readonly user_id: string | null;
  readonly username: string | null;
  readonly display_name: string | null;
  readonly winner_seat: RankedWinnerSeat | null;
  readonly status: 'CLASSIFIED' | 'UNKNOWN' | 'AMBIGUOUS' | null;
  readonly archetype_id: string | null;
}

interface RankedAdminPlayerListRow {
  readonly season_id: string;
  readonly rating_algorithm_version: string;
  readonly rating_config: unknown;
  readonly leaderboard_minimum_match_count: number;
  readonly ledger_revision: number;
  readonly active_release_id: string | null;
  readonly active_release_version: number | string | null;
  readonly active_release_snapshot_json: unknown;
  readonly active_release_config_hash: string | null;
  readonly active_release_published_at: Date | string | null;
  readonly active_release_activated_at: Date | string | null;
  readonly total_count: number | string;
  readonly user_id: string | null;
  readonly username: string | null;
  readonly display_name: string | null;
  readonly rating: number | string | null;
  readonly rating_deviation: number | string | null;
  readonly rated_match_count: number | string | null;
  readonly wins: number | string | null;
  readonly losses: number | string | null;
  readonly rank: number | string | null;
  readonly list_position: number | string | null;
  readonly observed_deck_match_count: number | string | null;
  readonly classified_deck_match_count: number | string | null;
  readonly leading_deck_match_count: number | string | null;
  readonly leading_archetype_ids: readonly string[] | null;
}

interface PlayerDeckClassificationSummaryRow {
  readonly active_release_id: string | null;
  readonly active_release_version: number | string | null;
  readonly active_release_snapshot_json: unknown;
  readonly active_release_config_hash: string | null;
  readonly observed_deck_match_count: number | string;
  readonly classified_deck_match_count: number | string;
  readonly leading_deck_match_count: number | string;
  readonly leading_archetype_ids: readonly string[] | null;
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

  async deleteDraft(seasonId: string, adminUserId: string): Promise<RankedAdminSeasonView> {
    const season = await this.seasonService.deleteDraft(seasonId);
    this.audit({
      event: 'RANKED_SEASON_DRAFT_DELETED',
      adminUserId,
      seasonId,
      detail: {
        seasonKey: season.seasonKey,
        name: season.name,
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

  async getDeckStatistics(seasonId: string): Promise<RankedAdminDeckStatistics> {
    const generatedAt = this.now();
    const season = await this.getInsightsSeason(seasonId);
    const release = readInsightsRelease(season);
    if (!release) {
      const settledResult = await this.query<{ readonly count: number | string }>(
        `SELECT COUNT(*) AS count
         FROM ranked_matches
         WHERE season_id = $1 AND rating_status = 'SETTLED'`,
        [seasonId]
      );
      const settledMatchCount = readAdminCount(settledResult.rows[0]?.count ?? 0, '已结算对局数');
      return {
        seasonId,
        generatedAt,
        available: false,
        release: null,
        sample: {
          settledMatchCount,
          observedMatchCount: 0,
          analyzedMatchCount: 0,
          deckObservationCount: 0,
          assignedDeckObservationCount: 0,
          recognizedDeckObservationCount: 0,
          invalidDeckObservationCount: 0,
          excludedDeckObservationCount: 0,
          observationCoverageRate: 0,
          classificationCoverageRate: 0,
        },
        categories: [],
      };
    }

    const displayResult = await this.query<RankedAdminDeckStatisticsDisplayRow>(
      `SELECT id, color_key
       FROM deck_archetypes
       WHERE id = ANY($1::uuid[])`,
      [release.snapshot.archetypes.map((archetype) => archetype.id)]
    );
    const statsResult = await this.query<RankedAdminDeckStatisticsRow>(
      RANKED_ADMIN_DECK_STATISTICS_QUERY,
      [seasonId, release.id]
    );
    return aggregateRankedAdminDeckStatistics({
      seasonId,
      generatedAt,
      release,
      displayRows: displayResult.rows,
      rows: statsResult.rows,
    });
  }

  async listPlayers(
    seasonId: string,
    queryText: string | undefined,
    limit: number,
    offset: number
  ): Promise<RankedAdminPlayerListPage> {
    const generatedAt = this.now();
    const normalizedQuery = queryText?.trim() ?? '';
    const pattern = normalizedQuery ? `%${escapeLikePattern(normalizedQuery)}%` : null;
    const result = await this.query<RankedAdminPlayerListRow>(RANKED_ADMIN_PLAYER_LIST_QUERY, [
      seasonId,
      pattern,
      limit,
      offset,
    ]);
    const first = result.rows[0];
    if (!first) {
      throw adminError('RANKED_SEASON_NOT_FOUND', '排位赛季不存在', 404);
    }
    const season: RankedAdminInsightsSeasonRow = {
      season_id: first.season_id,
      rating_algorithm_version: first.rating_algorithm_version,
      rating_config: first.rating_config,
      leaderboard_minimum_match_count: first.leaderboard_minimum_match_count,
      ledger_revision: first.ledger_revision,
      active_release_id: first.active_release_id,
      active_release_version: first.active_release_version,
      active_release_snapshot_json: first.active_release_snapshot_json,
      active_release_config_hash: first.active_release_config_hash,
      active_release_published_at: first.active_release_published_at,
      active_release_activated_at: first.active_release_activated_at,
    };
    const ratingConfig = readPersistentConfig(
      season.rating_algorithm_version,
      season.rating_config
    );
    const release = readInsightsRelease(season);
    const total = readAdminCount(first.total_count, '玩家总数');
    const placementRequired = ratingConfig.placementMatchCount;
    const leaderboardMinimumMatchCount = readPositiveAdminCount(
      season.leaderboard_minimum_match_count,
      '参榜门槛'
    );
    const ledgerRevision = readAdminCount(season.ledger_revision, 'ledger revision');
    const players = result.rows.flatMap((row): RankedAdminPlayerListItem[] => {
      if (
        !row.user_id ||
        !row.username ||
        row.rating === null ||
        row.rating_deviation === null ||
        row.rated_match_count === null ||
        row.wins === null ||
        row.losses === null ||
        row.list_position === null ||
        row.observed_deck_match_count === null ||
        row.classified_deck_match_count === null ||
        row.leading_deck_match_count === null
      ) {
        return [];
      }
      const ratedMatchCount = readAdminCount(row.rated_match_count, '玩家已计分场数');
      const wins = readAdminCount(row.wins, '玩家胜场数');
      const losses = readAdminCount(row.losses, '玩家负场数');
      if (wins + losses !== ratedMatchCount) {
        throw adminError(
          'RANKED_PLAYER_LIST_INVALID',
          '玩家胜负场数与评分投影的已计分场数不一致',
          500
        );
      }
      const placementCompleted = ratedMatchCount >= placementRequired;
      const leaderboardEligible = ratedMatchCount >= leaderboardMinimumMatchCount;
      const rank = leaderboardEligible ? readPositiveRank(row.rank) : null;
      return [
        {
          listPosition: readPositivePlayerListPosition(row.list_position),
          userId: row.user_id,
          username: row.username,
          displayName: row.display_name,
          rating: readFiniteNumber(row.rating, '玩家评分'),
          ratingDeviation: readFiniteNumber(row.rating_deviation, '玩家 RD'),
          ratedMatchCount,
          wins,
          losses,
          placementCompleted,
          leaderboardEligible,
          status: !placementCompleted
            ? 'PLACEMENT'
            : leaderboardEligible
              ? 'RANKED'
              : 'PLACED_NOT_ELIGIBLE',
          rank,
          deckClassification: readPlayerDeckClassification(
            {
              active_release_id: release?.id ?? null,
              active_release_version: release?.version ?? null,
              active_release_snapshot_json: release?.snapshot ?? null,
              active_release_config_hash: release?.configHash ?? null,
              observed_deck_match_count: row.observed_deck_match_count,
              classified_deck_match_count: row.classified_deck_match_count,
              leading_deck_match_count: row.leading_deck_match_count,
              leading_archetype_ids: row.leading_archetype_ids,
            },
            ratedMatchCount
          ),
        },
      ];
    });
    if (players.length > limit || players.length > total) {
      throw adminError('RANKED_PLAYER_LIST_INVALID', '排位玩家分页结果无效', 500);
    }
    return {
      seasonId,
      generatedAt,
      ledgerRevision,
      placementRequired,
      leaderboardMinimumMatchCount,
      classificationRelease: release ? { id: release.id, version: release.version } : null,
      query: normalizedQuery,
      limit,
      offset,
      total,
      players,
    };
  }

  private async getInsightsSeason(seasonId: string): Promise<RankedAdminInsightsSeasonRow> {
    const result = await this.query<RankedAdminInsightsSeasonRow>(
      `SELECT season.id AS season_id, season.rating_algorithm_version, season.rating_config,
              season.leaderboard_minimum_match_count, season.ledger_revision,
              release.id AS active_release_id,
              release.version AS active_release_version,
              release.snapshot_json AS active_release_snapshot_json,
              release.config_hash AS active_release_config_hash,
              release.published_at AS active_release_published_at,
              release.activated_at AS active_release_activated_at
       FROM ranked_seasons AS season
       LEFT JOIN deck_classifier_releases AS release ON release.status = 'ACTIVE'
       WHERE season.id = $1`,
      [seasonId]
    );
    const season = result.rows[0];
    if (!season) {
      throw adminError('RANKED_SEASON_NOT_FOUND', '排位赛季不存在', 404);
    }
    return season;
  }

  async searchPlayers(
    seasonId: string,
    queryText: string,
    limit: number
  ): Promise<RankedAdminPlayerSearchCandidate[]> {
    const seasonResult = await this.query<{ readonly exists: boolean }>(
      `SELECT TRUE AS exists
       FROM ranked_seasons
       WHERE id = $1`,
      [seasonId]
    );
    if (!seasonResult.rows[0]) {
      throw adminError('RANKED_SEASON_NOT_FOUND', '排位赛季不存在', 404);
    }

    const normalizedQuery = queryText.trim();
    const pattern = `%${escapeLikePattern(normalizedQuery)}%`;
    const result = await this.query<RankedAdminPlayerSearchRow>(
      `SELECT profile.id AS user_id, profile.username, profile.display_name
       FROM ranked_player_ratings AS rating
       JOIN profiles AS profile ON profile.id = rating.user_id
       WHERE rating.season_id = $1
         AND rating.rated_match_count > 0
         AND (
           profile.id::text ILIKE $2 ESCAPE '\\'
           OR profile.username ILIKE $2 ESCAPE '\\'
           OR COALESCE(profile.display_name, '') ILIKE $2 ESCAPE '\\'
         )
       ORDER BY
         CASE
           WHEN profile.id::text = $3 THEN 0
           WHEN LOWER(profile.username) = LOWER($3) THEN 1
           WHEN LOWER(COALESCE(profile.display_name, '')) = LOWER($3) THEN 2
           ELSE 3
         END,
         profile.username ASC,
         profile.id ASC
       LIMIT $4`,
      [seasonId, pattern, normalizedQuery, limit]
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
    }));
  }

  async getPlayerContext(seasonId: string, userId: string): Promise<RankedAdminPlayerContext> {
    const generatedAt = this.now();
    const result = await this.query<RankedAdminPlayerContextRow>(
      `WITH season AS MATERIALIZED (
         SELECT id, rating_algorithm_version, rating_config,
                leaderboard_minimum_match_count, ledger_revision
         FROM ranked_seasons
         WHERE id = $1
       ), target AS MATERIALIZED (
         SELECT profile.id AS user_id, profile.username, profile.display_name,
                rating.rating, rating.rating_deviation, rating.rated_match_count
         FROM profiles AS profile
         LEFT JOIN ranked_player_ratings AS rating
           ON rating.season_id = $1
          AND rating.user_id = profile.id
         WHERE profile.id = $2
       ), eligible AS MATERIALIZED (
         SELECT rating.user_id, profile.username, profile.display_name,
                rating.rating, rating.rating_deviation, rating.rated_match_count,
                ROW_NUMBER() OVER (
                  ORDER BY rating.rating DESC, rating.user_id ASC
                ) AS rank
         FROM season
         JOIN ranked_player_ratings AS rating
           ON rating.season_id = season.id
          AND rating.rated_match_count >= season.leaderboard_minimum_match_count
         JOIN profiles AS profile ON profile.id = rating.user_id
       ), active_release AS MATERIALIZED (
         SELECT id, version, snapshot_json, config_hash
         FROM deck_classifier_releases
         WHERE status = 'ACTIVE'
       ), target_context AS MATERIALIZED (
         SELECT season.id AS season_id,
                season.rating_algorithm_version, season.rating_config,
                season.leaderboard_minimum_match_count, season.ledger_revision,
                target.user_id AS target_user_id,
                target.username AS target_username,
                target.display_name AS target_display_name,
                target.rating AS target_rating,
                target.rating_deviation AS target_rating_deviation,
                target.rated_match_count AS target_rated_match_count,
                eligible.rank AS target_rank
         FROM season
         LEFT JOIN target ON TRUE
         LEFT JOIN eligible ON eligible.user_id = target.user_id
       ), neighbor_window AS MATERIALIZED (
         SELECT neighbor.*
         FROM target_context AS context
         JOIN eligible AS neighbor
           ON context.target_rank IS NOT NULL
          AND neighbor.rank BETWEEN context.target_rank - 3 AND context.target_rank + 3
       ), context_users AS MATERIALIZED (
         SELECT target_user_id AS user_id
         FROM target_context
         WHERE target_user_id IS NOT NULL
         UNION
         SELECT user_id FROM neighbor_window
       ), player_results AS MATERIALIZED (
         SELECT ranked_match.first_user_id AS user_id,
                ranked_match.match_id, 'FIRST'::text AS seat, ranked_match.winner_seat
         FROM ranked_matches AS ranked_match
         JOIN context_users AS context_user ON context_user.user_id = ranked_match.first_user_id
         WHERE ranked_match.season_id = $1
           AND ranked_match.rating_status = 'SETTLED'
         UNION ALL
         SELECT ranked_match.second_user_id AS user_id,
                ranked_match.match_id, 'SECOND'::text AS seat, ranked_match.winner_seat
         FROM ranked_matches AS ranked_match
         JOIN context_users AS context_user ON context_user.user_id = ranked_match.second_user_id
         WHERE ranked_match.season_id = $1
           AND ranked_match.rating_status = 'SETTLED'
       ), record_summaries AS MATERIALIZED (
         SELECT context_user.user_id,
                COUNT(result.match_id) FILTER (WHERE result.seat = result.winner_seat) AS wins,
                COUNT(result.match_id) FILTER (WHERE result.seat <> result.winner_seat) AS losses
         FROM context_users AS context_user
         LEFT JOIN player_results AS result ON result.user_id = context_user.user_id
         GROUP BY context_user.user_id
       ), player_observations AS MATERIALIZED (
         SELECT result.user_id, result.match_id, result.seat
         FROM player_results AS result
         JOIN ranked_deck_observations AS observation
           ON observation.match_id = result.match_id
          AND observation.seat = result.seat
          AND observation.season_id = $1
          AND observation.user_id = result.user_id
       ), classification_counts AS MATERIALIZED (
         SELECT observation.user_id, assignment.archetype_id, COUNT(*) AS match_count
         FROM player_observations AS observation
         CROSS JOIN active_release AS release
         JOIN deck_classification_assignments AS assignment
           ON assignment.match_id = observation.match_id
          AND assignment.seat = observation.seat
          AND assignment.release_id = release.id
          AND assignment.status = 'CLASSIFIED'
         GROUP BY observation.user_id, assignment.archetype_id
       ), deck_summaries AS MATERIALIZED (
         SELECT
           context_user.user_id,
           (SELECT COUNT(*) FROM player_observations AS observation
            WHERE observation.user_id = context_user.user_id) AS observed_match_count,
           COALESCE((SELECT SUM(match_count) FROM classification_counts AS count
                     WHERE count.user_id = context_user.user_id), 0)
             AS classified_match_count,
           COALESCE((SELECT MAX(match_count) FROM classification_counts AS count
                     WHERE count.user_id = context_user.user_id), 0)
             AS leading_match_count,
           COALESCE(
             (SELECT ARRAY_AGG(count.archetype_id ORDER BY count.archetype_id)
              FROM classification_counts AS count
              WHERE count.user_id = context_user.user_id
                AND count.match_count = (
                  SELECT MAX(inner_count.match_count)
                  FROM classification_counts AS inner_count
                  WHERE inner_count.user_id = context_user.user_id
                )),
             ARRAY[]::uuid[]
           ) AS leading_archetype_ids
         FROM context_users AS context_user
       )
       SELECT context.*,
              target_record.wins AS target_wins,
              target_record.losses AS target_losses,
              active_release.id AS active_release_id,
              active_release.version AS active_release_version,
              active_release.snapshot_json AS active_release_snapshot_json,
              active_release.config_hash AS active_release_config_hash,
              target_deck.observed_match_count AS observed_deck_match_count,
              target_deck.classified_match_count AS classified_deck_match_count,
              target_deck.leading_match_count AS leading_deck_match_count,
              target_deck.leading_archetype_ids,
              neighbor.user_id AS neighbor_user_id,
              neighbor.username AS neighbor_username,
              neighbor.display_name AS neighbor_display_name,
              neighbor.rating AS neighbor_rating,
              neighbor.rating_deviation AS neighbor_rating_deviation,
              neighbor.rated_match_count AS neighbor_rated_match_count,
              neighbor_record.wins AS neighbor_wins,
              neighbor_record.losses AS neighbor_losses,
              neighbor_deck.observed_match_count AS neighbor_observed_deck_match_count,
              neighbor_deck.classified_match_count AS neighbor_classified_deck_match_count,
              neighbor_deck.leading_match_count AS neighbor_leading_deck_match_count,
              neighbor_deck.leading_archetype_ids AS neighbor_leading_archetype_ids,
              neighbor.rank AS neighbor_rank
       FROM target_context AS context
       LEFT JOIN record_summaries AS target_record
         ON target_record.user_id = context.target_user_id
       LEFT JOIN deck_summaries AS target_deck
         ON target_deck.user_id = context.target_user_id
       LEFT JOIN active_release ON TRUE
       LEFT JOIN neighbor_window AS neighbor ON TRUE
       LEFT JOIN record_summaries AS neighbor_record
         ON neighbor_record.user_id = neighbor.user_id
       LEFT JOIN deck_summaries AS neighbor_deck
         ON neighbor_deck.user_id = neighbor.user_id
       ORDER BY neighbor.rank ASC NULLS LAST`,
      [seasonId, userId]
    );
    const first = result.rows[0];
    if (!first) {
      throw adminError('RANKED_SEASON_NOT_FOUND', '排位赛季不存在', 404);
    }
    if (!first.target_user_id || !first.target_username) {
      throw adminError('RANKED_PLAYER_NOT_FOUND', '玩家不存在', 404);
    }
    if (
      first.target_rating === null ||
      first.target_rating_deviation === null ||
      first.target_rated_match_count === null ||
      Number(first.target_rated_match_count) <= 0
    ) {
      throw adminError('RANKED_PLAYER_RATING_NOT_FOUND', '该玩家在本赛季没有有效计分记录', 404);
    }

    const ratingConfig = readPersistentConfig(first.rating_algorithm_version, first.rating_config);
    const ratedMatchCount = Number(first.target_rated_match_count);
    const wins = readNonNegativeSafeInteger(first.target_wins, '玩家胜场数');
    const losses = readNonNegativeSafeInteger(first.target_losses, '玩家负场数');
    if (wins + losses !== ratedMatchCount) {
      throw adminError(
        'RANKED_PLAYER_CONTEXT_INVALID',
        '玩家胜负场数与评分投影的已计分场数不一致',
        500
      );
    }
    const deckClassification = readPlayerDeckClassification(first, wins + losses);
    const placementRequired = ratingConfig.placementMatchCount;
    const leaderboardMinimumMatchCount = first.leaderboard_minimum_match_count;
    const placementCompleted = ratedMatchCount >= placementRequired;
    const leaderboardEligible = ratedMatchCount >= leaderboardMinimumMatchCount;
    const status: RankedAdminPlayerStatus = !placementCompleted
      ? 'PLACEMENT'
      : !leaderboardEligible
        ? 'PLACED_NOT_ELIGIBLE'
        : 'RANKED';
    const rank = leaderboardEligible ? Number(first.target_rank) : null;
    if (leaderboardEligible && (rank === null || !Number.isInteger(rank) || rank <= 0)) {
      throw adminError('RANKED_PLAYER_CONTEXT_INVALID', '排位玩家排名上下文查询失败', 500);
    }

    const neighbors = leaderboardEligible
      ? result.rows.flatMap((row): RankedAdminPlayerContextNeighbor[] => {
          if (
            !row.neighbor_user_id ||
            !row.neighbor_username ||
            row.neighbor_rating === null ||
            row.neighbor_rating_deviation === null ||
            row.neighbor_rated_match_count === null ||
            row.neighbor_wins === null ||
            row.neighbor_losses === null ||
            row.neighbor_observed_deck_match_count === null ||
            row.neighbor_classified_deck_match_count === null ||
            row.neighbor_leading_deck_match_count === null ||
            row.neighbor_rank === null
          ) {
            return [];
          }
          const neighborRatedMatchCount = readNonNegativeSafeInteger(
            row.neighbor_rated_match_count,
            '上下文玩家已计分场数'
          );
          const neighborWins = readNonNegativeSafeInteger(row.neighbor_wins, '上下文玩家胜场数');
          const neighborLosses = readNonNegativeSafeInteger(
            row.neighbor_losses,
            '上下文玩家负场数'
          );
          if (neighborWins + neighborLosses !== neighborRatedMatchCount) {
            throw adminError(
              'RANKED_PLAYER_CONTEXT_INVALID',
              '上下文玩家胜负场数与评分投影的已计分场数不一致',
              500
            );
          }
          const neighborDeckClassification = readPlayerDeckClassification(
            {
              active_release_id: row.active_release_id,
              active_release_version: row.active_release_version,
              active_release_snapshot_json: row.active_release_snapshot_json,
              active_release_config_hash: row.active_release_config_hash,
              observed_deck_match_count: row.neighbor_observed_deck_match_count,
              classified_deck_match_count: row.neighbor_classified_deck_match_count,
              leading_deck_match_count: row.neighbor_leading_deck_match_count,
              leading_archetype_ids: row.neighbor_leading_archetype_ids,
            },
            neighborRatedMatchCount
          );
          return [
            {
              userId: row.neighbor_user_id,
              username: row.neighbor_username,
              displayName: row.neighbor_display_name,
              rating: Number(row.neighbor_rating),
              ratingDeviation: Number(row.neighbor_rating_deviation),
              ratedMatchCount: neighborRatedMatchCount,
              wins: neighborWins,
              losses: neighborLosses,
              deckClassification: neighborDeckClassification,
              rank: Number(row.neighbor_rank),
              isTarget: row.neighbor_user_id === first.target_user_id,
            },
          ];
        })
      : [];

    return {
      seasonId: first.season_id,
      generatedAt,
      ledgerRevision: first.ledger_revision,
      placementRequired,
      leaderboardMinimumMatchCount,
      player: {
        userId: first.target_user_id,
        username: first.target_username,
        displayName: first.target_display_name,
        rating: Number(first.target_rating),
        ratingDeviation: Number(first.target_rating_deviation),
        ratedMatchCount,
        wins,
        losses,
        placementCompleted,
        leaderboardEligible,
        status,
        rank,
        deckClassification,
      },
      neighbors: { rows: neighbors },
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

interface RankedAdminInsightsRelease {
  readonly id: string;
  readonly version: number;
  readonly snapshot: ReturnType<typeof readDeckClassifierSnapshot>;
  readonly configHash: string;
  readonly publishedAt: number;
}

interface MutableRankedAdminDeckCategory {
  readonly archetypeId: string;
  readonly categoryKey: string;
  readonly name: string;
  readonly groupName: string;
  readonly color: string;
  readonly sortOrder: number;
  readonly classificationStatus: 'CLASSIFIED' | 'UNKNOWN' | 'AMBIGUOUS';
  appearanceCount: number;
  winnerCount: number;
  readonly players: Map<
    string,
    {
      readonly userId: string;
      readonly username: string;
      readonly displayName: string | null;
      appearanceCount: number;
      winnerCount: number;
    }
  >;
}

const UNKNOWN_ADMIN_DECK_CATEGORY = {
  archetypeId: 'system:other_unknown',
  categoryKey: 'other_unknown',
  name: '其他／未识别',
  groupName: '系统',
  color: '#94A3B8',
  sortOrder: 1_000_000,
  classificationStatus: 'UNKNOWN' as const,
};

const AMBIGUOUS_ADMIN_DECK_CATEGORY = {
  archetypeId: 'system:ambiguous',
  categoryKey: 'ambiguous',
  name: '分类冲突／待复核',
  groupName: '系统',
  color: '#F59E0B',
  sortOrder: 1_000_001,
  classificationStatus: 'AMBIGUOUS' as const,
};

const RANKED_ADMIN_DECK_STATISTICS_QUERY = `WITH settled_matches AS MATERIALIZED (
  SELECT match_id, first_user_id, second_user_id, winner_seat
  FROM ranked_matches
  WHERE season_id = $1 AND rating_status = 'SETTLED'
), observed_matches AS MATERIALIZED (
  SELECT ranked_match.match_id
  FROM settled_matches AS ranked_match
  JOIN ranked_deck_observations AS observation
    ON observation.match_id = ranked_match.match_id AND observation.season_id = $1
  GROUP BY ranked_match.match_id, ranked_match.first_user_id, ranked_match.second_user_id
  HAVING count(*) = 2
    AND count(*) FILTER (WHERE observation.seat = 'FIRST') = 1
    AND count(*) FILTER (WHERE observation.seat = 'SECOND') = 1
    AND bool_and(observation.user_id = CASE observation.seat
      WHEN 'FIRST' THEN ranked_match.first_user_id ELSE ranked_match.second_user_id END)
), assigned_rows AS MATERIALIZED (
  SELECT observation.match_id, observation.seat, observation.user_id,
         ranked_match.winner_seat, assignment.status, assignment.archetype_id
  FROM observed_matches
  JOIN settled_matches AS ranked_match USING (match_id)
  JOIN ranked_deck_observations AS observation
    ON observation.match_id = ranked_match.match_id AND observation.season_id = $1
  JOIN deck_classification_assignments AS assignment
    ON assignment.match_id = observation.match_id
   AND assignment.seat = observation.seat
   AND assignment.release_id = $2
), candidate_rows AS MATERIALIZED (
  SELECT *
  FROM assigned_rows
  WHERE status IN ('CLASSIFIED', 'UNKNOWN', 'AMBIGUOUS')
), analyzable_matches AS MATERIALIZED (
  SELECT match_id
  FROM candidate_rows
  GROUP BY match_id
  HAVING count(*) = 2
    AND count(*) FILTER (WHERE seat = 'FIRST') = 1
    AND count(*) FILTER (WHERE seat = 'SECOND') = 1
), effective_rows AS MATERIALIZED (
  SELECT candidate.*
  FROM candidate_rows AS candidate
  JOIN analyzable_matches USING (match_id)
), totals AS (
  SELECT
    (SELECT count(*) FROM settled_matches) AS settled_match_count,
    (SELECT count(*) FROM observed_matches) AS observed_match_count,
    (SELECT count(*) FROM assigned_rows
     WHERE status IN ('CLASSIFIED', 'UNKNOWN', 'AMBIGUOUS')) AS assigned_observation_count,
    (SELECT count(*) FROM assigned_rows WHERE status = 'CLASSIFIED')
      AS recognized_observation_count,
    (SELECT count(*) FROM assigned_rows WHERE status = 'INVALID') AS invalid_observation_count,
    (SELECT count(*) FROM assigned_rows WHERE status = 'EXCLUDED') AS excluded_observation_count
)
SELECT totals.*, effective.match_id, effective.seat, effective.user_id,
       profile.username, profile.display_name, effective.winner_seat,
       effective.status, effective.archetype_id
FROM totals
LEFT JOIN effective_rows AS effective ON TRUE
LEFT JOIN profiles AS profile ON profile.id = effective.user_id
ORDER BY effective.match_id ASC NULLS LAST, effective.seat ASC NULLS LAST`;

const RANKED_ADMIN_PLAYER_LIST_QUERY = `WITH season AS MATERIALIZED (
  SELECT id, rating_algorithm_version, rating_config,
         leaderboard_minimum_match_count, ledger_revision
  FROM ranked_seasons
  WHERE id = $1
), active_release AS MATERIALIZED (
  SELECT id, version, snapshot_json, config_hash, published_at, activated_at
  FROM deck_classifier_releases
  WHERE status = 'ACTIVE'
), participants AS MATERIALIZED (
  SELECT rating.user_id, profile.username, profile.display_name,
         rating.rating, rating.rating_deviation, rating.rated_match_count
  FROM season
  JOIN ranked_player_ratings AS rating
    ON rating.season_id = season.id AND rating.rated_match_count > 0
  JOIN profiles AS profile ON profile.id = rating.user_id
), eligible AS MATERIALIZED (
  SELECT participant.user_id,
         ROW_NUMBER() OVER (ORDER BY participant.rating DESC, participant.user_id ASC) AS rank
  FROM participants AS participant
  CROSS JOIN season
  WHERE participant.rated_match_count >= season.leaderboard_minimum_match_count
), player_results AS MATERIALIZED (
  SELECT ranked_match.first_user_id AS user_id, ranked_match.match_id,
         'FIRST'::text AS seat, ranked_match.winner_seat
  FROM ranked_matches AS ranked_match
  WHERE ranked_match.season_id = $1 AND ranked_match.rating_status = 'SETTLED'
  UNION ALL
  SELECT ranked_match.second_user_id AS user_id, ranked_match.match_id,
         'SECOND'::text AS seat, ranked_match.winner_seat
  FROM ranked_matches AS ranked_match
  WHERE ranked_match.season_id = $1 AND ranked_match.rating_status = 'SETTLED'
), record_summaries AS MATERIALIZED (
  SELECT participant.user_id,
         COUNT(result.match_id) FILTER (WHERE result.seat = result.winner_seat) AS wins,
         COUNT(result.match_id) FILTER (WHERE result.seat <> result.winner_seat) AS losses
  FROM participants AS participant
  LEFT JOIN player_results AS result ON result.user_id = participant.user_id
  GROUP BY participant.user_id
), player_observations AS MATERIALIZED (
  SELECT result.user_id, result.match_id, result.seat
  FROM player_results AS result
  JOIN ranked_deck_observations AS observation
    ON observation.match_id = result.match_id
   AND observation.seat = result.seat
   AND observation.season_id = $1
   AND observation.user_id = result.user_id
), classification_counts AS MATERIALIZED (
  SELECT observation.user_id, assignment.archetype_id, COUNT(*) AS match_count
  FROM player_observations AS observation
  CROSS JOIN active_release AS release
  JOIN deck_classification_assignments AS assignment
    ON assignment.match_id = observation.match_id
   AND assignment.seat = observation.seat
   AND assignment.release_id = release.id
   AND assignment.status = 'CLASSIFIED'
  GROUP BY observation.user_id, assignment.archetype_id
), deck_summaries AS MATERIALIZED (
  SELECT participant.user_id,
         (SELECT COUNT(*) FROM player_observations AS observation
          WHERE observation.user_id = participant.user_id) AS observed_match_count,
         COALESCE((SELECT SUM(match_count) FROM classification_counts AS count
                   WHERE count.user_id = participant.user_id), 0) AS classified_match_count,
         COALESCE((SELECT MAX(match_count) FROM classification_counts AS count
                   WHERE count.user_id = participant.user_id), 0) AS leading_match_count,
         COALESCE(
           (SELECT ARRAY_AGG(count.archetype_id ORDER BY count.archetype_id)
            FROM classification_counts AS count
            WHERE count.user_id = participant.user_id
              AND count.match_count = (
                SELECT MAX(inner_count.match_count)
                FROM classification_counts AS inner_count
                WHERE inner_count.user_id = participant.user_id
              )),
           ARRAY[]::uuid[]
         ) AS leading_archetype_ids
  FROM participants AS participant
), all_players AS MATERIALIZED (
  SELECT participant.*, eligible.rank, record.wins, record.losses,
         deck.observed_match_count, deck.classified_match_count,
         deck.leading_match_count, deck.leading_archetype_ids,
         eligible.rank IS NOT NULL AS leaderboard_eligible
  FROM participants AS participant
  LEFT JOIN eligible ON eligible.user_id = participant.user_id
  JOIN record_summaries AS record ON record.user_id = participant.user_id
  JOIN deck_summaries AS deck ON deck.user_id = participant.user_id
), ordered_players AS MATERIALIZED (
  SELECT player.*,
         ROW_NUMBER() OVER (
           ORDER BY player.leaderboard_eligible DESC, player.rank ASC NULLS LAST,
                    player.rating DESC, player.user_id ASC
         ) AS list_position
  FROM all_players AS player
), filtered_players AS MATERIALIZED (
  SELECT *
  FROM ordered_players AS player
  WHERE $2::text IS NULL OR (
    player.user_id::text ILIKE $2 ESCAPE '\\'
    OR player.username ILIKE $2 ESCAPE '\\'
    OR COALESCE(player.display_name, '') ILIKE $2 ESCAPE '\\'
  )
), paged AS MATERIALIZED (
  SELECT *
  FROM filtered_players
  ORDER BY list_position ASC
  LIMIT $3 OFFSET $4
), totals AS (
  SELECT COUNT(*) AS total_count FROM filtered_players
)
SELECT season.id AS season_id, season.rating_algorithm_version, season.rating_config,
       season.leaderboard_minimum_match_count, season.ledger_revision,
       active_release.id AS active_release_id,
       active_release.version AS active_release_version,
       active_release.snapshot_json AS active_release_snapshot_json,
       active_release.config_hash AS active_release_config_hash,
       active_release.published_at AS active_release_published_at,
       active_release.activated_at AS active_release_activated_at,
       totals.total_count, paged.user_id, paged.username, paged.display_name,
       paged.rating, paged.rating_deviation, paged.rated_match_count,
       paged.wins, paged.losses, paged.rank, paged.list_position,
       paged.observed_match_count AS observed_deck_match_count,
       paged.classified_match_count AS classified_deck_match_count,
       paged.leading_match_count AS leading_deck_match_count,
       paged.leading_archetype_ids
FROM season
LEFT JOIN active_release ON TRUE
CROSS JOIN totals
LEFT JOIN paged ON TRUE
ORDER BY paged.list_position ASC NULLS LAST`;

function readInsightsRelease(
  season: RankedAdminInsightsSeasonRow
): RankedAdminInsightsRelease | null {
  if (season.active_release_id === null) {
    if (
      season.active_release_version !== null ||
      season.active_release_snapshot_json != null ||
      season.active_release_config_hash !== null ||
      season.active_release_published_at !== null ||
      season.active_release_activated_at !== null
    ) {
      throw adminError('RANKED_DECK_CLASSIFIER_RELEASE_INVALID', '卡组分类发布状态无效', 500);
    }
    return null;
  }
  const version = Number(season.active_release_version);
  if (
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    !season.active_release_config_hash ||
    season.active_release_published_at === null ||
    season.active_release_activated_at === null
  ) {
    throw adminError('RANKED_DECK_CLASSIFIER_RELEASE_INVALID', '卡组分类发布状态无效', 500);
  }
  let snapshot: ReturnType<typeof readDeckClassifierSnapshot>;
  try {
    snapshot = readDeckClassifierSnapshot(season.active_release_snapshot_json);
  } catch {
    throw adminError('RANKED_DECK_CLASSIFIER_SNAPSHOT_INVALID', '卡组分类发布快照无效', 500);
  }
  if (
    snapshot.releaseVersion !== version ||
    hashDeckClassifierSnapshot(snapshot) !== season.active_release_config_hash
  ) {
    throw adminError(
      'RANKED_DECK_CLASSIFIER_SNAPSHOT_INVALID',
      '卡组分类发布快照完整性校验失败',
      500
    );
  }
  const publishedAt = new Date(season.active_release_published_at).getTime();
  if (!Number.isFinite(publishedAt)) {
    throw adminError('RANKED_DECK_CLASSIFIER_RELEASE_INVALID', '卡组分类发布时间无效', 500);
  }
  return {
    id: season.active_release_id,
    version,
    snapshot,
    configHash: season.active_release_config_hash,
    publishedAt,
  };
}

function aggregateRankedAdminDeckStatistics(input: {
  readonly seasonId: string;
  readonly generatedAt: Date;
  readonly release: RankedAdminInsightsRelease;
  readonly displayRows: readonly RankedAdminDeckStatisticsDisplayRow[];
  readonly rows: readonly RankedAdminDeckStatisticsRow[];
}): RankedAdminDeckStatistics {
  const displayById = new Map(input.displayRows.map((row) => [row.id, row.color_key]));
  if (displayById.size !== input.displayRows.length) {
    throw adminError('RANKED_DECK_STATISTICS_INVALID', '卡组分类展示设置包含重复分类', 500);
  }
  const categories = new Map<string, MutableRankedAdminDeckCategory>();
  for (const archetype of input.release.snapshot.archetypes) {
    const color = displayById.get(archetype.id);
    if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
      throw adminError(
        'RANKED_DECK_STATISTICS_INVALID',
        `卡组分类 ${archetype.archetypeKey} 缺少有效展示颜色`,
        500
      );
    }
    categories.set(
      archetype.id,
      createMutableDeckCategory({
        archetypeId: archetype.id,
        categoryKey: archetype.archetypeKey,
        name: archetype.name,
        groupName: archetype.groupName,
        color: color.toUpperCase(),
        sortOrder: archetype.sortOrder,
        classificationStatus: 'CLASSIFIED',
      })
    );
  }
  if (displayById.size !== input.release.snapshot.archetypes.length) {
    throw adminError('RANKED_DECK_STATISTICS_INVALID', '卡组分类展示设置与发布快照不一致', 500);
  }
  const first = input.rows[0];
  if (!first) {
    throw adminError('RANKED_DECK_STATISTICS_INVALID', '卡组分类统计查询失败', 500);
  }
  const settledMatchCount = readAdminCount(first.settled_match_count, '已结算对局数');
  const observedMatchCount = readAdminCount(first.observed_match_count, '完整观察对局数');
  const assignedDeckObservationCount = readAdminCount(
    first.assigned_observation_count,
    '已分配观察数'
  );
  const recognizedDeckObservationCount = readAdminCount(
    first.recognized_observation_count,
    '已识别观察数'
  );
  const invalidDeckObservationCount = readAdminCount(first.invalid_observation_count, '非法观察数');
  const excludedDeckObservationCount = readAdminCount(
    first.excluded_observation_count,
    '排除观察数'
  );
  const rowsByMatch = new Map<string, RankedAdminDeckStatisticsRow[]>();
  for (const row of input.rows) {
    if (!row.match_id) continue;
    if (!row.seat || !row.user_id || !row.username || !row.winner_seat || !row.status) {
      throw adminError('RANKED_DECK_STATISTICS_INVALID', '可分析卡组席位数据不完整', 500);
    }
    const category = resolveAdminDeckCategory(row, categories);
    category.appearanceCount += 1;
    const isWinner = row.seat === row.winner_seat;
    if (isWinner) category.winnerCount += 1;
    const player = category.players.get(row.user_id) ?? {
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      appearanceCount: 0,
      winnerCount: 0,
    };
    if (player.username !== row.username || player.displayName !== row.display_name) {
      throw adminError('RANKED_DECK_STATISTICS_INVALID', '卡组分类玩家身份不一致', 500);
    }
    player.appearanceCount += 1;
    if (isWinner) player.winnerCount += 1;
    category.players.set(row.user_id, player);
    const matchRows = rowsByMatch.get(row.match_id) ?? [];
    matchRows.push(row);
    rowsByMatch.set(row.match_id, matchRows);
  }
  for (const rows of rowsByMatch.values()) {
    if (
      rows.length !== 2 ||
      rows[0]?.seat === rows[1]?.seat ||
      rows.filter((row) => row.seat === row.winner_seat).length !== 1
    ) {
      throw adminError(
        'RANKED_DECK_STATISTICS_INVALID',
        '可分析对局必须恰好包含两席且唯一胜方',
        500
      );
    }
  }
  const deckObservationCount = observedMatchCount * 2;
  const analyzedMatchCount = rowsByMatch.size;
  if (
    observedMatchCount > settledMatchCount ||
    assignedDeckObservationCount > deckObservationCount ||
    recognizedDeckObservationCount > assignedDeckObservationCount ||
    assignedDeckObservationCount + invalidDeckObservationCount + excludedDeckObservationCount >
      deckObservationCount ||
    analyzedMatchCount * 2 > assignedDeckObservationCount ||
    analyzedMatchCount > observedMatchCount
  ) {
    throw adminError('RANKED_DECK_STATISTICS_INVALID', '卡组分类样本覆盖数据不一致', 500);
  }
  return {
    seasonId: input.seasonId,
    generatedAt: input.generatedAt,
    available: true,
    release: {
      id: input.release.id,
      version: input.release.version,
      publishedAt: input.release.publishedAt,
    },
    sample: {
      settledMatchCount,
      observedMatchCount,
      analyzedMatchCount,
      deckObservationCount,
      assignedDeckObservationCount,
      recognizedDeckObservationCount,
      invalidDeckObservationCount,
      excludedDeckObservationCount,
      observationCoverageRate:
        settledMatchCount === 0 ? 0 : clampAdminRate(observedMatchCount / settledMatchCount),
      classificationCoverageRate:
        deckObservationCount === 0
          ? 0
          : clampAdminRate(assignedDeckObservationCount / deckObservationCount),
    },
    categories: [...categories.values()]
      .filter(
        (category) => category.classificationStatus === 'CLASSIFIED' || category.appearanceCount > 0
      )
      .map(projectAdminDeckCategory)
      .sort(
        (left, right) =>
          right.appearanceCount - left.appearanceCount ||
          left.sortOrder - right.sortOrder ||
          left.categoryKey.localeCompare(right.categoryKey)
      ),
  };
}

function createMutableDeckCategory(
  metadata: Omit<MutableRankedAdminDeckCategory, 'appearanceCount' | 'winnerCount' | 'players'>
): MutableRankedAdminDeckCategory {
  return { ...metadata, appearanceCount: 0, winnerCount: 0, players: new Map() };
}

function resolveAdminDeckCategory(
  row: RankedAdminDeckStatisticsRow,
  categories: Map<string, MutableRankedAdminDeckCategory>
): MutableRankedAdminDeckCategory {
  if (row.status === 'UNKNOWN') {
    return getSystemAdminDeckCategory(categories, UNKNOWN_ADMIN_DECK_CATEGORY);
  }
  if (row.status === 'AMBIGUOUS') {
    return getSystemAdminDeckCategory(categories, AMBIGUOUS_ADMIN_DECK_CATEGORY);
  }
  if (row.status !== 'CLASSIFIED' || !row.archetype_id) {
    throw adminError('RANKED_DECK_STATISTICS_INVALID', '卡组分类结果无效', 500);
  }
  const category = categories.get(row.archetype_id);
  if (!category || category.classificationStatus !== 'CLASSIFIED') {
    throw adminError('RANKED_DECK_STATISTICS_INVALID', '卡组分类结果不在当前发布快照中', 500);
  }
  return category;
}

function getSystemAdminDeckCategory(
  categories: Map<string, MutableRankedAdminDeckCategory>,
  metadata: typeof UNKNOWN_ADMIN_DECK_CATEGORY | typeof AMBIGUOUS_ADMIN_DECK_CATEGORY
): MutableRankedAdminDeckCategory {
  const existing = categories.get(metadata.archetypeId);
  if (existing) return existing;
  const created = createMutableDeckCategory(metadata);
  categories.set(metadata.archetypeId, created);
  return created;
}

function projectAdminDeckCategory(
  category: MutableRankedAdminDeckCategory
): RankedAdminDeckStatisticsCategory {
  const players = [...category.players.values()]
    .map((player): RankedAdminDeckStatisticsPlayer => ({
      userId: player.userId,
      username: player.username,
      displayName: player.displayName,
      appearanceCount: player.appearanceCount,
      winnerCount: player.winnerCount,
      lossCount: player.appearanceCount - player.winnerCount,
      winRate: clampAdminRate(player.winnerCount / player.appearanceCount),
    }))
    .sort(
      (left, right) =>
        right.appearanceCount - left.appearanceCount ||
        right.winnerCount - left.winnerCount ||
        left.username.localeCompare(right.username) ||
        left.userId.localeCompare(right.userId)
    );
  return {
    archetypeId: category.archetypeId,
    categoryKey: category.categoryKey,
    name: category.name,
    groupName: category.groupName,
    color: category.color,
    sortOrder: category.sortOrder,
    classificationStatus: category.classificationStatus,
    appearanceCount: category.appearanceCount,
    winnerCount: category.winnerCount,
    lossCount: category.appearanceCount - category.winnerCount,
    playerCount: players.length,
    winRate:
      category.appearanceCount === 0
        ? null
        : clampAdminRate(category.winnerCount / category.appearanceCount),
    players,
  };
}

function readAdminCount(value: number | string, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw adminError('RANKED_ADMIN_INSIGHTS_INVALID', `${label}无效`, 500);
  }
  return result;
}

function readPositiveAdminCount(value: number | string, label: string): number {
  const result = readAdminCount(value, label);
  if (result === 0) {
    throw adminError('RANKED_ADMIN_INSIGHTS_INVALID', `${label}无效`, 500);
  }
  return result;
}

function readPositiveRank(value: number | string | null): number {
  const result = value === null ? 0 : Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw adminError('RANKED_PLAYER_LIST_INVALID', '玩家全局名次无效', 500);
  }
  return result;
}

function readPositivePlayerListPosition(value: number | string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw adminError('RANKED_PLAYER_LIST_INVALID', '玩家全局列表位置无效', 500);
  }
  return result;
}

function readFiniteNumber(value: number | string, label: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) {
    throw adminError('RANKED_PLAYER_LIST_INVALID', `${label}无效`, 500);
  }
  return result;
}

function clampAdminRate(value: number): number {
  return Math.min(1, Math.max(0, value));
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

function readPlayerDeckClassification(
  row: PlayerDeckClassificationSummaryRow,
  completedMatchCount: number
): RankedAdminPlayerDeckClassification {
  const observedMatchCount = readNonNegativeSafeInteger(
    row.observed_deck_match_count,
    '玩家卡组观察场数'
  );
  const classifiedMatchCount = readNonNegativeSafeInteger(
    row.classified_deck_match_count,
    '玩家已分类场数'
  );
  const leadingMatchCount = readNonNegativeSafeInteger(
    row.leading_deck_match_count,
    '玩家最常用卡组场数'
  );
  const leadingArchetypeIds = row.leading_archetype_ids ?? [];
  if (
    observedMatchCount > completedMatchCount ||
    classifiedMatchCount > observedMatchCount ||
    !Array.isArray(leadingArchetypeIds) ||
    leadingArchetypeIds.some((id) => typeof id !== 'string' || id.trim().length === 0) ||
    new Set(leadingArchetypeIds).size !== leadingArchetypeIds.length
  ) {
    throw adminError('RANKED_PLAYER_DECK_CLASSIFICATION_INVALID', '玩家卡组分类统计数据无效', 500);
  }

  if (row.active_release_id === null) {
    if (
      row.active_release_version !== null ||
      row.active_release_snapshot_json != null ||
      row.active_release_config_hash !== null ||
      classifiedMatchCount !== 0 ||
      leadingMatchCount !== 0 ||
      leadingArchetypeIds.length !== 0
    ) {
      throw adminError(
        'RANKED_PLAYER_DECK_CLASSIFICATION_INVALID',
        '玩家卡组分类发布状态无效',
        500
      );
    }
    return {
      release: null,
      observedMatchCount,
      classifiedMatchCount,
      coverageStatus: 'NONE',
      isTied: false,
      leaders: [],
    };
  }

  const releaseVersion = Number(row.active_release_version);
  if (
    !Number.isSafeInteger(releaseVersion) ||
    releaseVersion <= 0 ||
    !row.active_release_config_hash
  ) {
    throw adminError('RANKED_PLAYER_DECK_CLASSIFICATION_INVALID', '玩家卡组分类发布状态无效', 500);
  }
  let snapshot: ReturnType<typeof readDeckClassifierSnapshot>;
  try {
    snapshot = readDeckClassifierSnapshot(row.active_release_snapshot_json);
  } catch {
    throw adminError('RANKED_PLAYER_DECK_CLASSIFICATION_INVALID', '玩家卡组分类发布快照无效', 500);
  }
  if (
    snapshot.releaseVersion !== releaseVersion ||
    hashDeckClassifierSnapshot(snapshot) !== row.active_release_config_hash
  ) {
    throw adminError(
      'RANKED_PLAYER_DECK_CLASSIFICATION_INVALID',
      '玩家卡组分类发布快照完整性校验失败',
      500
    );
  }
  if (
    (classifiedMatchCount === 0 && (leadingMatchCount !== 0 || leadingArchetypeIds.length !== 0)) ||
    (classifiedMatchCount > 0 && (leadingMatchCount <= 0 || leadingArchetypeIds.length === 0))
  ) {
    throw adminError(
      'RANKED_PLAYER_DECK_CLASSIFICATION_INVALID',
      '玩家最常用卡组统计数据无效',
      500
    );
  }

  const leadingIds = new Set(leadingArchetypeIds);
  const leaders = snapshot.archetypes
    .filter((archetype) => leadingIds.has(archetype.id))
    .map((archetype) => ({
      archetypeId: archetype.id,
      name: archetype.name,
      matchCount: leadingMatchCount,
    }));
  if (leaders.length !== leadingArchetypeIds.length) {
    throw adminError(
      'RANKED_PLAYER_DECK_CLASSIFICATION_INVALID',
      '玩家最常用卡组不在当前发布快照中',
      500
    );
  }
  return {
    release: { id: row.active_release_id, version: releaseVersion },
    observedMatchCount,
    classifiedMatchCount,
    coverageStatus:
      classifiedMatchCount === 0
        ? 'NONE'
        : classifiedMatchCount === completedMatchCount
          ? 'COMPLETE'
          : 'PARTIAL',
    isTied: leaders.length > 1,
    leaders,
  };
}

function readNonNegativeSafeInteger(value: number | string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw adminError('RANKED_PLAYER_CONTEXT_INVALID', `${label}无效`, 500);
  }
  return parsed;
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
