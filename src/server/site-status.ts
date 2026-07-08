export const SITE_STATUS_LIFECYCLES = [
  'NORMAL',
  'SCHEDULED',
  'RESTRICTING_NEW_GAMES',
  'MAINTENANCE',
  'COMPLETED',
  'POSTPONED',
  'CANCELLED',
] as const;

export type SiteStatusLifecycle = (typeof SITE_STATUS_LIFECYCLES)[number];

export const SITE_ANNOUNCEMENT_TYPES = ['MAINTENANCE', 'UPDATE', 'NEWS'] as const;

export type SiteAnnouncementType = (typeof SITE_ANNOUNCEMENT_TYPES)[number];

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
  generatedAt: string;
  maintenance: PublicSiteMaintenanceStatus | null;
  announcements: readonly PublicSiteAnnouncement[];
}

type EnvLike = Record<string, string | undefined>;

const LIFECYCLE_SET = new Set<string>(SITE_STATUS_LIFECYCLES);
const ANNOUNCEMENT_TYPE_SET = new Set<string>(SITE_ANNOUNCEMENT_TYPES);

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readCsv(value: unknown): readonly string[] {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return [];
  }

  return cleaned
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function readLifecycle(value: unknown): SiteStatusLifecycle {
  const cleaned = cleanString(value)?.toUpperCase();
  return cleaned && LIFECYCLE_SET.has(cleaned) ? (cleaned as SiteStatusLifecycle) : 'NORMAL';
}

function readAnnouncementType(value: unknown): SiteAnnouncementType | null {
  const raw = cleanString(value);
  if (!raw) {
    return 'UPDATE';
  }

  const cleaned = raw.toUpperCase();
  if (!cleaned) {
    return 'UPDATE';
  }

  if (ANNOUNCEMENT_TYPE_SET.has(cleaned)) {
    return cleaned as SiteAnnouncementType;
  }

  return null;
}

function readPriority(value: unknown): number {
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

function readAnnouncementsJson(value: unknown): readonly PublicSiteAnnouncement[] {
  const cleaned = cleanString(value);
  if (!cleaned) {
    return [];
  }

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item, index) => normalizeAnnouncement(item, index))
      .filter((announcement): announcement is PublicSiteAnnouncement => announcement !== null)
      .sort(compareAnnouncements);
  } catch {
    return [];
  }
}

function normalizeAnnouncement(item: unknown, index: number): PublicSiteAnnouncement | null {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const record = item as Record<string, unknown>;
  const title = cleanString(record.title);
  const summary = cleanString(record.summary);
  const type = readAnnouncementType(record.type);
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
    priority: readPriority(record.priority),
    impactScopes: Array.isArray(record.impactScopes)
      ? record.impactScopes.map(cleanString).filter((scope): scope is string => scope !== null)
      : readCsv(record.impactScopes),
  };
}

export function sortPublicSiteAnnouncements(
  announcements: readonly PublicSiteAnnouncement[]
): readonly PublicSiteAnnouncement[] {
  return [...announcements].sort(compareAnnouncements);
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

export function buildPublicSiteStatusFromEnv(
  env: EnvLike,
  now: Date = new Date()
): PublicSiteStatus {
  const lifecycle = readLifecycle(env.SITE_STATUS_LIFECYCLE);
  const title = cleanString(env.SITE_STATUS_TITLE);
  const summary = cleanString(env.SITE_STATUS_SUMMARY);
  const hasMaintenanceFields = Boolean(
    title ||
    summary ||
    cleanString(env.SITE_STATUS_DETAIL) ||
    cleanString(env.SITE_STATUS_START_AT) ||
    cleanString(env.SITE_STATUS_END_AT) ||
    cleanString(env.SITE_STATUS_RESTRICT_NEW_GAMES_AT)
  );
  const hasMaintenanceStatus = lifecycle !== 'NORMAL' || hasMaintenanceFields;

  return {
    lifecycle,
    generatedAt: now.toISOString(),
    maintenance: hasMaintenanceStatus
      ? {
          id: cleanString(env.SITE_STATUS_ID) ?? 'current-maintenance',
          title: title ?? defaultMaintenanceTitle(lifecycle),
          summary: summary ?? defaultMaintenanceSummary(lifecycle),
          detail: cleanString(env.SITE_STATUS_DETAIL),
          startsAt: cleanString(env.SITE_STATUS_START_AT),
          estimatedEndsAt: cleanString(env.SITE_STATUS_END_AT),
          restrictsNewGamesAt: cleanString(env.SITE_STATUS_RESTRICT_NEW_GAMES_AT),
          impactScopes: readCsv(env.SITE_STATUS_IMPACT_SCOPES),
          restrictions: readCsv(env.SITE_STATUS_RESTRICTIONS),
          action: cleanString(env.SITE_STATUS_ACTION),
          updatedAt: cleanString(env.SITE_STATUS_UPDATED_AT),
        }
      : null,
    announcements: readAnnouncementsJson(env.SITE_STATUS_ANNOUNCEMENTS_JSON),
  };
}

function defaultMaintenanceTitle(lifecycle: SiteStatusLifecycle): string {
  switch (lifecycle) {
    case 'SCHEDULED':
      return '计划维护';
    case 'RESTRICTING_NEW_GAMES':
      return '限制新开局';
    case 'MAINTENANCE':
      return '维护中';
    case 'COMPLETED':
      return '维护已完成';
    case 'POSTPONED':
      return '维护已延期';
    case 'CANCELLED':
      return '维护已取消';
    case 'NORMAL':
      return '站点状态';
  }
}

function defaultMaintenanceSummary(lifecycle: SiteStatusLifecycle): string {
  switch (lifecycle) {
    case 'SCHEDULED':
      return '已发布计划维护通知。';
    case 'RESTRICTING_NEW_GAMES':
      return '维护窗口临近，正在限制新的正式联机开局。';
    case 'MAINTENANCE':
      return '服务正在维护，部分功能可能暂不可用。';
    case 'COMPLETED':
      return '本次维护已完成。';
    case 'POSTPONED':
      return '本次维护已延期，后续时间以最新通知为准。';
    case 'CANCELLED':
      return '本次维护已取消。';
    case 'NORMAL':
      return '当前没有进行中的维护。';
  }
}
