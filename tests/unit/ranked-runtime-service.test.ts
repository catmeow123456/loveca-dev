import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: vi.fn() },
}));
vi.mock('../../src/server/services/public-table-service.js', () => ({
  publicTableService: { expireWaitingTickets: vi.fn() },
}));
vi.mock('../../src/server/services/ranked-rating-service.js', () => ({
  rankedRatingService: { settleMatch: vi.fn() },
}));

import { pool } from '../../src/server/db/pool';
import { RankedRuntimeService } from '../../src/server/services/ranked-runtime-service';
import { rankedRatingService } from '../../src/server/services/ranked-rating-service';

describe('RankedRuntimeService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('moves scheduled seasons into finalizing and pauses admission', async () => {
    // pg exposes query as a method; the Vitest replacement is intentionally used as a detached mock.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const query = vi.mocked(pool.query);
    query.mockResolvedValue({
      rows: [{ id: 'season-1' }],
      rowCount: 1,
    } as never);
    const service = new RankedRuntimeService({
      now: () => new Date('2026-09-01T00:00:00.000Z'),
    });

    await expect(service.transitionEndedSeasons()).resolves.toBe(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("lifecycle = 'FINALIZING'"), [
      new Date('2026-09-01T00:00:00.000Z'),
    ]);
  });

  it('marks unresolved matches as platform no-contest after the finalizing deadline', async () => {
    // pg exposes query as a method; the Vitest replacement is intentionally used as a detached mock.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const query = vi.mocked(pool.query);
    query
      .mockResolvedValueOnce({
        rows: [
          {
            season_id: 'season-1',
            match_id: 'match-1',
            record_status: 'INTERRUPTED',
          },
        ],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({
        rows: [{ season_id: 'season-1', match_id: 'match-1' }],
        rowCount: 1,
      } as never);
    const service = new RankedRuntimeService({
      now: () => new Date('2026-09-03T00:00:00.000Z'),
    });

    await expect(service.voidExpiredPendingMatches()).resolves.toBe(1);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("result_type = 'PLATFORM_NO_CONTEST'"),
      ['match-1', new Date('2026-09-03T00:00:00.000Z')]
    );
  });

  it('drains more than one settlement batch before deadline voiding can run', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const query = vi.mocked(pool.query);
    query
      .mockResolvedValueOnce({
        rows: Array.from({ length: 50 }, (_, index) => ({ match_id: `match-${index}` })),
        rowCount: 50,
      } as never)
      .mockResolvedValueOnce({
        rows: [{ match_id: 'match-50' }],
        rowCount: 1,
      } as never);
    vi.mocked(rankedRatingService.settleMatch).mockResolvedValue({} as never);
    const service = new RankedRuntimeService();

    await expect(service.drainPendingSettlements()).resolves.toEqual({
      settlementCandidates: 51,
      settledMatches: 51,
      deferredSettlements: 0,
    });
    expect(rankedRatingService.settleMatch).toHaveBeenCalledTimes(51);
  });

  it('keeps a reliably sealed result pending when settlement is transiently deferred at deadline', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const query = vi.mocked(pool.query);
    query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never)
      .mockResolvedValueOnce({
        rows: [{ match_id: 'match-retry' }],
        rowCount: 1,
      } as never)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
    vi.mocked(rankedRatingService.settleMatch).mockRejectedValueOnce(
      Object.assign(new Error('serialization failure'), { code: '40001' })
    );
    const service = new RankedRuntimeService({
      now: () => new Date('2026-09-03T00:00:00.000Z'),
    });

    await expect(service.cleanup()).resolves.toMatchObject({
      settlementCandidates: 1,
      settledMatches: 0,
      deferredSettlements: 1,
      voidedExpiredMatches: 0,
    });
    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("record.status IN ('COMPLETED', 'SURRENDERED')"),
      [new Date('2026-09-03T00:00:00.000Z')]
    );
  });

  it('does not void an in-progress match unless its authority runtime was terminated', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const query = vi.mocked(pool.query);
    query.mockResolvedValueOnce({
      rows: [
        {
          season_id: 'season-1',
          match_id: 'match-running',
          record_status: 'IN_PROGRESS',
        },
      ],
      rowCount: 1,
    } as never);
    const terminateRuntimeMatch = vi.fn(async () => false);
    const service = new RankedRuntimeService({
      now: () => new Date('2026-09-03T00:00:00.000Z'),
    });

    await expect(service.voidExpiredPendingMatches({ terminateRuntimeMatch })).resolves.toBe(0);
    expect(terminateRuntimeMatch).toHaveBeenCalledWith(
      'match-running',
      new Date('2026-09-03T00:00:00.000Z'),
      'RANKED_FINALIZING_DEADLINE_EXCEEDED'
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
});
