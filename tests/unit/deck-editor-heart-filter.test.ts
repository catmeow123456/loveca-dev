import { describe, expect, it } from 'vitest';
import {
  countMemberHearts,
  countRequirementHearts,
  matchesMemberHeartRanges,
  matchesRequirementHeartRanges,
  toggleHeartRangeFilter,
  updateHeartRangeBoundary,
  type HeartRangeFilters,
} from '../../client/src/components/deck-editor/heart-range-filter';
import { HeartColor } from '../../src/shared/types/enums';

describe('deck editor Heart range filters', () => {
  it('requires every selected member Heart color to match', () => {
    const hearts = [
      { color: HeartColor.PINK, count: 2 },
      { color: HeartColor.YELLOW, count: 1 },
    ];

    expect(
      matchesMemberHeartRanges(hearts, {
        [HeartColor.PINK]: { min: 2, max: null },
        [HeartColor.YELLOW]: { min: 1, max: 1 },
      })
    ).toBe(true);
    expect(
      matchesMemberHeartRanges(hearts, {
        [HeartColor.PINK]: { min: 2, max: null },
        [HeartColor.BLUE]: { min: 1, max: null },
      })
    ).toBe(false);
  });

  it('supports minimum, maximum, exact and zero-count exclusion ranges', () => {
    const hearts = [{ color: HeartColor.PINK, count: 2 }];

    expect(matchesMemberHeartRanges(hearts, { [HeartColor.PINK]: { min: 1, max: null } })).toBe(
      true
    );
    expect(matchesMemberHeartRanges(hearts, { [HeartColor.PINK]: { min: null, max: 1 } })).toBe(
      false
    );
    expect(matchesMemberHeartRanges(hearts, { [HeartColor.PINK]: { min: 2, max: 2 } })).toBe(true);
    expect(matchesMemberHeartRanges(hearts, { [HeartColor.BLUE]: { min: 0, max: 0 } })).toBe(true);
    expect(matchesMemberHeartRanges(hearts, { [HeartColor.PINK]: { min: 0, max: 0 } })).toBe(false);
  });

  it('sums duplicate member Heart entries and keeps All separate from specified colors', () => {
    const hearts = [
      { color: HeartColor.PINK, count: 1 },
      { color: HeartColor.PINK, count: 2 },
      { color: HeartColor.RAINBOW, count: 1 },
    ];

    expect(countMemberHearts(hearts, HeartColor.PINK)).toBe(3);
    expect(countMemberHearts(hearts, HeartColor.RAINBOW)).toBe(1);
    expect(countMemberHearts(hearts, HeartColor.BLUE)).toBe(0);
  });

  it('normalizes canonical RAINBOW and historical GRAY LIVE requirements as generic', () => {
    const requirements = new Map([
      [HeartColor.PINK, 2],
      [HeartColor.RAINBOW, 1],
      [HeartColor.GRAY, 2],
    ]);

    expect(countRequirementHearts(requirements, HeartColor.RAINBOW)).toBe(3);
    expect(countRequirementHearts(requirements, HeartColor.GRAY)).toBe(2);
    expect(
      matchesRequirementHeartRanges(requirements, {
        [HeartColor.PINK]: { min: 2, max: 2 },
        [HeartColor.RAINBOW]: { min: 3, max: 3 },
      })
    ).toBe(true);
  });

  it('creates, updates and removes ranges without mutating another filter set', () => {
    const memberFilters = toggleHeartRangeFilter({}, HeartColor.PINK);
    const liveFilters: HeartRangeFilters = {};
    const withMaximumZero = updateHeartRangeBoundary(memberFilters, HeartColor.PINK, 'max', 0);

    expect(memberFilters[HeartColor.PINK]).toEqual({ min: 1, max: null });
    expect(withMaximumZero[HeartColor.PINK]).toEqual({ min: 0, max: 0 });
    expect(liveFilters).toEqual({});
    expect(toggleHeartRangeFilter(withMaximumZero, HeartColor.PINK)).toEqual({});
  });

  it('normalizes negative, fractional and inverted boundaries', () => {
    const initial = toggleHeartRangeFilter({}, HeartColor.BLUE);
    const negative = updateHeartRangeBoundary(initial, HeartColor.BLUE, 'min', -3);
    const fractional = updateHeartRangeBoundary(negative, HeartColor.BLUE, 'min', 2.8);
    const inverted = updateHeartRangeBoundary(fractional, HeartColor.BLUE, 'max', 1);

    expect(negative[HeartColor.BLUE]).toEqual({ min: 0, max: null });
    expect(fractional[HeartColor.BLUE]).toEqual({ min: 2, max: null });
    expect(inverted[HeartColor.BLUE]).toEqual({ min: 1, max: 1 });
  });
});
