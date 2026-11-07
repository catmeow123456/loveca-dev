import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareSolitudeRainImages } from '../../client/src/components/game/song-animation/solitude-rain/solitudeRainLoading';
afterEach(() => vi.useRealTimers());
describe('Solitude Rain loading and cancelled windows', () => {
  it('starts only after the standard Heart has decoded', async () => {
    let finish!: (image: HTMLImageElement) => void;
    const image = {} as HTMLImageElement;
    const cache = {
      load: vi.fn((url: string) =>
        url === 'heart'
          ? new Promise<HTMLImageElement>((r) => (finish = r))
          : Promise.resolve(image)
      ),
      clear: vi.fn(),
    };
    const ready = vi.fn();
    const result = prepareSolitudeRainImages(cache, ['heart'], new AbortController().signal).then(
      ready
    );
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    finish(image);
    await result;
    expect(ready).toHaveBeenCalledWith([image]);
    expect(cache.clear).not.toHaveBeenCalled();
  });
  it('cancels stalled loading at two seconds; a late decode never restarts it', async () => {
    vi.useFakeTimers();
    let finish!: (image: HTMLImageElement) => void;
    const cache = {
      load: vi.fn(() => new Promise<HTMLImageElement>((r) => (finish = r))),
      clear: vi.fn(),
    };
    const ready = vi.fn(),
      failed = vi.fn();
    const result = prepareSolitudeRainImages(cache, ['heart'], new AbortController().signal).then(
      ready,
      failed
    );
    await vi.advanceTimersByTimeAsync(1999);
    expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(failed).toHaveBeenCalledOnce();
    finish({} as HTMLImageElement);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    expect(cache.clear).toHaveBeenCalledOnce();
  });
  it('releases aborted or failed requests so skip and unmount cannot leave a blocked wait', async () => {
    const controller = new AbortController();
    const cache = { load: vi.fn(() => new Promise<HTMLImageElement>(() => {})), clear: vi.fn() };
    const result = prepareSolitudeRainImages(cache, ['heart'], controller.signal).catch((e) => e);
    controller.abort();
    expect((await result).name).toBe('AbortError');
    expect(cache.clear).toHaveBeenCalledOnce();
    const failed = { load: vi.fn(() => Promise.reject(Error('decode'))), clear: vi.fn() };
    await expect(
      prepareSolitudeRainImages(failed, ['heart'], new AbortController().signal)
    ).rejects.toThrow('unavailable');
  });
});
