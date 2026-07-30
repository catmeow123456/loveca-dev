import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_BATTLE_MATCH_POLL_INTERVAL_MS,
  createAiBattlePollingScheduler,
} from '../../client/src/lib/aiBattlePolling';

describe('AI battle polling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('syncs immediately and keeps polling the asynchronous opponent state', async () => {
    const syncRemoteState = vi.fn().mockResolvedValue(undefined);
    const scheduler = createAiBattlePollingScheduler({ syncRemoteState });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(syncRemoteState).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(AI_BATTLE_MATCH_POLL_INTERVAL_MS);
    expect(syncRemoteState).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it('reports a transient failure and continues polling', async () => {
    const failure = new Error('temporary sync failure');
    const syncRemoteState = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const scheduler = createAiBattlePollingScheduler({ syncRemoteState, onError });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(failure);

    await vi.advanceTimersByTimeAsync(AI_BATTLE_MATCH_POLL_INTERVAL_MS);
    expect(syncRemoteState).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });
});
