import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RankedAdminPlayerPage } from './rankedAdminClient';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: mocks.apiGet,
  },
}));

import {
  fetchRankedAdminDeckStatistics,
  fetchRankedAdminPlayers,
  rankedAdminPlayerSnapshotKey,
} from './rankedAdminClient';

function playerPage(overrides: Partial<RankedAdminPlayerPage> = {}): RankedAdminPlayerPage {
  return {
    seasonId: 'season-1',
    generatedAt: '2026-08-29T00:00:00.000Z',
    ledgerRevision: 8,
    placementRequired: 5,
    leaderboardMinimumMatchCount: 10,
    classificationRelease: { id: 'release-1', version: 3 },
    query: '',
    limit: 50,
    offset: 0,
    total: 0,
    players: [],
    ...overrides,
  };
}

describe('ranked admin insight client', () => {
  beforeEach(() => {
    mocks.apiGet.mockReset();
    mocks.apiGet.mockResolvedValue({ data: {} });
  });

  it('requests deck statistics for the encoded season', async () => {
    await fetchRankedAdminDeckStatistics('season id/%');

    expect(mocks.apiGet).toHaveBeenCalledWith(
      '/api/admin/ranked/deck-statistics?seasonId=season%20id%2F%25'
    );
  });

  it('uses 50-player pages and preserves literal wildcard characters in the query', async () => {
    await fetchRankedAdminPlayers({
      seasonId: 'season-1',
      query: '  %_ player  ',
      offset: 50,
    });

    const requestUrl = new URL(mocks.apiGet.mock.calls[0]![0], 'https://loveca.test');
    expect(requestUrl.pathname).toBe('/api/admin/ranked/players');
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
      seasonId: 'season-1',
      limit: '50',
      offset: '50',
      q: '%_ player',
    });
  });

  it('only treats ledger, thresholds, and classification release as pagination snapshot state', () => {
    const base = playerPage();
    expect(
      rankedAdminPlayerSnapshotKey(
        playerPage({ generatedAt: 'later', query: 'filtered', offset: 50, total: 120 })
      )
    ).toBe(rankedAdminPlayerSnapshotKey(base));

    expect(rankedAdminPlayerSnapshotKey(playerPage({ ledgerRevision: 9 }))).not.toBe(
      rankedAdminPlayerSnapshotKey(base)
    );
    expect(rankedAdminPlayerSnapshotKey(playerPage({ placementRequired: 6 }))).not.toBe(
      rankedAdminPlayerSnapshotKey(base)
    );
    expect(rankedAdminPlayerSnapshotKey(playerPage({ leaderboardMinimumMatchCount: 11 }))).not.toBe(
      rankedAdminPlayerSnapshotKey(base)
    );
    expect(
      rankedAdminPlayerSnapshotKey({
        ...base,
        classificationRelease: { id: 'release-2', version: 4 },
      })
    ).not.toBe(rankedAdminPlayerSnapshotKey(base));
  });
});
