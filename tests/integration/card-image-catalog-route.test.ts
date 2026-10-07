import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isUserRole } from '../../src/shared/auth/permissions.js';

const mocks = vi.hoisted(() => ({ poolQuery: vi.fn() }));
vi.mock('../../src/server/db/pool.js', () => ({ pool: { query: mocks.poolQuery } }));
vi.mock('../../src/server/services/minio-service.js', () => ({
  statObject: vi.fn(),
  getObject: vi.fn(),
}));

import { createCardImageCatalogRouter } from '../../src/server/routes/card-image-catalog.js';
import { CardImageCatalogService } from '../../src/server/services/card-image-catalog-service.js';

describe('card image catalog route', () => {
  const query = vi.fn();
  const stat = vi.fn();
  const read = vi.fn();
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use((req, _res, next) => {
      const role = req.header('x-test-role');
      if (isUserRole(role)) req.user = { id: 'catalog-reader', role };
      next();
    });
    app.use(
      '/api/admin/card-images',
      createCardImageCatalogRouter(new CardImageCatalogService(query, { stat, read }))
    );
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin/card-images`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'admin' }] });
    query.mockImplementation((sql: string) =>
      Promise.resolve({
        rows: sql.includes('COUNT(*)') ? [{ total: '0' }] : [],
      })
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('rejects anonymous access before querying cards or storage', async () => {
    const response = await fetch(baseUrl);
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHORIZED');
    expect(query).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
  });

  it.each(['user', 'season_admin'])(
    'rejects the %s role for both list and detail',
    async (role) => {
      for (const path of ['', '/catalog-card']) {
        const response = await fetch(baseUrl + path, { headers: { 'x-test-role': role } });
        expect(response.status).toBe(403);
        expect((await response.json()).error.code).toBe('FORBIDDEN');
      }
      expect(query).not.toHaveBeenCalled();
      expect(stat).not.toHaveBeenCalled();
    }
  );

  it('rejects an admin token after the database role is revoked', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'user' }] });
    const response = await fetch(baseUrl, { headers: { 'x-test-role': 'admin' } });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('AUTHORIZATION_STALE');
    expect(query).not.toHaveBeenCalled();
  });

  it('returns a no-store page for a currently authorized admin', async () => {
    const response = await fetch(baseUrl, { headers: { 'x-test-role': 'admin' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      data: { items: [], total: 0, page: 1, pageSize: 48, totalPages: 0 },
      error: null,
    });
    expect(stat).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['?page=0', '?pageSize=101', '?cardType=OTHER', '?unknown=true'])(
    'rejects invalid list input %s',
    async (search) => {
      const response = await fetch(baseUrl + search, { headers: { 'x-test-role': 'admin' } });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
      expect(query).not.toHaveBeenCalled();
    }
  );

  it('returns 404 for an unknown card without reading storage', async () => {
    const response = await fetch(baseUrl + '/catalog-card', {
      headers: { 'x-test-role': 'admin' },
    });
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('NOT_FOUND');
    expect(stat).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});
