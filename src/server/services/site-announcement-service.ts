import { pool } from '../db/pool.js';
import {
  SITE_ANNOUNCEMENT_TYPES,
  SITE_STATUS_LIFECYCLES,
  sortPublicSiteAnnouncements,
  type PublicSiteMaintenanceStatus,
  type PublicSiteAnnouncement,
  type PublicSiteStatus,
  type SiteAnnouncementType,
  type SiteStatusLifecycle,
} from '../site-status.js';
import {
  publicSiteStatusSnapshotService,
  type PublicSnapshotInspection,
} from './public-site-status-snapshot-service.js';
import { assertApplicationReady, ApplicationReadinessError } from './readiness-service.js';

export type SiteAnnouncementStatus = 'DRAFT' | 'PUBLISHED';

export interface AdminSiteAnnouncement extends PublicSiteAnnouncement {
  status: SiteAnnouncementStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SiteAnnouncementInput {
  type: SiteAnnouncementType;
  title: string;
  summary: string;
  detail?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  priority?: number;
  impactScopes?: readonly string[];
  publish?: boolean;
  publishedAt?: string | null;
}

export interface SiteStatusConfigInput {
  lifecycle: SiteStatusLifecycle;
  maintenanceConfirmed?: boolean;
  title?: string | null;
  summary?: string | null;
  detail?: string | null;
  startsAt?: string | null;
  estimatedEndsAt?: string | null;
  restrictsNewGamesAt?: string | null;
  impactScopes?: readonly string[];
  restrictions?: readonly string[];
  action?: string | null;
}

export interface AdminSiteStatusView {
  readonly siteStatus: PublicSiteStatus;
  readonly publicSnapshot: PublicSnapshotInspection;
}

export interface PlayerBattleEntryVisibility {
  readonly ranked: boolean;
  readonly themeTable: boolean;
}

interface SiteAnnouncementRow {
  id: string;
  type: SiteAnnouncementType;
  title: string;
  summary: string;
  detail: string | null;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  priority: number;
  impact_scopes: string[] | null;
  status: SiteAnnouncementStatus;
  published_at: Date | string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SiteStatusConfigRow {
  id: string;
  lifecycle: SiteStatusLifecycle;
  title: string | null;
  summary: string | null;
  detail: string | null;
  starts_at: Date | string | null;
  estimated_ends_at: Date | string | null;
  restricts_new_games_at: Date | string | null;
  impact_scopes: string[] | null;
  restrictions: string[] | null;
  action: string | null;
  ranked_entry_visible: boolean;
  theme_table_entry_visible: boolean;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const PUBLIC_ANNOUNCEMENT_LIMIT = 10;
const SITE_STATUS_CONFIG_ID = 'default';
const ANNOUNCEMENT_TYPE_SET = new Set<string>(SITE_ANNOUNCEMENT_TYPES);
const SITE_STATUS_LIFECYCLE_SET = new Set<string>(SITE_STATUS_LIFECYCLES);

export class SiteAnnouncementServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'SiteAnnouncementServiceError';
  }
}

export class SiteAnnouncementService {
  async getPublicSiteStatus(now: Date = new Date()): Promise<PublicSiteStatus> {
    const configuredStatus = await this.getConfiguredSiteStatus(now);
    try {
      const announcements = await this.listPublicAnnouncements(now);
      return {
        ...configuredStatus,
        announcements,
      };
    } catch (error) {
      console.warn(
        '[SiteAnnouncements] Falling back to configured site status announcements:',
        error
      );
      return configuredStatus;
    }
  }

  async getConfiguredSiteStatus(now: Date = new Date()): Promise<PublicSiteStatus> {
    const row = await this.getSiteStatusConfigRow();
    return row ? mapSiteStatusConfigRow(row, now) : buildNormalSiteStatus(now);
  }

  async getAdminSiteStatus(now: Date = new Date()): Promise<AdminSiteStatusView> {
    const [siteStatus, publicSnapshot] = await Promise.all([
      this.getPublicSiteStatus(now),
      publicSiteStatusSnapshotService.inspect(),
    ]);
    const expectedAvailability = siteStatus.lifecycle === 'MAINTENANCE' ? 'MAINTENANCE' : 'OPEN';
    return {
      siteStatus,
      publicSnapshot:
        publicSnapshot.status === 'SYNCED' && publicSnapshot.availability !== expectedAvailability
          ? {
              ...publicSnapshot,
              status: 'FAILED',
              error: `公开快照与数据库状态不一致，预期 ${expectedAvailability}`,
            }
          : publicSnapshot,
    };
  }

  async updateSiteStatusConfig(
    input: SiteStatusConfigInput,
    adminUserId: string,
    now: Date = new Date()
  ): Promise<PublicSiteStatus> {
    const normalized = normalizeSiteStatusConfigInput(input);
    if (normalized.lifecycle === 'MAINTENANCE' && input.maintenanceConfirmed !== true) {
      throw new SiteAnnouncementServiceError(
        'MAINTENANCE_CONFIRMATION_REQUIRED',
        '进入整站维护前必须确认普通用户将只能看到系统维护页',
        400
      );
    }

    const previousRow = await this.getSiteStatusConfigRow();
    const previousStatus = previousRow
      ? mapSiteStatusConfigRow(previousRow, now)
      : buildNormalSiteStatus(now);
    const previousPublicSnapshot = await publicSiteStatusSnapshotService.inspect();
    const isLeavingMaintenance =
      normalized.lifecycle !== 'MAINTENANCE' &&
      (previousStatus.lifecycle === 'MAINTENANCE' ||
        previousPublicSnapshot.status !== 'SYNCED' ||
        previousPublicSnapshot.availability !== 'OPEN');
    if (isLeavingMaintenance) {
      try {
        await assertApplicationReady();
      } catch (error) {
        if (error instanceof ApplicationReadinessError) {
          throw new SiteAnnouncementServiceError('APPLICATION_NOT_READY', error.message, 409);
        }
        throw error;
      }
    }

    if (normalized.lifecycle === 'MAINTENANCE') {
      try {
        await publicSiteStatusSnapshotService.write(
          'MAINTENANCE',
          buildMaintenanceFromNormalized(normalized, now),
          now
        );
      } catch (error) {
        logSiteStatusTransition({
          event: 'SITE_STATUS_UPDATE_REJECTED',
          adminUserId,
          previousLifecycle: previousStatus.lifecycle,
          nextLifecycle: normalized.lifecycle,
          snapshotAvailability: 'MAINTENANCE',
          error: readErrorMessage(error),
        });
        throw new SiteAnnouncementServiceError(
          'PUBLIC_SNAPSHOT_SYNC_FAILED',
          `${readErrorMessage(error)}；数据库状态尚未改变`,
          503
        );
      }
    }

    const result = await pool.query<SiteStatusConfigRow>(
      `INSERT INTO site_status_config (
         id,
         lifecycle,
         title,
         summary,
         detail,
         starts_at,
         estimated_ends_at,
         restricts_new_games_at,
         impact_scopes,
         restrictions,
         action,
         updated_by
       )
       VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
       ON CONFLICT (id) DO UPDATE
       SET
         lifecycle = EXCLUDED.lifecycle,
         title = EXCLUDED.title,
         summary = EXCLUDED.summary,
         detail = EXCLUDED.detail,
         starts_at = EXCLUDED.starts_at,
         estimated_ends_at = EXCLUDED.estimated_ends_at,
         restricts_new_games_at = EXCLUDED.restricts_new_games_at,
         impact_scopes = EXCLUDED.impact_scopes,
         restrictions = EXCLUDED.restrictions,
         action = EXCLUDED.action,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [
        normalized.lifecycle,
        normalized.title,
        normalized.summary,
        normalized.detail,
        normalized.startsAt,
        normalized.estimatedEndsAt,
        normalized.restrictsNewGamesAt,
        JSON.stringify(normalized.impactScopes),
        JSON.stringify(normalized.restrictions),
        normalized.action,
        adminUserId,
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new SiteAnnouncementServiceError('SITE_STATUS_UPDATE_FAILED', '站点状态保存失败', 500);
    }
    const status = mapSiteStatusConfigRow(row, now);
    try {
      await publicSiteStatusSnapshotService.write(
        normalized.lifecycle === 'MAINTENANCE' ? 'MAINTENANCE' : 'OPEN',
        status.maintenance,
        now
      );
    } catch (error) {
      logSiteStatusTransition({
        event: 'SITE_STATUS_SNAPSHOT_SYNC_FAILED',
        adminUserId,
        previousLifecycle: previousStatus.lifecycle,
        nextLifecycle: normalized.lifecycle,
        snapshotAvailability: normalized.lifecycle === 'MAINTENANCE' ? 'MAINTENANCE' : 'OPEN',
        error: readErrorMessage(error),
      });
      throw new SiteAnnouncementServiceError(
        'PUBLIC_SNAPSHOT_SYNC_FAILED',
        `${readErrorMessage(error)}；公开访问仍保持在限制侧，请修复快照后重试当前状态`,
        503
      );
    }

    logSiteStatusTransition({
      event: 'SITE_STATUS_UPDATED',
      adminUserId,
      previousLifecycle: previousStatus.lifecycle,
      nextLifecycle: normalized.lifecycle,
      snapshotAvailability: normalized.lifecycle === 'MAINTENANCE' ? 'MAINTENANCE' : 'OPEN',
      error: null,
    });
    return status;
  }

  async getPlayerBattleEntryVisibility(): Promise<PlayerBattleEntryVisibility> {
    const result = await pool.query<
      Pick<SiteStatusConfigRow, 'ranked_entry_visible' | 'theme_table_entry_visible'>
    >(
      `SELECT ranked_entry_visible, theme_table_entry_visible
       FROM site_status_config
       WHERE id = $1
       LIMIT 1`,
      [SITE_STATUS_CONFIG_ID]
    );
    const row = result.rows[0];
    return {
      ranked: row?.ranked_entry_visible ?? true,
      themeTable: row?.theme_table_entry_visible ?? true,
    };
  }

  async updatePlayerBattleEntryVisibility(
    input: PlayerBattleEntryVisibility,
    adminUserId: string
  ): Promise<PlayerBattleEntryVisibility> {
    const result = await pool.query<
      Pick<SiteStatusConfigRow, 'ranked_entry_visible' | 'theme_table_entry_visible'>
    >(
      `INSERT INTO site_status_config (
         id,
         lifecycle,
         ranked_entry_visible,
         theme_table_entry_visible,
         updated_by
       )
       VALUES ('default', 'NORMAL', $1, $2, $3)
       ON CONFLICT (id) DO UPDATE
       SET
         ranked_entry_visible = EXCLUDED.ranked_entry_visible,
         theme_table_entry_visible = EXCLUDED.theme_table_entry_visible,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING ranked_entry_visible, theme_table_entry_visible`,
      [input.ranked, input.themeTable, adminUserId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new SiteAnnouncementServiceError(
        'PLAYER_BATTLE_ENTRIES_UPDATE_FAILED',
        '玩家对战入口保存失败',
        500
      );
    }
    return {
      ranked: row.ranked_entry_visible,
      themeTable: row.theme_table_entry_visible,
    };
  }

  async getGameplayRestriction(
    now: Date = new Date()
  ): Promise<PublicSiteMaintenanceStatus | null> {
    const status = await this.getConfiguredSiteStatus(now);
    if (!isGameplayRestrictedLifecycle(status.lifecycle)) {
      return null;
    }

    return status.maintenance;
  }

  async listPublicAnnouncements(
    now: Date = new Date()
  ): Promise<readonly PublicSiteAnnouncement[]> {
    const result = await pool.query<SiteAnnouncementRow>(
      `SELECT *
       FROM site_announcements
       WHERE status = 'PUBLISHED'
         AND (ends_at IS NULL OR ends_at > $1)
       ORDER BY priority DESC, COALESCE(published_at, starts_at, created_at) DESC
       LIMIT $2`,
      [now, PUBLIC_ANNOUNCEMENT_LIMIT]
    );

    return sortPublicSiteAnnouncements(result.rows.map(mapPublicAnnouncementRow));
  }

  async listAdminAnnouncements(): Promise<readonly AdminSiteAnnouncement[]> {
    const result = await pool.query<SiteAnnouncementRow>(
      `SELECT *
       FROM site_announcements
       ORDER BY
         CASE WHEN status = 'DRAFT' THEN 0 ELSE 1 END,
         priority DESC,
         COALESCE(published_at, starts_at, created_at) DESC,
         updated_at DESC`
    );

    return result.rows.map(mapAdminAnnouncementRow);
  }

  async createAnnouncement(
    input: SiteAnnouncementInput,
    adminUserId: string,
    now: Date = new Date()
  ): Promise<AdminSiteAnnouncement> {
    const normalized = normalizeAnnouncementInput(input);
    const status: SiteAnnouncementStatus = input.publish === true ? 'PUBLISHED' : 'DRAFT';
    const publishedAt =
      status === 'PUBLISHED' ? (normalizeOptionalDate(input.publishedAt) ?? now) : null;

    const result = await pool.query<SiteAnnouncementRow>(
      `INSERT INTO site_announcements (
         type,
         title,
         summary,
         detail,
         starts_at,
         ends_at,
         priority,
         impact_scopes,
         status,
         published_at,
         created_by,
         updated_by
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
       RETURNING *`,
      [
        normalized.type,
        normalized.title,
        normalized.summary,
        normalized.detail,
        normalized.startsAt,
        normalized.endsAt,
        normalized.priority,
        JSON.stringify(normalized.impactScopes),
        status,
        publishedAt,
        adminUserId,
        adminUserId,
      ]
    );

    return mapRequiredAdminRow(result.rows[0]);
  }

  async updateAnnouncement(
    id: string,
    input: SiteAnnouncementInput,
    adminUserId: string
  ): Promise<AdminSiteAnnouncement | null> {
    const normalized = normalizeAnnouncementInput(input);
    const result = await pool.query<SiteAnnouncementRow>(
      `UPDATE site_announcements
       SET
         type = $1,
         title = $2,
         summary = $3,
         detail = $4,
         starts_at = $5,
         ends_at = $6,
         priority = $7,
         impact_scopes = $8::jsonb,
         updated_by = $9,
         updated_at = now()
       WHERE id = $10
       RETURNING *`,
      [
        normalized.type,
        normalized.title,
        normalized.summary,
        normalized.detail,
        normalized.startsAt,
        normalized.endsAt,
        normalized.priority,
        JSON.stringify(normalized.impactScopes),
        adminUserId,
        id,
      ]
    );

    return result.rows[0] ? mapAdminAnnouncementRow(result.rows[0]) : null;
  }

  async publishAnnouncement(
    id: string,
    adminUserId: string,
    now: Date = new Date()
  ): Promise<AdminSiteAnnouncement | null> {
    const result = await pool.query<SiteAnnouncementRow>(
      `UPDATE site_announcements
       SET
         status = 'PUBLISHED',
         published_at = COALESCE(published_at, $1),
         updated_by = $2,
         updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [now, adminUserId, id]
    );

    return result.rows[0] ? mapAdminAnnouncementRow(result.rows[0]) : null;
  }

  async deleteAnnouncement(id: string): Promise<boolean> {
    const result = await pool.query<{ id: string }>(
      `DELETE FROM site_announcements
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    return result.rows.length > 0;
  }

  private async getSiteStatusConfigRow(): Promise<SiteStatusConfigRow | null> {
    const result = await pool.query<SiteStatusConfigRow>(
      `SELECT *
       FROM site_status_config
       WHERE id = $1
       LIMIT 1`,
      [SITE_STATUS_CONFIG_ID]
    );

    return result.rows[0] ?? null;
  }
}

function isGameplayRestrictedLifecycle(lifecycle: SiteStatusLifecycle): boolean {
  return lifecycle === 'RESTRICTING_NEW_GAMES' || lifecycle === 'MAINTENANCE';
}

function normalizeSiteStatusConfigInput(input: SiteStatusConfigInput) {
  const lifecycle = normalizeSiteStatusLifecycle(input.lifecycle);

  if (lifecycle === 'NORMAL') {
    return {
      lifecycle,
      title: null,
      summary: null,
      detail: null,
      startsAt: null,
      estimatedEndsAt: null,
      restrictsNewGamesAt: null,
      impactScopes: [],
      restrictions: [],
      action: null,
    };
  }

  const startsAt = normalizeOptionalDate(input.startsAt);
  const estimatedEndsAt = normalizeOptionalDate(input.estimatedEndsAt);
  const restrictsNewGamesAt = normalizeOptionalDate(input.restrictsNewGamesAt);

  if (startsAt && estimatedEndsAt && estimatedEndsAt.getTime() <= startsAt.getTime()) {
    throw new SiteAnnouncementServiceError(
      'INVALID_DATE_RANGE',
      '预计结束时间必须晚于开始时间',
      400
    );
  }

  return {
    lifecycle,
    title: normalizeOptionalText(input.title),
    summary: normalizeOptionalText(input.summary),
    detail: normalizeOptionalText(input.detail),
    startsAt,
    estimatedEndsAt,
    restrictsNewGamesAt,
    impactScopes: normalizeImpactScopes(input.impactScopes),
    restrictions: normalizeImpactScopes(input.restrictions),
    action: normalizeOptionalText(input.action),
  };
}

function normalizeSiteStatusLifecycle(lifecycle: string): SiteStatusLifecycle {
  const normalized = lifecycle.trim().toUpperCase();
  if (!SITE_STATUS_LIFECYCLE_SET.has(normalized)) {
    throw new SiteAnnouncementServiceError('INVALID_SITE_STATUS', '站点状态非法', 400);
  }

  return normalized as SiteStatusLifecycle;
}

function normalizeAnnouncementInput(input: SiteAnnouncementInput) {
  const type = normalizeAnnouncementType(input.type);
  const title = normalizeRequiredText(input.title, '标题');
  const summary = normalizeRequiredText(input.summary, '摘要');
  const detail = normalizeOptionalText(input.detail);
  const startsAt = normalizeOptionalDate(input.startsAt);
  const endsAt = normalizeOptionalDate(input.endsAt);
  const priority =
    typeof input.priority === 'number' && Number.isFinite(input.priority)
      ? Math.trunc(input.priority)
      : 0;
  const impactScopes = normalizeImpactScopes(input.impactScopes);

  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new SiteAnnouncementServiceError('INVALID_DATE_RANGE', '结束时间必须晚于开始时间', 400);
  }

  return {
    type,
    title,
    summary,
    detail,
    startsAt,
    endsAt,
    priority,
    impactScopes,
  };
}

function normalizeAnnouncementType(type: string): SiteAnnouncementType {
  const normalized = type.trim().toUpperCase();
  if (!ANNOUNCEMENT_TYPE_SET.has(normalized)) {
    throw new SiteAnnouncementServiceError('INVALID_TYPE', '公告类型非法', 400);
  }

  return normalized as SiteAnnouncementType;
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new SiteAnnouncementServiceError('INVALID_INPUT', `${label}不能为空`, 400);
  }

  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalDate(value: string | null | undefined): Date | null {
  const cleaned = normalizeOptionalText(value);
  if (!cleaned) {
    return null;
  }

  const timestamp = Date.parse(cleaned);
  if (!Number.isFinite(timestamp)) {
    throw new SiteAnnouncementServiceError('INVALID_DATE', '日期格式非法', 400);
  }

  return new Date(timestamp);
}

function normalizeImpactScopes(scopes: readonly string[] | undefined): readonly string[] {
  if (!scopes) {
    return [];
  }

  return scopes
    .map((scope) => normalizeOptionalText(scope))
    .filter((scope): scope is string => scope !== null)
    .slice(0, 12);
}

function mapSiteStatusConfigRow(row: SiteStatusConfigRow, now: Date): PublicSiteStatus {
  const lifecycle = normalizeSiteStatusLifecycle(row.lifecycle);

  return {
    lifecycle,
    generatedAt: now.toISOString(),
    maintenance:
      lifecycle === 'NORMAL'
        ? null
        : {
            id: row.id,
            title: row.title ?? defaultMaintenanceTitle(lifecycle),
            summary: row.summary ?? defaultMaintenanceSummary(lifecycle),
            detail: row.detail,
            startsAt: toIsoStringOrNull(row.starts_at),
            estimatedEndsAt: toIsoStringOrNull(row.estimated_ends_at),
            restrictsNewGamesAt: toIsoStringOrNull(row.restricts_new_games_at),
            impactScopes: Array.isArray(row.impact_scopes) ? row.impact_scopes : [],
            restrictions: Array.isArray(row.restrictions) ? row.restrictions : [],
            action: row.action,
            updatedAt: toIsoString(row.updated_at),
          },
    announcements: [],
  };
}

function buildNormalSiteStatus(now: Date): PublicSiteStatus {
  return {
    lifecycle: 'NORMAL',
    generatedAt: now.toISOString(),
    maintenance: null,
    announcements: [],
  };
}

function buildMaintenanceFromNormalized(
  normalized: ReturnType<typeof normalizeSiteStatusConfigInput>,
  now: Date
): PublicSiteMaintenanceStatus {
  return {
    id: SITE_STATUS_CONFIG_ID,
    title: normalized.title ?? defaultMaintenanceTitle(normalized.lifecycle),
    summary: normalized.summary ?? defaultMaintenanceSummary(normalized.lifecycle),
    detail: normalized.detail,
    startsAt: normalized.startsAt?.toISOString() ?? null,
    estimatedEndsAt: normalized.estimatedEndsAt?.toISOString() ?? null,
    restrictsNewGamesAt: normalized.restrictsNewGamesAt?.toISOString() ?? null,
    impactScopes: normalized.impactScopes,
    restrictions: normalized.restrictions,
    action: normalized.action,
    updatedAt: now.toISOString(),
  };
}

function defaultMaintenanceTitle(lifecycle: SiteStatusLifecycle): string {
  switch (lifecycle) {
    case 'RESTRICTING_NEW_GAMES':
      return '限制新开局';
    case 'MAINTENANCE':
      return '舞台正在整备';
    case 'NORMAL':
      return '站点状态';
  }
}

function defaultMaintenanceSummary(lifecycle: SiteStatusLifecycle): string {
  switch (lifecycle) {
    case 'RESTRICTING_NEW_GAMES':
      return '维护窗口临近，正在限制新的正式联机开局。';
    case 'MAINTENANCE':
      return '稍后再见，下一场 LIVE 很快开始。';
    case 'NORMAL':
      return '站点运行正常。';
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

interface SiteStatusTransitionLog {
  readonly event:
    'SITE_STATUS_UPDATE_REJECTED' | 'SITE_STATUS_SNAPSHOT_SYNC_FAILED' | 'SITE_STATUS_UPDATED';
  readonly adminUserId: string;
  readonly previousLifecycle: SiteStatusLifecycle;
  readonly nextLifecycle: SiteStatusLifecycle;
  readonly snapshotAvailability: 'OPEN' | 'MAINTENANCE';
  readonly error: string | null;
}

function logSiteStatusTransition(entry: SiteStatusTransitionLog): void {
  const payload = JSON.stringify({
    scope: 'site_status',
    occurredAt: new Date().toISOString(),
    ...entry,
  });
  if (entry.error) {
    console.error(payload);
  } else {
    console.info(payload);
  }
}

function mapPublicAnnouncementRow(row: SiteAnnouncementRow): PublicSiteAnnouncement {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    summary: row.summary,
    detail: row.detail,
    publishedAt: toIsoStringOrNull(row.published_at),
    startsAt: toIsoStringOrNull(row.starts_at),
    endsAt: toIsoStringOrNull(row.ends_at),
    priority: row.priority,
    impactScopes: Array.isArray(row.impact_scopes) ? row.impact_scopes : [],
  };
}

function mapAdminAnnouncementRow(row: SiteAnnouncementRow): AdminSiteAnnouncement {
  return {
    ...mapPublicAnnouncementRow(row),
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function mapRequiredAdminRow(row: SiteAnnouncementRow | undefined): AdminSiteAnnouncement {
  if (!row) {
    throw new SiteAnnouncementServiceError('CREATE_FAILED', '公告保存失败', 500);
  }

  return mapAdminAnnouncementRow(row);
}

function toIsoStringOrNull(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return toIsoString(value);
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

export const siteAnnouncementService = new SiteAnnouncementService();
