import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import {
  deleteWallpaperObjects,
  getWallpaperObject,
  uploadWallpaperObject,
} from './minio-service.js';
import {
  normalizeWallpaperSource,
  renderWallpaperLayout,
  validateWallpaperFocus,
  withWallpaperProcessingSlot,
  type ProcessedWallpaperImage,
} from './player-wallpaper-image-service.js';
import { isPlayerWallpaperSolidPreset } from '../../online/player-wallpaper-types.js';
import type {
  CompactWallpaperMode,
  PlayerWallpaperSolidPreset,
  PlayerWallpaperAssetView,
  PlayerWallpaperPublishResult,
  PlayerWallpaperView,
  WallpaperCrop,
  WallpaperFocus,
  WideWallpaperMode,
} from '../../online/player-wallpaper-types.js';

const DEFAULT_FINGERPRINT = sha256(
  Buffer.from(
    stableJson({
      wideMode: 'DEFAULT',
      compactMode: 'INHERIT_PC',
      wide: null,
      compact: null,
    })
  )
);
const PRIVATE_ASSET_BASE_PATH = '/api/player-wallpapers/assets';
const WALLPAPER_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let lastWallpaperCleanupAt = 0;

type SourceChoice = 'UPLOAD' | 'CURRENT';
type AssetKind = 'MASTER' | 'WIDE_DISPLAY' | 'COMPACT_DISPLAY';

export interface WallpaperLayoutDraft {
  readonly crop: WallpaperCrop;
  readonly focus: WallpaperFocus;
}

export interface PublishPlayerWallpaperInput {
  readonly userId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly wideMode: WideWallpaperMode;
  readonly compactMode: CompactWallpaperMode;
  readonly wideSolidPreset: PlayerWallpaperSolidPreset | null;
  readonly compactSolidPreset: PlayerWallpaperSolidPreset | null;
  readonly wide: (WallpaperLayoutDraft & { readonly source: SourceChoice }) | null;
  readonly compact: (WallpaperLayoutDraft & { readonly source?: SourceChoice }) | null;
  readonly wideUpload?: Buffer;
  readonly compactUpload?: Buffer;
  readonly now?: Date;
}

export interface ResetPlayerWallpaperInput {
  readonly userId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly now?: Date;
}

interface ConfigRow {
  user_id: string;
  version: number;
  wide_mode: WideWallpaperMode;
  compact_mode: CompactWallpaperMode;
  wide_solid_preset: PlayerWallpaperSolidPreset | null;
  compact_solid_preset: PlayerWallpaperSolidPreset | null;
  wide_master_asset_id: string | null;
  compact_master_asset_id: string | null;
  wide_display_asset_id: string | null;
  compact_display_asset_id: string | null;
  wide_crop: WallpaperCrop | null;
  compact_crop: WallpaperCrop | null;
  wide_focus: WallpaperFocus | null;
  compact_focus: WallpaperFocus | null;
  active_fingerprint: string;
  last_published_at: Date | null;
}

interface AssetRow {
  id: string;
  user_id: string;
  kind: AssetKind;
  object_key: string;
  width: number;
  height: number;
  byte_size: number;
  sha256: string;
}

interface PendingAsset extends AssetRow {
  buffer: Buffer;
}

interface IdempotencyRow {
  operation: 'PUBLISH' | 'RESET' | 'ADMIN_REMOVE';
  request_fingerprint: string;
  status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  result: PlayerWallpaperPublishResult | null;
  error_code: string | null;
}

interface PreparedConfiguration {
  readonly wideMaster: AssetRow | null;
  readonly compactMaster: AssetRow | null;
  readonly wideDisplay: AssetRow | null;
  readonly compactDisplay: AssetRow | null;
  readonly pendingAssets: readonly PendingAsset[];
  readonly activeFingerprint: string;
}

export class PlayerWallpaperServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly nextChangeAt?: string;

  constructor(
    code: string,
    message: string,
    status: number,
    retryAfterMs?: number,
    nextChangeAt?: string
  ) {
    super(message);
    this.name = 'PlayerWallpaperServiceError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.nextChangeAt = nextChangeAt;
  }
}

export class PlayerWallpaperService {
  async getCurrent(
    userId: string,
    includeSources = false,
    now = new Date()
  ): Promise<PlayerWallpaperView> {
    const configRow = await this.readConfig(userId);
    const publication = await pool.query<{ present: boolean }>(
      `SELECT true AS present
         FROM player_wallpaper_publication_days
        WHERE user_id = $1 AND publish_day = $2`,
      [userId, shanghaiDay(now)]
    );
    return this.buildView(configRow, includeSources, publication.rowCount === 0, now);
  }

  async publish(input: PublishPlayerWallpaperInput): Promise<PlayerWallpaperPublishResult> {
    const now = input.now ?? new Date();
    validatePublishShape(input);
    const requestFingerprint = buildRequestFingerprint(input);
    const replay = await this.reserveIdempotency(
      input.userId,
      input.idempotencyKey,
      'PUBLISH',
      requestFingerprint,
      now
    );
    if (replay) {
      return replay;
    }

    const uploadedObjectKeys: string[] = [];
    try {
      const current = await this.readConfig(input.userId);
      if ((current?.version ?? 0) !== input.expectedVersion) {
        throw versionConflict();
      }

      const prepared = await withWallpaperProcessingSlot(() =>
        this.prepareConfiguration(input, current)
      );
      if (prepared.activeFingerprint === (current?.active_fingerprint ?? DEFAULT_FINGERPRINT)) {
        return this.commitNoopPublish(input, current, now);
      }

      const quota = await this.readDailyQuota(input.userId, now);
      if (!quota.canPublishToday) {
        throw dailyLimit(quota.nextChangeAt, now);
      }

      for (const asset of prepared.pendingAssets) {
        uploadedObjectKeys.push(asset.object_key);
        await uploadWallpaperObject(asset.object_key, asset.buffer);
      }

      const result = await this.commitPublish(input, prepared, current, now);
      return result;
    } catch (error) {
      await this.compensateUploadedObjects(uploadedObjectKeys);
      const serviceError = normalizeServiceError(error);
      await this.failIdempotency(input.userId, input.idempotencyKey, serviceError.code);
      throw serviceError;
    }
  }

  async reset(input: ResetPlayerWallpaperInput): Promise<PlayerWallpaperPublishResult> {
    const now = input.now ?? new Date();
    const requestFingerprint = sha256(
      Buffer.from(JSON.stringify({ expectedVersion: input.expectedVersion, operation: 'RESET' }))
    );
    const replay = await this.reserveIdempotency(
      input.userId,
      input.idempotencyKey,
      'RESET',
      requestFingerprint,
      now
    );
    if (replay) {
      return replay;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lockWallpaperUser(client, input.userId);
      const current = await readConfigWithClient(client, input.userId, true);
      if ((current?.version ?? 0) !== input.expectedVersion) {
        throw versionConflict();
      }

      if (!hasNonDefaultWallpaper(current)) {
        const wallpaper = defaultView(
          current?.version ?? 0,
          !(await hasPublicationDay(client, input.userId, now)),
          now,
          current?.last_published_at ?? null
        );
        const result = { wallpaper, changed: false } satisfies PlayerWallpaperPublishResult;
        await completeIdempotencyWithClient(
          client,
          input.userId,
          input.idempotencyKey,
          result,
          wallpaper.version,
          now
        );
        await client.query('COMMIT');
        return result;
      }

      const nextVersion = (current?.version ?? 0) + 1;
      const retiredIds = referencedAssetIds(current);
      await client.query(
        `UPDATE player_wallpaper_configs
            SET version = $2,
                wide_mode = 'DEFAULT', compact_mode = 'INHERIT_PC',
                wide_solid_preset = NULL, compact_solid_preset = NULL,
                wide_master_asset_id = NULL, compact_master_asset_id = NULL,
                wide_display_asset_id = NULL, compact_display_asset_id = NULL,
                wide_crop = NULL, compact_crop = NULL,
                wide_focus = NULL, compact_focus = NULL,
                active_fingerprint = $3,
                admin_removed_at = NULL, admin_removed_by = NULL, admin_removal_reason = NULL,
                updated_at = $4
          WHERE user_id = $1`,
        [input.userId, nextVersion, DEFAULT_FINGERPRINT, now]
      );
      await retireAssets(client, retiredIds, now);

      const wallpaper = defaultView(
        nextVersion,
        !(await hasPublicationDay(client, input.userId, now)),
        now,
        current?.last_published_at ?? null
      );
      const result = { wallpaper, changed: true } satisfies PlayerWallpaperPublishResult;
      await completeIdempotencyWithClient(
        client,
        input.userId,
        input.idempotencyKey,
        result,
        nextVersion,
        now
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      const serviceError = normalizeServiceError(error);
      await this.failIdempotency(input.userId, input.idempotencyKey, serviceError.code);
      throw serviceError;
    } finally {
      client.release();
    }
  }

  async adminRemove(
    userId: string,
    adminUserId: string,
    reason: string,
    now = new Date()
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lockWallpaperUser(client, userId);
      const current = await readConfigWithClient(client, userId, true);
      const nextVersion = (current?.version ?? 0) + 1;
      const retiredIds = referencedAssetIds(current);
      await client.query(
        `INSERT INTO player_wallpaper_configs (
           user_id, version, wide_mode, compact_mode, active_fingerprint,
           admin_removed_at, admin_removed_by, admin_removal_reason, created_at, updated_at
         ) VALUES ($1, $2, 'DEFAULT', 'INHERIT_PC', $3, $4, $5, $6, $4, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           version = EXCLUDED.version,
           wide_mode = 'DEFAULT', compact_mode = 'INHERIT_PC',
           wide_solid_preset = NULL, compact_solid_preset = NULL,
           wide_master_asset_id = NULL, compact_master_asset_id = NULL,
           wide_display_asset_id = NULL, compact_display_asset_id = NULL,
           wide_crop = NULL, compact_crop = NULL,
           wide_focus = NULL, compact_focus = NULL,
           active_fingerprint = EXCLUDED.active_fingerprint,
           admin_removed_at = EXCLUDED.admin_removed_at,
           admin_removed_by = EXCLUDED.admin_removed_by,
           admin_removal_reason = EXCLUDED.admin_removal_reason,
           updated_at = EXCLUDED.updated_at`,
        [userId, nextVersion, DEFAULT_FINGERPRINT, now, adminUserId, reason.trim()]
      );
      await retireAssets(client, retiredIds, now);
      await client.query(
        `INSERT INTO player_wallpaper_admin_audit_logs
           (user_id, admin_user_id, action, reason, config_version, created_at)
         VALUES ($1, $2, 'REMOVED', $3, $4, $5)`,
        [userId, adminUserId, reason.trim(), nextVersion, now]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw normalizeServiceError(error);
    } finally {
      client.release();
    }
  }

  async getOwnedActiveAsset(
    userId: string,
    assetId: string
  ): Promise<{
    stream: Readable;
    etag: string;
    byteSize: number;
  }> {
    const { rows } = await pool.query<AssetRow>(
      `SELECT asset.id, asset.user_id, asset.kind, asset.object_key,
              asset.width, asset.height, asset.byte_size, asset.sha256
         FROM player_wallpaper_assets AS asset
         JOIN player_wallpaper_configs AS config ON config.user_id = asset.user_id
        WHERE asset.id = $1 AND asset.user_id = $2 AND asset.deleted_at IS NULL
          AND asset.id IN (
            config.wide_master_asset_id, config.compact_master_asset_id,
            config.wide_display_asset_id, config.compact_display_asset_id
          )`,
      [assetId, userId]
    );
    const asset = rows[0];
    if (!asset) {
      throw new PlayerWallpaperServiceError('WALLPAPER_ASSET_NOT_FOUND', '壁纸资源不存在。', 404);
    }
    let stream: Readable;
    try {
      stream = await getWallpaperObject(asset.object_key);
    } catch {
      throw new PlayerWallpaperServiceError(
        'WALLPAPER_ASSET_UNAVAILABLE',
        '壁纸资源暂时无法加载。',
        503
      );
    }
    return {
      stream,
      etag: `"${asset.sha256}"`,
      byteSize: asset.byte_size,
    };
  }

  async cleanupRetiredAssets(now = new Date()): Promise<number> {
    if (now.getTime() - lastWallpaperCleanupAt < WALLPAPER_CLEANUP_INTERVAL_MS) {
      return 0;
    }
    await pool.query(`DELETE FROM player_wallpaper_idempotency WHERE expires_at < $1`, [now]);
    const cutoff = new Date(
      now.getTime() - config.playerWallpaper.retiredAssetRetentionHours * 60 * 60 * 1000
    );
    const { rows } = await pool.query<Pick<AssetRow, 'id' | 'object_key'>>(
      `SELECT asset.id, asset.object_key
         FROM player_wallpaper_assets AS asset
        WHERE asset.retired_at IS NOT NULL
          AND asset.retired_at < $1
          AND asset.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM player_wallpaper_configs AS config
             WHERE asset.id IN (
               config.wide_master_asset_id, config.compact_master_asset_id,
               config.wide_display_asset_id, config.compact_display_asset_id
             )
          )
        ORDER BY asset.retired_at ASC
        LIMIT 100`,
      [cutoff]
    );
    if (rows.length === 0) {
      lastWallpaperCleanupAt = now.getTime();
      return 0;
    }
    await deleteWallpaperObjects(rows.map((row) => row.object_key));
    await pool.query(
      `UPDATE player_wallpaper_assets SET deleted_at = $2 WHERE id = ANY($1::uuid[])`,
      [rows.map((row) => row.id), now]
    );
    lastWallpaperCleanupAt = now.getTime();
    return rows.length;
  }

  private async prepareConfiguration(
    input: PublishPlayerWallpaperInput,
    current: ConfigRow | null
  ): Promise<PreparedConfiguration> {
    const currentAssets = await this.readAssets(referencedAssetIds(current));
    const currentById = new Map(currentAssets.map((asset) => [asset.id, asset]));
    const pendingAssets: PendingAsset[] = [];

    const wideMasterResult =
      input.wideMode === 'CUSTOM' && input.wide
        ? await this.resolveMaster(
            input.userId,
            input.wide.source,
            input.wideUpload,
            current?.wide_master_asset_id ?? null,
            currentById,
            pendingAssets
          )
        : null;

    let compactMasterResult: { asset: AssetRow; image: ProcessedWallpaperImage } | null = null;
    if (input.compactMode === 'INHERIT_PC') {
      compactMasterResult = wideMasterResult;
    } else if (input.compact) {
      compactMasterResult = await this.resolveMaster(
        input.userId,
        input.compact.source ?? 'UPLOAD',
        input.compactUpload,
        current?.compact_master_asset_id ?? null,
        currentById,
        pendingAssets
      );
    }

    const wideDisplay =
      wideMasterResult && input.wide
        ? createPendingAsset(
            input.userId,
            'WIDE_DISPLAY',
            'wide',
            await renderWallpaperLayout(wideMasterResult.image, 'WIDE', input.wide.crop)
          )
        : null;
    if (wideDisplay) pendingAssets.push(wideDisplay);

    const compactDisplay =
      compactMasterResult && input.compact
        ? createPendingAsset(
            input.userId,
            'COMPACT_DISPLAY',
            'compact',
            await renderWallpaperLayout(compactMasterResult.image, 'COMPACT', input.compact.crop, {
              inheritedWideSource: input.compactMode === 'INHERIT_PC',
            })
          )
        : null;
    if (compactDisplay) pendingAssets.push(compactDisplay);

    const activeFingerprint = sha256(
      Buffer.from(
        stableJson({
          wideMode: input.wideMode,
          compactMode: input.compactMode,
          ...(input.wideMode === 'SOLID' ? { wideSolidPreset: input.wideSolidPreset } : {}),
          ...(input.compactMode === 'SOLID'
            ? { compactSolidPreset: input.compactSolidPreset }
            : {}),
          wide:
            wideMasterResult && input.wide
              ? {
                  sourceSha256: wideMasterResult.asset.sha256,
                  crop: input.wide.crop,
                  focus: input.wide.focus,
                }
              : null,
          compact:
            compactMasterResult && input.compact
              ? {
                  sourceSha256: compactMasterResult.asset.sha256,
                  crop: input.compact.crop,
                  focus: input.compact.focus,
                }
              : null,
        })
      )
    );

    return {
      wideMaster: wideMasterResult?.asset ?? null,
      compactMaster: compactMasterResult?.asset ?? null,
      wideDisplay,
      compactDisplay,
      pendingAssets,
      activeFingerprint,
    };
  }

  private async resolveMaster(
    userId: string,
    source: SourceChoice,
    upload: Buffer | undefined,
    currentAssetId: string | null,
    currentById: ReadonlyMap<string, AssetRow>,
    pendingAssets: PendingAsset[]
  ): Promise<{ asset: AssetRow; image: ProcessedWallpaperImage }> {
    if (source === 'UPLOAD') {
      if (!upload) {
        throw new PlayerWallpaperServiceError(
          'WALLPAPER_SOURCE_REQUIRED',
          '请选择要使用的壁纸图片。',
          400
        );
      }
      const normalized = await normalizeWallpaperSource(upload);
      const asset = createPendingAsset(userId, 'MASTER', 'master', normalized);
      pendingAssets.push(asset);
      return { asset, image: normalized };
    }

    const asset = currentAssetId ? currentById.get(currentAssetId) : null;
    if (!asset || asset.kind !== 'MASTER') {
      throw new PlayerWallpaperServiceError(
        'WALLPAPER_CURRENT_SOURCE_UNAVAILABLE',
        '当前源图已不可用，请重新选择图片。',
        409
      );
    }
    let buffer: Buffer;
    try {
      buffer = await streamToBuffer(await getWallpaperObject(asset.object_key), 32 * 1024 * 1024);
    } catch {
      throw new PlayerWallpaperServiceError(
        'WALLPAPER_CURRENT_SOURCE_UNAVAILABLE',
        '当前源图已不可用，请重新选择图片。',
        409
      );
    }
    return {
      asset,
      image: { buffer, width: asset.width, height: asset.height },
    };
  }

  private async commitPublish(
    input: PublishPlayerWallpaperInput,
    prepared: PreparedConfiguration,
    original: ConfigRow | null,
    now: Date
  ): Promise<PlayerWallpaperPublishResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lockWallpaperUser(client, input.userId);
      const current = await readConfigWithClient(client, input.userId, true);
      if ((current?.version ?? 0) !== input.expectedVersion) {
        throw versionConflict();
      }
      if (
        (current?.active_fingerprint ?? DEFAULT_FINGERPRINT) !==
        (original?.active_fingerprint ?? DEFAULT_FINGERPRINT)
      ) {
        throw versionConflict();
      }
      const nextVersion = (current?.version ?? 0) + 1;
      const publishDay = shanghaiDay(now);
      try {
        await client.query(
          `INSERT INTO player_wallpaper_publication_days
             (user_id, publish_day, config_version, created_at)
           VALUES ($1, $2, $3, $4)`,
          [input.userId, publishDay, nextVersion, now]
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw dailyLimit(nextShanghaiMidnight(now), now);
        }
        throw error;
      }

      for (const asset of prepared.pendingAssets) {
        await client.query(
          `INSERT INTO player_wallpaper_assets
             (id, user_id, kind, object_key, width, height, byte_size, sha256, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            asset.id,
            asset.user_id,
            asset.kind,
            asset.object_key,
            asset.width,
            asset.height,
            asset.byte_size,
            asset.sha256,
            now,
          ]
        );
      }

      await client.query(
        `INSERT INTO player_wallpaper_configs (
           user_id, version, wide_mode, compact_mode,
           wide_solid_preset, compact_solid_preset,
           wide_master_asset_id, compact_master_asset_id,
           wide_display_asset_id, compact_display_asset_id,
           wide_crop, compact_crop, wide_focus, compact_focus,
           active_fingerprint, last_published_at, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16, $16, $16
         )
         ON CONFLICT (user_id) DO UPDATE SET
           version = EXCLUDED.version,
           wide_mode = EXCLUDED.wide_mode,
           compact_mode = EXCLUDED.compact_mode,
           wide_solid_preset = EXCLUDED.wide_solid_preset,
           compact_solid_preset = EXCLUDED.compact_solid_preset,
           wide_master_asset_id = EXCLUDED.wide_master_asset_id,
           compact_master_asset_id = EXCLUDED.compact_master_asset_id,
           wide_display_asset_id = EXCLUDED.wide_display_asset_id,
           compact_display_asset_id = EXCLUDED.compact_display_asset_id,
           wide_crop = EXCLUDED.wide_crop,
           compact_crop = EXCLUDED.compact_crop,
           wide_focus = EXCLUDED.wide_focus,
           compact_focus = EXCLUDED.compact_focus,
           active_fingerprint = EXCLUDED.active_fingerprint,
           last_published_at = EXCLUDED.last_published_at,
           admin_removed_at = NULL, admin_removed_by = NULL, admin_removal_reason = NULL,
           updated_at = EXCLUDED.updated_at`,
        [
          input.userId,
          nextVersion,
          input.wideMode,
          input.compactMode,
          input.wideSolidPreset,
          input.compactSolidPreset,
          prepared.wideMaster?.id ?? null,
          prepared.compactMaster?.id ?? null,
          prepared.wideDisplay?.id ?? null,
          prepared.compactDisplay?.id ?? null,
          input.wide ? JSON.stringify(input.wide.crop) : null,
          input.compact ? JSON.stringify(input.compact.crop) : null,
          input.wide ? JSON.stringify(input.wide.focus) : null,
          input.compact ? JSON.stringify(input.compact.focus) : null,
          prepared.activeFingerprint,
          now,
        ]
      );

      const activeIds = new Set(
        [
          prepared.wideMaster?.id,
          prepared.compactMaster?.id,
          prepared.wideDisplay?.id,
          prepared.compactDisplay?.id,
        ].filter((id): id is string => !!id)
      );
      await retireAssets(
        client,
        referencedAssetIds(current).filter((id) => !activeIds.has(id)),
        now
      );

      const wallpaper = buildPreparedView(input, prepared, nextVersion, now);
      const result = { wallpaper, changed: true } satisfies PlayerWallpaperPublishResult;
      await completeIdempotencyWithClient(
        client,
        input.userId,
        input.idempotencyKey,
        result,
        nextVersion,
        now
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async commitNoopPublish(
    input: PublishPlayerWallpaperInput,
    original: ConfigRow | null,
    now: Date
  ): Promise<PlayerWallpaperPublishResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await lockWallpaperUser(client, input.userId);
      const current = await readConfigWithClient(client, input.userId, true);
      if (
        (current?.version ?? 0) !== input.expectedVersion ||
        (current?.active_fingerprint ?? DEFAULT_FINGERPRINT) !==
          (original?.active_fingerprint ?? DEFAULT_FINGERPRINT)
      ) {
        throw versionConflict();
      }
      const wallpaper = await this.buildView(
        current,
        true,
        !(await hasPublicationDay(client, input.userId, now)),
        now
      );
      const result = { wallpaper, changed: false } satisfies PlayerWallpaperPublishResult;
      await completeIdempotencyWithClient(
        client,
        input.userId,
        input.idempotencyKey,
        result,
        wallpaper.version,
        now
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async readConfig(userId: string): Promise<ConfigRow | null> {
    return readConfigWithClient(pool, userId, false);
  }

  private async readAssets(assetIds: readonly string[]): Promise<AssetRow[]> {
    if (assetIds.length === 0) return [];
    const { rows } = await pool.query<AssetRow>(
      `SELECT id, user_id, kind, object_key, width, height, byte_size, sha256
         FROM player_wallpaper_assets
        WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [assetIds]
    );
    return rows;
  }

  private async buildView(
    configRow: ConfigRow | null,
    includeSources: boolean,
    canPublishToday: boolean,
    now: Date
  ): Promise<PlayerWallpaperView> {
    if (!configRow) {
      return defaultView(0, canPublishToday, now, null);
    }
    const assets = await this.readAssets(referencedAssetIds(configRow));
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const wideFocus = configRow.wide_focus ?? { x: 0.5, y: 0.5 };
    const compactFocus = configRow.compact_focus ?? { x: 0.5, y: 0.5 };
    return {
      version: configRow.version,
      wideMode: configRow.wide_mode,
      compactMode: configRow.compact_mode,
      wideSolidPreset: configRow.wide_solid_preset,
      compactSolidPreset: configRow.compact_solid_preset,
      wide: assetView(
        byId.get(configRow.wide_display_asset_id ?? ''),
        configRow.wide_crop,
        wideFocus
      ),
      compact: assetView(
        byId.get(configRow.compact_display_asset_id ?? ''),
        configRow.compact_crop,
        compactFocus
      ),
      wideSource: includeSources
        ? assetView(byId.get(configRow.wide_master_asset_id ?? ''), configRow.wide_crop, wideFocus)
        : null,
      compactSource: includeSources
        ? assetView(
            byId.get(configRow.compact_master_asset_id ?? ''),
            configRow.compact_crop,
            compactFocus
          )
        : null,
      canPublishToday,
      nextChangeAt: canPublishToday ? null : nextShanghaiMidnight(now).toISOString(),
      lastPublishedAt: configRow.last_published_at?.toISOString() ?? null,
    };
  }

  private async readDailyQuota(
    userId: string,
    now: Date
  ): Promise<{
    canPublishToday: boolean;
    nextChangeAt: Date;
  }> {
    const result = await pool.query(
      `SELECT 1 FROM player_wallpaper_publication_days
        WHERE user_id = $1 AND publish_day = $2`,
      [userId, shanghaiDay(now)]
    );
    return { canPublishToday: result.rowCount === 0, nextChangeAt: nextShanghaiMidnight(now) };
  }

  private async reserveIdempotency(
    userId: string,
    key: string,
    operation: 'PUBLISH' | 'RESET',
    fingerprint: string,
    now: Date
  ): Promise<PlayerWallpaperPublishResult | null> {
    const { rows } = await pool.query<IdempotencyRow>(
      `INSERT INTO player_wallpaper_idempotency (
         user_id, idempotency_key, operation, request_fingerprint,
         status, expires_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'PROCESSING', $5, $6, $6)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING operation, request_fingerprint, status, result, error_code`,
      [
        userId,
        key,
        operation,
        fingerprint,
        new Date(nextShanghaiMidnight(now).getTime() + 24 * 60 * 60 * 1000),
        now,
      ]
    );
    if (rows.length > 0) return null;

    const existingResult = await pool.query<IdempotencyRow>(
      `SELECT operation, request_fingerprint, status, result, error_code
         FROM player_wallpaper_idempotency
        WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, key]
    );
    const existing = existingResult.rows[0];
    if (
      !existing ||
      existing.operation !== operation ||
      existing.request_fingerprint !== fingerprint
    ) {
      throw new PlayerWallpaperServiceError(
        'WALLPAPER_IDEMPOTENCY_CONFLICT',
        '本次保存标识已用于其他壁纸内容，请重新提交。',
        409
      );
    }
    if (existing.status === 'SUCCEEDED' && existing.result) {
      return existing.result;
    }
    if (existing.status === 'PROCESSING') {
      throw new PlayerWallpaperServiceError(
        'WALLPAPER_REQUEST_IN_PROGRESS',
        '壁纸正在保存，请稍后查看结果。',
        409,
        1000
      );
    }
    throw new PlayerWallpaperServiceError(
      existing.error_code ?? 'WALLPAPER_PREVIOUS_REQUEST_FAILED',
      '这次壁纸保存没有成功，请重新选择图片后再试。',
      409
    );
  }

  private async failIdempotency(userId: string, key: string, errorCode: string): Promise<void> {
    try {
      await pool.query(
        `UPDATE player_wallpaper_idempotency
            SET status = 'FAILED', error_code = $3, updated_at = now()
          WHERE user_id = $1 AND idempotency_key = $2 AND status = 'PROCESSING'`,
        [userId, key, errorCode]
      );
    } catch (error) {
      console.error('Failed to persist wallpaper idempotency failure', {
        userId,
        errorCode,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async compensateUploadedObjects(objectKeys: readonly string[]): Promise<void> {
    if (objectKeys.length === 0) return;
    try {
      await deleteWallpaperObjects(objectKeys);
    } catch (error) {
      console.error('Failed to compensate unreferenced wallpaper objects', {
        count: objectKeys.length,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }
}

function validatePublishShape(input: PublishPlayerWallpaperInput): void {
  if (input.wideMode === 'CUSTOM') {
    if (!input.wide) {
      throw new PlayerWallpaperServiceError('WALLPAPER_WIDE_REQUIRED', '请设置 PC 壁纸。', 400);
    }
    if (input.wideSolidPreset !== null) throw invalidWallpaperState('PC 壁纸状态无效。');
  } else if (input.wideMode === 'SOLID') {
    if (!isPlayerWallpaperSolidPreset(input.wideSolidPreset) || input.wide) {
      throw invalidWallpaperState('请选择有效的 PC 纯色壁纸。');
    }
  } else if (input.wideSolidPreset !== null || input.wide) {
    throw invalidWallpaperState('PC 壁纸状态无效。');
  }

  if (input.compactMode === 'CUSTOM') {
    if (!input.compact) {
      throw new PlayerWallpaperServiceError('WALLPAPER_COMPACT_REQUIRED', '请设置手机壁纸。', 400);
    }
    if (input.compactSolidPreset !== null) throw invalidWallpaperState('手机壁纸状态无效。');
  } else if (input.compactMode === 'SOLID') {
    if (!isPlayerWallpaperSolidPreset(input.compactSolidPreset) || input.compact) {
      throw invalidWallpaperState('请选择有效的手机纯色壁纸。');
    }
  } else {
    if (input.compactSolidPreset !== null) throw invalidWallpaperState('手机壁纸状态无效。');
    if (input.wideMode === 'CUSTOM' && !input.compact) {
      throw new PlayerWallpaperServiceError(
        'WALLPAPER_COMPACT_CROP_REQUIRED',
        '请确认手机端的壁纸位置。',
        400
      );
    }
    if (input.wideMode !== 'CUSTOM' && input.compact) {
      throw invalidWallpaperState('手机壁纸状态无效。');
    }
  }
  if (input.wideMode !== 'CUSTOM' && input.wideUpload) {
    throw invalidWallpaperState('PC 壁纸状态无效。');
  }
  if (input.compactMode !== 'CUSTOM' && input.compactUpload) {
    throw invalidWallpaperState('手机壁纸状态无效。');
  }
  if (input.wide) validateWallpaperFocus(input.wide.focus);
  if (input.compact) validateWallpaperFocus(input.compact.focus);
  if (input.wideUpload && input.wideUpload.length > config.playerWallpaper.maxInputBytes) {
    throw fileTooLarge();
  }
  if (input.compactUpload && input.compactUpload.length > config.playerWallpaper.maxInputBytes) {
    throw fileTooLarge();
  }
}

function invalidWallpaperState(message: string): PlayerWallpaperServiceError {
  return new PlayerWallpaperServiceError('WALLPAPER_INVALID_STATE', message, 400);
}

function buildPreparedView(
  input: PublishPlayerWallpaperInput,
  prepared: PreparedConfiguration,
  version: number,
  now: Date
): PlayerWallpaperView {
  return {
    version,
    wideMode: input.wideMode,
    compactMode: input.compactMode,
    wideSolidPreset: input.wideSolidPreset,
    compactSolidPreset: input.compactSolidPreset,
    wide: assetView(
      prepared.wideDisplay,
      input.wide?.crop ?? null,
      input.wide?.focus ?? { x: 0.5, y: 0.5 }
    ),
    compact: assetView(
      prepared.compactDisplay,
      input.compact?.crop ?? null,
      input.compact?.focus ?? { x: 0.5, y: 0.5 }
    ),
    wideSource: assetView(
      prepared.wideMaster,
      input.wide?.crop ?? null,
      input.wide?.focus ?? { x: 0.5, y: 0.5 }
    ),
    compactSource: assetView(
      prepared.compactMaster,
      input.compact?.crop ?? null,
      input.compact?.focus ?? { x: 0.5, y: 0.5 }
    ),
    canPublishToday: false,
    nextChangeAt: nextShanghaiMidnight(now).toISOString(),
    lastPublishedAt: now.toISOString(),
  };
}

function defaultView(
  version: number,
  canPublishToday: boolean,
  now: Date,
  lastPublishedAt: Date | null
): PlayerWallpaperView {
  return {
    version,
    wideMode: 'DEFAULT',
    compactMode: 'INHERIT_PC',
    wideSolidPreset: null,
    compactSolidPreset: null,
    wide: null,
    compact: null,
    wideSource: null,
    compactSource: null,
    canPublishToday,
    nextChangeAt: canPublishToday ? null : nextShanghaiMidnight(now).toISOString(),
    lastPublishedAt: lastPublishedAt?.toISOString() ?? null,
  };
}

function assetView(
  asset: AssetRow | undefined | null,
  crop: WallpaperCrop | null,
  focus: WallpaperFocus
): PlayerWallpaperAssetView | null {
  if (!asset) return null;
  return {
    id: asset.id,
    url: `${PRIVATE_ASSET_BASE_PATH}/${asset.id}`,
    width: asset.width,
    height: asset.height,
    bytes: asset.byte_size,
    crop,
    focus,
  };
}

function createPendingAsset(
  userId: string,
  kind: AssetKind,
  objectName: 'master' | 'wide' | 'compact',
  image: ProcessedWallpaperImage
): PendingAsset {
  const pathId = randomUUID();
  return {
    id: randomUUID(),
    user_id: userId,
    kind,
    object_key: `wallpapers/${pathId}/${objectName}.webp`,
    width: image.width,
    height: image.height,
    byte_size: image.buffer.length,
    sha256: sha256(image.buffer),
    buffer: image.buffer,
  };
}

async function readConfigWithClient(
  client: Pick<PoolClient, 'query'>,
  userId: string,
  forUpdate: boolean
): Promise<ConfigRow | null> {
  const { rows } = await client.query<ConfigRow>(
    `SELECT user_id, version, wide_mode, compact_mode,
            wide_solid_preset, compact_solid_preset,
            wide_master_asset_id, compact_master_asset_id,
            wide_display_asset_id, compact_display_asset_id,
            wide_crop, compact_crop, wide_focus, compact_focus,
            active_fingerprint, last_published_at
       FROM player_wallpaper_configs
      WHERE user_id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [userId]
  );
  return rows[0] ?? null;
}

async function lockWallpaperUser(client: PoolClient, userId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
}

async function retireAssets(
  client: PoolClient,
  assetIds: readonly string[],
  now: Date
): Promise<void> {
  if (assetIds.length === 0) return;
  await client.query(
    `UPDATE player_wallpaper_assets
        SET retired_at = COALESCE(retired_at, $2)
      WHERE id = ANY($1::uuid[])`,
    [assetIds, now]
  );
}

async function hasPublicationDay(client: PoolClient, userId: string, now: Date): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM player_wallpaper_publication_days
      WHERE user_id = $1 AND publish_day = $2`,
    [userId, shanghaiDay(now)]
  );
  return (result.rowCount ?? 0) > 0;
}

async function completeIdempotencyWithClient(
  client: PoolClient,
  userId: string,
  key: string,
  result: PlayerWallpaperPublishResult,
  configVersion: number,
  now: Date
): Promise<void> {
  await client.query(
    `UPDATE player_wallpaper_idempotency
        SET status = 'SUCCEEDED', result = $3::jsonb, config_version = $4,
            error_code = NULL, updated_at = $5
      WHERE user_id = $1 AND idempotency_key = $2`,
    [userId, key, JSON.stringify(result), configVersion, now]
  );
}

function referencedAssetIds(configRow: ConfigRow | null): string[] {
  if (!configRow) return [];
  return [
    configRow.wide_master_asset_id,
    configRow.compact_master_asset_id,
    configRow.wide_display_asset_id,
    configRow.compact_display_asset_id,
  ].filter((id, index, ids): id is string => !!id && ids.indexOf(id) === index);
}

function hasNonDefaultWallpaper(configRow: ConfigRow | null): boolean {
  return (
    !!configRow && (configRow.wide_mode !== 'DEFAULT' || configRow.compact_mode !== 'INHERIT_PC')
  );
}

function buildRequestFingerprint(input: PublishPlayerWallpaperInput): string {
  return sha256(
    Buffer.from(
      stableJson({
        expectedVersion: input.expectedVersion,
        wideMode: input.wideMode,
        compactMode: input.compactMode,
        wideSolidPreset: input.wideSolidPreset,
        compactSolidPreset: input.compactSolidPreset,
        wide: input.wide,
        compact: input.compact,
        wideUpload: input.wideUpload ? sha256(input.wideUpload) : null,
        compactUpload: input.compactUpload ? sha256(input.compactUpload) : null,
      })
    )
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function shanghaiDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function nextShanghaiMidnight(now: Date): Date {
  const [year, month, day] = shanghaiDay(now).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, -8, 0, 0, 0));
}

function versionConflict(): PlayerWallpaperServiceError {
  return new PlayerWallpaperServiceError(
    'WALLPAPER_VERSION_CONFLICT',
    '壁纸已在另一页面更新，请重新载入后再编辑。',
    409
  );
}

function dailyLimit(nextChangeAt: Date, now: Date): PlayerWallpaperServiceError {
  return new PlayerWallpaperServiceError(
    'WALLPAPER_DAILY_LIMIT',
    '今天已经保存过壁纸，明天 00:00 后可以再次更换。',
    429,
    Math.max(0, nextChangeAt.getTime() - now.getTime()),
    nextChangeAt.toISOString()
  );
}

function fileTooLarge(): PlayerWallpaperServiceError {
  return new PlayerWallpaperServiceError(
    'WALLPAPER_FILE_TOO_LARGE',
    '图片不能超过 8 MB，请压缩后重新选择。',
    413
  );
}

function normalizeServiceError(error: unknown): PlayerWallpaperServiceError {
  if (error instanceof PlayerWallpaperServiceError) return error;
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (typeof candidate.code === 'string' && candidate.code.startsWith('WALLPAPER_')) {
      return new PlayerWallpaperServiceError(
        candidate.code,
        String(candidate.message),
        candidate.code.includes('TOO_LARGE') ? 413 : 400
      );
    }
  }
  console.error('Player wallpaper service failed', {
    errorType: error instanceof Error ? error.name : typeof error,
    errorCode:
      error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined,
  });
  return new PlayerWallpaperServiceError(
    'WALLPAPER_STORAGE_FAILED',
    '壁纸暂时无法保存，当前游戏桌没有改变，请稍后重试。',
    503
  );
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '23505';
}

async function streamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new PlayerWallpaperServiceError(
        'WALLPAPER_CURRENT_SOURCE_UNAVAILABLE',
        '当前源图已不可用，请重新选择图片。',
        409
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export const playerWallpaperService = new PlayerWallpaperService();
