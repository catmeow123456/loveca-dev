export interface BoundedLruCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly entries: number;
  readonly estimatedBytes: number;
}

interface CacheEntry<T> {
  readonly value: T;
  readonly estimatedBytes: number;
}

export class BoundedLruCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private estimatedBytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxEstimatedBytes: number,
    private readonly estimate: (value: T) => number
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new Error('LRU maxEntries must be a positive integer');
    }
    if (!Number.isSafeInteger(maxEstimatedBytes) || maxEstimatedBytes <= 0) {
      throw new Error('LRU maxEstimatedBytes must be a positive integer');
    }
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key: string, value: T): boolean {
    const estimatedBytes = normalizeEstimatedBytes(this.estimate(value));
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.estimatedBytes -= previous.estimatedBytes;
    }

    if (estimatedBytes > this.maxEstimatedBytes) {
      return false;
    }

    this.entries.set(key, { value, estimatedBytes });
    this.estimatedBytes += estimatedBytes;
    this.evictOverflow();
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.estimatedBytes = 0;
  }

  snapshotStats(): BoundedLruCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      entries: this.entries.size,
      estimatedBytes: this.estimatedBytes,
    };
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries || this.estimatedBytes > this.maxEstimatedBytes) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        break;
      }
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      this.estimatedBytes -= oldest?.estimatedBytes ?? 0;
      this.evictions += 1;
    }
  }
}

function normalizeEstimatedBytes(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
