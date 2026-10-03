import { apiClient } from './apiClient';
import {
  DEFAULT_BATTLE_TIMEOUT_CONFIG,
  type BattleTimeoutConfig,
  type OnlineMatchEmoteCatalog,
  type OnlineMatchEmoteDefinition,
} from '@game/online';

export type SiteStatusLifecycle = 'NORMAL' | 'RESTRICTING_NEW_GAMES' | 'MAINTENANCE';

export type SiteAnnouncementType = 'MAINTENANCE' | 'UPDATE' | 'NEWS';

export interface PublicSiteMaintenanceStatus {
  id: string;
  title: string;
  summary: string;
  detail: string | null;
  startsAt: string | null;
  estimatedEndsAt: string | null;
  restrictsNewGamesAt: string | null;
  impactScopes: readonly string[];
  restrictions: readonly string[];
  action: string | null;
  updatedAt: string | null;
}

export interface PublicSiteAnnouncement {
  id: string;
  type: SiteAnnouncementType;
  title: string;
  summary: string;
  detail: string | null;
  publishedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  impactScopes: readonly string[];
}

export interface PublicSiteStatus {
  lifecycle: SiteStatusLifecycle;
  generatedAt: string | null;
  maintenance: PublicSiteMaintenanceStatus | null;
  announcements: readonly PublicSiteAnnouncement[];
}

export interface PublicAppConfig {
  features: {
    email: {
      enabled: boolean;
      verificationRequired: boolean;
      passwordResetEnabled: boolean;
    };
    battleEntries: PlayerBattleEntryVisibility;
    battleTimeouts: BattleTimeoutConfig;
  };
  siteStatus: PublicSiteStatus;
  matchEmotes: OnlineMatchEmoteCatalog | null;
}

export interface PlayerBattleEntryVisibility {
  readonly ranked: boolean;
  readonly themeTable: boolean;
}

const DEFAULT_SITE_STATUS: PublicSiteStatus = {
  lifecycle: 'NORMAL',
  generatedAt: null,
  maintenance: null,
  announcements: [],
};

export const DEFAULT_APP_CONFIG: PublicAppConfig = {
  features: {
    email: {
      enabled: false,
      verificationRequired: false,
      passwordResetEnabled: false,
    },
    battleEntries: {
      ranked: false,
      themeTable: false,
    },
    battleTimeouts: DEFAULT_BATTLE_TIMEOUT_CONFIG,
  },
  siteStatus: DEFAULT_SITE_STATUS,
  matchEmotes: null,
};

const SITE_STATUS_LIFECYCLES = new Set<string>(['NORMAL', 'RESTRICTING_NEW_GAMES', 'MAINTENANCE']);

const SITE_ANNOUNCEMENT_TYPES = new Set<string>(['MAINTENANCE', 'UPDATE', 'NEWS']);

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

export function normalizeAppConfig(
  config: Partial<PublicAppConfig> | null | undefined
): PublicAppConfig {
  const email = config?.features?.email;
  const battleEntries = config?.features?.battleEntries;
  const battleTimeouts = config?.features?.battleTimeouts;

  return {
    features: {
      email: {
        enabled: email?.enabled === true,
        verificationRequired: email?.verificationRequired === true,
        passwordResetEnabled: email?.passwordResetEnabled === true,
      },
      battleEntries: {
        ranked: battleEntries?.ranked === true,
        themeTable: battleEntries?.themeTable === true,
      },
      battleTimeouts: {
        playerActionTimeoutSeconds: normalizePositiveInteger(
          battleTimeouts?.playerActionTimeoutSeconds,
          DEFAULT_BATTLE_TIMEOUT_CONFIG.playerActionTimeoutSeconds
        ),
        reconnectGracePeriodSeconds: normalizePositiveInteger(
          battleTimeouts?.reconnectGracePeriodSeconds,
          DEFAULT_BATTLE_TIMEOUT_CONFIG.reconnectGracePeriodSeconds
        ),
      },
    },
    siteStatus: normalizeSiteStatus(config?.siteStatus),
    matchEmotes: normalizeMatchEmoteCatalog(config?.matchEmotes),
  };
}

export async function loadPublicAppConfig(): Promise<PublicAppConfig> {
  const result = await apiClient.get<PublicAppConfig>('/api/config');

  if (!result.data) {
    const errorMessage = result.error?.message ?? '公开配置响应缺少 data';
    throw new Error(errorMessage);
  }

  if (!hasValidPlatformStatus(result.data.siteStatus)) {
    throw new Error('公开配置中的平台状态无效');
  }

  return normalizeAppConfig(result.data);
}

function hasValidPlatformStatus(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.lifecycle !== 'string' ||
    !SITE_STATUS_LIFECYCLES.has(record.lifecycle) ||
    typeof record.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.generatedAt))
  ) {
    return false;
  }
  const normalized = normalizeSiteStatus(value);
  return record.lifecycle === 'NORMAL'
    ? record.maintenance === null
    : normalized.maintenance !== null;
}

export async function refreshPublicAppConfigStrict(): Promise<PublicAppConfig | null> {
  try {
    return await loadPublicAppConfig();
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[AppConfig] Background public config refresh failed:', error);
    }
    return null;
  }
}

export function buildPublicAppConfigRenderKey(config: PublicAppConfig): string {
  const normalized = normalizeAppConfig(config);
  return JSON.stringify({
    features: {
      email: {
        enabled: normalized.features.email.enabled,
        verificationRequired: normalized.features.email.verificationRequired,
        passwordResetEnabled: normalized.features.email.passwordResetEnabled,
      },
      battleEntries: normalized.features.battleEntries,
      battleTimeouts: normalized.features.battleTimeouts,
    },
    siteStatus: {
      lifecycle: normalized.siteStatus.lifecycle,
      maintenance: normalized.siteStatus.maintenance
        ? buildMaintenanceFingerprint(normalized.siteStatus.maintenance)
        : null,
      announcements: normalized.siteStatus.announcements.map((announcement) => ({
        id: announcement.id,
        type: announcement.type,
        title: announcement.title,
        summary: announcement.summary,
        detail: announcement.detail,
        publishedAt: announcement.publishedAt,
        startsAt: announcement.startsAt,
        endsAt: announcement.endsAt,
        priority: announcement.priority,
        impactScopes: announcement.impactScopes,
      })),
    },
    matchEmotes: normalized.matchEmotes,
  });
}

function normalizeMatchEmoteCatalog(value: unknown): OnlineMatchEmoteCatalog | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as { version?: unknown; items?: unknown };
  if (typeof candidate.version !== 'string' || !Array.isArray(candidate.items)) {
    return null;
  }
  const items: OnlineMatchEmoteDefinition[] = [];
  for (const rawItem of candidate.items) {
    if (!rawItem || typeof rawItem !== 'object') {
      return null;
    }
    const item = rawItem as Record<string, unknown>;
    if (
      typeof item.id !== 'string' ||
      typeof item.label !== 'string' ||
      typeof item.shortLabel !== 'string' ||
      typeof item.staticImageUrl !== 'string' ||
      !isSafeEmoteImageUrl(item.staticImageUrl) ||
      (item.animatedImageUrl !== null &&
        (typeof item.animatedImageUrl !== 'string' ||
          !isSafeEmoteImageUrl(item.animatedImageUrl))) ||
      typeof item.assetRevision !== 'string'
    ) {
      return null;
    }
    items.push({
      id: item.id,
      label: item.label,
      shortLabel: item.shortLabel,
      staticImageUrl: item.staticImageUrl,
      animatedImageUrl: item.animatedImageUrl,
      assetRevision: item.assetRevision,
    });
  }
  return { version: candidate.version, items };
}

function isSafeEmoteImageUrl(value: string): boolean {
  return /^\/images\/emotes\/[0-9a-f]{64}\.webp$/u.test(value);
}

export function buildAnnouncementUnreadKey(siteStatus: PublicSiteStatus): string | null {
  const normalized = normalizeSiteStatus(siteStatus);
  const maintenance = normalized.maintenance
    ? {
        lifecycle: normalized.lifecycle,
        ...buildMaintenanceFingerprint(normalized.maintenance),
      }
    : null;
  const announcements = normalized.announcements
    .map((announcement) => ({
      id: announcement.id,
      type: announcement.type,
      title: announcement.title,
      summary: announcement.summary,
      detail: announcement.detail,
      publishedAt: announcement.publishedAt,
      startsAt: announcement.startsAt,
      endsAt: announcement.endsAt,
      impactScopes: announcement.impactScopes,
    }))
    .sort(compareAnnouncementUnreadEntries);

  if (!maintenance && announcements.length === 0) {
    return null;
  }

  return JSON.stringify({ maintenance, announcements });
}

function buildMaintenanceFingerprint(maintenance: PublicSiteMaintenanceStatus) {
  return {
    id: maintenance.id,
    title: maintenance.title,
    summary: maintenance.summary,
    detail: maintenance.detail,
    startsAt: maintenance.startsAt,
    estimatedEndsAt: maintenance.estimatedEndsAt,
    restrictsNewGamesAt: maintenance.restrictsNewGamesAt,
    impactScopes: maintenance.impactScopes,
    restrictions: maintenance.restrictions,
    action: maintenance.action,
    updatedAt: maintenance.updatedAt,
  };
}

type AnnouncementUnreadEntry = {
  id: string;
  type: SiteAnnouncementType;
  title: string;
  summary: string;
  detail: string | null;
  publishedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  impactScopes: readonly string[];
};

function compareAnnouncementUnreadEntries(
  left: AnnouncementUnreadEntry,
  right: AnnouncementUnreadEntry
): number {
  return `${left.id}\u0000${left.type}`.localeCompare(`${right.id}\u0000${right.type}`);
}

function normalizeSiteStatus(value: unknown): PublicSiteStatus {
  if (!value || typeof value !== 'object') {
    return DEFAULT_SITE_STATUS;
  }

  const record = value as Record<string, unknown>;
  const lifecycle = normalizeLifecycle(record.lifecycle);
  const announcements = Array.isArray(record.announcements)
    ? record.announcements
        .map((announcement, index) => normalizeAnnouncement(announcement, index))
        .filter((announcement): announcement is PublicSiteAnnouncement => announcement !== null)
        .sort(compareAnnouncements)
    : [];

  return {
    lifecycle,
    generatedAt: cleanString(record.generatedAt),
    maintenance: normalizeMaintenance(record.maintenance, lifecycle),
    announcements,
  };
}

function normalizeMaintenance(
  value: unknown,
  lifecycle: SiteStatusLifecycle
): PublicSiteMaintenanceStatus | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = cleanString(record.title);
  const summary = cleanString(record.summary);
  if (!title || !summary) {
    return null;
  }

  return {
    id: cleanString(record.id) ?? `maintenance-${lifecycle.toLowerCase()}`,
    title,
    summary,
    detail: cleanString(record.detail),
    startsAt: cleanString(record.startsAt),
    estimatedEndsAt: cleanString(record.estimatedEndsAt),
    restrictsNewGamesAt: cleanString(record.restrictsNewGamesAt),
    impactScopes: normalizeStringArray(record.impactScopes),
    restrictions: normalizeStringArray(record.restrictions),
    action: cleanString(record.action),
    updatedAt: cleanString(record.updatedAt),
  };
}

function normalizeAnnouncement(value: unknown, index: number): PublicSiteAnnouncement | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const title = cleanString(record.title);
  const summary = cleanString(record.summary);
  const type = normalizeAnnouncementType(record.type);
  if (!title || !summary || !type) {
    return null;
  }

  return {
    id: cleanString(record.id) ?? `announcement-${index + 1}`,
    type,
    title,
    summary,
    detail: cleanString(record.detail),
    publishedAt: cleanString(record.publishedAt),
    startsAt: cleanString(record.startsAt),
    endsAt: cleanString(record.endsAt),
    priority: normalizePriority(record.priority),
    impactScopes: normalizeStringArray(record.impactScopes),
  };
}

function normalizeLifecycle(value: unknown): SiteStatusLifecycle {
  const cleaned = cleanString(value)?.toUpperCase();
  return cleaned && SITE_STATUS_LIFECYCLES.has(cleaned)
    ? (cleaned as SiteStatusLifecycle)
    : 'NORMAL';
}

function normalizeAnnouncementType(value: unknown): SiteAnnouncementType | null {
  const raw = cleanString(value);
  if (!raw) {
    return 'UPDATE';
  }

  const cleaned = raw.toUpperCase();
  if (SITE_ANNOUNCEMENT_TYPES.has(cleaned)) {
    return cleaned as SiteAnnouncementType;
  }

  return null;
}

function normalizePriority(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const cleaned = cleanString(value);
  if (!cleaned) {
    return 0;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStringArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter((item): item is string => item !== null);
  }

  const cleaned = cleanString(value);
  return cleaned
    ? cleaned
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compareAnnouncements(left: PublicSiteAnnouncement, right: PublicSiteAnnouncement): number {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }

  return readSortableTime(right) - readSortableTime(left);
}

function readSortableTime(announcement: PublicSiteAnnouncement): number {
  const raw = announcement.publishedAt ?? announcement.startsAt ?? announcement.endsAt;
  if (!raw) {
    return 0;
  }

  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
