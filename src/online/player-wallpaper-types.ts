export const PLAYER_WALLPAPER_SOLID_PRESET_IDS = [
  'NIGHT_INK',
  'SAKURA',
  'OCEAN',
  'FOREST',
  'AMBER',
  'LILAC',
] as const;

export type PlayerWallpaperSolidPreset = (typeof PLAYER_WALLPAPER_SOLID_PRESET_IDS)[number];

export const PLAYER_WALLPAPER_SOLID_PRESETS = [
  { id: 'NIGHT_INK', label: '夜樱墨', color: '#211529' },
  { id: 'SAKURA', label: '樱莓', color: '#8f3d5d' },
  { id: 'OCEAN', label: '深海蓝', color: '#274260' },
  { id: 'FOREST', label: '森林绿', color: '#285448' },
  { id: 'AMBER', label: '琥珀', color: '#8a5a2b' },
  { id: 'LILAC', label: '藤紫', color: '#69527f' },
] as const satisfies ReadonlyArray<{
  readonly id: PlayerWallpaperSolidPreset;
  readonly label: string;
  readonly color: `#${string}`;
}>;
export type WideWallpaperMode = 'DEFAULT' | 'SOLID' | 'CUSTOM';
export type CompactWallpaperMode = 'INHERIT_PC' | 'SOLID' | 'CUSTOM';
export type WallpaperLayout = 'WIDE' | 'COMPACT';

export function isPlayerWallpaperSolidPreset(value: unknown): value is PlayerWallpaperSolidPreset {
  return PLAYER_WALLPAPER_SOLID_PRESETS.some((preset) => preset.id === value);
}

export function getPlayerWallpaperSolidColor(
  presetId: PlayerWallpaperSolidPreset | null
): string | null {
  return PLAYER_WALLPAPER_SOLID_PRESETS.find((preset) => preset.id === presetId)?.color ?? null;
}

export interface WallpaperCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WallpaperFocus {
  readonly x: number;
  readonly y: number;
}

export interface PlayerWallpaperAssetView {
  readonly id: string;
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly crop: WallpaperCrop | null;
  readonly focus: WallpaperFocus;
}

export interface PlayerWallpaperView {
  readonly version: number;
  readonly wideMode: WideWallpaperMode;
  readonly compactMode: CompactWallpaperMode;
  readonly wideSolidPreset: PlayerWallpaperSolidPreset | null;
  readonly compactSolidPreset: PlayerWallpaperSolidPreset | null;
  readonly wide: PlayerWallpaperAssetView | null;
  readonly compact: PlayerWallpaperAssetView | null;
  readonly wideSource: PlayerWallpaperAssetView | null;
  readonly compactSource: PlayerWallpaperAssetView | null;
  readonly canPublishToday: boolean;
  readonly nextChangeAt: string | null;
  readonly lastPublishedAt: string | null;
}

export interface PlayerWallpaperPublishResult {
  readonly wallpaper: PlayerWallpaperView;
  readonly changed: boolean;
}
