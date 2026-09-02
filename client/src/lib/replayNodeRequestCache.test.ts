import { describe, expect, it, vi } from 'vitest';
import { ReplayNodeRequestCache } from './replayNodeRequestCache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('ReplayNodeRequestCache', () => {
  it('reuses the same in-flight request and then serves the cached node', async () => {
    const pending = deferred<string>();
    const loader = vi.fn(() => pending.promise);
    const cache = new ReplayNodeRequestCache<string>(2);

    const first = cache.getOrLoad('match:FIRST:1', loader);
    const duplicate = cache.getOrLoad('match:FIRST:1', loader);

    expect(first.source).toBe('NETWORK');
    expect(duplicate.source).toBe('IN_FLIGHT');
    expect(duplicate.promise).toBe(first.promise);
    expect(loader).toHaveBeenCalledTimes(1);

    pending.resolve('node-1');
    await expect(first.promise).resolves.toBe('node-1');
    const cached = cache.getOrLoad('match:FIRST:1', loader);
    expect(cached.source).toBe('CACHE');
    await expect(cached.promise).resolves.toBe('node-1');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('cancels other keys without cancelling a reused target request', async () => {
    const signals = new Map<string, AbortSignal>();
    const pending = new Map<string, ReturnType<typeof deferred<string>>>();
    const cache = new ReplayNodeRequestCache<string>(2);
    const load = (key: string) =>
      cache.getOrLoad(key, (signal) => {
        signals.set(key, signal);
        const request = deferred<string>();
        pending.set(key, request);
        return request.promise;
      });

    const first = load('match:FIRST:1');
    const second = load('match:FIRST:2');
    cache.cancelInFlightExcept('match:FIRST:2');

    expect(signals.get('match:FIRST:1')?.aborted).toBe(true);
    expect(signals.get('match:FIRST:2')?.aborted).toBe(false);
    expect(cache.getOrLoad('match:FIRST:2', vi.fn()).promise).toBe(second.promise);

    pending.get('match:FIRST:1')?.reject(new Error('cancelled'));
    pending.get('match:FIRST:2')?.resolve('node-2');
    await expect(first.promise).rejects.toThrow('cancelled');
    await expect(second.promise).resolves.toBe('node-2');
  });

  it('keeps only the most recently used bounded entries', async () => {
    const events: string[] = [];
    const cache = new ReplayNodeRequestCache<string>(2, (event) => events.push(event.type));
    cache.set('one', '1');
    cache.set('two', '2');
    await cache.getOrLoad('one', vi.fn()).promise;
    cache.set('three', '3');

    expect(cache.cacheSize).toBe(2);
    expect(cache.getOrLoad('one', vi.fn()).source).toBe('CACHE');
    expect(cache.getOrLoad('three', vi.fn()).source).toBe('CACHE');
    expect(events).toContain('CACHE_EVICTED');
  });
});
