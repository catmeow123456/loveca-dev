export type LovecaSyncHeartColor =
  'PINK' | 'RED' | 'YELLOW' | 'GREEN' | 'BLUE' | 'PURPLE' | 'ORANGE' | 'GRAY' | 'RAINBOW';

export const LOVECA_SYNC_HEART_COLOR_MAP: Readonly<
  Record<string, Exclude<LovecaSyncHeartColor, 'RAINBOW'>>
> = {
  pink: 'PINK',
  red: 'RED',
  yellow: 'YELLOW',
  green: 'GREEN',
  blue: 'BLUE',
  purple: 'PURPLE',
  orange: 'ORANGE',
  gray: 'GRAY',
  grey: 'GRAY',
  colorless: 'GRAY',
};

export const LOVECA_SYNC_RAINBOW_HEART_TOKENS: ReadonlySet<string> = new Set(['any', 'all']);

export const LOVECA_SYNC_BLADE_HEART_COLOR_MAP: Readonly<Record<string, LovecaSyncHeartColor>> = {
  ...LOVECA_SYNC_HEART_COLOR_MAP,
  all: 'RAINBOW',
};
