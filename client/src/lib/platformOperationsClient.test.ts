import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiClient } from './apiClient';
import {
  fetchReplayRetentionJob,
  isTerminalReplayRetentionPollError,
} from './platformOperationsClient';

afterEach(() => vi.restoreAllMocks());

describe('replay retention status errors', () => {
  it('preserves the missing job response for terminal recovery', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: null,
      status: 404,
      error: { code: 'REPLAY_RETENTION_JOB_NOT_FOUND', message: '任务不存在' },
    });

    const error = await fetchReplayRetentionJob('lost-job').catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      code: 'REPLAY_RETENTION_JOB_NOT_FOUND',
      message: '任务不存在',
      status: 404,
    });
    expect(isTerminalReplayRetentionPollError(error)).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('stops polling on HTTP %i', (status) => {
    expect(
      isTerminalReplayRetentionPollError(
        new ApiClientError({ code: 'ERROR', message: '失败', status })
      )
    ).toBe(true);
  });

  it.each([408, 429, 500, 503, undefined])(
    'keeps polling after a transient HTTP %s or network failure',
    (status) => {
      expect(
        isTerminalReplayRetentionPollError(
          new ApiClientError({ code: 'ERROR', message: '失败', status })
        )
      ).toBe(false);
    }
  );
});
