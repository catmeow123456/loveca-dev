import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../client/src/lib/apiClient';
import { SpectatorPollingScheduler } from '../../client/src/lib/spectatorPolling';

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('SpectatorPollingScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('静止对局按 800ms 串行轮询且 10 秒内不超过预算', async () => {
    const poll = vi.fn(() => Promise.resolve());
    const scheduler = new SpectatorPollingScheduler({ intervalMs: 800, poll });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(poll.mock.calls.length).toBeLessThanOrEqual(14);
    expect(poll).toHaveBeenCalledTimes(12);
    scheduler.dispose();
  });

  it('慢请求完成前不发起第二个请求', async () => {
    const first = deferred();
    const poll = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const scheduler = new SpectatorPollingScheduler({ intervalMs: 800, poll });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(poll).toHaveBeenCalledTimes(1);

    first.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(799);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it('429 等待服务端窗口后只发送一次探测请求并恢复单一调度器', async () => {
    const onError = vi.fn();
    const poll = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError({
          code: 'ONLINE_SPECTATOR_RATE_LIMITED',
          message: '观战同步暂时繁忙，请稍等',
          status: 429,
          retryAfterMs: 3_000,
        })
      )
      .mockResolvedValue(undefined);
    const scheduler = new SpectatorPollingScheduler({ intervalMs: 800, poll, onError });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(800);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'RATE_LIMITED', retryAfterMs: 3_050 })
    );

    await vi.advanceTimersByTimeAsync(3_049);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(800);
    expect(poll).toHaveBeenCalledTimes(3);
    scheduler.dispose();
  });

  it('视角切换暂停时作废旧调度，恢复后仍不与旧请求重入', async () => {
    const oldRequest = deferred();
    const poll = vi.fn().mockReturnValueOnce(oldRequest.promise).mockResolvedValue(undefined);
    const scheduler = new SpectatorPollingScheduler({ intervalMs: 800, poll });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(800);
    scheduler.pause();
    scheduler.resume();
    await vi.advanceTimersByTimeAsync(1_600);
    expect(poll).toHaveBeenCalledTimes(1);

    oldRequest.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800);
    expect(poll).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });
});
