import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../client/src/lib/apiClient';
import {
  createCardSyncPreview,
  fetchCardSyncRun,
  fetchCardSyncStatus,
  isCardSyncRunActive,
  startCardSyncRun,
} from '../../client/src/lib/cardSyncClient';

vi.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockedApiClient = vi.mocked(apiClient);

describe('card sync client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses fixed admin endpoints and sends no source or image configuration', async () => {
    mockedApiClient.get.mockResolvedValue({
      data: { configuration: 'READY', activeRun: null, latestRun: null },
      error: null,
    });
    mockedApiClient.post
      .mockResolvedValueOnce({
        data: {
          id: 'preview-1',
          createdAt: '2026-08-22T12:00:00.000Z',
          expiresAt: '2026-08-22T12:15:00.000Z',
          summary: {
            sourceCount: 10,
            existingCount: 9,
            candidateCount: 1,
            blockedCount: 0,
            warningCount: 0,
          },
          candidates: [],
          blocked: [],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          id: 'run-1',
          previewId: 'preview-1',
          status: 'QUEUED',
          createdAt: '2026-08-22T12:01:00.000Z',
          summary: {
            totalCount: 1,
            succeededCount: 0,
            failedCount: 0,
            pendingCount: 1,
          },
          items: [],
        },
        error: null,
      });

    await fetchCardSyncStatus();
    await createCardSyncPreview('preview-key');
    await startCardSyncRun('preview-1', 'apply-key');

    expect(mockedApiClient.get.mock.calls).toContainEqual(['/api/admin/card-sync/status']);
    expect(mockedApiClient.post.mock.calls[0]).toEqual([
      '/api/admin/card-sync/previews',
      { idempotencyKey: 'preview-key' },
      60_000,
    ]);
    expect(mockedApiClient.post.mock.calls[1]).toEqual([
      '/api/admin/card-sync/runs',
      { previewId: 'preview-1', idempotencyKey: 'apply-key' },
    ]);
    expect(mockedApiClient.post.mock.calls[1]?.[1]).not.toHaveProperty('collection');
    expect(mockedApiClient.post.mock.calls[1]?.[1]).not.toHaveProperty('status');
    expect(mockedApiClient.post.mock.calls[1]?.[1]).not.toHaveProperty('imageFlags');
  });

  it('encodes run identifiers and only polls active states', async () => {
    mockedApiClient.get.mockResolvedValue({
      data: {
        id: 'run/unsafe',
        previewId: 'preview-1',
        status: 'SUCCEEDED',
        createdAt: '2026-08-22T12:01:00.000Z',
        summary: {
          totalCount: 1,
          succeededCount: 1,
          failedCount: 0,
          pendingCount: 0,
        },
        items: [],
      },
      error: null,
    });

    await fetchCardSyncRun('run/unsafe');

    expect(mockedApiClient.get.mock.calls).toContainEqual([
      '/api/admin/card-sync/runs/run%2Funsafe',
    ]);
    expect(isCardSyncRunActive('QUEUED')).toBe(true);
    expect(isCardSyncRunActive('RUNNING')).toBe(true);
    expect(isCardSyncRunActive('PARTIAL')).toBe(false);
    expect(isCardSyncRunActive('FAILED')).toBe(false);
  });
});
