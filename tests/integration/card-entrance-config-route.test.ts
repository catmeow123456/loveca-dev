import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../../src/server/db/pool.js', () => ({ pool: { query: mocks.query } }));
vi.mock('../../src/server/services/card-entrance-config-service.js', () => ({
  cardEntranceConfigService: { getConfig: mocks.read, updateConfig: mocks.update },
}));
vi.mock('../../src/server/services/online-match-service.js', () => ({
  onlineMatchService: { refreshCardEntrancePolicy: mocks.refresh },
}));
vi.mock('../../src/server/services/debug-match-service.js', () => ({
  applyDebugCardEntranceConfig: mocks.debug,
}));
import { siteAnnouncementsRouter } from '../../src/server/routes/site-announcements';
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((r) => server.close(() => r()));
  vi.clearAllMocks();
});
async function fixture() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get('x-test-role');
    if (role === 'admin' || role === 'user') req.user = { id: 'test-user', role };
    next();
  });
  app.use('/config', siteAnnouncementsRouter);
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('address');
  return (role?: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${address.port}/config/admin/card-entrance`, {
      method: body === undefined ? 'GET' : 'PUT',
      headers: { 'content-type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}
it('requires platform permission and validates booleans before saving', async () => {
  const request = await fixture();
  mocks.query.mockResolvedValue({ rows: [{ role: 'admin' }] });
  mocks.read.mockResolvedValue({ enabled: true });
  expect((await request()).status).toBe(401);
  expect((await request('user')).status).toBe(403);
  expect((await request('admin', { enabled: 'false' })).status).toBe(400);
  expect(mocks.update).not.toHaveBeenCalled();
  expect((await request('admin')).status).toBe(200);
  mocks.update.mockResolvedValue({ enabled: false });
  mocks.refresh.mockResolvedValue(undefined);
  expect((await request('admin', { enabled: false })).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith({ enabled: false }, 'test-user');
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  expect(mocks.debug).toHaveBeenCalledWith(false);
});
it('rejects a stale administrator token after its database role is revoked', async () => {
  const request = await fixture();
  mocks.query.mockResolvedValue({ rows: [{ role: 'user' }] });
  expect((await request('admin', { enabled: false })).status).toBe(403);
  expect(mocks.update).not.toHaveBeenCalled();
});
