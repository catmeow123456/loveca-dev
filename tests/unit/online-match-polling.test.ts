import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerViewState } from '../../src/online/types';
import { SerialPollingScheduler } from '../../client/src/lib/asyncRequestControl';
import { getOnlineMatchPollInterval } from '../../client/src/lib/onlineMatchPolling';

describe('online animation polling window', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps the fast cadence after the local ACK, restores normal polling when released or expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let entrance: PlayerViewState['match']['entrance'] = {
      id: 'animation',
      objectIds: [],
      waitingSeats: ['FIRST', 'SECOND'],
      deadlineAt: 1000,
    };
    const times: number[] = [];
    const scheduler = new SerialPollingScheduler({
      intervalMs: () => getOnlineMatchPollInterval(entrance),
      poll: async () => {
        times.push(Date.now());
      },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(200);
    entrance = { ...entrance, waitingSeats: ['SECOND'] };
    await vi.advanceTimersByTimeAsync(200);
    expect(times).toEqual([0, 200, 400]);

    // Even if a failed request leaves a stale window in the store, its original deadline
    // bounds the extra traffic. It does not locally release the rules barrier.
    await vi.advanceTimersByTimeAsync(1000);
    expect(times).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(entrance.waitingSeats).toEqual(['SECOND']);
    await vi.advanceTimersByTimeAsync(400);
    expect(times.at(-1)).toBe(1800);
    entrance = undefined;
    scheduler.refreshInterval();
    await vi.advanceTimersByTimeAsync(800);
    expect(times.at(-1)).toBe(2600);
    scheduler.dispose();
  });

  it('does not accelerate ordinary snapshots or ones past their authority deadline', () => {
    expect(getOnlineMatchPollInterval(undefined, 0)).toBe(800);
    expect(
      getOnlineMatchPollInterval(
        {
          id: 'old',
          objectIds: [],
          waitingSeats: ['SECOND'],
          deadlineAt: 1000,
        },
        1000
      )
    ).toBe(800);
  });
});
