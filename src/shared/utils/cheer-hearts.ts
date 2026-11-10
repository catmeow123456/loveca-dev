import { HeartColor } from '../types/enums.js';

/** Orange remains a marker identity but contributes one colorless cheer Heart. */
export function getCheerHeartContributionColor(color: HeartColor): HeartColor {
  return color === HeartColor.ORANGE ? HeartColor.GRAY : color;
}
