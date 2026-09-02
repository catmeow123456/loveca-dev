export type ReplayNodeCacheEvent =
  | { readonly type: 'CACHE_HIT'; readonly key: string }
  | { readonly type: 'CACHE_EVICTED'; readonly key: string }
  | { readonly type: 'IN_FLIGHT_REUSED'; readonly key: string }
  | { readonly type: 'REQUEST_STARTED'; readonly key: string }
  | { readonly type: 'REQUEST_CANCELLED'; readonly key: string };

export interface ReplayNodeLoadResult<T> {
  readonly promise: Promise<T>;
  readonly source: 'CACHE' | 'IN_FLIGHT' | 'NETWORK';
}

interface InFlightEntry<T> {
  readonly controller: AbortController;
  readonly promise: Promise<T>;
}

export class ReplayNodeRequestCache<T> {
  private readonly cache = new Map<string, T>();
  private readonly inFlight = new Map<string, InFlightEntry<T>>();
  private onEvent: (event: ReplayNodeCacheEvent) => void;

  constructor(
    private readonly maxEntries: number,
    onEvent: (event: ReplayNodeCacheEvent) => void = () => undefined
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new Error('Replay node cache maxEntries must be a positive integer');
    }
    this.onEvent = onEvent;
  }

  setEventListener(onEvent: (event: ReplayNodeCacheEvent) => void = () => undefined): void {
    this.onEvent = onEvent;
  }

  getOrLoad(key: string, loader: (signal: AbortSignal) => Promise<T>): ReplayNodeLoadResult<T> {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      this.onEvent({ type: 'CACHE_HIT', key });
      return { promise: Promise.resolve(cached), source: 'CACHE' };
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      this.onEvent({ type: 'IN_FLIGHT_REUSED', key });
      return { promise: existing.promise, source: 'IN_FLIGHT' };
    }

    const controller = new AbortController();
    const entry = {} as InFlightEntry<T>;
    const promise = loader(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          this.set(key, value);
        }
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === entry) {
          this.inFlight.delete(key);
        }
      });
    Object.assign(entry, { controller, promise });
    this.inFlight.set(key, entry);
    this.onEvent({ type: 'REQUEST_STARTED', key });
    return { promise, source: 'NETWORK' };
  }

  set(key: string, value: T): void {
    this.cache.delete(key);
    this.cache.set(key, value);
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        break;
      }
      this.cache.delete(oldestKey);
      this.onEvent({ type: 'CACHE_EVICTED', key: oldestKey });
    }
  }

  cancelInFlightExcept(key?: string): void {
    for (const [candidateKey, entry] of this.inFlight) {
      if (candidateKey === key) {
        continue;
      }
      this.inFlight.delete(candidateKey);
      entry.controller.abort();
      this.onEvent({ type: 'REQUEST_CANCELLED', key: candidateKey });
    }
  }

  clear(): void {
    this.cancelInFlightExcept();
    this.cache.clear();
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  get cacheSize(): number {
    return this.cache.size;
  }

  get inFlightSize(): number {
    return this.inFlight.size;
  }
}
