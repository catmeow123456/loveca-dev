import { createHash, randomUUID } from 'node:crypto';
import type {
  ActivityBadgeActivityType,
  ActivityBadgeAdminView,
  ActivityBadgePublicView,
  ActivityBadgeSaveResult,
} from '../../online/activity-badge-types.js';
import type { UserRole } from '../../shared/auth/permissions.js';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import {
  awardEligibleRankedActivityBadges,
  awardEligibleThemeActivityBadges,
} from '../player-badges/award.js';
import {
  normalizeActivityBadgeImage,
  withActivityBadgeProcessingSlot,
} from './activity-badge-image-service.js';
import { writeManagementAudit } from './management-audit-service.js';
import { deletePublicObjects, uploadPublicImmutableObject } from './minio-service.js';
import { stableJsonStringify } from './replay-payload-serialization.js';

export const ACTIVITY_BADGE_MINIMUM_COMPLETED_MATCH_COUNT = 3;

interface ActivityBadgeRuleRow {
  readonly badge_key: string;
  readonly source_season_id: string | null;
  readonly source_theme_table_version_id: string | null;
  readonly criteria_type: string;
  readonly minimum_value: number;
  readonly criteria_version: string;
  readonly image_object_key: string;
  readonly image_sha256: string;
  readonly revision: number;
  readonly last_idempotency_key: string;
  readonly last_request_fingerprint: string;
  readonly updated_at: Date | string;
}

interface ActivityRow {
  readonly id: string;
  readonly activity_key: string;
  readonly name: string;
}

export interface ActivityBadgeQueryResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

export interface ActivityBadgeQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<ActivityBadgeQueryResult<T>>;
}

interface ActivityBadgeServiceDeps {
  readonly query?: ActivityBadgeQueryClient['query'];
  readonly transaction?: <T>(
    operation: (client: ActivityBadgeQueryClient) => Promise<T>
  ) => Promise<T>;
  readonly uploadObject?: typeof uploadPublicImmutableObject;
  readonly deleteObjects?: typeof deletePublicObjects;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export interface SaveActivityBadgeInput {
  readonly activityType: ActivityBadgeActivityType;
  readonly activityId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly upload: Buffer;
  readonly actorUserId: string;
  readonly actorRole: UserRole;
  readonly requestId: string;
}

export class ActivityBadgeServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'ActivityBadgeServiceError';
  }
}

export class ActivityBadgeService {
  private readonly query: ActivityBadgeQueryClient['query'];
  private readonly transaction: NonNullable<ActivityBadgeServiceDeps['transaction']>;
  private readonly uploadObject: typeof uploadPublicImmutableObject;
  private readonly deleteObjects: typeof deletePublicObjects;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(deps: ActivityBadgeServiceDeps = {}) {
    this.query =
      deps.query ??
      (async <T>(text: string, values?: readonly unknown[]) => {
        const result = await pool.query(text, values as unknown[]);
        return { rows: result.rows as T[], rowCount: result.rowCount };
      });
    this.transaction = deps.transaction ?? withTransaction;
    this.uploadObject = deps.uploadObject ?? uploadPublicImmutableObject;
    this.deleteObjects = deps.deleteObjects ?? deletePublicObjects;
    this.createId = deps.createId ?? randomUUID;
    this.now = deps.now ?? (() => new Date());
  }

  async getPublic(
    activityType: ActivityBadgeActivityType,
    activityId: string
  ): Promise<ActivityBadgePublicView | null> {
    return projectPublicView(await this.loadRule(this.queryClient(), activityType, activityId));
  }

  async getPublicMany(
    activityType: ActivityBadgeActivityType,
    activityIds: readonly string[]
  ): Promise<ReadonlyMap<string, ActivityBadgePublicView>> {
    if (activityIds.length === 0) return new Map();
    const sourceColumn = sourceColumnFor(activityType);
    const result = await this.query<ActivityBadgeRuleRow>(
      `SELECT *
       FROM player_badge_rules
       WHERE ${sourceColumn} = ANY($1::uuid[])`,
      [[...activityIds]]
    );
    return new Map(
      result.rows.map((row) => [
        requireActivityId(row, activityType),
        projectRequiredPublicView(row),
      ])
    );
  }

  async getAdmin(
    activityType: ActivityBadgeActivityType,
    activityId: string
  ): Promise<ActivityBadgeAdminView> {
    const client = this.queryClient();
    const activity = await requireActivity(client, activityType, activityId);
    return projectAdminView(
      await this.loadRule(client, activityType, activityId),
      activityType,
      activity
    );
  }

  async save(input: SaveActivityBadgeInput): Promise<ActivityBadgeSaveResult> {
    validateSaveInput(input);
    const requestFingerprint = sha256(
      stableJsonStringify({
        operation: 'SAVE',
        activityType: input.activityType,
        activityId: input.activityId,
        uploadSha256: sha256(input.upload),
      })
    );
    const client = this.queryClient();
    const activity = await requireActivity(client, input.activityType, input.activityId);
    const current = await this.loadRule(client, input.activityType, input.activityId);
    if (readIdempotentRetry(current, input.idempotencyKey, requestFingerprint)) {
      return {
        badge: projectAdminView(current, input.activityType, activity),
        changed: false,
        awardedPlayerCount: 0,
      };
    }
    assertExpectedRevision(current, input.expectedRevision);

    let processed: Awaited<ReturnType<typeof normalizeActivityBadgeImage>>;
    try {
      processed = await withActivityBadgeProcessingSlot(() =>
        normalizeActivityBadgeImage(input.upload)
      );
    } catch (error) {
      throw normalizeBadgeError(error);
    }
    const imageSha256 = sha256(processed.buffer);

    const objectKey = `activity-badges/${this.createId()}/badge.webp`;
    try {
      await this.uploadObject(objectKey, processed.buffer);
    } catch (error) {
      await this.compensateObject(objectKey);
      throw normalizeBadgeError(error);
    }
    try {
      const committed = await this.transaction(async (transactionClient) => {
        const lockedActivity = await requireActivity(
          transactionClient,
          input.activityType,
          input.activityId,
          true
        );
        const locked = await this.loadRule(
          transactionClient,
          input.activityType,
          input.activityId,
          true
        );
        if (readIdempotentRetry(locked, input.idempotencyKey, requestFingerprint)) {
          return { row: locked!, activity: lockedActivity, changed: false, awarded: [] } as const;
        }
        assertExpectedRevision(locked, input.expectedRevision);
        if (locked?.image_sha256 === imageSha256) {
          return { row: locked, activity: lockedActivity, changed: false, awarded: [] } as const;
        }

        const nextRevision = (locked?.revision ?? 0) + 1;
        const row = locked
          ? await this.updateRule(transactionClient, locked, {
              input,
              nextRevision,
              objectKey,
              imageSha256,
              requestFingerprint,
            })
          : await this.insertRule(transactionClient, {
              input,
              nextRevision,
              objectKey,
              imageSha256,
              requestFingerprint,
            });
        const awarded =
          input.activityType === 'RANKED'
            ? await awardEligibleRankedActivityBadges(transactionClient, {
                seasonId: input.activityId,
              })
            : await awardEligibleThemeActivityBadges(transactionClient, {
                themeTableVersionId: input.activityId,
              });
        await writeManagementAudit(transactionClient as never, {
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          scope: input.activityType === 'RANKED' ? 'RANKED' : 'THEME_TABLE',
          action: locked ? 'ACTIVITY_BADGE_REPLACED' : 'ACTIVITY_BADGE_PUBLISHED',
          targetType: input.activityType === 'RANKED' ? 'RANKED_SEASON_BADGE' : 'THEME_EVENT_BADGE',
          targetId: input.activityId,
          requestId: input.requestId,
          before: summarizeRule(locked),
          after: summarizeRule(row),
        });
        return { row, activity: lockedActivity, changed: true, awarded } as const;
      });

      if (!committed.changed) {
        await this.compensateObject(objectKey);
      } else if (current?.image_object_key) {
        await this.compensateObject(current.image_object_key);
      }
      return {
        badge: projectAdminView(committed.row, input.activityType, committed.activity),
        changed: committed.changed,
        awardedPlayerCount: committed.awarded.length,
      };
    } catch (error) {
      await this.compensateObject(objectKey);
      throw normalizeBadgeError(error);
    }
  }

  private async insertRule(
    client: ActivityBadgeQueryClient,
    prepared: PreparedRuleWrite
  ): Promise<ActivityBadgeRuleRow> {
    const { input } = prepared;
    const result = await client.query<ActivityBadgeRuleRow>(
      `INSERT INTO player_badge_rules (
         badge_key,
         source_season_id,
         source_theme_table_version_id,
         criteria_type,
         minimum_value,
         criteria_version,
         image_object_key,
         image_sha256,
         revision,
         last_idempotency_key,
         last_request_fingerprint,
         updated_by,
         created_at,
         updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13
       )
       RETURNING *`,
      [
        buildBadgeKey(input.activityType, input.activityId),
        input.activityType === 'RANKED' ? input.activityId : null,
        input.activityType === 'THEME' ? input.activityId : null,
        criteriaTypeFor(input.activityType),
        ACTIVITY_BADGE_MINIMUM_COMPLETED_MATCH_COUNT,
        criteriaVersionFor(input.activityType),
        prepared.objectKey,
        prepared.imageSha256,
        prepared.nextRevision,
        input.idempotencyKey.trim(),
        prepared.requestFingerprint,
        input.actorUserId,
        this.now(),
      ]
    );
    return requireRuleRow(result.rows[0]);
  }

  private async updateRule(
    client: ActivityBadgeQueryClient,
    locked: ActivityBadgeRuleRow,
    prepared: PreparedRuleWrite
  ): Promise<ActivityBadgeRuleRow> {
    const result = await client.query<ActivityBadgeRuleRow>(
      `UPDATE player_badge_rules
       SET image_object_key = $2,
           image_sha256 = $3,
           revision = $4,
           last_idempotency_key = $5,
           last_request_fingerprint = $6,
           updated_by = $7,
           updated_at = $8
       WHERE badge_key = $1
       RETURNING *`,
      [
        locked.badge_key,
        prepared.objectKey,
        prepared.imageSha256,
        prepared.nextRevision,
        prepared.input.idempotencyKey.trim(),
        prepared.requestFingerprint,
        prepared.input.actorUserId,
        this.now(),
      ]
    );
    return requireRuleRow(result.rows[0]);
  }

  private async loadRule(
    client: ActivityBadgeQueryClient,
    activityType: ActivityBadgeActivityType,
    activityId: string,
    lock = false
  ): Promise<ActivityBadgeRuleRow | null> {
    const result = await client.query<ActivityBadgeRuleRow>(
      `SELECT *
       FROM player_badge_rules
       WHERE ${sourceColumnFor(activityType)} = $1${lock ? ' FOR UPDATE' : ''}`,
      [activityId]
    );
    return result.rows[0] ?? null;
  }

  private queryClient(): ActivityBadgeQueryClient {
    return { query: this.query };
  }

  private async compensateObject(objectKey: string): Promise<void> {
    try {
      await this.deleteObjects([objectKey]);
    } catch (error) {
      console.error('Failed to remove replaced activity badge object', {
        errorType: error instanceof Error ? error.name : typeof error,
        objectKey,
      });
    }
  }
}

interface PreparedRuleWrite {
  readonly input: SaveActivityBadgeInput;
  readonly nextRevision: number;
  readonly objectKey: string;
  readonly imageSha256: string;
  readonly requestFingerprint: string;
}

async function requireActivity(
  client: ActivityBadgeQueryClient,
  activityType: ActivityBadgeActivityType,
  activityId: string,
  lock = false
): Promise<ActivityRow> {
  const table = activityType === 'RANKED' ? 'ranked_seasons' : 'theme_table_versions';
  const keyColumn = activityType === 'RANKED' ? 'season_key' : 'version_key';
  const result = await client.query<ActivityRow>(
    `SELECT id, ${keyColumn} AS activity_key, name
     FROM ${table}
     WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [activityId]
  );
  const row = result.rows[0];
  if (!row) {
    throw badgeError(
      'ACTIVITY_BADGE_ACTIVITY_NOT_FOUND',
      activityType === 'RANKED' ? '排位赛季不存在' : '娱乐模式活动不存在',
      404
    );
  }
  return row;
}

function projectPublicView(row: ActivityBadgeRuleRow | null): ActivityBadgePublicView | null {
  return row ? projectRequiredPublicView(row) : null;
}

function projectRequiredPublicView(row: ActivityBadgeRuleRow): ActivityBadgePublicView {
  return {
    imageUrl: `/images/${row.image_object_key}`,
    revision: row.revision,
    minimumCompletedMatchCount: row.minimum_value,
  };
}

function projectAdminView(
  row: ActivityBadgeRuleRow | null,
  activityType: ActivityBadgeActivityType,
  activity: ActivityRow
): ActivityBadgeAdminView {
  return {
    activityType,
    activityId: activity.id,
    activityName: activity.name,
    badge: projectPublicView(row),
    updatedAt: row ? new Date(row.updated_at).toISOString() : null,
  };
}

function sourceColumnFor(activityType: ActivityBadgeActivityType): string {
  return activityType === 'RANKED' ? 'source_season_id' : 'source_theme_table_version_id';
}

function requireActivityId(
  row: ActivityBadgeRuleRow,
  activityType: ActivityBadgeActivityType
): string {
  const value =
    activityType === 'RANKED' ? row.source_season_id : row.source_theme_table_version_id;
  if (!value) throw badgeError('ACTIVITY_BADGE_CONFIG_INVALID', '活动徽章配置不完整', 500);
  return value;
}

function criteriaTypeFor(activityType: ActivityBadgeActivityType): string {
  return activityType === 'RANKED' ? 'RANKED_RATED_MATCH_COUNT' : 'THEME_COMPLETED_MATCH_COUNT';
}

function criteriaVersionFor(activityType: ActivityBadgeActivityType): string {
  return activityType === 'RANKED'
    ? 'RANKED_ACTIVITY_BADGE_THREE_MATCHES_V1'
    : 'THEME_ACTIVITY_BADGE_THREE_MATCHES_V1';
}

function buildBadgeKey(activityType: ActivityBadgeActivityType, activityId: string): string {
  return `activity-${activityType.toLowerCase()}-${activityId}`;
}

function validateSaveInput(input: SaveActivityBadgeInput): void {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw badgeError('ACTIVITY_BADGE_INVALID_REQUEST', '活动徽章 revision 无效');
  }
  if (
    input.idempotencyKey.trim().length < 8 ||
    input.idempotencyKey.trim().length > 160 ||
    !input.requestId.trim()
  ) {
    throw badgeError('ACTIVITY_BADGE_INVALID_REQUEST', '活动徽章请求参数无效');
  }
  if (!input.upload.length) {
    throw badgeError('ACTIVITY_BADGE_UPLOAD_REQUIRED', '请选择要上传的活动徽章图片');
  }
  if (input.upload.length > config.playerWallpaper.maxInputBytes) {
    throw badgeError('ACTIVITY_BADGE_FILE_TOO_LARGE', '图片不能超过 8 MB，请压缩后再试', 413);
  }
}

function readIdempotentRetry(
  row: ActivityBadgeRuleRow | null,
  idempotencyKey: string,
  requestFingerprint: string
): boolean {
  if (!row || row.last_idempotency_key !== idempotencyKey.trim()) return false;
  if (row.last_request_fingerprint !== requestFingerprint) {
    throw badgeError(
      'ACTIVITY_BADGE_IDEMPOTENCY_CONFLICT',
      '同一个幂等键已用于不同的徽章请求',
      409
    );
  }
  return true;
}

function assertExpectedRevision(row: ActivityBadgeRuleRow | null, expectedRevision: number): void {
  if ((row?.revision ?? 0) !== expectedRevision) {
    throw badgeError(
      'ACTIVITY_BADGE_REVISION_CONFLICT',
      '活动徽章已被其他管理员更新，请重新读取后再保存',
      409
    );
  }
}

function summarizeRule(row: ActivityBadgeRuleRow | null): Record<string, unknown> {
  return row
    ? {
        revision: row.revision,
        contentHash: `sha256:${row.image_sha256}`,
        minimumCompletedMatchCount: row.minimum_value,
      }
    : { revision: 0, configured: false };
}

function requireRuleRow(row: ActivityBadgeRuleRow | undefined): ActivityBadgeRuleRow {
  if (!row) throw badgeError('ACTIVITY_BADGE_STORAGE_FAILED', '活动徽章配置写入失败', 503);
  return row;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function badgeError(code: string, message: string, statusCode = 400): ActivityBadgeServiceError {
  return new ActivityBadgeServiceError(code, message, statusCode);
}

function normalizeBadgeError(error: unknown): ActivityBadgeServiceError {
  if (error instanceof ActivityBadgeServiceError) return error;
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const candidate = error as { readonly code?: unknown; readonly message?: unknown };
    if (typeof candidate.code === 'string' && candidate.code.startsWith('ACTIVITY_BADGE_')) {
      return badgeError(
        candidate.code,
        String(candidate.message),
        candidate.code.includes('TOO_LARGE') ? 413 : 400
      );
    }
  }
  console.error('Activity badge service failed', {
    errorType: error instanceof Error ? error.name : typeof error,
  });
  return badgeError(
    'ACTIVITY_BADGE_STORAGE_FAILED',
    '活动徽章暂时无法保存，当前徽章没有改变，请稍后重试',
    503
  );
}

async function withTransaction<T>(
  operation: (client: ActivityBadgeQueryClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export const activityBadgeService = new ActivityBadgeService();
