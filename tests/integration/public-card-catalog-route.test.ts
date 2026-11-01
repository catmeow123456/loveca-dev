import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { publicCardRecordSchema } from '../../src/shared/public-card-catalog.js';

vi.mock('../../src/server/db/pool.js', () => ({ pool: { query: vi.fn() } }));
import { pool } from '../../src/server/db/pool.js';
import { cardsRouter } from '../../src/server/routes/cards.js';

// The mocked query does not depend on a Pool receiver.
// eslint-disable-next-line @typescript-eslint/unbound-method
const queryMock = vi.mocked(pool.query);

let server: Server;
let baseUrl: string;
const record = {
  ...Object.fromEntries(Object.keys(publicCardRecordSchema.shape).map((key) => [key, null])),
  card_code: 'test-energy',
  card_type: 'ENERGY',
  name_cn: '测试能量',
  hearts: [],
  requirements: [],
  id: 'private-id',
  updated_by: 'private-actor',
  source_flags: { secret: 'private' },
};

beforeEach(async () => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [record] } as never);
  const app = express();
  app.use((req, _res, next) => {
    if (req.header('authorization')) req.user = { id: 'admin', role: 'admin' };
    next();
  });
  app.use('/api/cards', cardsRouter);
  app.use(
    (_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next;
      res.status(500).json({ data: null, error: { code: 'INTERNAL_ERROR' } });
    }
  );
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it('does not serve the retired full-list endpoint', async () => {
  const response = await globalThis.fetch(`${baseUrl}/api/cards?status=all`);
  expect(response.status).toBe(404);
  expect(queryMock).not.toHaveBeenCalled();
});

it('serves the same published-only projection regardless of identity or query', async () => {
  const guest = await globalThis.fetch(`${baseUrl}/api/cards/published`);
  const admin = await globalThis.fetch(`${baseUrl}/api/cards/published?status=all`, {
    headers: { Authorization: 'Bearer test' },
  });
  expect(guest.status).toBe(200);
  expect(admin.headers.get('etag')).toBe(guest.headers.get('etag'));
  const body: unknown = await guest.json();
  expect(body).toMatchObject({
    data: { schemaVersion: 1, cards: [publicCardRecordSchema.parse(record)] },
  });
  expect(JSON.stringify(body)).not.toContain('private');
  expect(admin.headers.get('cache-control')).toBe('public, no-cache');
  for (const [sql] of queryMock.mock.calls) expect(sql).toContain("WHERE status = 'PUBLISHED'");
});

it('revalidates unchanged content and returns new data after an edit or removal', async () => {
  const first = await globalThis.fetch(`${baseUrl}/api/cards/published`);
  const etag = first.headers.get('etag')!;
  await first.text();
  const same = await globalThis.fetch(`${baseUrl}/api/cards/published`, {
    // Match browser revalidation. Node fetch otherwise adds no-cache when a
    // caller supplies If-None-Match, which explicitly requests a fresh response.
    headers: { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' },
  });
  expect(same.status).toBe(304);
  expect(await same.text()).toBe('');
  queryMock.mockResolvedValue({ rows: [{ ...record, name_cn: '新版能量' }] } as never);
  const changed = await globalThis.fetch(`${baseUrl}/api/cards/published`, {
    headers: { 'If-None-Match': etag, 'Cache-Control': 'max-age=0' },
  });
  expect(changed.status).toBe(200);
  expect(changed.headers.get('etag')).not.toBe(etag);
  expect(await changed.json()).toMatchObject({ data: { cards: [{ name_cn: '新版能量' }] } });
  queryMock.mockResolvedValue({ rows: [] } as never);
  const empty = await globalThis.fetch(`${baseUrl}/api/cards/published`);
  expect(empty.status).toBe(500);
  expect(empty.headers.get('cache-control')).toBe('no-store');
});
