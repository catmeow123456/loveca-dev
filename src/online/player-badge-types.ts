export interface PlayerBadgeSourceSeasonView {
  readonly id: string;
  readonly seasonKey: string;
  readonly name: string;
}

export interface PlayerBadgeView {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly imagePath: string;
  readonly awardedAt: number;
  readonly sourceSeason: PlayerBadgeSourceSeasonView | null;
}
