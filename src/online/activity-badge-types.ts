export const ACTIVITY_BADGE_ACTIVITY_TYPES = ['RANKED', 'THEME'] as const;

export type ActivityBadgeActivityType = (typeof ACTIVITY_BADGE_ACTIVITY_TYPES)[number];

export interface ActivityBadgePublicView {
  readonly imageUrl: string;
  readonly revision: number;
  readonly minimumCompletedMatchCount: number;
}

export interface ActivityBadgeAdminView {
  readonly activityType: ActivityBadgeActivityType;
  readonly activityId: string;
  readonly activityName: string;
  readonly badge: ActivityBadgePublicView | null;
  readonly updatedAt: string | null;
}

export interface ActivityBadgeSaveResult {
  readonly badge: ActivityBadgeAdminView;
  readonly changed: boolean;
  readonly awardedPlayerCount: number;
}
