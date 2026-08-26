export const ACTIVITY_COVER_ACTIVITY_TYPES = ['RANKED', 'THEME'] as const;
export const ACTIVITY_COVER_MASK_LEVELS = ['STANDARD', 'STRONG'] as const;

export type ActivityCoverActivityType = (typeof ACTIVITY_COVER_ACTIVITY_TYPES)[number];
export type ActivityCoverMaskLevel = (typeof ACTIVITY_COVER_MASK_LEVELS)[number];
export type ActivityCoverMode = 'DEFAULT' | 'CUSTOM';
export type ActivityCoverLayout = 'WIDE' | 'COMPACT';

export interface ActivityCoverCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ActivityCoverFocus {
  readonly x: number;
  readonly y: number;
}

export interface ActivityCoverAssetView {
  readonly url: string;
  readonly focus: ActivityCoverFocus;
}

export interface ActivityCoverPublicView {
  readonly mode: ActivityCoverMode;
  readonly revision: number;
  readonly maskLevel: ActivityCoverMaskLevel;
  readonly wide: ActivityCoverAssetView | null;
  readonly compact: ActivityCoverAssetView | null;
}

export interface ActivityCoverSourceView {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface ActivityCoverAdminView extends ActivityCoverPublicView {
  readonly activityType: ActivityCoverActivityType;
  readonly activityId: string;
  readonly source: ActivityCoverSourceView | null;
  readonly wideCrop: ActivityCoverCrop | null;
  readonly wideSourceFocus: ActivityCoverFocus | null;
  readonly compactCrop: ActivityCoverCrop | null;
  readonly compactSourceFocus: ActivityCoverFocus | null;
  readonly updatedAt: string | null;
}

export interface ActivityCoverSaveResult {
  readonly cover: ActivityCoverAdminView;
  readonly changed: boolean;
}
