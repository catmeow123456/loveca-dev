import { entranceCards } from '../../src/shared/card-entrance';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  prepareEntranceAssets,
  ENTRANCE_LOAD_TIMEOUT_MS,
} from '../../client/src/lib/cardEntranceAssets';
import {
  cardEntranceProfiles,
  defineEntranceProfiles,
  getCardEntranceProfile,
} from '../../client/src/lib/cardEntranceProfiles';
import {
  entranceTimeline as t,
  entrancePortraitFrame,
  entranceRemaining,
} from '../../client/src/lib/cardEntranceTimeline';
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function imageFactory() {
  const images: {
    src: string;
    decode: ReturnType<typeof vi.fn>;
    removeAttribute: ReturnType<typeof vi.fn>;
    naturalWidth: number;
    naturalHeight: number;
    gate: ReturnType<typeof deferred<void>>;
  }[] = [];
  const make = () => {
    const gate = deferred<void>();
    const image = {
      src: '',
      naturalWidth: 1061,
      naturalHeight: 1483,
      gate,
      decode: vi.fn(() => gate.promise),
      removeAttribute: vi.fn(),
    };
    images.push(image);
    return image as unknown as HTMLImageElement;
  };
  return { images, make };
}
afterEach(() => vi.useRealTimers());
describe('entrance registration and resources', () => {
  it('validates unique identities and resolves every registered asset and rarity', async () => {
    expect(cardEntranceProfiles.map(p => p.baseCode).sort()).toEqual(Object.values(entranceCards).sort());
    const first = cardEntranceProfiles[0]!;
    expect(() => defineEntranceProfiles([first, { ...first, id: 'another' }])).toThrow();
    expect(() => defineEntranceProfiles([first, { ...first, baseCode: 'OTHER' }])).toThrow();
    for (const p of cardEntranceProfiles) {
      expect(getCardEntranceProfile(`${p.baseCode}-FUTURE`)).toBe(p);
      expect(getCardEntranceProfile(`${p.baseCode}0-PP`)).toBeUndefined();
      expect((await p.loadArt()).default).toMatch(/\.png(?:\?|$)/);
    }
  });
  it('waits for both images to decode, without loading other registered art', async () => {
    const { images, make } = imageFactory();
    const loadArt = vi.fn(async () => ({ default: 'portrait.png' }));
    const ready = vi.fn();
    const work = prepareEntranceAssets(
      { ...cardEntranceProfiles[0]!, loadArt },
      'card.png',
      new AbortController().signal,
      make
    ).then(ready);
    await vi.waitFor(() => expect(images).toHaveLength(2));
    images[0]!.gate.resolve();
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    images[1]!.gate.resolve();
    await work;
    expect(loadArt).toHaveBeenCalledTimes(1);
    expect(ready.mock.calls[0]![0].portrait.src).toBe('portrait.png');
    expect(ready.mock.calls[0]![0].card.src).toBe('card.png');
  });
  it('cancellation prevents a late import from starting a new image', async () => {
    const gate = deferred<{ default: string }>(),
      controller = new AbortController();
    const { images, make } = imageFactory();
    const result = prepareEntranceAssets(
      { ...cardEntranceProfiles[0]!, loadArt: () => gate.promise },
      null,
      controller.signal,
      make
    );
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    gate.resolve({ default: 'late.png' });
    await Promise.resolve();
    await Promise.resolve();
    expect(images).toHaveLength(0);
  });
  it('times out decoding and releases pending images', async () => {
    vi.useFakeTimers();
    const { images, make } = imageFactory();
    const result = prepareEntranceAssets(
      { ...cardEntranceProfiles[0]!, loadArt: async () => ({ default: 'slow.png' }) },
      'card.png',
      new AbortController().signal,
      make
    );
    const rejected = expect(result).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(ENTRANCE_LOAD_TIMEOUT_MS);
    await rejected;
    expect(images.every((i) => i.removeAttribute.mock.calls[0]?.[0] === 'src')).toBe(true);
  });
  it('rejects decode failures and permits a fresh later attempt', async () => {
    const p = { ...cardEntranceProfiles[0]!, loadArt: async () => ({ default: 'portrait.png' }) };
    const first = imageFactory();
    const result = prepareEntranceAssets(p, null, new AbortController().signal, first.make);
    const rejected = expect(result).rejects.toThrow('decode failed');
    await vi.waitFor(() => expect(first.images).toHaveLength(1));
    first.images[0]!.gate.reject(new Error('decode failed'));
    await rejected;
    const next = imageFactory();
    const retry = prepareEntranceAssets(p, null, new AbortController().signal, next.make);
    await vi.waitFor(() => expect(next.images).toHaveLength(1));
    next.images[0]!.gate.resolve();
    expect((await retry).card).toBeNull();
  });
});
describe('one entrance clock', () => {
  it('preserves the agreed phases and keeps completion after every impact effect', () => {
    expect(t.portraitEnd).toBe(1950);
    expect(t.total).toBe(2740);
    expect(entrancePortraitFrame(0, false).opacity).toBe(0);
    expect(entrancePortraitFrame(t.portrait.enter, false).opacity).toBe(1);
    expect(entrancePortraitFrame(t.portraitEnd, false).finished).toBe(true);
    expect(t.landingAt).toBeLessThan(t.portraitEnd);
    expect(t.impactDuration).toBeGreaterThanOrEqual(
      t.impact.contact + t.impact.spread + t.impact.neighbors
    );
    expect(entranceRemaining(5000, t.landingAt, 5100)).toBe(t.landingAt - 100);
    expect(entranceRemaining(5000, t.landingAt, 9000)).toBe(0);
  });
  it('reduced motion has no entrance displacement or label transition', () => {
    expect(entrancePortraitFrame(0, true)).toMatchObject({
      x: 0,
      label: 1,
      opacity: 1,
      finished: false,
    });
    expect(entrancePortraitFrame(t.reduced, true).finished).toBe(true);
  });
});
