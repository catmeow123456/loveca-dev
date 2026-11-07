/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  getOverview: vi.fn(),
  listTemplateMatchCandidates: vi.fn(),
  getClassificationRun: vi.fn(),
  updateDisplaySettings: vi.fn(),
  updateExecutionSettings: vi.fn(),
  createArchetype: vi.fn(),
  createTemplateFromMatch: vi.fn(),
  previewTemplateYaml: vi.fn(),
  createTemplateFromYaml: vi.fn(),
  updateArchetypeDisplay: vi.fn(),
  createTemplateFromReview: vi.fn(),
  updateTemplate: vi.fn(),
  publishRelease: vi.fn(),
  setOverride: vi.fn(),
  notify: vi.fn(),
  preview: vi.fn(),
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
    listTemplateMatchCandidates: mocks.listTemplateMatchCandidates,
    getClassificationRun: mocks.getClassificationRun,
    updateDisplaySettings: mocks.updateDisplaySettings,
    updateExecutionSettings: mocks.updateExecutionSettings,
    createArchetype: mocks.createArchetype,
    createTemplateFromMatch: mocks.createTemplateFromMatch,
    previewTemplateYaml: mocks.previewTemplateYaml,
    createTemplateFromYaml: mocks.createTemplateFromYaml,
    updateArchetypeDisplay: mocks.updateArchetypeDisplay,
    createTemplateFromReview: mocks.createTemplateFromReview,
    updateTemplate: mocks.updateTemplate,
    publishRelease: mocks.publishRelease,
    setOverride: mocks.setOverride,
  },
}));

vi.mock('../../src/server/services/deck-classifier-process-runtime.js', () => ({
  DeckClassifierProcessError: class extends Error {},
  deckClassifierProcess: { notify: mocks.notify, preview: mocks.preview },
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
  params: Record<string, string> = {},
  query: Record<string, string> = {}
) {
  const response = createResponse();
  const request = {
    user: { id: '22222222-2222-4222-8222-222222222222', role: 'season_admin' },
    requestId: 'request-1',
    params,
    query,
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

  it('saves the configured daily limit without starting a classification task', async () => {
    mocks.updateExecutionSettings.mockResolvedValue({ recentMatchLimit: 120 });
    const response = await invoke('/execution-settings', 'put', {
      recentMatchLimit: 120,
      reason: '调整重算场数',
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.updateExecutionSettings).toHaveBeenCalledWith(
      { recentMatchLimit: 120, reason: '调整重算场数' },
      expect.any(Object)
    );
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, 10001, null, '200'])(
    'rejects invalid daily limit %s',
    async (recentMatchLimit) => {
      const response = await invoke('/execution-settings', 'put', {
        recentMatchLimit,
        reason: '调整重算场数',
      });
      expect(response.statusCode).toBe(400);
      expect(mocks.updateExecutionSettings).not.toHaveBeenCalled();
    }
  );

  it('dispatches preview to the child process with an explicit scope', async () => {
    mocks.preview.mockResolvedValue({ observationCount: 1000 });
    const response = await invoke('/preview', 'post', {
      expectedDraftRevision: 4,
      matchLimit: 200,
    });
    expect(response.statusCode).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith(4, 200);
    expect(mocks.publishRelease).not.toHaveBeenCalled();
  });

  it('rejects a missing or unsupported scope before dispatching classification work', async () => {
    for (const body of [
      { expectedDraftRevision: 4 },
      { expectedDraftRevision: 4, matchLimit: 'ALL' },
    ]) {
      expect((await invoke('/preview', 'post', body)).statusCode).toBe(400);
    }
    expect(mocks.preview).not.toHaveBeenCalled();
  });

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

  it('reads candidates with validated filters and pagination without changing the draft', async () => {
    mocks.listTemplateMatchCandidates.mockResolvedValue({ items: [], hasMore: false });
    const response = await invoke(
      '/template-match-candidates',
      'get',
      undefined,
      {},
      {
        playerAQuery: ' Alpha ',
        playerBQuery: 'Beta',
        limit: '50',
        offset: '50',
        startedFrom: '1000',
        startedTo: '9000',
      }
    );
    expect(response.statusCode).toBe(200);
    expect(mocks.listTemplateMatchCandidates).toHaveBeenCalledWith({
      playerAQuery: 'Alpha',
      playerBQuery: 'Beta',
      limit: 50,
      offset: 50,
      startedFrom: 1000,
      startedTo: 9000,
    });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it.each([
    { originKind: 'UNKNOWN' },
    { originKind: 'PUBLIC_TABLE' },
    { originKind: 'SOLITAIRE' },
    { themeTableVersionId: '11111111-1111-4111-8111-111111111111' },
    { offset: '-1' },
    { limit: '101' },
    { startedFrom: '9000', startedTo: '1000' },
    { rankedSeasonId: 'invalid' },
    { playerAQuery: 'x'.repeat(121) },
    { startedFrom: '8640000000000001' },
    { themeTableVersionId: 'not-ranked' },
  ])('rejects invalid candidate filters %j', async (query) => {
    const response = await invoke('/template-match-candidates', 'get', undefined, {}, query);
    expect(response.statusCode).toBe(400);
    expect(mocks.listTemplateMatchCandidates).not.toHaveBeenCalled();
  });

  it('previews YAML without importing and validates the import envelope', async () => {
    mocks.previewTemplateYaml.mockResolvedValue({ cards: [] });
    const preview = await invoke('/templates/preview-yaml', 'post', {
      yamlContent: 'player_name: test',
    });
    expect(preview.statusCode).toBe(200);
    expect(mocks.previewTemplateYaml).toHaveBeenCalledWith('player_name: test');
    expect(mocks.createTemplateFromYaml).not.toHaveBeenCalled();
    const payload = {
      yamlContent: 'player_name: test',
      expectedDraftRevision: 7,
      archetypeId: '11111111-1111-4111-8111-111111111111',
      name: '文件样板',
      sourceNote: 'YAML 文件',
      reason: '管理员确认导入',
    };
    mocks.createTemplateFromYaml.mockResolvedValue({ id: 'template' });
    expect((await invoke('/templates/from-yaml', 'post', payload)).statusCode).toBe(201);
    expect(
      (await invoke('/templates/from-yaml', 'post', { ...payload, cards: [] })).statusCode
    ).toBe(400);
    expect(
      (await invoke('/templates/preview-yaml', 'post', { yamlContent: 'x'.repeat(65537) }))
        .statusCode
    ).toBe(400);
  });

  it('does not accept client-supplied cards, origins or player identities on import', async () => {
    const response = await invoke('/templates/from-match', 'post', {
      expectedDraftRevision: 1,
      archetypeId: '11111111-1111-4111-8111-111111111111',
      matchId: 'match-1',
      seat: 'FIRST',
      name: '样板',
      sourceNote: '',
      reason: '管理员导入测试样板',
      cards: [],
      originKind: 'PUBLIC_TABLE',
      userId: 'someone',
    });
    expect(response.statusCode).toBe(400);
    expect(mocks.createTemplateFromMatch).not.toHaveBeenCalled();
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
      matchLimit: null,
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
      },
      null
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
