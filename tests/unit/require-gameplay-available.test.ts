import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../../src/server/services/site-announcement-service.js', () => ({
  siteAnnouncementService: {
    getGameplayRestriction: vi.fn(),
  },
}));

import { requireGameplayAvailable } from '../../src/server/middleware/require-gameplay-available';
import { siteAnnouncementService } from '../../src/server/services/site-announcement-service';

function createMockResponse() {
  const response = {
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
  };

  return response as Response & {
    statusCode: number;
    body: {
      data: unknown;
      error: { code: string; message: string } | null;
    } | null;
  };
}

describe('requireGameplayAvailable', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('allows gameplay actions when no maintenance restriction is active', async () => {
    vi.mocked(siteAnnouncementService.getGameplayRestriction).mockResolvedValue(null);
    const response = createMockResponse();
    const next = vi.fn() as NextFunction;

    await requireGameplayAvailable({} as Request, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.body).toBeNull();
  });

  it('rejects new gameplay actions while maintenance is active', async () => {
    vi.mocked(siteAnnouncementService.getGameplayRestriction).mockResolvedValue({
      id: 'default',
      title: '维护中',
      summary: '服务正在维护，暂时限制新的对局。',
      detail: null,
      startsAt: null,
      estimatedEndsAt: null,
      restrictsNewGamesAt: null,
      impactScopes: [],
      restrictions: [],
      action: null,
      updatedAt: '2026-07-08T08:00:00.000Z',
    });
    const response = createMockResponse();
    const next = vi.fn() as NextFunction;

    await requireGameplayAvailable({} as Request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(503);
    expect(response.body?.error).toEqual({
      code: 'SITE_MAINTENANCE',
      message: '服务正在维护，暂时限制新的对局。',
    });
  });
});
