import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EffectImageCache,
  EFFECT_IMAGE_CACHE_LIMIT,
  EFFECT_IMAGE_LOAD_TIMEOUT_MS,
} from '../../client/src/lib/effectImageCache';

class FakeImage {
  src = '';
  fetchPriority = '';
  decoding = '';
  naturalWidth = 400;
  naturalHeight = 560;
  resolve!: () => void;
  reject!: () => void;
  decode = vi.fn(
    () =>
      new Promise<void>((yes, no) => {
        this.resolve = yes;
        this.reject = no;
      })
  );
  removeAttribute = vi.fn();
}
let images: FakeImage[], cache: EffectImageCache;
beforeEach(() => {
  vi.useFakeTimers();
  images = [];
  cache = new EffectImageCache(() => {
    const image = new FakeImage();
    images.push(image);
    return image as unknown as HTMLImageElement;
  });
});
afterEach(() => {
  cache.clear();
  vi.useRealTimers();
});
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('match-owned decoded effect images', () => {
  it('reuses a slow background decode and the same image for first and later playback', async () => {
    cache.preload(['card', 'card']);
    expect(images).toHaveLength(1);
    expect(images[0]!.fetchPriority).toBe('low');
    await vi.advanceTimersByTimeAsync(3000);
    const first = cache.load('card');
    expect(images[0]!.fetchPriority).toBe('auto');
    expect(images[0]!.removeAttribute).not.toHaveBeenCalled();
    images[0]!.resolve();
    expect(await first).toBe(images[0]);
    expect(await cache.load('card')).toBe(images[0]);
    expect(images[0]!.decode).toHaveBeenCalledTimes(1);
    expect(images).toHaveLength(1);
  });

  it('bounds background concurrency and lets playback preempt speculative work', async () => {
    cache.preload(['slow-a', 'slow-b', 'needed', 'later']);
    expect(images.map((image) => image.src)).toEqual(['slow-a', 'slow-b']);
    const needed = cache.load('needed');
    expect(images[0]!.removeAttribute).toHaveBeenCalledWith('src');
    expect(images[2]!.src).toBe('needed');
    images[2]!.resolve();
    expect(await needed).toBe(images[2]);
    expect(images[3]!.src).toBe('later');
  });

  it('does not cancel another foreground consumer when promoting queued work', async () => {
    const first = cache.load('first'),
      second = cache.load('second'),
      third = cache.load('third');
    expect(images).toHaveLength(2);
    images[0]!.resolve();
    await first;
    expect(images[2]!.src).toBe('third');
    images[1]!.resolve();
    images[2]!.resolve();
    await Promise.all([second, third]);
    expect(images.every((image) => !image.removeAttribute.mock.calls.length)).toBe(true);
  });

  it('drops obsolete queued candidates, retries failures and times out stalled requests', async () => {
    cache.preload(['bad', 'stalled', 'obsolete']);
    cache.preload(['bad', 'stalled', 'current']);
    images[0]!.reject();
    await flush();
    expect(images.map((image) => image.src)).toEqual(['bad', 'stalled', 'current']);
    images[2]!.resolve();
    await vi.advanceTimersByTimeAsync(EFFECT_IMAGE_LOAD_TIMEOUT_MS);
    expect(images[1]!.removeAttribute).toHaveBeenCalledWith('src');
    const retry = cache.load('bad');
    images[3]!.resolve();
    expect(await retry).toBe(images[3]);
  });

  it('clears pending work, ignores late results and can warm again after a StrictMode cleanup', async () => {
    cache.preload(['card', 'second', 'never']);
    const old = cache.load('card');
    const rejection = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    cache.clear();
    await rejection;
    cache.preload(['card']);
    images[0]!.resolve();
    await flush();
    const next = cache.load('card');
    images[2]!.resolve();
    expect(await next).toBe(images[2]);
    expect(images.map((image) => image.src)).toEqual(['card', 'second', 'card']);
  });

  it('evicts least-recently-used ready entries without invalidating a borrowed image', async () => {
    for (let i = 0; i < EFFECT_IMAGE_CACHE_LIMIT; i++) {
      const ready = cache.load(String(i));
      images.at(-1)!.resolve();
      await ready;
    }
    const borrowed = await cache.load('0');
    const extra = cache.load('extra');
    images.at(-1)!.resolve();
    await extra;
    expect(await cache.load('0')).toBe(borrowed);
    const evicted = cache.load('1');
    expect(images).toHaveLength(EFFECT_IMAGE_CACHE_LIMIT + 2);
    images.at(-1)!.resolve();
    await evicted;
    cache.clear();
    expect(images[0]!.removeAttribute).not.toHaveBeenCalled();
  });

  it('caps decoded byte ownership even for unexpectedly large card faces', async () => {
    const first = cache.load('large');
    images[0]!.naturalWidth = images[0]!.naturalHeight = 4096;
    images[0]!.resolve();
    await first;
    const retry = cache.load('large');
    expect(images).toHaveLength(2);
    images[1]!.resolve();
    await retry;
    expect(images[0]!.removeAttribute).not.toHaveBeenCalled();
  });
});
