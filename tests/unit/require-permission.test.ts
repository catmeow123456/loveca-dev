import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
}));

import { requirePermission } from '../../src/server/middleware/require-permission';

function createResponse() {
  return {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  } as Response & {
    statusCode: number;
    body: { error?: { code?: string } } | null;
  };
}

async function runMiddleware(request: Request, response: Response, next: NextFunction) {
  await requirePermission('season.ranked.manage')(request, response, next);
}

describe('requirePermission', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('rejects a low-privilege token without trusting a later database promotion', async () => {
    const response = createResponse();
    const next = vi.fn();

    await runMiddleware({ user: { id: 'user-1', role: 'user' } } as Request, response, next);

    expect(response.statusCode).toBe(403);
    expect(response.body?.error?.code).toBe('FORBIDDEN');
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a season admin only when the database role still matches the token', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [{ role: 'season_admin' }],
      rowCount: 1,
    });
    const response = createResponse();
    const next = vi.fn();

    await runMiddleware(
      { user: { id: 'season-admin-1', role: 'season_admin' } } as Request,
      response,
      next
    );

    expect(mocks.poolQuery).toHaveBeenCalledWith('SELECT role FROM profiles WHERE id = $1', [
      'season-admin-1',
    ]);
    expect(next).toHaveBeenCalledOnce();
    expect(response.body).toBeNull();
  });

  it('immediately rejects an old privileged token after database demotion', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'user' }], rowCount: 1 });
    const response = createResponse();
    const next = vi.fn();

    await runMiddleware(
      { user: { id: 'season-admin-1', role: 'season_admin' } } as Request,
      response,
      next
    );

    expect(response.statusCode).toBe(403);
    expect(response.body?.error?.code).toBe('AUTHORIZATION_STALE');
    expect(next).not.toHaveBeenCalled();
  });

  it('does not grant platform permissions to a season admin', async () => {
    const response = createResponse();
    const next = vi.fn();

    await requirePermission('platform.manage')(
      { user: { id: 'season-admin-1', role: 'season_admin' } } as Request,
      response,
      next
    );

    expect(response.statusCode).toBe(403);
    expect(response.body?.error?.code).toBe('FORBIDDEN');
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
