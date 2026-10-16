import { once } from 'node:events';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { publicTableRouter } from '../../src/server/routes/public-table';

describe('retired casual ticket protocol', () => {
  it('retires reads and writes rather than forwarding old heartbeats into the new pool', async () => {
    const app = express();
    app.use('/api/public-table', publicTableRouter);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No address');
      for (const [method, path] of [
        ['GET', 'summary'],
        ['GET', 'me'],
        ['POST', 'join'],
        ['POST', 'heartbeat'],
        ['POST', 'confirm'],
        ['POST', 'cancel'],
      ]) {
        const response = await globalThis.fetch(
          `http://127.0.0.1:${address.port}/api/public-table/${path}`,
          {
            method,
          }
        );
        expect(response.status).toBe(410);
        expect(await response.json()).toMatchObject({
          data: null,
          error: { code: 'CASUAL_ENTRY_RETIRED' },
        });
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
