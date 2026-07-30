import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { assertValidGlicko1Config, type Glicko1Config } from '../rating/glicko.js';
import {
  buildRankedCompetitiveEnvironmentIdentity,
  type RankedCompetitiveEnvironmentIdentity,
} from '../rating/ranked-environment.js';
import { stableJsonStringify } from './replay-payload-serialization.js';

export interface RankedSeasonOpenWindow {
  readonly weekdays: readonly number[];
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface RankedQueueWindowTiming {
  readonly withinOpenWindow: boolean;
  readonly currentWindowEndsAt: Date | null;
  readonly nextOpensAt: Date | null;
}

export interface CreateRankedSeasonInput {
  readonly seasonKey: string;
  readonly name: string;
  readonly platformTimeZone: string;
  readonly openWindows: readonly RankedSeasonOpenWindow[];
  readonly startsAt: Date;
  readonly scheduledEndsAt: Date;
  readonly finalizingDeadlineAt: Date;
  readonly environment: RankedCompetitiveEnvironmentIdentity;
  readonly ratingConfig: Glicko1Config;
  readonly leaderboardMinimumMatchCount: number;
  readonly adminUserId: string;
}

export type UpdateRankedSeasonDraftInput = CreateRankedSeasonInput;

export interface UpdateActiveRankedSeasonOperationsInput {
  readonly name: string;
  readonly openWindows: readonly RankedSeasonOpenWindow[];
  readonly leaderboardMinimumMatchCount: number;
  readonly adminUserId: string;
}

export interface RankedSeasonRecord {
  readonly id: string;
  readonly seasonKey: string;
  readonly name: string;
  readonly lifecycle: 'DRAFT' | 'ACTIVE' | 'FINALIZING' | 'CLOSED';
  readonly queueAdmission: 'OPEN' | 'PAUSED';
  readonly competitiveEnvironmentId: string;
  readonly platformTimeZone: string;
  readonly openWindows: readonly RankedSeasonOpenWindow[];
  readonly startsAt: Date;
  readonly scheduledEndsAt: Date;
  readonly finalizingDeadlineAt: Date;
  readonly closedAt: Date | null;
  readonly rulesVersion: string;
  readonly cardCatalogVersion: string;
  readonly cardCatalogHash: string;
  readonly deckPolicyVersion: string;
  readonly ratingAlgorithmVersion: string;
  readonly ratingConfig: Glicko1Config;
  readonly leaderboardMinimumMatchCount: number;
  readonly ledgerRevision: number;
}

export interface RankedSeasonQueryResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

export interface RankedSeasonQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<RankedSeasonQueryResult<T>>;
}

interface RankedSeasonServiceDeps {
  readonly transaction?: <T>(
    callback: (client: RankedSeasonQueryClient) => Promise<T>
  ) => Promise<T>;
}

interface RankedSeasonRow {
  readonly id: string;
  readonly season_key: string;
  readonly name: string;
  readonly lifecycle: RankedSeasonRecord['lifecycle'];
  readonly queue_admission: RankedSeasonRecord['queueAdmission'];
  readonly competitive_environment_id: string;
  readonly platform_time_zone: string;
  readonly open_windows: RankedSeasonOpenWindow[];
  readonly starts_at: Date | string;
  readonly scheduled_ends_at: Date | string;
  readonly finalizing_deadline_at: Date | string;
  readonly closed_at: Date | string | null;
  readonly rules_version: string;
  readonly card_catalog_version: string;
  readonly card_catalog_hash: string;
  readonly deck_policy_version: string;
  readonly rating_algorithm_version: string;
  readonly rating_config: unknown;
  readonly leaderboard_minimum_match_count: number;
  readonly ledger_revision: number;
}

export class RankedSeasonServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'RankedSeasonServiceError';
  }
}

export class RankedSeasonService {
  private readonly transaction: <T>(
    callback: (client: RankedSeasonQueryClient) => Promise<T>
  ) => Promise<T>;

  constructor(deps: RankedSeasonServiceDeps = {}) {
    this.transaction = deps.transaction ?? withSerializableTransaction;
  }

  async createDraft(input: CreateRankedSeasonInput): Promise<RankedSeasonRecord> {
    validateCreateInput(input);
    return this.transaction(async (client) => {
      const result = await client.query<RankedSeasonRow>(
        `INSERT INTO ranked_seasons (
           season_key,
           name,
           competitive_environment_id,
           lifecycle,
           queue_admission,
           platform_time_zone,
           open_windows,
           starts_at,
           scheduled_ends_at,
           finalizing_deadline_at,
           rules_version,
           card_catalog_version,
           card_catalog_hash,
           deck_policy_version,
           rating_algorithm_version,
           rating_config,
           leaderboard_minimum_match_count,
           created_by,
           updated_by
         )
         VALUES (
           $1, $2, $3, 'DRAFT', 'PAUSED', $4, $5::jsonb, $6, $7, $8,
           $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $16
         )
         RETURNING *`,
        [
          input.seasonKey.trim(),
          input.name.trim(),
          input.environment.competitiveEnvironmentId,
          input.platformTimeZone,
          JSON.stringify(input.openWindows),
          input.startsAt,
          input.scheduledEndsAt,
          input.finalizingDeadlineAt,
          input.environment.rulesVersion,
          input.environment.cardCatalogVersion,
          input.environment.cardCatalogHash,
          input.environment.deckPolicyVersion,
          input.environment.ratingAlgorithmVersion,
          JSON.stringify(input.ratingConfig),
          input.leaderboardMinimumMatchCount,
          input.adminUserId,
        ]
      );
      return mapRequiredSeason(result.rows[0], 'RANKED_SEASON_CREATE_FAILED');
    });
  }

  async listSeasons(): Promise<RankedSeasonRecord[]> {
    return this.transaction(async (client) => {
      const result = await client.query<RankedSeasonRow>(
        `SELECT *
         FROM ranked_seasons
         ORDER BY starts_at DESC, season_key DESC`
      );
      return result.rows.map((row) => mapRequiredSeason(row, 'RANKED_SEASON_READ_FAILED'));
    });
  }

  async getSeason(seasonId: string): Promise<RankedSeasonRecord> {
    return this.transaction(async (client) => {
      const result = await client.query<RankedSeasonRow>(
        `SELECT *
         FROM ranked_seasons
         WHERE id = $1`,
        [seasonId]
      );
      const row = result.rows[0];
      if (!row) {
        throw seasonError('RANKED_SEASON_NOT_FOUND', '排位赛季不存在', 404);
      }
      return mapRequiredSeason(row, 'RANKED_SEASON_READ_FAILED');
    });
  }

  async updateDraft(
    seasonId: string,
    input: UpdateRankedSeasonDraftInput
  ): Promise<RankedSeasonRecord> {
    validateCreateInput(input);
    return this.transaction(async (client) => {
      const season = await lockSeason(client, seasonId);
      if (season.lifecycle !== 'DRAFT') {
        throw seasonError('RANKED_SEASON_DRAFT_UPDATE_CONFLICT', '只有草稿赛季可以编辑', 409);
      }
      const result = await client.query<RankedSeasonRow>(
        `UPDATE ranked_seasons
         SET season_key = $2,
             name = $3,
             competitive_environment_id = $4,
             platform_time_zone = $5,
             open_windows = $6::jsonb,
             starts_at = $7,
             scheduled_ends_at = $8,
             finalizing_deadline_at = $9,
             rules_version = $10,
             card_catalog_version = $11,
             card_catalog_hash = $12,
             deck_policy_version = $13,
             rating_algorithm_version = $14,
             rating_config = $15::jsonb,
             leaderboard_minimum_match_count = $16,
             updated_by = $17,
             updated_at = NOW()
         WHERE id = $1
           AND lifecycle = 'DRAFT'
         RETURNING *`,
        [
          seasonId,
          input.seasonKey.trim(),
          input.name.trim(),
          input.environment.competitiveEnvironmentId,
          input.platformTimeZone,
          JSON.stringify(input.openWindows),
          input.startsAt,
          input.scheduledEndsAt,
          input.finalizingDeadlineAt,
          input.environment.rulesVersion,
          input.environment.cardCatalogVersion,
          input.environment.cardCatalogHash,
          input.environment.deckPolicyVersion,
          input.environment.ratingAlgorithmVersion,
          JSON.stringify(input.ratingConfig),
          input.leaderboardMinimumMatchCount,
          input.adminUserId,
        ]
      );
      return mapRequiredSeason(result.rows[0], 'RANKED_SEASON_DRAFT_UPDATE_FAILED');
    });
  }

  async updateActiveOperations(
    seasonId: string,
    input: UpdateActiveRankedSeasonOperationsInput
  ): Promise<RankedSeasonRecord> {
    validateActiveOperationsInput(input);
    return this.transaction(async (client) => {
      const season = await lockSeason(client, seasonId);
      if (season.lifecycle !== 'ACTIVE') {
        throw seasonError(
          'RANKED_SEASON_ACTIVE_UPDATE_CONFLICT',
          '只有进行中的赛季可以修改运营设置',
          409
        );
      }
      const result = await client.query<RankedSeasonRow>(
        `UPDATE ranked_seasons
         SET name = $2,
             open_windows = $3::jsonb,
             leaderboard_minimum_match_count = $4,
             updated_by = $5,
             updated_at = NOW()
         WHERE id = $1
           AND lifecycle = 'ACTIVE'
         RETURNING *`,
        [
          seasonId,
          input.name.trim(),
          JSON.stringify(input.openWindows),
          input.leaderboardMinimumMatchCount,
          input.adminUserId,
        ]
      );
      return mapRequiredSeason(result.rows[0], 'RANKED_SEASON_ACTIVE_UPDATE_FAILED');
    });
  }

  async activate(
    seasonId: string,
    environment: RankedCompetitiveEnvironmentIdentity,
    ratingConfig: Glicko1Config,
    adminUserId: string,
    now = new Date()
  ): Promise<RankedSeasonRecord> {
    assertFormalAlgorithm(ratingConfig);
    return this.transaction(async (client) => {
      const season = await lockSeason(client, seasonId);
      if (season.lifecycle !== 'DRAFT') {
        throw seasonError('RANKED_SEASON_ACTIVATE_CONFLICT', '只有草稿赛季可以开始', 409);
      }
      if (now.getTime() >= new Date(season.scheduled_ends_at).getTime()) {
        throw seasonError('RANKED_SEASON_ALREADY_ENDED', '赛季计划结束时间已经过去', 409);
      }
      assertEnvironmentMatches(season, environment, ratingConfig);
      const existingSeason = await client.query<{ readonly id: string }>(
        `SELECT id
         FROM ranked_seasons
         WHERE id <> $1
           AND lifecycle IN ('ACTIVE', 'FINALIZING')
         LIMIT 1
         FOR UPDATE`,
        [seasonId]
      );
      if (existingSeason.rows[0]) {
        throw seasonError('RANKED_SEASON_ALREADY_ACTIVE', '已有进行中或正在结算的排位赛季', 409);
      }

      const activated = await updateLifecycle(client, {
        seasonId,
        fromLifecycle: 'DRAFT',
        toLifecycle: 'ACTIVE',
        queueAdmission: 'PAUSED',
        adminUserId,
        closedAt: null,
      });
      await seedSoftResetRatings(client, seasonId, ratingConfig);
      return activated;
    });
  }

  async setQueueAdmission(
    seasonId: string,
    admission: 'OPEN' | 'PAUSED',
    adminUserId: string
  ): Promise<RankedSeasonRecord> {
    return this.transaction(async (client) => {
      const season = await lockSeason(client, seasonId);
      if (season.lifecycle !== 'ACTIVE') {
        throw seasonError(
          'RANKED_QUEUE_ADMISSION_LIFECYCLE_CONFLICT',
          '只有开放中的赛季可以调整匹配状态',
          409
        );
      }
      const result = await client.query<RankedSeasonRow>(
        `UPDATE ranked_seasons
         SET queue_admission = $2,
             updated_by = $3,
             updated_at = NOW()
         WHERE id = $1
           AND lifecycle = 'ACTIVE'
         RETURNING *`,
        [seasonId, admission, adminUserId]
      );
      return mapRequiredSeason(result.rows[0], 'RANKED_QUEUE_ADMISSION_UPDATE_FAILED');
    });
  }

  async beginFinalizing(seasonId: string, adminUserId: string): Promise<RankedSeasonRecord> {
    return this.transaction(async (client) => {
      const season = await lockSeason(client, seasonId);
      if (season.lifecycle !== 'ACTIVE') {
        throw seasonError('RANKED_SEASON_FINALIZING_CONFLICT', '只有开放中的赛季可以结束赛季', 409);
      }
      return updateLifecycle(client, {
        seasonId,
        fromLifecycle: 'ACTIVE',
        toLifecycle: 'FINALIZING',
        queueAdmission: 'PAUSED',
        adminUserId,
        closedAt: null,
      });
    });
  }

  async close(
    seasonId: string,
    adminUserId: string,
    now = new Date()
  ): Promise<RankedSeasonRecord> {
    return this.transaction(async (client) => {
      const season = await lockSeason(client, seasonId);
      if (season.lifecycle !== 'FINALIZING') {
        throw seasonError('RANKED_SEASON_CLOSE_CONFLICT', '只有正在结算的赛季可以完成结算', 409);
      }
      const pending = await client.query<{ readonly pending_count: number | string }>(
        `SELECT COUNT(*) AS pending_count
         FROM ranked_matches
         WHERE season_id = $1
           AND rating_status = 'PENDING'`,
        [seasonId]
      );
      if (Number(pending.rows[0]?.pending_count ?? 0) > 0) {
        throw seasonError(
          'RANKED_SEASON_PENDING_MATCHES',
          '仍有对局等待计分，暂时不能完成赛季结算',
          409
        );
      }
      return updateLifecycle(client, {
        seasonId,
        fromLifecycle: 'FINALIZING',
        toLifecycle: 'CLOSED',
        queueAdmission: 'PAUSED',
        adminUserId,
        closedAt: now,
      });
    });
  }
}

async function seedSoftResetRatings(
  client: RankedSeasonQueryClient,
  seasonId: string,
  config: Glicko1Config
): Promise<void> {
  const previous = await client.query<{ readonly id: string }>(
    `SELECT id
     FROM ranked_seasons
     WHERE lifecycle = 'CLOSED'
       AND id <> $1
     ORDER BY closed_at DESC NULLS LAST, scheduled_ends_at DESC
     LIMIT 1`,
    [seasonId]
  );
  const sourceSeasonId = previous.rows[0]?.id;
  if (!sourceSeasonId) {
    return;
  }
  await client.query(
    `INSERT INTO ranked_player_seeds (
       season_id, user_id, source_season_id, rating, rating_deviation
     )
     SELECT
       $1,
       user_id,
       $2,
       $3 + $4 * (rating - $3),
       LEAST($6, GREATEST(rating_deviation, $5))
     FROM ranked_player_ratings
     WHERE season_id = $2
     ON CONFLICT (season_id, user_id) DO NOTHING`,
    [
      seasonId,
      sourceSeasonId,
      config.softResetCenter,
      config.softResetRetention,
      config.softResetMinimumDeviation,
      config.maximumRatingDeviation,
    ]
  );
  await client.query(
    `INSERT INTO ranked_player_ratings (
       season_id, user_id, rating, rating_deviation,
       rated_match_count, last_rated_at, ledger_revision
     )
     SELECT season_id, user_id, rating, rating_deviation, 0, NULL, 0
     FROM ranked_player_seeds
     WHERE season_id = $1
     ON CONFLICT (season_id, user_id) DO NOTHING`,
    [seasonId]
  );
}

export function isRankedQueueWindowOpen(
  now: Date,
  platformTimeZone: string,
  windows: readonly RankedSeasonOpenWindow[],
  startsAt: Date,
  scheduledEndsAt: Date
): boolean {
  if (
    !Number.isFinite(now.getTime()) ||
    now.getTime() < startsAt.getTime() ||
    now.getTime() >= scheduledEndsAt.getTime()
  ) {
    return false;
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: platformTimeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = weekdayNumber(readPart(parts, 'weekday'));
  const minute = Number(readPart(parts, 'hour')) * 60 + Number(readPart(parts, 'minute'));
  return windows.some(
    (window) =>
      window.weekdays.includes(weekday) && minute >= window.startMinute && minute < window.endMinute
  );
}

export function getRankedQueueWindowTiming(
  now: Date,
  platformTimeZone: string,
  windows: readonly RankedSeasonOpenWindow[],
  startsAt: Date,
  scheduledEndsAt: Date
): RankedQueueWindowTiming {
  const searchFrom = new Date(Math.max(now.getTime(), startsAt.getTime()));
  if (!Number.isFinite(searchFrom.getTime()) || searchFrom.getTime() >= scheduledEndsAt.getTime()) {
    return {
      withinOpenWindow: false,
      currentWindowEndsAt: null,
      nextOpensAt: null,
    };
  }
  const local = readZonedDateParts(searchFrom, platformTimeZone);
  const baseLocalDate = Date.UTC(local.year, local.month - 1, local.day);
  let nextOpensAt: Date | null = null;
  let currentWindowEndsAt: Date | null = null;

  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const localDate = new Date(baseLocalDate + dayOffset * 24 * 60 * 60 * 1000);
    const weekday = localDate.getUTCDay() === 0 ? 7 : localDate.getUTCDay();
    for (const window of windows) {
      if (!window.weekdays.includes(weekday)) {
        continue;
      }
      const windowStart = zonedLocalMinuteToUtc(localDate, window.startMinute, platformTimeZone);
      const windowEnd = zonedLocalMinuteToUtc(localDate, window.endMinute, platformTimeZone);
      const effectiveStart = new Date(Math.max(windowStart.getTime(), startsAt.getTime()));
      const effectiveEnd = new Date(Math.min(windowEnd.getTime(), scheduledEndsAt.getTime()));
      if (effectiveStart.getTime() >= effectiveEnd.getTime()) {
        continue;
      }
      if (now.getTime() >= effectiveStart.getTime() && now.getTime() < effectiveEnd.getTime()) {
        if (
          currentWindowEndsAt === null ||
          effectiveEnd.getTime() > currentWindowEndsAt.getTime()
        ) {
          currentWindowEndsAt = effectiveEnd;
        }
        continue;
      }
      if (
        effectiveStart.getTime() > now.getTime() &&
        (!nextOpensAt || effectiveStart.getTime() < nextOpensAt.getTime())
      ) {
        nextOpensAt = effectiveStart;
      }
    }
  }
  return {
    withinOpenWindow: currentWindowEndsAt !== null,
    currentWindowEndsAt,
    nextOpensAt,
  };
}

function validateCreateInput(input: CreateRankedSeasonInput): void {
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(input.seasonKey.trim())) {
    throw seasonError('RANKED_SEASON_KEY_INVALID', '赛季标识格式无效');
  }
  if (input.name.trim().length === 0 || input.name.trim().length > 100) {
    throw seasonError('RANKED_SEASON_NAME_INVALID', '赛季名称不能为空且不能超过 100 个字符');
  }
  if (input.adminUserId.trim().length === 0) {
    throw seasonError('RANKED_SEASON_ADMIN_REQUIRED', '创建赛季缺少管理员身份');
  }
  validateLeaderboardMinimumMatchCount(input.leaderboardMinimumMatchCount);
  assertFormalAlgorithm(input.ratingConfig);
  validateEnvironmentIdentity(input.environment, input.ratingConfig);
  validateTimeZone(input.platformTimeZone);
  validateOpenWindows(input.openWindows);
  if (
    !Number.isFinite(input.startsAt.getTime()) ||
    !Number.isFinite(input.scheduledEndsAt.getTime()) ||
    !Number.isFinite(input.finalizingDeadlineAt.getTime()) ||
    input.startsAt.getTime() >= input.scheduledEndsAt.getTime() ||
    input.scheduledEndsAt.getTime() > input.finalizingDeadlineAt.getTime()
  ) {
    throw seasonError('RANKED_SEASON_SCHEDULE_INVALID', '赛季时间范围无效');
  }
}

function validateActiveOperationsInput(input: UpdateActiveRankedSeasonOperationsInput): void {
  if (input.name.trim().length === 0 || input.name.trim().length > 100) {
    throw seasonError('RANKED_SEASON_NAME_INVALID', '赛季名称不能为空且不能超过 100 个字符');
  }
  if (input.adminUserId.trim().length === 0) {
    throw seasonError('RANKED_SEASON_ADMIN_REQUIRED', '修改赛季缺少管理员身份');
  }
  validateLeaderboardMinimumMatchCount(input.leaderboardMinimumMatchCount);
  validateOpenWindows(input.openWindows);
}

function validateLeaderboardMinimumMatchCount(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw seasonError(
      'RANKED_LEADERBOARD_MINIMUM_MATCH_COUNT_INVALID',
      '进入排行榜所需场次必须是 1 到 100 之间的整数'
    );
  }
}

function validateEnvironmentIdentity(
  environment: RankedCompetitiveEnvironmentIdentity,
  ratingConfig: Glicko1Config
): void {
  assertValidGlicko1Config(ratingConfig);
  const rebuilt = buildRankedCompetitiveEnvironmentIdentity(
    {
      cardCatalogVersion: environment.cardCatalogVersion,
      cardCatalogHash: environment.cardCatalogHash,
      publishedCardCount: environment.publishedCardCount,
    },
    ratingConfig,
    {
      rulesVersion: environment.rulesVersion,
      deckPolicyVersion: environment.deckPolicyVersion,
    }
  );
  if (
    !/^sha256:[0-9a-f]{64}$/.test(environment.competitiveEnvironmentId) ||
    !/^sha256:[0-9a-f]{64}$/.test(environment.cardCatalogHash) ||
    environment.publishedCardCount <= 0 ||
    environment.rulesVersion.trim().length === 0 ||
    environment.cardCatalogVersion.trim().length === 0 ||
    environment.deckPolicyVersion.trim().length === 0 ||
    environment.ratingAlgorithmVersion !== ratingConfig.algorithmVersion ||
    environment.competitiveEnvironmentId !== rebuilt.competitiveEnvironmentId
  ) {
    throw seasonError(
      'RANKED_ENVIRONMENT_IDENTITY_INVALID',
      '排位竞技环境身份不完整或与算法版本不一致'
    );
  }
}

function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
  } catch {
    throw seasonError('RANKED_TIME_ZONE_INVALID', '排位赛季时区无效');
  }
}

function validateOpenWindows(windows: readonly RankedSeasonOpenWindow[]): void {
  if (windows.length === 0) {
    throw seasonError('RANKED_OPEN_WINDOWS_REQUIRED', '排位赛季至少需要一个开放窗口');
  }
  const occupied = new Set<string>();
  for (const window of windows) {
    if (
      window.weekdays.length === 0 ||
      !window.weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7) ||
      !Number.isInteger(window.startMinute) ||
      !Number.isInteger(window.endMinute) ||
      window.startMinute < 0 ||
      window.endMinute > 24 * 60 ||
      window.startMinute >= window.endMinute
    ) {
      throw seasonError('RANKED_OPEN_WINDOW_INVALID', '排位开放窗口格式无效');
    }
    for (const day of new Set(window.weekdays)) {
      for (let minute = window.startMinute; minute < window.endMinute; minute += 1) {
        const key = `${day}:${minute}`;
        if (occupied.has(key)) {
          throw seasonError('RANKED_OPEN_WINDOW_OVERLAP', '排位开放窗口不能重叠');
        }
        occupied.add(key);
      }
    }
  }
}

function assertFormalAlgorithm(config: Glicko1Config): void {
  if (config.algorithmVersion.trim().length === 0 || config.algorithmVersion.includes('SHADOW')) {
    throw seasonError(
      'RANKED_FORMAL_ALGORITHM_REQUIRED',
      '持久赛季不能使用空版本或 SHADOW 算法版本'
    );
  }
}

async function lockSeason(
  client: RankedSeasonQueryClient,
  seasonId: string
): Promise<RankedSeasonRow> {
  const result = await client.query<RankedSeasonRow>(
    `SELECT *
     FROM ranked_seasons
     WHERE id = $1
     FOR UPDATE`,
    [seasonId]
  );
  const row = result.rows[0];
  if (!row) {
    throw seasonError('RANKED_SEASON_NOT_FOUND', '排位赛季不存在', 404);
  }
  return row;
}

function assertEnvironmentMatches(
  season: RankedSeasonRow,
  environment: RankedCompetitiveEnvironmentIdentity,
  ratingConfig: Glicko1Config
): void {
  validateEnvironmentIdentity(environment, ratingConfig);
  if (
    season.competitive_environment_id !== environment.competitiveEnvironmentId ||
    season.rules_version !== environment.rulesVersion ||
    season.card_catalog_version !== environment.cardCatalogVersion ||
    season.card_catalog_hash !== environment.cardCatalogHash ||
    season.deck_policy_version !== environment.deckPolicyVersion ||
    season.rating_algorithm_version !== ratingConfig.algorithmVersion ||
    stableJsonStringify(season.rating_config) !== stableJsonStringify(ratingConfig)
  ) {
    throw seasonError(
      'RANKED_ENVIRONMENT_CHANGED',
      '当前部署环境与赛季草稿冻结的竞技环境不一致',
      409
    );
  }
}

async function updateLifecycle(
  client: RankedSeasonQueryClient,
  input: {
    readonly seasonId: string;
    readonly fromLifecycle: RankedSeasonRecord['lifecycle'];
    readonly toLifecycle: RankedSeasonRecord['lifecycle'];
    readonly queueAdmission: RankedSeasonRecord['queueAdmission'];
    readonly adminUserId: string;
    readonly closedAt: Date | null;
  }
): Promise<RankedSeasonRecord> {
  const result = await client.query<RankedSeasonRow>(
    `UPDATE ranked_seasons
     SET lifecycle = $3,
         queue_admission = $4,
         closed_at = $5,
         updated_by = $6,
         updated_at = NOW()
     WHERE id = $1
       AND lifecycle = $2
     RETURNING *`,
    [
      input.seasonId,
      input.fromLifecycle,
      input.toLifecycle,
      input.queueAdmission,
      input.closedAt,
      input.adminUserId,
    ]
  );
  return mapRequiredSeason(result.rows[0], 'RANKED_SEASON_LIFECYCLE_UPDATE_FAILED');
}

function mapRequiredSeason(row: RankedSeasonRow | undefined, code: string): RankedSeasonRecord {
  if (!row) {
    throw seasonError(code, '排位赛季状态保存失败', 500);
  }
  return {
    id: row.id,
    seasonKey: row.season_key,
    name: row.name,
    lifecycle: row.lifecycle,
    queueAdmission: row.queue_admission,
    competitiveEnvironmentId: row.competitive_environment_id,
    platformTimeZone: row.platform_time_zone,
    openWindows: row.open_windows,
    startsAt: new Date(row.starts_at),
    scheduledEndsAt: new Date(row.scheduled_ends_at),
    finalizingDeadlineAt: new Date(row.finalizing_deadline_at),
    closedAt: row.closed_at === null ? null : new Date(row.closed_at),
    rulesVersion: row.rules_version,
    cardCatalogVersion: row.card_catalog_version,
    cardCatalogHash: row.card_catalog_hash,
    deckPolicyVersion: row.deck_policy_version,
    ratingAlgorithmVersion: row.rating_algorithm_version,
    ratingConfig: readStoredRatingConfig(row.rating_config),
    leaderboardMinimumMatchCount: row.leaderboard_minimum_match_count,
    ledgerRevision: row.ledger_revision,
  };
}

function readStoredRatingConfig(value: unknown): Glicko1Config {
  assertValidGlicko1Config(value as Glicko1Config);
  return value as Glicko1Config;
}

function readPart(parts: readonly Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((part) => part.type === type)?.value ?? '';
}

function readZonedDateParts(
  date: Date,
  timeZone: string
): { readonly year: number; readonly month: number; readonly day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return {
    year: Number(readPart(parts, 'year')),
    month: Number(readPart(parts, 'month')),
    day: Number(readPart(parts, 'day')),
  };
}

function zonedLocalMinuteToUtc(localDate: Date, minuteOfDay: number, timeZone: string): Date {
  const targetUtcFields = Date.UTC(
    localDate.getUTCFullYear(),
    localDate.getUTCMonth(),
    localDate.getUTCDate(),
    Math.floor(minuteOfDay / 60),
    minuteOfDay % 60
  );
  let candidate = targetUtcFields;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(candidate));
    const projected = Date.UTC(
      Number(readPart(parts, 'year')),
      Number(readPart(parts, 'month')) - 1,
      Number(readPart(parts, 'day')),
      Number(readPart(parts, 'hour')),
      Number(readPart(parts, 'minute'))
    );
    candidate += targetUtcFields - projected;
  }
  return new Date(candidate);
}

function weekdayNumber(value: string): number {
  const weekdays: Readonly<Record<string, number>> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  const day = weekdays[value];
  if (!day) {
    throw seasonError('RANKED_TIME_ZONE_PROJECTION_FAILED', '无法计算排位开放日');
  }
  return day;
}

function seasonError(code: string, message: string, statusCode = 400): RankedSeasonServiceError {
  return new RankedSeasonServiceError(code, message, statusCode);
}

async function withSerializableTransaction<T>(
  callback: (client: RankedSeasonQueryClient) => Promise<T>
): Promise<T> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export const rankedSeasonService = new RankedSeasonService();
