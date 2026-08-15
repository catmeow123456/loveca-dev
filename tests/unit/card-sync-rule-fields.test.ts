import { describe, expect, it } from 'vitest';
import {
  parseOptionalNonNegativeInteger,
  resolveSyncedRuleFields,
} from '../../src/scripts/card-sync-rule-fields';

describe('card sync rule fields', () => {
  it('parses zero and positive integers', () => {
    const warnings: string[] = [];

    expect(parseOptionalNonNegativeInteger('0', 'card blade', warnings)).toBe(0);
    expect(parseOptionalNonNegativeInteger(' 13 ', 'card cost', warnings)).toBe(13);
    expect(warnings).toEqual([]);
  });

  it('returns null for an absent source value without warning', () => {
    const warnings: string[] = [];

    expect(parseOptionalNonNegativeInteger(null, 'card score', warnings)).toBeNull();
    expect(warnings).toEqual([]);
  });

  it.each(['-1', '1.5', 'unknown'])('rejects invalid value %s with a warning', (value) => {
    const warnings: string[] = [];

    expect(parseOptionalNonNegativeInteger(value, 'card cost', warnings)).toBeNull();
    expect(warnings).toEqual([
      `card cost: expected a non-negative integer, received ${JSON.stringify(value)}`,
    ]);
  });

  it('syncs cost and blade only for members while preserving score', () => {
    const warnings: string[] = [];

    expect(
      resolveSyncedRuleFields(
        'MEMBER',
        { cost: '13', blade: '0', score: '9' },
        { cost: 11, blade: 2, score: 4 },
        'member row 2',
        warnings
      )
    ).toEqual({ cost: 13, blade: 0, score: 4 });
    expect(warnings).toEqual([]);
  });

  it('syncs score only for Live cards', () => {
    const warnings: string[] = [];

    expect(
      resolveSyncedRuleFields(
        'LIVE',
        { cost: '13', blade: '5', score: '0' },
        { cost: null, blade: null, score: 4 },
        'live row 3',
        warnings
      )
    ).toEqual({ cost: null, blade: null, score: 0 });
    expect(warnings).toEqual([]);
  });

  it('preserves existing values when source fields are empty or invalid', () => {
    const warnings: string[] = [];

    expect(
      resolveSyncedRuleFields(
        'MEMBER',
        { cost: '', blade: '-1', score: null },
        { cost: 7, blade: 1, score: null },
        'member row 4',
        warnings
      )
    ).toEqual({ cost: 7, blade: 1, score: null });
    expect(warnings).toEqual([
      'member row 4 ブレード: expected a non-negative integer, received "-1"',
    ]);
  });
});
