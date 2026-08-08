import type { HeartIcon } from '@game/domain/entities/card';
import { HeartColor } from '@game/shared/types/enums';

export interface HeartCountRange {
  readonly min: number | null;
  readonly max: number | null;
}

export type HeartRangeFilters = Partial<Record<HeartColor, HeartCountRange>>;
export type HeartRangeBoundary = keyof HeartCountRange;

export const DEFAULT_HEART_COUNT_RANGE: HeartCountRange = { min: 1, max: null };

function normalizeBoundary(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

export function toggleHeartRangeFilter(
  filters: HeartRangeFilters,
  color: HeartColor
): HeartRangeFilters {
  if (!filters[color]) {
    return { ...filters, [color]: DEFAULT_HEART_COUNT_RANGE };
  }

  const next = { ...filters };
  delete next[color];
  return next;
}

export function updateHeartRangeBoundary(
  filters: HeartRangeFilters,
  color: HeartColor,
  boundary: HeartRangeBoundary,
  value: number | null
): HeartRangeFilters {
  const current = filters[color] ?? DEFAULT_HEART_COUNT_RANGE;
  const normalizedValue = normalizeBoundary(value);
  let min = boundary === 'min' ? normalizedValue : current.min;
  let max = boundary === 'max' ? normalizedValue : current.max;

  if (min !== null && max !== null && min > max) {
    if (boundary === 'min') {
      max = min;
    } else {
      min = max;
    }
  }

  return { ...filters, [color]: { min, max } };
}

export function matchesHeartCountRange(count: number, range: HeartCountRange): boolean {
  if (range.min !== null && count < range.min) return false;
  if (range.max !== null && count > range.max) return false;
  return true;
}

export function countMemberHearts(hearts: readonly HeartIcon[], color: HeartColor): number {
  return hearts.reduce((total, heart) => {
    return heart.color === color ? total + heart.count : total;
  }, 0);
}

export function countRequirementHearts(
  colorRequirements: ReadonlyMap<HeartColor, number>,
  color: HeartColor
): number {
  if (color === HeartColor.RAINBOW) {
    return (
      (colorRequirements.get(HeartColor.RAINBOW) ?? 0) +
      (colorRequirements.get(HeartColor.GRAY) ?? 0)
    );
  }
  return colorRequirements.get(color) ?? 0;
}

function entries(filters: HeartRangeFilters): readonly [HeartColor, HeartCountRange][] {
  return Object.entries(filters) as [HeartColor, HeartCountRange][];
}

export function matchesMemberHeartRanges(
  hearts: readonly HeartIcon[],
  filters: HeartRangeFilters
): boolean {
  return entries(filters).every(([color, range]) => {
    return matchesHeartCountRange(countMemberHearts(hearts, color), range);
  });
}

export function matchesRequirementHeartRanges(
  colorRequirements: ReadonlyMap<HeartColor, number>,
  filters: HeartRangeFilters
): boolean {
  return entries(filters).every(([color, range]) => {
    return matchesHeartCountRange(countRequirementHearts(colorRequirements, color), range);
  });
}
