import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  listTracks: vi.fn(),
  uploadTrack: vi.fn(),
  setDefaultTracks: vi.fn(),
  deleteTrack: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
}));

vi.mock('../../src/server/services/matchmaking-bgm-service.js', () => ({
  MatchmakingBgmServiceError: class MatchmakingBgmServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number
    ) {
      super(message);
    }
  },
  matchmakingBgmService: {
    listTracks: mocks.listTracks,
    uploadTrack: mocks.uploadTrack,
    setDefaultTracks: mocks.setDefaultTracks,
    deleteTrack: mocks.deleteTrack,
  },
}));

import { matchmakingBgmRouter } from '../../src/server/routes/matchmaking-bgm';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TRACK_ID = '22222222-2222-4222-8222-222222222222';

describe('matchmakingBgmRouter', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the current library publicly with no-store caching', async () => {
    mocks.listTracks.mockResolvedValue([track()]);

    const response = await request('/');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, max-age=0');
    await expect(response.json()).resolves.toMatchObject({
      data: { tracks: [expect.objectContaining({ id: TRACK_ID })] },
      error: null,
    });
  });

  it('allows a current platform administrator to upload one MP3', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'admin' }], rowCount: 1 });
    mocks.uploadTrack.mockResolvedValue(track({ title: '上传曲目' }));
    const form = new FormData();
    form.append('title', '上传曲目');
    form.append('file', new Blob(['ID3audio'], { type: 'audio/mpeg' }), 'waiting.mp3');

    const response = await request('/admin', { method: 'POST', body: form }, true);

    expect(response.status).toBe(201);
    expect(mocks.uploadTrack).toHaveBeenCalledWith({
      file: Buffer.from('ID3audio'),
      title: '上传曲目',
      adminUserId: ADMIN_ID,
    });
  });

  it('permits an eight-track administrator batch within the upload limits', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'admin' }], rowCount: 1 });
    mocks.uploadTrack.mockImplementation(async ({ title }: { title: string }) => track({ title }));

    for (let index = 0; index < 8; index += 1) {
      const form = new FormData();
      form.append('title', `批量曲目 ${index + 1}`);
      form.append('file', new Blob(['ID3audio'], { type: 'audio/mpeg' }), `waiting-${index}.mp3`);

      const response = await request('/admin', { method: 'POST', body: form }, true);

      expect(response.status).toBe(201);
    }

    expect(mocks.uploadTrack).toHaveBeenCalledTimes(8);
  });

  it('rejects multipart uploads with undeclared extra fields', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'admin' }], rowCount: 1 });
    const form = new FormData();
    form.append('title', '上传曲目');
    form.append('unexpected', 'extra');
    form.append('file', new Blob(['ID3audio'], { type: 'audio/mpeg' }), 'waiting.mp3');

    const response = await request('/admin', { method: 'POST', body: form }, true);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'MATCHMAKING_BGM_MULTIPART_INVALID' },
    });
    expect(mocks.uploadTrack).not.toHaveBeenCalled();
  });

  it('rejects stale authority before deleting a track', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'user' }], rowCount: 1 });

    const response = await request(`/admin/${TRACK_ID}`, { method: 'DELETE' }, true);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'AUTHORIZATION_STALE' },
    });
    expect(mocks.deleteTrack).not.toHaveBeenCalled();
  });

  it('allows a current platform administrator to replace the default subset', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'admin' }], rowCount: 1 });
    mocks.setDefaultTracks.mockResolvedValue([track({ defaultSelected: true })]);

    const response = await request(
      '/admin/default',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trackIds: [TRACK_ID] }),
      },
      true
    );

    expect(response.status).toBe(200);
    expect(mocks.setDefaultTracks).toHaveBeenCalledWith([TRACK_ID]);
  });
});

async function request(path: string, init: RequestInit = {}, authenticated = false) {
  const app = express();
  app.use(express.json());
  if (authenticated) {
    app.use((req, _res, next) => {
      req.user = {
        id: ADMIN_ID,
        email: 'admin@example.com',
        emailVerified: true,
        role: 'admin',
      };
      next();
    });
  }
  app.use(matchmakingBgmRouter);
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    return await globalThis.fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

function track(overrides: Partial<{ title: string; defaultSelected: boolean }> = {}) {
  return {
    id: TRACK_ID,
    title: 'Intro Theme',
    audioUrl: '/music/intro-theme.mp3',
    byteSize: 2111155,
    source: 'BUNDLED',
    defaultSelected: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}
