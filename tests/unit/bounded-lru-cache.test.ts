import { describe, expect, it } from 'vitest';
import { BoundedLruCache } from '../../src/server/services/bounded-lru-cache';

describe('BoundedLruCache', () => {
  it('tracks hits and misses while refreshing recency', () => {
    const cache = new BoundedLruCache<string>(2, 10, (value) => value.length);
    cache.set('one', '1');
    cache.set('two', '22');

    expect(cache.get('one')).toBe('1');
    expect(cache.get('missing')).toBeUndefined();
    cache.set('three', '333');

    expect(cache.get('two')).toBeUndefined();
    expect(cache.get('one')).toBe('1');
    expect(cache.snapshotStats()).toMatchObject({ hits: 2, misses: 2, evictions: 1, entries: 2 });
  });

  it('enforces the estimated byte limit and skips oversized values', () => {
    const cache = new BoundedLruCache<string>(10, 5, (value) => value.length);
    cache.set('one', '111');
    cache.set('two', '22');
    cache.set('three', '333');

    expect(cache.get('one')).toBeUndefined();
    expect(cache.snapshotStats()).toMatchObject({ entries: 2, estimatedBytes: 5, evictions: 1 });
    expect(cache.set('oversized', '123456')).toBe(false);
    expect(cache.snapshotStats()).toMatchObject({ entries: 2, estimatedBytes: 5 });
  });
});
