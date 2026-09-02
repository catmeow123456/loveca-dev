import express from 'express';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getObject: vi.fn(),
}));

vi.mock('../../src/server/services/minio-service.js', () => ({
  uploadObject: vi.fn(),
  deleteObjects: vi.fn(),
  getObject: mocks.getObject,
}));

import { publicImagesRouter } from '../../src/server/routes/images';

describe('matchmaking BGM public asset route', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('serves an uploaded content-addressed MP3 through its published URL', async () => {
    const hash = 'a'.repeat(64);
    mocks.getObject.mockResolvedValue(Readable.from(Buffer.from('ID3audio')));

    const response = await request(`/matchmaking-bgm/${hash}.mp3`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('audio/mpeg');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(mocks.getObject).toHaveBeenCalledWith(`matchmaking-bgm/${hash}.mp3`);
    await expect(response.arrayBuffer()).resolves.toEqual(
      Uint8Array.from(Buffer.from('ID3audio')).buffer
    );
  });

  it('keeps arbitrary public object folders outside the read allowlist', async () => {
    const response = await request('/private-audio/example.mp3');

    expect(response.status).toBe(404);
    expect(mocks.getObject).not.toHaveBeenCalled();
  });

  it('only exposes content-addressed MP3 names from the BGM namespace', async () => {
    const response = await request('/matchmaking-bgm/example.mp3');

    expect(response.status).toBe(404);
    expect(mocks.getObject).not.toHaveBeenCalled();
  });
});

async function request(path: string): Promise<Response> {
  const app = express();
  app.use(publicImagesRouter);
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    return await globalThis.fetch(`http://127.0.0.1:${address.port}${path}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}
