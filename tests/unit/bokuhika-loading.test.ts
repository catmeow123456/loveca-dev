import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EffectImageCache } from '../../client/src/lib/effectImageCache';
import { ENTRANCE_LOAD_TIMEOUT_MS } from '../../client/src/lib/cardEntranceAssets';
import { prepareBokuhikaImages } from '../../client/src/components/game/song-animation/bokuhikaLoading';
import { bokuhikaImageUrls } from '../../client/src/components/game/song-animation/bokuhikaAssets';
import { shouldPreloadBokuhika } from '../../client/src/lib/bokuhikaPresentation';
import type { PlayerViewState } from '../../src/online/types';

class FakeImage {
  src = '';
  naturalWidth = 524;
  naturalHeight = 732;
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
let requests: FakeImage[], cache: EffectImageCache;
beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  cache = new EffectImageCache(() => {
    const image = new FakeImage();
    requests.push(image);
    return image as unknown as HTMLImageElement;
  });
});
afterEach(() => {
  cache.clear();
  vi.useRealTimers();
});
const flush = () => vi.advanceTimersByTimeAsync(0);
const prepare = (signal = new AbortController().signal) =>
  prepareBokuhikaImages(cache, bokuhikaImageUrls, signal, Promise.resolve());

describe('Bokuhika full-scene preparation', () => {
  it('also waits for the rendered SVG portraits, within the same two-second budget', async () => {
    let rendered!: () => void;
    const ready = vi.fn();
    const pending = prepareBokuhikaImages(
      cache,
      bokuhikaImageUrls,
      new AbortController().signal,
      new Promise<void>((resolve) => {
        rendered = resolve;
      })
    ).then(ready);
    for (let i = 0; i < 10; i++) {
      requests[i].resolve();
      await flush();
    }
    expect(ready).not.toHaveBeenCalled();
    rendered();
    await pending;
    expect(ready).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cannot exceed the deadline when decoded images are ready but a rendered portrait stalls', async () => {
    const pending = prepareBokuhikaImages(
      cache,
      bokuhikaImageUrls,
      new AbortController().signal,
      new Promise<void>(() => {})
    );
    const failed = expect(pending).rejects.toThrow('timeout');
    for (let i = 0; i < 10; i++) {
      requests[i].resolve();
      await flush();
    }
    await vi.advanceTimersByTimeAsync(ENTRANCE_LOAD_TIMEOUT_MS);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('reuses preheating but waits for all nine portraits, including the last slow decode', async () => {
    cache.preload(bokuhikaImageUrls);
    const ready = vi.fn();
    const pending = prepare().then(ready);
    for (let i = 0; i < 9; i++) {
      requests[i].resolve();
      await flush();
    }
    expect(requests).toHaveLength(10);
    expect(ready).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ENTRANCE_LOAD_TIMEOUT_MS - 1);
    requests[9].resolve();
    await pending;
    expect(ready).toHaveBeenCalledOnce();
    expect(ready.mock.calls[0][0][0]).toBe(requests[0]);
    await prepare();
    expect(requests).toHaveLength(10);
    expect(requests.every((image) => image.decode.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out the whole batch at two seconds, releases it and ignores late completions', async () => {
    const ready = vi.fn(),
      failed = vi.fn();
    const pending = prepare().then(ready, failed);
    requests[0].resolve();
    await vi.advanceTimersByTimeAsync(ENTRANCE_LOAD_TIMEOUT_MS);
    await pending;
    expect(failed).toHaveBeenCalledOnce();
    expect(failed.mock.calls[0][0].message).toContain('timeout');
    const old = [...requests];
    expect(old.slice(1).every((image) => image.removeAttribute.mock.calls.length)).toBe(true);
    for (const image of old) image.resolve();
    await flush();
    expect(ready).not.toHaveBeenCalled();
    expect(requests).toHaveLength(old.length);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends on a broken portrait without waiting for the deadline or invalidating another cache', async () => {
    const otherImage = new FakeImage();
    const otherCache = new EffectImageCache(() => otherImage as unknown as HTMLImageElement);
    const other = otherCache.load('honoka-memory');
    const failed = expect(prepare()).rejects.toThrow('decode failed');
    requests[1].reject();
    await failed;
    expect(vi.getTimerCount()).toBe(1); // Only the other animation is still loading.
    otherImage.resolve();
    expect(await other).toBe(otherImage);
    expect(otherImage.removeAttribute).not.toHaveBeenCalled();
    otherCache.clear();
  });

  it('cancels on skip/unmount, and stale callbacks cannot clear a new playback', async () => {
    const controller = new AbortController();
    const cancelled = expect(prepare(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    const old = [...requests];
    controller.abort();
    const next = prepare();
    for (const image of old) image.resolve();
    for (let i = old.length; i < old.length + 10; i++) {
      requests[i].resolve();
      await flush();
    }
    await cancelled;
    expect(await next).toHaveLength(10);
    expect(
      requests.slice(old.length).every((image) => !image.removeAttribute.mock.calls.length)
    ).toBe(true);
  });

  it('does not start requests for an already cancelled scene', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepare(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Bokuhika public preheat eligibility', () => {
  const view = (zone: string, surface = 'FRONT', cardCode = 'PL!-pb2-039-L') =>
    ({
      objects: { song: { surface, frontInfo: { cardCode } } },
      table: { zones: { cards: { zone, objectIds: ['song'] } } },
    }) as unknown as PlayerViewState;

  it.each(['LIVE_ZONE', 'SUCCESS_ZONE', 'WAITING_ROOM'])(
    'warms all prints in public %s before a presentation is pending',
    (zone) => {
      for (const print of ['PL!-pb2-039', 'PL!-pb2-039-L', 'PL!-pb2-039-L+'])
        expect(shouldPreloadBokuhika(view(zone, 'FRONT', print))).toBe(true);
    }
  );
  it('does not use a hidden identity, private zone or unrelated card', () => {
    expect(shouldPreloadBokuhika(view('LIVE_ZONE', 'BACK'))).toBe(false);
    expect(shouldPreloadBokuhika(view('HAND'))).toBe(false);
    expect(shouldPreloadBokuhika(view('MAIN_DECK'))).toBe(false);
    expect(shouldPreloadBokuhika(view('LIVE_ZONE', 'FRONT', 'PL!-pb2-038-L'))).toBe(false);
  });
});
