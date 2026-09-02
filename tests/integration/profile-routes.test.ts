import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: mocks.poolQuery,
  },
}));

import { profilesRouter } from '../../src/server/routes/profiles';

interface RouterLayer {
  handle: RequestHandler;
  route?: {
    path: string;
    methods: Partial<Record<'put', boolean>>;
    stack: RouterLayer[];
  };
}

interface MockResponse extends Response {
  statusCode: number;
  body: {
    data: Record<string, unknown> | null;
    error: { code: string; message: string } | null;
  } | null;
}

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: MockResponse['body']) {
      this.body = payload;
      return this;
    },
  } as unknown as MockResponse;
}

async function invokeProfileUpdate(body: unknown): Promise<MockResponse> {
  const route = (profilesRouter.stack as unknown as RouterLayer[]).find(
    (layer) => layer.route?.path === '/:id' && layer.route.methods.put
  )?.route;
  if (!route) throw new Error('Profile update route not found');

  const response = createMockResponse();
  const userId = '11111111-1111-4111-8111-111111111111';
  const request = {
    params: { id: userId },
    query: {},
    body,
    headers: {},
    user: { id: userId, role: 'user' },
  } as unknown as Request;

  for (const layer of route.stack) {
    if (response.body !== null) break;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const complete = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) reject(error instanceof Error ? error : new Error('Middleware failed'));
        else resolve();
      };
      const next: NextFunction = (error?: unknown) => complete(error);
      try {
        const result = layer.handle(request, response, next);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          void (result as Promise<unknown>).then(() => complete(), complete);
        } else if (response.body !== null) {
          complete();
        }
      } catch (error) {
        complete(error);
      }
    });
  }

  return response;
}

describe('profilesRouter account updates', () => {
  beforeEach(() => {
    mocks.poolQuery.mockReset();
  });

  it('lets a user update their own username and display name', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          username: 'new_name',
          display_name: '新名字',
        },
      ],
      rowCount: 1,
    });

    const response = await invokeProfileUpdate({
      username: 'new_name',
      display_name: '新名字',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body?.data).toMatchObject({
      username: 'new_name',
      display_name: '新名字',
    });
    const [query, values] = mocks.poolQuery.mock.calls[0] as [string, unknown[]];
    expect(query).toContain('username = $1');
    expect(query).toContain('display_name = $2');
    expect(query).toContain('updated_at = now()');
    expect(values).toEqual(['new_name', '新名字', '11111111-1111-4111-8111-111111111111']);
  });

  it('rejects an invalid username before querying the database', async () => {
    const response = await invokeProfileUpdate({ username: '含空格 用户名' });

    expect(response.statusCode).toBe(400);
    expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('rejects role changes through the general profile endpoint', async () => {
    const response = await invokeProfileUpdate({ role: 'season_admin' });

    expect(response.statusCode).toBe(400);
    expect(response.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });

  it('returns a conflict when another profile already owns the username', async () => {
    mocks.poolQuery.mockRejectedValue({ code: '23505' });

    const response = await invokeProfileUpdate({ username: 'existing_name' });

    expect(response.statusCode).toBe(409);
    expect(response.body?.error?.code).toBe('USERNAME_TAKEN');
  });

  it('stores an explicit user BGM subset and allows returning to platform defaults', async () => {
    const firstTrackId = '22222222-2222-4222-8222-222222222222';
    const secondTrackId = '33333333-3333-4333-8333-333333333333';
    mocks.poolQuery.mockResolvedValue({
      rows: [{ matchmaking_bgm_track_ids: [firstTrackId, secondTrackId] }],
      rowCount: 1,
    });

    const customResponse = await invokeProfileUpdate({
      matchmaking_bgm_track_ids: [firstTrackId, secondTrackId],
    });

    expect(customResponse.statusCode).toBe(200);
    expect(mocks.poolQuery.mock.calls[0]?.[1]).toEqual([
      [firstTrackId, secondTrackId],
      '11111111-1111-4111-8111-111111111111',
    ]);

    mocks.poolQuery.mockResolvedValue({
      rows: [{ matchmaking_bgm_track_ids: null }],
      rowCount: 1,
    });
    const defaultResponse = await invokeProfileUpdate({ matchmaking_bgm_track_ids: null });

    expect(defaultResponse.statusCode).toBe(200);
    expect(mocks.poolQuery.mock.calls[1]?.[1]).toEqual([
      null,
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('rejects invalid or duplicate BGM track ids before querying the database', async () => {
    const duplicateId = '22222222-2222-4222-8222-222222222222';

    const invalidResponse = await invokeProfileUpdate({
      matchmaking_bgm_track_ids: ['not-a-uuid'],
    });
    const duplicateResponse = await invokeProfileUpdate({
      matchmaking_bgm_track_ids: [duplicateId, duplicateId],
    });

    expect(invalidResponse.statusCode).toBe(400);
    expect(duplicateResponse.statusCode).toBe(400);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
  });
});
