/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/server/services/ranked-player-service.js', () => ({
  RankedPlayerServiceError: class RankedPlayerServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number
    ) {
      super(message);
    }
  },
  rankedPlayerService: {
    getOverview: vi.fn(),
    join: vi.fn(),
    heartbeat: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
  },
}));

vi.mock('../../src/server/services/ranked-environment-service.js', () => ({
  RankedEnvironmentServiceError: class RankedEnvironmentServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number
    ) {
      super(message);
    }
  },
  rankedEnvironmentService: {
    getSeasonEnvironment: vi.fn(),
  },
}));

vi.mock('../../src/server/services/site-announcement-service.js', () => ({
  siteAnnouncementService: {
    getGameplayRestriction: vi.fn(),
  },
}));

import { rankedRouter } from '../../src/server/routes/ranked';
import { rankedEnvironmentService } from '../../src/server/services/ranked-environment-service';
import { rankedPlayerService } from '../../src/server/services/ranked-player-service';

function createResponse() {
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
  return response as Response & { statusCode: number; body: Record<string, unknown> | null };
}

function findRoute(path: string, method: 'get' | 'post') {
  const layer = rankedRouter.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) throw new Error(`route not found: ${method} ${path}`);
  return layer.route;
}

async function invoke(
  path: string,
  method: 'get' | 'post',
  body?: unknown,
  query: Record<string, unknown> = {}
) {
  const route = findRoute(path, method);
  const response = createResponse();
  const request = {
    body,
    query,
    user: { id: '11111111-1111-4111-8111-111111111111', role: 'user' },
  } as Request;
  for (const layer of route.stack) {
    if (response.body !== null) break;
    await new Promise<void>((resolve, reject) => {
      const next: NextFunction = (error?: unknown) =>
        error ? reject(error instanceof Error ? error : new Error('middleware failed')) : resolve();
      const result = layer.handle(request, response, next);
      if (result && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).then(resolve, reject);
      } else if (response.body !== null) {
        resolve();
      }
    });
  }
  return response;
}

describe('rankedRouter', () => {
  afterEach(() => vi.clearAllMocks());

  it('returns the authenticated player overview', async () => {
    vi.mocked(rankedPlayerService.getOverview).mockResolvedValue({
      season: null,
      availability: {
        state: 'NO_SEASON',
        canJoin: false,
        message: '当前没有开放中的赛季',
        nextOpensAt: null,
        currentWindowEndsAt: null,
      },
      player: null,
      queue: {
        state: 'IDLE',
        ticketId: null,
        joinedAt: null,
        deckName: null,
        reservationId: null,
        confirmationExpiresAt: null,
        confirmed: false,
        roomCode: null,
        roomGeneration: null,
        message: null,
      },
      recentMatches: [],
      leaderboard: [],
    });

    const response = await invoke('/overview', 'get');

    expect(response.statusCode).toBe(200);
    expect(rankedPlayerService.getOverview).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      undefined
    );
  });

  it('validates the cloud deck id before joining', async () => {
    const response = await invoke('/queue/join', 'post', { deckId: 'not-a-uuid' });

    expect(response.statusCode).toBe(400);
    expect(rankedPlayerService.join).not.toHaveBeenCalled();
  });

  it('returns the selected public season environment', async () => {
    const seasonId = '22222222-2222-4222-8222-222222222222';
    vi.mocked(rankedEnvironmentService.getSeasonEnvironment).mockResolvedValue({
      seasonId,
      displayMode: 'PLAYER_EQUAL',
      visibleSections: ['USAGE'],
      topRankedPlayerCount: 30,
      sample: {
        settledMatchCount: 1,
        analyzedMatchCount: 1,
        deckObservationCount: 2,
        playerCount: 2,
        winningPlayerCount: 0,
        topRankedEligiblePlayerCount: 0,
        topRankedAnalyzedPlayerCount: 0,
        topRankedDeckObservationCount: 0,
        coverageRate: 1,
      },
      rankings: [{ section: 'USAGE', weighting: 'PLAYER_EQUAL', cards: [] }],
    });

    const response = await invoke('/environment', 'get', undefined, { seasonId });

    expect(response.statusCode).toBe(200);
    expect(rankedEnvironmentService.getSeasonEnvironment).toHaveBeenCalledWith(seasonId);
  });

  it('requires a valid season id for environment reads', async () => {
    const response = await invoke('/environment', 'get', undefined, { seasonId: 'invalid' });

    expect(response.statusCode).toBe(400);
    expect(rankedEnvironmentService.getSeasonEnvironment).not.toHaveBeenCalled();
  });
});
