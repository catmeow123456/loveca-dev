import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareMiraiImages } from '../../client/src/components/game/song-animation/mirai-return/miraiLoading';
afterEach(() => vi.useRealTimers());
describe('未来音 bounded first-play loading', () => {
  it('waits for every face and the jacket before playback can start', async () => {
    let release!: (image: HTMLImageElement) => void;
    const image = {} as HTMLImageElement;
    const cache = {
      load: vi.fn((url: string) =>
        url === 'slow'
          ? new Promise<HTMLImageElement>((yes) => (release = yes))
          : Promise.resolve(image)
      ),
      clear: vi.fn(),
    };
    let ready = false;
    const wait = prepareMiraiImages(
      cache,
      ['cover', 'face', 'slow'],
      new AbortController().signal
    ).then((result) => {
      ready = true;
      return result;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(ready).toBe(false);
    release(image);
    expect(await wait).toHaveLength(3);
    expect(cache.clear).not.toHaveBeenCalled();
  });
  it('releases stalled requests at two seconds so the shared barrier can continue', async () => {
    vi.useFakeTimers();
    const cache = { load: vi.fn(() => new Promise<HTMLImageElement>(() => {})), clear: vi.fn() };
    const result = prepareMiraiImages(cache, ['stalled'], new AbortController().signal).catch(
      (error) => error
    );
    await vi.advanceTimersByTimeAsync(1999);
    expect(cache.clear).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBeInstanceOf(Error);
    expect(cache.clear).toHaveBeenCalledOnce();
  });
  it('cancels an abandoned window and rejects decode failures', async () => {
    const controller = new AbortController();
    const cache = { load: vi.fn(() => new Promise<HTMLImageElement>(() => {})), clear: vi.fn() };
    const result = prepareMiraiImages(cache, ['stalled'], controller.signal).catch(
      (error) => error
    );
    controller.abort();
    expect((await result).name).toBe('AbortError');
    expect(cache.clear).toHaveBeenCalledOnce();
    const failed = { load: vi.fn(() => Promise.reject(new Error('bad image'))), clear: vi.fn() };
    await expect(prepareMiraiImages(failed, ['bad'], new AbortController().signal)).rejects.toThrow(
      'unavailable'
    );
    expect(failed.clear).toHaveBeenCalledOnce();
  });
});
