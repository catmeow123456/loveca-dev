import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PublicSiteMaintenanceStatus } from '../site-status.js';

export const PUBLIC_SITE_STATUS_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type PublicSiteAvailability = 'OPEN' | 'MAINTENANCE';
export type PublicSnapshotSyncStatus = 'SYNCED' | 'FAILED' | 'UNVERIFIED';

export interface PublicSiteStatusSnapshot {
  readonly schemaVersion: typeof PUBLIC_SITE_STATUS_SNAPSHOT_SCHEMA_VERSION;
  readonly availability: PublicSiteAvailability;
  readonly generatedAt: string;
  readonly maintenance: PublicSiteMaintenanceStatus | null;
}

export interface PublicSnapshotInspection {
  readonly status: PublicSnapshotSyncStatus;
  readonly availability: PublicSiteAvailability | null;
  readonly generatedAt: string | null;
  readonly error: string | null;
}

export class PublicSiteStatusSnapshotError extends Error {
  constructor(
    public readonly code:
      | 'SNAPSHOT_PATH_NOT_CONFIGURED'
      | 'SNAPSHOT_READ_FAILED'
      | 'SNAPSHOT_INVALID'
      | 'SNAPSHOT_WRITE_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'PublicSiteStatusSnapshotError';
  }
}

type EnvLike = Record<string, string | undefined>;

export class PublicSiteStatusSnapshotService {
  constructor(private readonly env: EnvLike = process.env) {}

  async write(
    availability: PublicSiteAvailability,
    maintenance: PublicSiteMaintenanceStatus | null,
    now: Date = new Date()
  ): Promise<PublicSiteStatusSnapshot> {
    const snapshotPath = this.requireSnapshotPath();
    const snapshot: PublicSiteStatusSnapshot = {
      schemaVersion: PUBLIC_SITE_STATUS_SNAPSHOT_SCHEMA_VERSION,
      availability,
      generatedAt: now.toISOString(),
      maintenance: availability === 'MAINTENANCE' ? requireMaintenance(maintenance) : null,
    };
    const temporaryPath = `${snapshotPath}.${randomUUID()}.tmp`;

    try {
      await mkdir(dirname(snapshotPath), { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o644,
        flag: 'wx',
      });
      await rename(temporaryPath, snapshotPath);
      return snapshot;
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new PublicSiteStatusSnapshotError(
        'SNAPSHOT_WRITE_FAILED',
        `公开维护快照写入失败：${readErrorMessage(error)}`
      );
    }
  }

  async inspect(): Promise<PublicSnapshotInspection> {
    let snapshotPath: string;
    try {
      snapshotPath = this.requireSnapshotPath();
    } catch (error) {
      return {
        status: 'UNVERIFIED',
        availability: null,
        generatedAt: null,
        error: readErrorMessage(error),
      };
    }

    try {
      const snapshot = parsePublicSiteStatusSnapshot(await readFile(snapshotPath, 'utf8'));
      return {
        status: 'SYNCED',
        availability: snapshot.availability,
        generatedAt: snapshot.generatedAt,
        error: null,
      };
    } catch (error) {
      return {
        status: 'FAILED',
        availability: null,
        generatedAt: null,
        error: readErrorMessage(error),
      };
    }
  }

  private requireSnapshotPath(): string {
    const snapshotPath = this.env.PUBLIC_SITE_STATUS_SNAPSHOT_PATH?.trim();
    if (!snapshotPath) {
      throw new PublicSiteStatusSnapshotError(
        'SNAPSHOT_PATH_NOT_CONFIGURED',
        '未配置 PUBLIC_SITE_STATUS_SNAPSHOT_PATH，不能安全切换整站维护状态'
      );
    }
    return snapshotPath;
  }
}

export function parsePublicSiteStatusSnapshot(raw: string): PublicSiteStatusSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new PublicSiteStatusSnapshotError('SNAPSHOT_INVALID', '公开维护快照不是合法 JSON');
  }

  if (!value || typeof value !== 'object') {
    throw new PublicSiteStatusSnapshotError('SNAPSHOT_INVALID', '公开维护快照缺少对象内容');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== PUBLIC_SITE_STATUS_SNAPSHOT_SCHEMA_VERSION) {
    throw new PublicSiteStatusSnapshotError('SNAPSHOT_INVALID', '公开维护快照版本不受支持');
  }
  if (record.availability !== 'OPEN' && record.availability !== 'MAINTENANCE') {
    throw new PublicSiteStatusSnapshotError('SNAPSHOT_INVALID', '公开维护快照状态非法');
  }
  if (typeof record.generatedAt !== 'string' || !Number.isFinite(Date.parse(record.generatedAt))) {
    throw new PublicSiteStatusSnapshotError('SNAPSHOT_INVALID', '公开维护快照时间非法');
  }

  const maintenance = parseMaintenance(record.maintenance);
  if (record.availability === 'MAINTENANCE' && !maintenance) {
    throw new PublicSiteStatusSnapshotError('SNAPSHOT_INVALID', '维护快照缺少维护说明');
  }
  if (record.availability === 'OPEN' && record.maintenance !== null) {
    throw new PublicSiteStatusSnapshotError('SNAPSHOT_INVALID', '开放快照不得包含维护说明');
  }

  return {
    schemaVersion: PUBLIC_SITE_STATUS_SNAPSHOT_SCHEMA_VERSION,
    availability: record.availability,
    generatedAt: record.generatedAt,
    maintenance,
  };
}

function parseMaintenance(value: unknown): PublicSiteMaintenanceStatus | null {
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== 'object') {
    throw new PublicSiteStatusSnapshotError('SNAPSHOT_INVALID', '维护说明结构非法');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== 'string' ||
    typeof record.title !== 'string' ||
    !record.title.trim() ||
    typeof record.summary !== 'string' ||
    !record.summary.trim() ||
    !Array.isArray(record.impactScopes) ||
    !Array.isArray(record.restrictions)
  ) {
    throw new PublicSiteStatusSnapshotError('SNAPSHOT_INVALID', '维护说明缺少必需字段');
  }

  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    detail: readNullableString(record.detail),
    startsAt: readNullableString(record.startsAt),
    estimatedEndsAt: readNullableString(record.estimatedEndsAt),
    restrictsNewGamesAt: readNullableString(record.restrictsNewGamesAt),
    impactScopes: readStringArray(record.impactScopes),
    restrictions: readStringArray(record.restrictions),
    action: readNullableString(record.action),
    updatedAt: readNullableString(record.updatedAt),
  };
}

function requireMaintenance(
  maintenance: PublicSiteMaintenanceStatus | null
): PublicSiteMaintenanceStatus {
  if (!maintenance) {
    throw new PublicSiteStatusSnapshotError(
      'SNAPSHOT_INVALID',
      '进入整站维护必须提供维护标题和摘要'
    );
  }
  return maintenance;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new PublicSiteStatusSnapshotError('SNAPSHOT_INVALID', '维护说明列表字段非法');
  }
  return value.map((item) => String(item));
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

export const publicSiteStatusSnapshotService = new PublicSiteStatusSnapshotService();
