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
    query.mockResolvedValue({
      rows: [{ season_id: 'season-1', match_id: 'match-1' }],
      rowCount: 1,
    } as never);
    const service = new RankedRuntimeService({
      now: () => new Date('2026-09-03T00:00:00.000Z'),
    });

    await expect(service.voidExpiredPendingMatches()).resolves.toBe(1);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("result_type = 'PLATFORM_NO_CONTEST'"),
      [new Date('2026-09-03T00:00:00.000Z')]
    );
  });
});
