/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/server/services/player-badge-service.js', () => ({
  PlayerBadgeServiceError: class PlayerBadgeServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode = 500
    ) {
      super(message);
    }
  },
  playerBadgeService: {
    listOwnBadges: vi.fn(),
  },
}));

import { playerBadgesRouter } from '../../src/server/routes/player-badges';
import { playerBadgeService } from '../../src/server/services/player-badge-service';

function routeHandler() {
  const route = playerBadgesRouter.stack.find(
    (layer) => 'route' in layer && layer.route?.path === '/me' && layer.route.methods.get
  )?.route;
  if (!route) throw new Error('GET /me route not found');
  return route.stack.at(-1)!.handle;
}

describe('playerBadgesRouter', () => {
  afterEach(() => vi.clearAllMocks());

  it('reads badges only for the authenticated player', async () => {
    vi.mocked(playerBadgeService.listOwnBadges).mockResolvedValue([]);
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
    } as Response & { statusCode: number; body: unknown };
    const request = {
      user: { id: '11111111-1111-4111-8111-111111111111', role: 'user' },
    } as Request;

    await routeHandler()(request, response, vi.fn());

    expect(playerBadgeService.listOwnBadges).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(response.body).toEqual({ data: [], error: null });
  });
});
