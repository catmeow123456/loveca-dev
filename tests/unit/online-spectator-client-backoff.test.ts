import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@/lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../client/src/lib/apiClient')>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: apiMocks.get,
    },
  };
});

import {
  fetchOnlineSpectatorPublicEvents,
  fetchOnlineSpectatorSnapshotResponse,
} from '../../client/src/lib/onlineClient';

describe('online spectator client shared backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    apiMocks.get.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('任一会话请求收到 429 后在等待窗口内阻止快照和公开日志继续请求', async () => {
    apiMocks.get.mockResolvedValueOnce({
      data: null,
      status: 429,
      retryAfterMs: 3_000,
      error: {
        code: 'ONLINE_SPECTATOR_RATE_LIMITED',
        message: '观战同步暂时繁忙，请稍等',
        retryAfterMs: 3_000,
      },
    });

    await expect(
      fetchOnlineSpectatorSnapshotResponse('token-backoff', 'session-backoff', 4, 1)
    ).rejects.toMatchObject({
      code: 'ONLINE_SPECTATOR_RATE_LIMITED',
      retryAfterMs: 3_000,
    });
    await expect(
      fetchOnlineSpectatorPublicEvents('token-backoff', 'session-backoff', 2)
    ).rejects.toMatchObject({
      code: 'ONLINE_SPECTATOR_RATE_LIMITED',
      retryAfterMs: 3_000,
    });
    expect(apiMocks.get).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_003_000);
    apiMocks.get.mockResolvedValueOnce({
      data: { matchId: 'match-1', currentPublicSeq: 2, publicEvents: [] },
      status: 200,
      error: null,
    });
    await expect(
      fetchOnlineSpectatorPublicEvents('token-backoff', 'session-backoff', 2)
    ).resolves.toMatchObject({ matchId: 'match-1' });
    expect(apiMocks.get).toHaveBeenCalledTimes(2);
  });
});
