import type { ActivityBadgeActivityType } from './activity-badge-types.js';

export interface PlayerBadgeSourceActivityView {
  readonly type: ActivityBadgeActivityType;
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface PlayerBadgeView {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly imageUrl: string;
  readonly awardedAt: number;
  readonly sourceActivity: PlayerBadgeSourceActivityView;
}
