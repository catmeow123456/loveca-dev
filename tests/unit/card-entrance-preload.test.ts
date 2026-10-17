import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  preloadEntranceProfiles,
  ENTRANCE_PRELOAD_TIMEOUT_MS,
} from '../../client/src/lib/cardEntrancePreload';
import { cardEntranceProfiles } from '../../client/src/lib/cardEntranceProfiles';

class FakeImage {
  static images: FakeImage[] = [];
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  removeAttribute = vi.fn();
  constructor() {
    FakeImage.images.push(this);
  }
}
const profile = (id: string, blink = true) => ({
  ...cardEntranceProfiles[0]!,
  id,
  loadArt: vi.fn(async () => ({ default: `${id}.png` })),
  blink: blink
    ? {
        ...cardEntranceProfiles[0]!.blink!,
        loadArt: vi.fn(async () => ({ default: `${id}-eyes.png` })),
      }
    : undefined,
});
const settleImages = () => FakeImage.images.forEach((image) => image.onload?.());

beforeEach(() => {
  vi.useFakeTimers();
  FakeImage.images = [];
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('document', { fonts: { load: vi.fn(async () => []) } });
});
afterEach(async () => {
  settleImages();
  await vi.runAllTimersAsync();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('nonblocking entrance preload', () => {
  it('starts asynchronously, deduplicates profiles and loads only one portrait/eyes pair at a time', async () => {
    const first = profile('first'),
      second = profile('second', false);
    const stop = preloadEntranceProfiles([first, first, second]);
    expect(first.loadArt).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeImage.images.map((image) => image.src)).toEqual(['first.png', 'first-eyes.png']);
    expect(second.loadArt).not.toHaveBeenCalled();
    // Background work is independent of the 2 second playback preparation deadline.
    await vi.advanceTimersByTimeAsync(3000);
    expect(FakeImage.images[0]!.removeAttribute).not.toHaveBeenCalled();
    settleImages();
    await vi.advanceTimersByTimeAsync(0);
    expect(first.loadArt).toHaveBeenCalledTimes(1);
    expect(FakeImage.images.at(-1)!.src).toBe('second.png');
    stop();
  });

  it('shares in-flight URLs between matches, lets them finish on leave and stops the old queue', async () => {
    const first = profile('shared'),
      second = profile('never');
    const stop = preloadEntranceProfiles([first, second]);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    const stopNext = preloadEntranceProfiles([first]);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeImage.images).toHaveLength(2);
    expect(FakeImage.images.every((image) => image.removeAttribute.mock.calls.length === 0)).toBe(
      true
    );
    settleImages();
    await vi.advanceTimersByTimeAsync(0);
    expect(second.loadArt).not.toHaveBeenCalled();
    expect(FakeImage.images.every((image) => image.onload === null && image.onerror === null)).toBe(
      true
    );
    stopNext();
  });

  it('continues after image/import failures and retries failed URLs in another game', async () => {
    const broken = profile('broken'),
      next = profile('after-error', false);
    broken.blink!.loadArt.mockRejectedValue(new Error('missing module'));
    const stop = preloadEntranceProfiles([broken, next]);
    await vi.advanceTimersByTimeAsync(0);
    FakeImage.images[0]!.onerror!();
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeImage.images.at(-1)!.src).toBe('after-error.png');
    stop();
    const stopRetry = preloadEntranceProfiles([broken]);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeImage.images.filter((image) => image.src === 'broken.png')).toHaveLength(2);
    stopRetry();
  });

  it('releases stalled image requests and proceeds without blocking on the font', async () => {
    document.fonts.load = vi.fn(() => new Promise(() => {}));
    const stop = preloadEntranceProfiles([
      profile('stalled', false),
      profile('after-timeout', false),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(ENTRANCE_PRELOAD_TIMEOUT_MS);
    expect(FakeImage.images[0]!.removeAttribute).toHaveBeenCalledWith('src');
    expect(FakeImage.images.at(-1)!.src).toBe('after-timeout.png');
    stop();
  });

  it('does not download after cancellation before the timer or a delayed module resolves', async () => {
    const first = profile('not-started');
    preloadEntranceProfiles([first])();
    await vi.advanceTimersByTimeAsync(0);
    expect(first.loadArt).not.toHaveBeenCalled();
    let resolve!: (value: { default: string }) => void;
    const delayed = profile('delayed', false);
    delayed.loadArt.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const stop = preloadEntranceProfiles([delayed]);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    resolve({ default: 'late.png' });
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeImage.images).toHaveLength(0);
  });

  it('moves past a stalled import and ignores its late result', async () => {
    let resolve!: (value: { default: string }) => void;
    const delayed = profile('stalled-import', false);
    delayed.loadArt.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const stop = preloadEntranceProfiles([delayed, profile('after-import-timeout', false)]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(ENTRANCE_PRELOAD_TIMEOUT_MS);
    expect(FakeImage.images.map((image) => image.src)).toEqual(['after-import-timeout.png']);
    resolve({ default: 'too-late.png' });
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeImage.images).toHaveLength(1);
    stop();
  });
});
