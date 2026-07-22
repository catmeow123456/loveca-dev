import { describe, expect, it } from 'vitest';
import { appendDoubleGrayBladeHearts } from '../../src/scripts/card-sync-double-heart';

type SyncBladeHeart = {
  readonly effect: 'HEART' | 'DRAW' | 'SCORE';
  readonly heartColor?: 'GRAY';
};

describe('card sync double colorless Blade Heart', () => {
  it('expands one xlsx/CloudBase double token to two gray Heart items', () => {
    const result: SyncBladeHeart[] = [];

    expect(appendDoubleGrayBladeHearts(result, ' double ')).toBe(true);
    expect(result).toEqual([
      { effect: 'HEART', heartColor: 'GRAY' },
      { effect: 'HEART', heartColor: 'GRAY' },
    ]);
  });

  it('multiplies the CloudBase object count by two', () => {
    const result: SyncBladeHeart[] = [];

    expect(appendDoubleGrayBladeHearts(result, 'double', 2)).toBe(true);
    expect(result).toHaveLength(4);
    expect(result).toEqual(
      Array.from({ length: 4 }, () => ({ effect: 'HEART', heartColor: 'GRAY' }))
    );
  });

  it('leaves non-double tokens for the normal color/effect parser', () => {
    const result: SyncBladeHeart[] = [];

    expect(appendDoubleGrayBladeHearts(result, 'red')).toBe(false);
    expect(result).toEqual([]);
  });
});
