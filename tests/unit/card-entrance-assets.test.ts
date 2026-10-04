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
// Explicitly exercise the no-eye-art path; registrations may gain blinking later.
const plainProfile = { ...cardEntranceProfiles[0]!, blink: undefined };
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('entrance registration and resources', () => {
  it('validates unique identities and resolves every registered asset and rarity', async () => {
    expect(cardEntranceProfiles.map((p) => p.baseCode).sort()).toEqual(
      Object.values(entranceCards).sort()
    );
    const first = cardEntranceProfiles[0]!;
    expect(() => defineEntranceProfiles([first, { ...first, id: 'another' }])).toThrow();
    expect(() => defineEntranceProfiles([first, { ...first, baseCode: 'OTHER' }])).toThrow();
    for (const p of cardEntranceProfiles) {
      expect(getCardEntranceProfile(`${p.baseCode}-FUTURE`)).toBe(p);
      expect(getCardEntranceProfile(`${p.baseCode}0-PP`)).toBeUndefined();
      expect((await p.loadArt()).default).toMatch(/\.png(?:\?|$)/);
      if (p.blink) expect((await p.blink.loadArt()).default).toMatch(/\.png(?:\?|$)/);
    }
  });
  it('waits for both images to decode, without loading other registered art', async () => {
    const { images, make } = imageFactory();
    const loadArt = vi.fn(async () => ({ default: 'portrait.png' }));
    const ready = vi.fn();
    const work = prepareEntranceAssets(
      { ...plainProfile, loadArt },
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
  it('prepares the optional blink before starting and falls back to the original portrait on a broken eye image', async () => {
    for (const fails of [false, true]) {
      const { images, make } = imageFactory();
      const rurino = cardEntranceProfiles.find((p) => p.id === 'rurino')!;
      const profile = {
        ...rurino,
        loadArt: async () => ({ default: 'portrait.png' }),
        blink: { ...rurino.blink!, loadArt: async () => ({ default: 'eyes.png' }) },
      };
      const ready = vi.fn();
      const work = prepareEntranceAssets(profile, null, new AbortController().signal, make).then(
        ready
      );
      await vi.waitFor(() => expect(images).toHaveLength(2));
      images.find((i) => i.src === 'portrait.png')!.gate.resolve();
      await Promise.resolve();
      expect(ready).not.toHaveBeenCalled();
      const eyes = images.find((i) => i.src === 'eyes.png')!;
      if (fails) eyes.gate.reject(new Error('eye decode failed'));
      else eyes.gate.resolve();
      await work;
      expect(ready.mock.calls[0]![0].portrait.src).toBe('portrait.png');
      expect(ready.mock.calls[0]![0].blink).toBe(fails ? null : eyes);
    }
  });
  it('keeps the portrait usable when the optional eye module cannot be imported', async () => {
    const { images, make } = imageFactory();
    const original = cardEntranceProfiles[0]!;
    const work = prepareEntranceAssets(
      {
        ...original,
        loadArt: async () => ({ default: 'portrait.png' }),
        blink: {
          ...original.blink!,
          loadArt: async () => {
            throw new Error('chunk offline');
          },
        },
      },
      null,
      new AbortController().signal,
      make
    );
    await vi.waitFor(() => expect(images).toHaveLength(1));
    images[0]!.gate.resolve();
    expect(await work).toMatchObject({ portrait: images[0], card: null, blink: null });
  });
  it('ends preparation when only the eye image stalls and ignores its late completion', async () => {
    vi.useFakeTimers();
    const { images, make } = imageFactory();
    const original = cardEntranceProfiles[0]!;
    const ready = vi.fn();
    const work = prepareEntranceAssets(
      {
        ...original,
        loadArt: async () => ({ default: 'portrait.png' }),
        blink: { ...original.blink!, loadArt: async () => ({ default: 'eyes.png' }) },
      },
      null,
      new AbortController().signal,
      make
    ).then(ready);
    const rejected = expect(work).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(0);
    images.find((i) => i.src === 'portrait.png')!.gate.resolve();
    await vi.advanceTimersByTimeAsync(ENTRANCE_LOAD_TIMEOUT_MS);
    await rejected;
    expect(images.every((i) => i.removeAttribute.mock.calls[0]?.[0] === 'src')).toBe(true);
    images.find((i) => i.src === 'eyes.png')!.gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).not.toHaveBeenCalled();
  });
  it('does not start a late blink import after skip and releases already decoded images', async () => {
    const { images, make } = imageFactory();
    const gate = deferred<{ default: string }>(),
      controller = new AbortController();
    const rurino = cardEntranceProfiles.find((p) => p.id === 'rurino')!;
    const work = prepareEntranceAssets(
      {
        ...rurino,
        loadArt: async () => ({ default: 'portrait.png' }),
        blink: { ...rurino.blink!, loadArt: () => gate.promise },
      },
      null,
      controller.signal,
      make
    );
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(images).toHaveLength(1));
    images[0]!.gate.resolve();
    controller.abort();
    await rejected;
    gate.resolve({ default: 'late-eyes.png' });
    await Promise.resolve();
    await Promise.resolve();
    expect(images).toHaveLength(1);
    expect(images[0]!.removeAttribute).toHaveBeenCalledWith('src');
  });
  it('font rejection retains the decoded art and allows fallback typography', async () => {
    vi.stubGlobal('document', {
      fonts: { load: vi.fn().mockRejectedValue(new Error('font offline')) },
    });
    const { images, make } = imageFactory();
    const work = prepareEntranceAssets(
      { ...plainProfile, loadArt: async () => ({ default: 'portrait.png' }) },
      null,
      new AbortController().signal,
      make
    );
    await vi.waitFor(() => expect(images).toHaveLength(1));
    images[0]!.gate.resolve();
    expect((await work).portrait.src).toBe('portrait.png');
  });
  it('font preparation shares the existing timeout even when images are ready', async () => {
    vi.useFakeTimers();
    const font = deferred<void>();
    vi.stubGlobal('document', { fonts: { load: () => font.promise } });
    const { images, make } = imageFactory();
    const work = prepareEntranceAssets(
      { ...plainProfile, loadArt: async () => ({ default: 'portrait.png' }) },
      null,
      new AbortController().signal,
      make
    );
    const rejected = expect(work).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(0);
    images[0]!.gate.resolve();
    await vi.advanceTimersByTimeAsync(ENTRANCE_LOAD_TIMEOUT_MS);
    await rejected;
    font.resolve();
  });
  it('cancellation prevents a late import from starting a new image', async () => {
    const gate = deferred<{ default: string }>(),
      controller = new AbortController();
    const { images, make } = imageFactory();
    const result = prepareEntranceAssets(
      { ...plainProfile, loadArt: () => gate.promise },
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
      { ...plainProfile, loadArt: async () => ({ default: 'slow.png' }) },
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
    const p = { ...plainProfile, loadArt: async () => ({ default: 'portrait.png' }) };
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
