import { afterEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: dbMocks.query },
}));

import { checkApplicationReadiness } from '../../src/server/services/readiness-service';

describe('checkApplicationReadiness', () => {
  afterEach(() => vi.clearAllMocks());

  it('reports ready only when the database confirms all required relations', async () => {
    dbMocks.query.mockResolvedValueOnce({ rows: [{ relation_name: 'cards' }] });
    await expect(checkApplicationReadiness(new Date('2026-08-21T12:00:00.000Z'))).resolves.toEqual({
      ready: true,
      checkedAt: '2026-08-21T12:00:00.000Z',
    });
    expect(dbMocks.query.mock.calls[0]?.[1]).toEqual([['cards', 'profiles', 'site_status_config']]);
  });

  it('reports not ready without exposing the database failure', async () => {
    dbMocks.query.mockRejectedValueOnce(new Error('connection refused'));
    await expect(checkApplicationReadiness()).resolves.toMatchObject({ ready: false });
  });
});
