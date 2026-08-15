/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/unbound-method */
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/server/services/theme-table-admin-service.js', () => ({
  ThemeTableAdminServiceError: class ThemeTableAdminServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number
    ) {
      super(message);
    }
  },
  themeTableAdminService: {
    getEnvironmentPreview: vi.fn(),
    listEvents: vi.fn(),
    createDraft: vi.fn(),
    updateDraft: vi.fn(),
    updateOperations: vi.fn(),
    addDeck: vi.fn(),
    updateDeck: vi.fn(),
    deleteDeck: vi.fn(),
    addMatchup: vi.fn(),
    setMatchupEnabled: vi.fn(),
    runLifecycleAction: vi.fn(),
  },
}));

import { themeTableAdminRouter } from '../../src/server/routes/theme-table-admin';
import { themeTableAdminService } from '../../src/server/services/theme-table-admin-service';

type RouteMethod = 'delete' | 'get' | 'post' | 'put';

function findRoute(path: string, method: RouteMethod) {
  const layer = themeTableAdminRouter.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route;
}

async function invoke(path: string, method: RouteMethod, options: Partial<Request> = {}) {
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
    user: { id: '22222222-2222-4222-8222-222222222222', role: 'admin' },
    body: undefined,
    query: {},
    params: {},
    ...options,
  } as Request;
  for (const layer of findRoute(path, method).stack) {
    if (response.body !== null) break;
    await new Promise<void>((resolve, reject) => {
      const next: NextFunction = (error?: unknown) => (error ? reject(toError(error)) : resolve());
      try {
        const result = layer.handle(request, response, next);
        if (result && typeof (result as Promise<void>).then === 'function') {
          void (result as Promise<void>).then(resolve, reject);
        } else if (response.body !== null) {
          resolve();
        }
      } catch (error) {
        reject(toError(error));
      }
    });
  }
  return response;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

const validDraft = {
  versionKey: 'summer-discovery-1',
  name: '夏日发现局',
  platformTimeZone: 'Asia/Shanghai',
  openWindows: [{ weekdays: [6, 7], startMinute: 1140, endMinute: 1380 }],
  startsAt: '2026-08-08T00:00:00.000Z',
  endsAt: '2026-08-22T00:00:00.000Z',
  scheduleLabel: '周末 19:00–23:00',
  summary: '体验不同构筑思路',
  announcement: '不计入排位，确认后随机分配预组。',
  evaluationPolicy: {
    minimumCompletedMatchesPerPair: 20,
    minimumCompletionRate: 0.8,
    maximumExceptionRate: 0.05,
    maximumExposureDeviation: 0.1,
    maximumMedianWaitSeconds: 180,
    winRateLowerBound: 0.35,
    winRateUpperBound: 0.65,
    baselineWindowLabel: '前两周同窗口',
  },
};

const validOperations = {
  name: '盛夏发现局',
  openWindows: [{ weekdays: [6, 7], startMinute: 1080, endMinute: 1380 }],
  startsAt: '2026-08-09T00:00:00.000Z',
  endsAt: '2026-08-30T00:00:00.000Z',
  scheduleLabel: '周末 18:00–23:00',
  summary: '调整后的玩家说明',
  announcement: '不计入排位，确认后随机分配预组。',
};

describe('themeTableAdminRouter', () => {
  afterEach(() => vi.clearAllMocks());

  it('coerces schedule timestamps and uses the authenticated admin identity', async () => {
    vi.mocked(themeTableAdminService.createDraft).mockResolvedValue({ id: 'theme-1' } as never);

    const response = await invoke('/events', 'post', { body: validDraft });

    expect(response.statusCode).toBe(201);
    expect(themeTableAdminService.createDraft).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      expect.objectContaining({ startsAt: expect.any(Date), endsAt: expect.any(Date) })
    );
  });

  it('rejects a malformed evaluation policy before calling the service', async () => {
    const response = await invoke('/events', 'post', {
      body: {
        ...validDraft,
        evaluationPolicy: { ...validDraft.evaluationPolicy, winRateLowerBound: 0.8 },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(themeTableAdminService.createDraft).not.toHaveBeenCalled();
  });

  it('routes editable operations for a started theme season', async () => {
    vi.mocked(themeTableAdminService.updateOperations).mockResolvedValue({
      id: 'theme-1',
    } as never);

    const response = await invoke('/events/:themeId/operations', 'put', {
      params: { themeId: '11111111-1111-4111-8111-111111111111' },
      body: validOperations,
    });

    expect(response.statusCode).toBe(200);
    expect(themeTableAdminService.updateOperations).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ startsAt: expect.any(Date), endsAt: expect.any(Date) })
    );
  });

  it('routes a published matchup disable through the narrow enabled endpoint', async () => {
    vi.mocked(themeTableAdminService.setMatchupEnabled).mockResolvedValue({
      id: 'pair-1',
    } as never);
    const response = await invoke('/events/:themeId/matchups/:matchupId/enabled', 'put', {
      params: {
        themeId: '11111111-1111-4111-8111-111111111111',
        matchupId: '33333333-3333-4333-8333-333333333333',
      },
      body: { enabled: false },
    });

    expect(response.statusCode).toBe(200);
    expect(themeTableAdminService.setMatchupEnabled).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      false
    );
  });

  it('rejects a prebuilt deck source URL that is not HTTP or HTTPS', async () => {
    const response = await invoke('/events/:themeId/decks', 'post', {
      params: { themeId: '11111111-1111-4111-8111-111111111111' },
      body: {
        sourceType: 'CLOUD',
        sourceDeckId: '33333333-3333-4333-8333-333333333333',
        deckKey: 'unsafe-source',
        displayName: '不安全来源',
        playStyleTags: ['测试'],
        difficulty: 'BEGINNER',
        sourceLabel: '外部来源',
        sourceUrl: 'javascript:alert(document.domain)',
        reviewNote: '双向试打完成',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(themeTableAdminService.addDeck).not.toHaveBeenCalled();
  });

  it('accepts a YAML source without requiring a cloud deck id', async () => {
    vi.mocked(themeTableAdminService.addDeck).mockResolvedValue({ id: 'deck-1' } as never);
    const response = await invoke('/events/:themeId/decks', 'post', {
      params: { themeId: '11111111-1111-4111-8111-111111111111' },
      body: {
        sourceType: 'YAML',
        yamlContent: 'player_name: 彩虹混合',
        deckKey: 'rainbow-mix',
        displayName: '彩虹混合',
        playStyleTags: [],
        difficulty: 'INTERMEDIATE',
        sourceLabel: 'YAML · rainbow.yaml',
        sourceUrl: null,
        reviewNote: '管理员导入',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(themeTableAdminService.addDeck).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ sourceType: 'YAML', yamlContent: 'player_name: 彩虹混合' })
    );
  });

  it('routes an edited YAML deck to the version replacement endpoint', async () => {
    vi.mocked(themeTableAdminService.updateDeck).mockResolvedValue({ id: 'deck-2' } as never);
    const response = await invoke('/events/:themeId/decks/:deckId', 'put', {
      params: {
        themeId: '11111111-1111-4111-8111-111111111111',
        deckId: '33333333-3333-4333-8333-333333333333',
      },
      body: {
        sourceType: 'YAML',
        yamlContent: 'player_name: 彩虹混合改',
        displayName: '彩虹混合改',
        playStyleTags: [],
        difficulty: 'INTERMEDIATE',
        sourceLabel: 'DeckLog N33A0',
        sourceUrl: 'https://decklog.bushiroad.com/view/N33A0',
        reviewNote: '运行期调整',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(themeTableAdminService.updateDeck).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
      expect.objectContaining({ sourceType: 'YAML', displayName: '彩虹混合改' })
    );
  });

  it('routes deck removal through the pool endpoint', async () => {
    vi.mocked(themeTableAdminService.deleteDeck).mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      disabledMatchupCount: 3,
    } as never);
    const response = await invoke('/events/:themeId/decks/:deckId', 'delete', {
      params: {
        themeId: '11111111-1111-4111-8111-111111111111',
        deckId: '33333333-3333-4333-8333-333333333333',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(themeTableAdminService.deleteDeck).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333'
    );
  });
});
