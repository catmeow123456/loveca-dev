import express, { type Router } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { battleRouter } from '../../src/server/routes/battle';
import { onlineRouter } from '../../src/server/routes/online';

const openServers: ReturnType<express.Express['listen']>[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        })
    )
  );
});

describe('private match-record response cache headers', () => {
  it.each([
    ['battle replay', battleRouter, '/match-records/match-1/replay'],
    ['battle audit', battleRouter, '/match-records/match-1/audit'],
    ['battle admin export', battleRouter, '/admin/match-records/match-1/export'],
    ['online replay alias', onlineRouter, '/match-records/match-1/replay'],
    ['online audit alias', onlineRouter, '/match-records/match-1/audit'],
  ])('marks %s responses as private and non-storable', async (_label, router, path) => {
    const response = await fetchRouter(router, path);

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
});

async function fetchRouter(router: Router, path: string): Promise<Response> {
  const app = express();
  app.use(router);
  const server = app.listen(0);
  openServers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not expose a TCP port');
  }
  return fetch(`http://127.0.0.1:${address.port}${path}`);
}
