import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LatestRequestGate,
  SerialPollingScheduler,
} from '../../client/src/lib/asyncRequestControl';

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('async request control', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serial polling waits for a slow request before scheduling the next poll', async () => {
    const first = deferred();
    const poll = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const scheduler = new SerialPollingScheduler({ intervalMs: 1_200, poll });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(poll).toHaveBeenCalledTimes(1);

    first.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_199);
    expect(poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(poll).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it('disposing serial polling prevents another poll after an in-flight request finishes', async () => {
    const first = deferred();
    const poll = vi.fn().mockReturnValue(first.promise);
    const scheduler = new SerialPollingScheduler({ intervalMs: 1_200, poll });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.dispose();
    first.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('latest request gate invalidates older responses and explicit cancellation', () => {
    const gate = new LatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);

    gate.invalidate();
    expect(gate.isCurrent(second)).toBe(false);
  });
});
