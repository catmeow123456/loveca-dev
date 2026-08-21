export const SITE_STATUS_LIFECYCLES = ['NORMAL', 'RESTRICTING_NEW_GAMES', 'MAINTENANCE'] as const;

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
