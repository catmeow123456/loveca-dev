import { apiClient } from './apiClient';

export type SiteStatusLifecycle =
  | 'NORMAL'
  | 'SCHEDULED'
  | 'RESTRICTING_NEW_GAMES'
  | 'MAINTENANCE'
  | 'COMPLETED'
  | 'POSTPONED'
  | 'CANCELLED';

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
  };
  siteStatus: PublicSiteStatus;
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
  },
  siteStatus: DEFAULT_SITE_STATUS,
};

const SITE_STATUS_LIFECYCLES = new Set<string>([
  'NORMAL',
  'SCHEDULED',
  'RESTRICTING_NEW_GAMES',
  'MAINTENANCE',
  'COMPLETED',
  'POSTPONED',
  'CANCELLED',
]);

const SITE_ANNOUNCEMENT_TYPES = new Set<string>(['MAINTENANCE', 'UPDATE', 'NEWS']);

export function normalizeAppConfig(
  config: Partial<PublicAppConfig> | null | undefined
): PublicAppConfig {
  const email = config?.features?.email;

  return {
    features: {
      email: {
        enabled: email?.enabled === true,
        verificationRequired: email?.verificationRequired === true,
        passwordResetEnabled: email?.passwordResetEnabled === true,
      },
    },
    siteStatus: normalizeSiteStatus(config?.siteStatus),
  };
}

export async function loadPublicAppConfig(): Promise<PublicAppConfig> {
  const result = await apiClient.get<PublicAppConfig>('/api/config');

  if (!result.data) {
    if (result.error) {
      console.warn('[AppConfig] Failed to load public config:', result.error.message);
    }
    return {
      ...DEFAULT_APP_CONFIG,
      siteStatus: await loadStaticSiteStatusFallback(),
    };
  }

  return normalizeAppConfig(result.data);
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

async function loadStaticSiteStatusFallback(): Promise<PublicSiteStatus> {
  try {
    const response = await fetch('/site-status.json', { cache: 'no-store' });
    if (!response.ok) {
      return DEFAULT_SITE_STATUS;
    }

    const payload = (await response.json()) as unknown;
    if (payload && typeof payload === 'object' && 'siteStatus' in payload) {
      return normalizeSiteStatus((payload as { siteStatus?: unknown }).siteStatus);
    }

    return normalizeSiteStatus(payload);
  } catch {
    return DEFAULT_SITE_STATUS;
  }
}
