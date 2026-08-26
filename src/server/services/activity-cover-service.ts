import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type {
  ActivityCoverActivityType,
  ActivityCoverAdminView,
  ActivityCoverCrop,
  ActivityCoverFocus,
  ActivityCoverMaskLevel,
  ActivityCoverPublicView,
  ActivityCoverSaveResult,
} from '../../online/activity-cover-types.js';
import type { UserRole } from '../../shared/auth/permissions.js';
import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { deletePublicObjects, getObject, uploadPublicImmutableObject } from './minio-service.js';
import {
  normalizeActivityCoverSource,
  renderActivityCoverLayout,
  validateActivityCoverFocus,
  withActivityCoverProcessingSlot,
  type ProcessedActivityCoverImage,
} from './activity-cover-image-service.js';
import { writeManagementAudit } from './management-audit-service.js';
import { stableJsonStringify } from './replay-payload-serialization.js';

interface ActivityCoverConfigRow {
  readonly activity_type: ActivityCoverActivityType;
  readonly activity_id: string;
  readonly mode: 'DEFAULT' | 'CUSTOM';
  readonly revision: number;
  readonly mask_level: ActivityCoverMaskLevel;
  readonly master_object_key: string | null;
  readonly master_width: number | null;
  readonly master_height: number | null;
  readonly master_sha256: string | null;
  readonly wide_object_key: string | null;
  readonly wide_crop: ActivityCoverCrop | null;
  readonly wide_focus: ActivityCoverFocus | null;
  readonly compact_object_key: string | null;
  readonly compact_crop: ActivityCoverCrop | null;
  readonly compact_focus: ActivityCoverFocus | null;
  readonly last_idempotency_key: string;
  readonly last_request_fingerprint: string;
  readonly updated_at: Date | string;
}

export interface ActivityCoverQueryResult<T> {
  readonly rows: T[];
  readonly rowCount?: number | null;
}

export interface ActivityCoverQueryClient {
  query<T = unknown>(
    text: string,
    values?: readonly unknown[]
  ): Promise<ActivityCoverQueryResult<T>>;
}

interface ActivityCoverServiceDeps {
  readonly query?: ActivityCoverQueryClient['query'];
  readonly transaction?: <T>(
    operation: (client: ActivityCoverQueryClient) => Promise<T>
  ) => Promise<T>;
  readonly uploadObject?: typeof uploadPublicImmutableObject;
  readonly deleteObjects?: typeof deletePublicObjects;
  readonly getObject?: typeof getObject;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export interface SaveActivityCoverInput {
  readonly activityType: ActivityCoverActivityType;
  readonly activityId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly source: 'UPLOAD' | 'CURRENT';
  readonly upload?: Buffer;
  readonly maskLevel: ActivityCoverMaskLevel;
  readonly wide: { readonly crop: ActivityCoverCrop; readonly focus: ActivityCoverFocus };
  readonly compact: { readonly crop: ActivityCoverCrop; readonly focus: ActivityCoverFocus };
  readonly actorUserId: string;
  readonly actorRole: UserRole;
  readonly requestId: string;
}

export interface RemoveActivityCoverInput {
  readonly activityType: ActivityCoverActivityType;
  readonly activityId: string;
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly actorUserId: string;
  readonly actorRole: UserRole;
  readonly requestId: string;
}

export class ActivityCoverServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'ActivityCoverServiceError';
  }
}

const DEFAULT_MASK_LEVEL: ActivityCoverMaskLevel = 'STANDARD';

export class ActivityCoverService {
  private readonly query: ActivityCoverQueryClient['query'];
  private readonly transaction: NonNullable<ActivityCoverServiceDeps['transaction']>;
  private readonly uploadObject: typeof uploadPublicImmutableObject;
  private readonly deleteObjects: typeof deletePublicObjects;
  private readonly readObject: typeof getObject;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(deps: ActivityCoverServiceDeps = {}) {
    this.query =
      deps.query ??
      (async <T>(text: string, values?: readonly unknown[]) => {
        const result = await pool.query(text, values as unknown[]);
        return { rows: result.rows as T[], rowCount: result.rowCount };
      });
    this.transaction = deps.transaction ?? withTransaction;
    this.uploadObject = deps.uploadObject ?? uploadPublicImmutableObject;
    this.deleteObjects = deps.deleteObjects ?? deletePublicObjects;
    this.readObject = deps.getObject ?? getObject;
    this.createId = deps.createId ?? randomUUID;
    this.now = deps.now ?? (() => new Date());
  }

  async getPublic(
    activityType: ActivityCoverActivityType,
    activityId: string
  ): Promise<ActivityCoverPublicView> {
    const row = await this.loadConfig(this.queryClient(), activityType, activityId);
    return projectPublicView(row);
  }

  async getPublicMany(
    activityType: ActivityCoverActivityType,
    activityIds: readonly string[]
  ): Promise<ReadonlyMap<string, ActivityCoverPublicView>> {
    if (activityIds.length === 0) return new Map();
    const result = await this.query<ActivityCoverConfigRow>(
      `SELECT *
       FROM activity_cover_configs
       WHERE activity_type = $1
         AND activity_id = ANY($2::uuid[])`,
      [activityType, [...activityIds]]
    );
    return new Map(result.rows.map((row) => [row.activity_id, projectPublicView(row)]));
  }

  async getAdmin(
    activityType: ActivityCoverActivityType,
    activityId: string
  ): Promise<ActivityCoverAdminView> {
    const client = this.queryClient();
    await requireActivity(client, activityType, activityId);
    return projectAdminView(
      await this.loadConfig(client, activityType, activityId),
      activityType,
      activityId
    );
  }

  async getCurrentSource(
    activityType: ActivityCoverActivityType,
    activityId: string,
    expectedRevision?: number
  ): Promise<{
    readonly stream: Readable;
    readonly etag: string;
  }> {
    const client = this.queryClient();
    await requireActivity(client, activityType, activityId);
    const row = await this.loadConfig(client, activityType, activityId);
    if (!row || row.mode !== 'CUSTOM' || !row.master_object_key || !row.master_sha256) {
      throw coverError('ACTIVITY_COVER_SOURCE_NOT_FOUND', '当前活动没有可重新构图的封面母图', 404);
    }
    if (expectedRevision !== undefined && row.revision !== expectedRevision) {
      throw coverError(
        'ACTIVITY_COVER_REVISION_CONFLICT',
        '活动封面已被其他管理员更新，请重新读取后再编辑',
        409
      );
    }
    return {
      stream: await this.readObject(row.master_object_key),
      etag: `"sha256-${row.master_sha256}"`,
    };
  }

  async save(input: SaveActivityCoverInput): Promise<ActivityCoverSaveResult> {
    validateSaveInput(input);
    const client = this.queryClient();
    await requireActivity(client, input.activityType, input.activityId);
    const current = await this.loadConfig(client, input.activityType, input.activityId);
    const requestFingerprint = buildSaveRequestFingerprint(input);
    const retry = readIdempotentRetry(current, input.idempotencyKey, requestFingerprint);
    if (retry)
      return {
        cover: projectAdminView(current, input.activityType, input.activityId),
        changed: false,
      };
    assertExpectedRevision(current, input.expectedRevision);

    const prepared = await this.prepareImages(input, current);
    const activeFingerprint = buildActiveFingerprint(input, prepared.masterSha256);
    if (buildStoredActiveFingerprint(current) === activeFingerprint) {
      return {
        cover: projectAdminView(current, input.activityType, input.activityId),
        changed: false,
      };
    }

    const groupId = this.createId();
    const keys = {
      master: `activity-covers/${groupId}/master.webp`,
      wide: `activity-covers/${groupId}/wide.webp`,
      compact: `activity-covers/${groupId}/compact.webp`,
    } as const;
    const uploadResults = await Promise.allSettled([
      this.uploadObject(keys.master, prepared.master.buffer),
      this.uploadObject(keys.wide, prepared.wide.buffer),
      this.uploadObject(keys.compact, prepared.compact.buffer),
    ]);
    const failedUpload = uploadResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );
    if (failedUpload) {
      await this.compensateObjects(Object.values(keys));
      throw normalizeCoverError(failedUpload.reason);
    }

    try {
      const committed = await this.transaction(async (transactionClient) => {
        await requireActivity(transactionClient, input.activityType, input.activityId, true);
        const locked = await this.loadConfig(
          transactionClient,
          input.activityType,
          input.activityId,
          true
        );
        const lockedRetry = readIdempotentRetry(locked, input.idempotencyKey, requestFingerprint);
        if (lockedRetry) {
          return { row: locked, changed: false } as const;
        }
        assertExpectedRevision(locked, input.expectedRevision);
        if (buildStoredActiveFingerprint(locked) === activeFingerprint) {
          return { row: locked, changed: false } as const;
        }

        const nextRevision = (locked?.revision ?? 0) + 1;
        const result = await transactionClient.query<ActivityCoverConfigRow>(
          `INSERT INTO activity_cover_configs (
             activity_type, activity_id, mode, revision, mask_level,
             master_object_key, master_width, master_height, master_sha256,
             wide_object_key, wide_crop, wide_focus,
             compact_object_key, compact_crop, compact_focus,
             last_idempotency_key, last_request_fingerprint,
             updated_by, updated_at
           )
           VALUES (
             $1, $2, 'CUSTOM', $3, $4,
             $5, $6, $7, $8,
             $9, $10::jsonb, $11::jsonb,
             $12, $13::jsonb, $14::jsonb,
             $15, $16, $17, $18
           )
           ON CONFLICT (activity_type, activity_id) DO UPDATE SET
             mode = EXCLUDED.mode,
             revision = EXCLUDED.revision,
             mask_level = EXCLUDED.mask_level,
             master_object_key = EXCLUDED.master_object_key,
             master_width = EXCLUDED.master_width,
             master_height = EXCLUDED.master_height,
             master_sha256 = EXCLUDED.master_sha256,
             wide_object_key = EXCLUDED.wide_object_key,
             wide_crop = EXCLUDED.wide_crop,
             wide_focus = EXCLUDED.wide_focus,
             compact_object_key = EXCLUDED.compact_object_key,
             compact_crop = EXCLUDED.compact_crop,
             compact_focus = EXCLUDED.compact_focus,
             last_idempotency_key = EXCLUDED.last_idempotency_key,
             last_request_fingerprint = EXCLUDED.last_request_fingerprint,
             updated_by = EXCLUDED.updated_by,
             updated_at = EXCLUDED.updated_at
           RETURNING *`,
          [
            input.activityType,
            input.activityId,
            nextRevision,
            input.maskLevel,
            keys.master,
            prepared.master.width,
            prepared.master.height,
            prepared.masterSha256,
            keys.wide,
            stableJsonStringify(input.wide.crop),
            stableJsonStringify(input.wide.focus),
            keys.compact,
            stableJsonStringify(input.compact.crop),
            stableJsonStringify(input.compact.focus),
            input.idempotencyKey,
            requestFingerprint,
            input.actorUserId,
            this.now(),
          ]
        );
        const row = requireConfigRow(result.rows[0]);
        await writeManagementAudit(transactionClient as never, {
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          scope: input.activityType === 'RANKED' ? 'RANKED' : 'THEME_TABLE',
          action:
            locked?.mode === 'CUSTOM'
              ? input.source === 'UPLOAD'
                ? 'ACTIVITY_COVER_REPLACED'
                : 'ACTIVITY_COVER_ADJUSTED'
              : 'ACTIVITY_COVER_PUBLISHED',
          targetType: input.activityType === 'RANKED' ? 'RANKED_SEASON_COVER' : 'THEME_EVENT_COVER',
          targetId: input.activityId,
          requestId: input.requestId,
          before: summarizeConfig(locked),
          after: summarizeConfig(row),
        });
        return { row, changed: true } as const;
      });

      if (!committed.changed) await this.compensateObjects(Object.values(keys));
      return {
        cover: projectAdminView(committed.row, input.activityType, input.activityId),
        changed: committed.changed,
      };
    } catch (error) {
      await this.compensateObjects(Object.values(keys));
      throw normalizeCoverError(error);
    }
  }

  async remove(input: RemoveActivityCoverInput): Promise<ActivityCoverSaveResult> {
    validateRemoveInput(input);
    const client = this.queryClient();
    await requireActivity(client, input.activityType, input.activityId);
    const current = await this.loadConfig(client, input.activityType, input.activityId);
    const requestFingerprint = sha256(
      stableJsonStringify({
        operation: 'REMOVE',
        activityType: input.activityType,
        activityId: input.activityId,
        reason: input.reason.trim(),
      })
    );
    const retry = readIdempotentRetry(current, input.idempotencyKey, requestFingerprint);
    if (retry)
      return {
        cover: projectAdminView(current, input.activityType, input.activityId),
        changed: false,
      };
    assertExpectedRevision(current, input.expectedRevision);
    if (!current || current.mode === 'DEFAULT') {
      return {
        cover: projectAdminView(current, input.activityType, input.activityId),
        changed: false,
      };
    }

    try {
      return await this.transaction(async (transactionClient) => {
        await requireActivity(transactionClient, input.activityType, input.activityId, true);
        const locked = await this.loadConfig(
          transactionClient,
          input.activityType,
          input.activityId,
          true
        );
        const lockedRetry = readIdempotentRetry(locked, input.idempotencyKey, requestFingerprint);
        if (lockedRetry) {
          return {
            cover: projectAdminView(locked, input.activityType, input.activityId),
            changed: false,
          };
        }
        assertExpectedRevision(locked, input.expectedRevision);
        if (!locked || locked.mode === 'DEFAULT') {
          return {
            cover: projectAdminView(locked, input.activityType, input.activityId),
            changed: false,
          };
        }

        const nextRevision = locked.revision + 1;
        const result = await transactionClient.query<ActivityCoverConfigRow>(
          `UPDATE activity_cover_configs
           SET mode = 'DEFAULT',
               revision = $3,
               mask_level = $4,
               master_object_key = NULL,
               master_width = NULL,
               master_height = NULL,
               master_sha256 = NULL,
               wide_object_key = NULL,
               wide_crop = NULL,
               wide_focus = NULL,
               compact_object_key = NULL,
               compact_crop = NULL,
               compact_focus = NULL,
               last_idempotency_key = $5,
               last_request_fingerprint = $6,
               updated_by = $7,
               updated_at = $8
           WHERE activity_type = $1 AND activity_id = $2
           RETURNING *`,
          [
            input.activityType,
            input.activityId,
            nextRevision,
            DEFAULT_MASK_LEVEL,
            input.idempotencyKey,
            requestFingerprint,
            input.actorUserId,
            this.now(),
          ]
        );
        const row = requireConfigRow(result.rows[0]);
        await writeManagementAudit(transactionClient as never, {
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          scope: input.activityType === 'RANKED' ? 'RANKED' : 'THEME_TABLE',
          action: 'ACTIVITY_COVER_REMOVED',
          targetType: input.activityType === 'RANKED' ? 'RANKED_SEASON_COVER' : 'THEME_EVENT_COVER',
          targetId: input.activityId,
          requestId: input.requestId,
          reason: input.reason.trim(),
          before: summarizeConfig(locked),
          after: summarizeConfig(row),
        });
        return {
          cover: projectAdminView(row, input.activityType, input.activityId),
          changed: true,
        };
      });
    } catch (error) {
      throw normalizeCoverError(error);
    }
  }

  private async prepareImages(
    input: SaveActivityCoverInput,
    current: ActivityCoverConfigRow | null
  ): Promise<{
    readonly master: ProcessedActivityCoverImage;
    readonly masterSha256: string;
    readonly wide: ProcessedActivityCoverImage;
    readonly compact: ProcessedActivityCoverImage;
  }> {
    return withActivityCoverProcessingSlot(async () => {
      let master: ProcessedActivityCoverImage;
      if (input.source === 'UPLOAD') {
        if (!input.upload) {
          throw coverError('ACTIVITY_COVER_UPLOAD_REQUIRED', '请选择要上传的活动封面图片');
        }
        if (input.upload.length > config.playerWallpaper.maxInputBytes) {
          throw coverError('ACTIVITY_COVER_FILE_TOO_LARGE', '图片不能超过 8 MB，请压缩后再试', 413);
        }
        master = await normalizeActivityCoverSource(input.upload);
      } else {
        if (
          !current ||
          current.mode !== 'CUSTOM' ||
          !current.master_object_key ||
          !current.master_width ||
          !current.master_height
        ) {
          throw coverError(
            'ACTIVITY_COVER_CURRENT_SOURCE_UNAVAILABLE',
            '当前封面母图不可用，请重新选择图片',
            409
          );
        }
        master = {
          buffer: await streamToBuffer(
            await this.readObject(current.master_object_key),
            config.playerWallpaper.maxInputBytes * 2
          ),
          width: current.master_width,
          height: current.master_height,
        };
      }
      const [wide, compact] = await Promise.all([
        renderActivityCoverLayout(master, 'WIDE', input.wide.crop),
        renderActivityCoverLayout(master, 'COMPACT', input.compact.crop),
      ]);
      return { master, masterSha256: sha256(master.buffer), wide, compact };
    });
  }

  private async compensateObjects(keys: readonly string[]): Promise<void> {
    try {
      await this.deleteObjects(keys);
    } catch (error) {
      console.error('Failed to compensate activity cover candidate objects', {
        errorType: error instanceof Error ? error.name : typeof error,
        objectCount: keys.length,
      });
    }
  }

  private async loadConfig(
    client: ActivityCoverQueryClient,
    activityType: ActivityCoverActivityType,
    activityId: string,
    lock = false
  ): Promise<ActivityCoverConfigRow | null> {
    const result = await client.query<ActivityCoverConfigRow>(
      `SELECT *
       FROM activity_cover_configs
       WHERE activity_type = $1 AND activity_id = $2${lock ? ' FOR UPDATE' : ''}`,
      [activityType, activityId]
    );
    return result.rows[0] ?? null;
  }

  private queryClient(): ActivityCoverQueryClient {
    return { query: this.query };
  }
}

function projectPublicView(row: ActivityCoverConfigRow | null): ActivityCoverPublicView {
  if (!row || row.mode === 'DEFAULT') {
    return {
      mode: 'DEFAULT',
      revision: row?.revision ?? 0,
      maskLevel: row?.mask_level ?? DEFAULT_MASK_LEVEL,
      wide: null,
      compact: null,
    };
  }
  if (!row.wide_object_key || !row.wide_focus || !row.compact_object_key || !row.compact_focus) {
    throw coverError('ACTIVITY_COVER_CONFIG_INVALID', '活动封面配置不完整', 500);
  }
  if (!row.wide_crop || !row.compact_crop) {
    throw coverError('ACTIVITY_COVER_CONFIG_INVALID', '活动封面配置不完整', 500);
  }
  return {
    mode: 'CUSTOM',
    revision: row.revision,
    maskLevel: row.mask_level,
    wide: {
      url: publicObjectUrl(row.wide_object_key),
      focus: projectFocusIntoCrop(row.wide_focus, row.wide_crop),
    },
    compact: {
      url: publicObjectUrl(row.compact_object_key),
      focus: projectFocusIntoCrop(row.compact_focus, row.compact_crop),
    },
  };
}

function projectAdminView(
  row: ActivityCoverConfigRow | null,
  activityType: ActivityCoverActivityType,
  activityId: string
): ActivityCoverAdminView {
  const publicView = projectPublicView(row);
  return {
    ...publicView,
    activityType,
    activityId,
    source:
      row?.mode === 'CUSTOM' && row.master_width && row.master_height
        ? {
            url: `/api/admin/activity-covers/${activityType}/${activityId}/source?revision=${row.revision}`,
            width: row.master_width,
            height: row.master_height,
          }
        : null,
    wideCrop: row?.mode === 'CUSTOM' ? row.wide_crop : null,
    wideSourceFocus: row?.mode === 'CUSTOM' ? row.wide_focus : null,
    compactCrop: row?.mode === 'CUSTOM' ? row.compact_crop : null,
    compactSourceFocus: row?.mode === 'CUSTOM' ? row.compact_focus : null,
    updatedAt: row ? new Date(row.updated_at).toISOString() : null,
  };
}

function projectFocusIntoCrop(
  focus: ActivityCoverFocus,
  crop: ActivityCoverCrop
): ActivityCoverFocus {
  return {
    x: Math.min(1, Math.max(0, (focus.x - crop.x) / crop.width)),
    y: Math.min(1, Math.max(0, (focus.y - crop.y) / crop.height)),
  };
}

async function requireActivity(
  client: ActivityCoverQueryClient,
  activityType: ActivityCoverActivityType,
  activityId: string,
  lock = false
): Promise<void> {
  const table = activityType === 'RANKED' ? 'ranked_seasons' : 'theme_table_versions';
  const result = await client.query<{ readonly id: string }>(
    `SELECT id FROM ${table} WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [activityId]
  );
  if (!result.rows[0]) {
    throw coverError(
      'ACTIVITY_COVER_ACTIVITY_NOT_FOUND',
      activityType === 'RANKED' ? '排位赛季不存在' : '娱乐模式活动不存在',
      404
    );
  }
}

function validateSaveInput(input: SaveActivityCoverInput): void {
  validateCommonInput(input);
  validateActivityCoverFocus(input.wide.focus);
  validateActivityCoverFocus(input.compact.focus);
  validateFocusWithinCrop(input.wide.focus, input.wide.crop);
  validateFocusWithinCrop(input.compact.focus, input.compact.crop);
  if (input.source === 'CURRENT' && input.upload) {
    throw coverError('ACTIVITY_COVER_INVALID_REQUEST', '复用当前母图时不能同时上传新文件');
  }
}

function validateFocusWithinCrop(focus: ActivityCoverFocus, crop: ActivityCoverCrop): void {
  const epsilon = 0.000_001;
  if (
    focus.x < crop.x - epsilon ||
    focus.x > crop.x + crop.width + epsilon ||
    focus.y < crop.y - epsilon ||
    focus.y > crop.y + crop.height + epsilon
  ) {
    throw coverError('ACTIVITY_COVER_INVALID_FOCUS', '活动封面主体位置必须位于裁切区域内');
  }
}

function validateRemoveInput(input: RemoveActivityCoverInput): void {
  validateCommonInput(input);
  if (!input.reason.trim()) {
    throw coverError('ACTIVITY_COVER_REMOVAL_REASON_REQUIRED', '请填写移除封面的原因');
  }
}

function validateCommonInput(input: {
  readonly expectedRevision: number;
  readonly idempotencyKey: string;
  readonly requestId: string;
}): void {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw coverError('ACTIVITY_COVER_INVALID_REQUEST', '活动封面 revision 无效');
  }
  const key = input.idempotencyKey.trim();
  if (key.length < 8 || key.length > 160 || !input.requestId.trim()) {
    throw coverError('ACTIVITY_COVER_INVALID_REQUEST', '活动封面请求参数无效');
  }
}

function buildSaveRequestFingerprint(input: SaveActivityCoverInput): string {
  return sha256(
    stableJsonStringify({
      operation: 'SAVE',
      activityType: input.activityType,
      activityId: input.activityId,
      source: input.source,
      uploadSha256: input.upload ? sha256(input.upload) : null,
      maskLevel: input.maskLevel,
      wide: input.wide,
      compact: input.compact,
    })
  );
}

function buildActiveFingerprint(input: SaveActivityCoverInput, masterSha256: string): string {
  return sha256(
    stableJsonStringify({
      mode: 'CUSTOM',
      masterSha256,
      maskLevel: input.maskLevel,
      wide: input.wide,
      compact: input.compact,
    })
  );
}

function buildStoredActiveFingerprint(row: ActivityCoverConfigRow | null): string | null {
  if (
    !row ||
    row.mode !== 'CUSTOM' ||
    !row.master_sha256 ||
    !row.wide_crop ||
    !row.wide_focus ||
    !row.compact_crop ||
    !row.compact_focus
  ) {
    return null;
  }
  return sha256(
    stableJsonStringify({
      mode: 'CUSTOM',
      masterSha256: row.master_sha256,
      maskLevel: row.mask_level,
      wide: { crop: row.wide_crop, focus: row.wide_focus },
      compact: { crop: row.compact_crop, focus: row.compact_focus },
    })
  );
}

function readIdempotentRetry(
  row: ActivityCoverConfigRow | null,
  idempotencyKey: string,
  requestFingerprint: string
): boolean {
  if (!row || row.last_idempotency_key !== idempotencyKey) return false;
  if (row.last_request_fingerprint !== requestFingerprint) {
    throw coverError(
      'ACTIVITY_COVER_IDEMPOTENCY_CONFLICT',
      '同一个幂等键已用于不同的封面请求',
      409
    );
  }
  return true;
}

function assertExpectedRevision(
  row: ActivityCoverConfigRow | null,
  expectedRevision: number
): void {
  if ((row?.revision ?? 0) !== expectedRevision) {
    throw coverError(
      'ACTIVITY_COVER_REVISION_CONFLICT',
      '活动封面已被其他管理员更新，请重新读取后再保存',
      409
    );
  }
}

function summarizeConfig(row: ActivityCoverConfigRow | null): Record<string, unknown> {
  if (!row) return { mode: 'DEFAULT', revision: 0 };
  return {
    mode: row.mode,
    revision: row.revision,
    contentHash: row.master_sha256 ? `sha256:${row.master_sha256}` : null,
    maskLevel: row.mask_level,
    wide: row.wide_crop && row.wide_focus ? { crop: row.wide_crop, focus: row.wide_focus } : null,
    compact:
      row.compact_crop && row.compact_focus
        ? { crop: row.compact_crop, focus: row.compact_focus }
        : null,
  };
}

function requireConfigRow(row: ActivityCoverConfigRow | undefined): ActivityCoverConfigRow {
  if (!row) throw coverError('ACTIVITY_COVER_STORAGE_FAILED', '活动封面配置写入失败', 503);
  return row;
}

function publicObjectUrl(objectKey: string): string {
  return `/images/${objectKey}`;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function coverError(code: string, message: string, statusCode = 400): ActivityCoverServiceError {
  return new ActivityCoverServiceError(code, message, statusCode);
}

function normalizeCoverError(error: unknown): ActivityCoverServiceError {
  if (error instanceof ActivityCoverServiceError) return error;
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const candidate = error as { readonly code?: unknown; readonly message?: unknown };
    if (typeof candidate.code === 'string' && candidate.code.startsWith('ACTIVITY_COVER_')) {
      return coverError(
        candidate.code,
        String(candidate.message),
        candidate.code.includes('TOO_LARGE') ? 413 : 400
      );
    }
  }
  console.error('Activity cover service failed', {
    errorType: error instanceof Error ? error.name : typeof error,
    errorCode:
      error && typeof error === 'object' && 'code' in error
        ? String((error as { readonly code?: unknown }).code)
        : undefined,
  });
  return coverError(
    'ACTIVITY_COVER_STORAGE_FAILED',
    '活动封面暂时无法保存，当前发布版本没有改变，请稍后重试',
    503
  );
}

async function streamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > maxBytes) {
      stream.destroy();
      throw coverError(
        'ACTIVITY_COVER_CURRENT_SOURCE_UNAVAILABLE',
        '当前封面母图不可用，请重新选择图片',
        409
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function withTransaction<T>(
  operation: (client: ActivityCoverQueryClient) => Promise<T>
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

export const activityCoverService = new ActivityCoverService();
