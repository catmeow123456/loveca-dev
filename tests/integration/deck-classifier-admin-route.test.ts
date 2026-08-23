/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  getOverview: vi.fn(),
  getClassificationRun: vi.fn(),
  updateDisplaySettings: vi.fn(),
  createArchetype: vi.fn(),
  updateArchetypeDisplay: vi.fn(),
  createTemplateFromReview: vi.fn(),
  updateTemplate: vi.fn(),
  publishRelease: vi.fn(),
  setOverride: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('../../src/server/db/pool.js', () => ({
  pool: { query: mocks.poolQuery },
}));

vi.mock('../../src/server/services/deck-classifier-admin-service.js', () => ({
  DeckClassifierAdminServiceError: class DeckClassifierAdminServiceError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly statusCode: number
    ) {
      super(message);
    }
  },
  deckClassifierAdminService: {
    getOverview: mocks.getOverview,
    getClassificationRun: mocks.getClassificationRun,
    updateDisplaySettings: mocks.updateDisplaySettings,
    createArchetype: mocks.createArchetype,
    updateArchetypeDisplay: mocks.updateArchetypeDisplay,
    createTemplateFromReview: mocks.createTemplateFromReview,
    updateTemplate: mocks.updateTemplate,
    publishRelease: mocks.publishRelease,
    setOverride: mocks.setOverride,
  },
}));

vi.mock('../../src/server/services/deck-classification-worker.js', () => ({
  deckClassificationWorker: { notify: mocks.notify },
}));

import { deckClassifierAdminRouter } from '../../src/server/routes/deck-classifier-admin';

type RouteMethod = 'get' | 'post' | 'put' | 'delete';

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
  return response as Response & { statusCode: number; body: unknown };
}

function findRoute(path: string, method: RouteMethod) {
  const layer = deckClassifierAdminRouter.stack.find(
    (candidate) =>
      'route' in candidate && candidate.route?.path === path && candidate.route.methods[method]
  );
  if (!layer?.route) throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  return layer.route;
}

async function invoke(
  path: string,
  method: RouteMethod,
  body: unknown,
  params: Record<string, string> = {}
) {
  const response = createResponse();
  const request = {
    user: { id: '22222222-2222-4222-8222-222222222222', role: 'season_admin' },
    requestId: 'request-1',
    params,
    query: {},
    body,
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

describe('deckClassifierAdminRouter', () => {
  afterEach(() => vi.clearAllMocks());

  it('allows a current season administrator through the module permission boundary', async () => {
    mocks.poolQuery.mockResolvedValue({ rows: [{ role: 'season_admin' }], rowCount: 1 });
    const response = createResponse();
    const next = vi.fn();

    await deckClassifierAdminRouter.stack[1].handle(
      { user: { id: 'season-admin-1', role: 'season_admin' } } as Request,
      response,
      next
    );

    expect(next).toHaveBeenCalledOnce();
    expect(response.body).toBeNull();
  });

  it('returns one classification run for asynchronous status polling', async () => {
    const runId = '44444444-4444-4444-8444-444444444444';
    mocks.getClassificationRun.mockResolvedValue({ id: runId, status: 'SUCCEEDED' });
    const response = await invoke('/runs/:runId', 'get', undefined, { runId });

    expect(response.statusCode).toBe(200);
    expect(mocks.getClassificationRun).toHaveBeenCalledWith(runId);
  });

  it('rejects an ordinary player before querying current management role', () => {
    const response = createResponse();
    const next = vi.fn();

    deckClassifierAdminRouter.stack[1].handle(
      { user: { id: 'user-1', role: 'user' } } as Request,
      response,
      next
    );

    expect(response.statusCode).toBe(403);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('publishes with the authenticated season administrator and wakes the worker', async () => {
    mocks.publishRelease.mockResolvedValue({ release: { id: 'release-1' }, run: { id: 'run-1' } });
    const response = await invoke('/releases', 'post', {
      expectedDraftRevision: 4,
      reason: '发布经复核的分类版本',
      idempotencyKey: 'deck-classifier:publish:test-1',
    });

    expect(response.statusCode).toBe(202);
    expect(mocks.publishRelease).toHaveBeenCalledWith(
      4,
      '发布经复核的分类版本',
      'deck-classifier:publish:test-1',
      {
        actorUserId: '22222222-2222-4222-8222-222222222222',
        actorRole: 'season_admin',
        requestId: 'request-1',
      }
    );
    expect(mocks.notify).toHaveBeenCalledOnce();
  });

  it('accepts an optional representative card when creating a draft archetype', async () => {
    mocks.createArchetype.mockResolvedValue({ id: 'archetype-1' });
    const body = {
      expectedDraftRevision: 4,
      archetypeKey: 'test_archetype',
      name: '测试卡组',
      groupName: '测试系列',
      description: '',
      color: '#123456',
      representativeCardCode: 'PL!-bp1-001-P',
      sortOrder: 10,
      reason: '创建带代表卡的测试分类',
    };
    const response = await invoke('/archetypes', 'post', body);

    expect(response.statusCode).toBe(201);
    expect(mocks.createArchetype).toHaveBeenCalledWith(body, {
      actorUserId: '22222222-2222-4222-8222-222222222222',
      actorRole: 'season_admin',
      requestId: 'request-1',
    });
  });

  it('accepts independently selected player environment sections and weighting', async () => {
    mocks.updateDisplaySettings.mockResolvedValue({
      displayMode: 'PLAYER_EQUAL',
      visibleSections: ['USAGE', 'TOP_RANKED'],
      cardDisplayMode: 'MATCH_EQUAL',
      cardVisibleSections: ['WINNER'],
      topRankedPlayerCount: 40,
    });
    const body = {
      displayMode: 'PLAYER_EQUAL',
      visibleSections: ['USAGE', 'TOP_RANKED'],
      cardDisplayMode: 'MATCH_EQUAL',
      cardVisibleSections: ['WINNER'],
      topRankedPlayerCount: 40,
      reason: '公开使用率和高排名玩家卡组构成',
    };
    const response = await invoke('/settings', 'put', body);

    expect(response.statusCode).toBe(200);
    expect(mocks.updateDisplaySettings).toHaveBeenCalledWith(body, {
      actorUserId: '22222222-2222-4222-8222-222222222222',
      actorRole: 'season_admin',
      requestId: 'request-1',
    });
  });

  it('updates display settings immediately without requiring a draft revision', async () => {
    mocks.updateArchetypeDisplay.mockResolvedValue({ id: 'archetype-1' });
    const body = {
      color: '#ABCDEF',
      representativeCardCode: 'PL!-bp1-001-P',
      reason: '调整玩家端卡组封面',
    };
    const archetypeId = '11111111-1111-4111-8111-111111111111';
    const response = await invoke('/archetypes/:archetypeId/display', 'put', body, { archetypeId });

    expect(response.statusCode).toBe(200);
    expect(mocks.updateArchetypeDisplay).toHaveBeenCalledWith(archetypeId, body, {
      actorUserId: '22222222-2222-4222-8222-222222222222',
      actorRole: 'season_admin',
      requestId: 'request-1',
    });
  });

  it('accepts an editable template card list and forwards it to the draft service', async () => {
    mocks.updateTemplate.mockResolvedValue({ id: 'template-1' });
    const response = createResponse();
    const request = {
      user: { id: '22222222-2222-4222-8222-222222222222', role: 'season_admin' },
      requestId: 'request-1',
      params: { templateId: '33333333-3333-4333-8333-333333333333' },
      query: {},
      body: {
        expectedDraftRevision: 4,
        archetypeId: '11111111-1111-4111-8111-111111111111',
        name: '调整后的样板',
        cards: [
          { baseCardCode: 'PL!-bp1-001', cardType: 'MEMBER', count: 48 },
          { baseCardCode: 'PL!-bp1-101', cardType: 'LIVE', count: 12 },
        ],
        sourceNote: '复核卡表后调整',
        enabled: true,
        reason: '修正样板中的卡牌数量',
      },
    } as unknown as Request;
    for (const layer of findRoute('/templates/:templateId', 'put').stack) {
      if (response.body !== null) break;
      await new Promise<void>((resolve, reject) => {
        const next: NextFunction = (error?: unknown) =>
          error ? reject(toError(error)) : resolve();
        const result = layer.handle(request, response, next);
        if (result && typeof (result as Promise<void>).then === 'function') {
          void (result as Promise<void>).then(resolve, reject);
        } else if (response.body !== null) {
          resolve();
        }
      });
    }

    expect(response.statusCode).toBe(200);
    expect(mocks.updateTemplate).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      request.body,
      {
        actorUserId: '22222222-2222-4222-8222-222222222222',
        actorRole: 'season_admin',
        requestId: 'request-1',
      }
    );
  });

  it('creates a draft template from a pending review deck', async () => {
    mocks.createTemplateFromReview.mockResolvedValue({ id: 'template-1' });
    const body = {
      expectedDraftRevision: 4,
      archetypeId: '11111111-1111-4111-8111-111111111111',
      deckFingerprint: `sha256:${'a'.repeat(64)}`,
      name: '测试卡组 · 待处理导入',
      sourceNote: '从待处理队列导入',
      reason: '将人工复核构筑加入草稿样板库',
    };
    const response = await invoke('/templates/from-review', 'post', body);

    expect(response.statusCode).toBe(201);
    expect(mocks.createTemplateFromReview).toHaveBeenCalledWith(body, {
      actorUserId: '22222222-2222-4222-8222-222222222222',
      actorRole: 'season_admin',
      requestId: 'request-1',
    });
  });

  it('rejects an override whose status and archetype shape disagree', async () => {
    const response = await invoke('/overrides', 'post', {
      deckFingerprint: `sha256:${'a'.repeat(64)}`,
      targetStatus: 'UNKNOWN',
      archetypeId: '11111111-1111-4111-8111-111111111111',
      appliesToFutureReleases: true,
      reason: '人工复核后保持未知',
      idempotencyKey: 'deck-classifier:override:test-1',
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.setOverride).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
