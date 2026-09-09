import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';
import type { GameCommand } from '../../../src/application/game-commands';
import type { CreateAiBattleInput } from '../../../src/online/ai-battle-types';
import type { AiDecisionInput } from '../../../src/server/ai-battle/protocol';
import { CardDataRegistry } from '../../../src/domain/card-data/loader';
import { toTransport, fromTransport } from '../../../src/online/serde';
import { readFrozenMuseDeck } from '../../../tests/helpers/ai-curated-decks';

const OWNER = 'ai-ui-admin';
const NOW = '2026-09-09T06:00:00.000Z';
export const CREATE_INPUT: CreateAiBattleInput = {
  humanPresetId: 'muse-starter',
  aiPresetId: 'muse-starter',
  handbookId: 'muse-balanced',
  humanSeat: 'FIRST',
};

/** Browser transport fixture backed by real services/rules/driver/traces and a fake HTTP model.
 * No business DB or upstream connection: all dependencies that read/write those are injected.
 * Route authorization is covered separately by ai-battle-admin-route.test.ts.
 */
export async function aiBrowserFixture(page: Page) {
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
    JWT_SECRET: 'ai-ui-fixture',
    JWT_REFRESH_SECRET: 'ai-ui-fixture-refresh',
    MINIO_ENDPOINT: '127.0.0.1',
    MINIO_ACCESS_KEY: 'fixture',
    MINIO_SECRET_KEY: 'fixture',
    FRONTEND_URL: 'http://localhost:5173',
  });
  const [
    { AiBattleService },
    { OnlineMatchService },
    { AiBattlePresetLoader },
    { DashScopeAiBattleClient },
    { AiBattleTraceStore },
  ] = await Promise.all([
    import('../../../src/server/services/ai-battle-service'),
    import('../../../src/server/services/online-match-service'),
    import('../../../src/server/ai-battle/presets'),
    import('../../../src/server/ai-battle/model-client'),
    import('../../../src/server/ai-battle/trace-store'),
  ]);
  const registry = new CardDataRegistry();
  const deck = readFrozenMuseDeck().deck;
  registry.load([...deck.mainDeck, ...deck.energyDeck]);
  const matches = new OnlineMatchService({ recorder: null });
  const traces = new AiBattleTraceStore();
  const state = { modelCalls: 0, writes: [] as string[], snapshots: 0, failNextEnd: false };
  const service = new AiBattleService({
    matchService: matches,
    traces,
    loadProfile: (userId) => Promise.resolve({ userId, displayName: '调试管理员' }),
    presets: new AiBattlePresetLoader({
      root: fileURLToPath(new URL('../../../', import.meta.url)),
      getRegistry: () => Promise.resolve(registry),
      getPointTable: () =>
        Promise.resolve({
          version: 'browser-fixture',
          pointLimit: 9,
          effectiveFrom: NOW,
          entries: {},
        }),
    }),
    createModel: (knowledge, store) =>
      Promise.resolve(
        new DashScopeAiBattleClient(
          {
            endpoint: 'https://fixture.example/compatible-mode/v1/chat/completions',
            model: 'browser-fake-model',
            apiKey: 'browser-fake-secret',
            temperature: 0.2,
            maxTokens: 2048,
          },
          knowledge,
          store,
          (_url, init) => {
            state.modelCalls++;
            const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
            const content = body.messages.at(-1)!.content;
            const input = JSON.parse(content.slice(content.indexOf('\n') + 1)) as AiDecisionInput;
            const selection =
              input.space.kind === 'CARDS'
                ? {
                    kind: 'CARDS',
                    cardRefs: input.space.candidates.slice(0, input.space.min).map((c) => c.ref),
                  }
                : {
                    kind: 'ACTION',
                    actionRef: (input.space.candidates.find((c) =>
                      c.description.includes('结束')
                    ) ?? input.space.candidates[0])!.ref,
                  };
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({ selection, tradeoff: '浏览器夹具固定选择' }),
                      },
                      finish_reason: 'stop',
                    },
                  ],
                }),
                { status: 200, headers: { 'content-type': 'application/json' } }
              )
            );
          }
        )
      ),
  });
  await page.route('**/site-status.json*', (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        availability: 'OPEN',
        generatedAt: NOW,
        maintenance: null,
      },
    })
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === '/api/cards') return route.fallback(); // Existing published card/image display.
    if (path === '/api/config')
      return fulfill(route, {
        features: {
          email: { enabled: false, verificationRequired: false, passwordResetEnabled: false },
          battleEntries: { ranked: true, themeTable: true },
          battleTimeouts: { playerActionTimeoutSeconds: 180, reconnectGracePeriodSeconds: 60 },
        },
        siteStatus: { lifecycle: 'NORMAL', generatedAt: NOW, maintenance: null, announcements: [] },
        matchEmotes: null,
      });
    if (path === '/api/auth/refresh')
      return fulfill(route, {
        accessToken: 'ai-ui-fixture-token',
        user: { id: OWNER, email: 'ai-ui@example.test' },
        profile: {
          id: OWNER,
          username: 'ai_ui_admin',
          display_name: '调试管理员',
          avatar_url: null,
          role: 'admin',
          deck_count: 0,
          created_at: NOW,
          updated_at: NOW,
        },
      });
    if (path === '/api/decks' || path === '/api/player-badges/me') return fulfill(route, []);
    if (!path.startsWith('/api/admin/ai-battle')) return fulfill(route, null);
    if (request.method() !== 'GET') state.writes.push(path);
    try {
      if (path.endsWith('/presets')) return fulfill(route, await service.listPresets());
      if (path.endsWith('/sessions'))
        return fulfill(
          route,
          request.method() === 'POST'
            ? await service.create(OWNER, request.postDataJSON() as CreateAiBattleInput)
            : service.listSessions(OWNER)
        );
      const segments = path.split('/');
      const id = segments[5]!;
      const operation = segments[6];
      if (!operation) return fulfill(route, service.getSession(OWNER, id));
      if (operation === 'snapshot') {
        state.snapshots++;
        return fulfill(
          route,
          await service.snapshot(
            OWNER,
            id,
            url.searchParams.has('sinceSeq') ? Number(url.searchParams.get('sinceSeq')) : undefined
          )
        );
      }
      if (operation === 'public-events')
        return fulfill(
          route,
          await service.publicEvents(OWNER, id, Number(url.searchParams.get('afterSeq') ?? 0))
        );
      if (operation === 'command')
        return fulfill(
          route,
          await service.command(
            OWNER,
            id,
            fromTransport<{ command: GameCommand }>(request.postDataJSON()).command
          )
        );
      if (operation === 'advance') return fulfill(route, await service.advance(OWNER, id));
      if (operation === 'end') {
        if (state.failNextEnd) {
          state.failNextEnd = false;
          throw new Error('封存夹具失败，请重试结束');
        }
        return fulfill(route, await service.end(OWNER, id));
      }
      if (operation === 'decisions')
        return fulfill(
          route,
          segments[7]
            ? service.exportDecisions(OWNER, id, segments[7])
            : service.listDecisions(OWNER, id)
        );
      if (operation === 'export')
        return route.fulfill({
          json: service.exportDecisions(OWNER, id),
          headers: {
            'cache-control': 'private, no-store',
            'content-disposition': 'attachment; filename=ai-fixture.json',
          },
        });
      throw new Error(`Unhandled AI fixture route: ${path}`);
    } catch (error) {
      return route.fulfill({
        status: 503,
        json: {
          data: null,
          error: {
            code: 'AI_FIXTURE_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
        },
        headers: { 'cache-control': 'private, no-store' },
      });
    }
  });
  return {
    service,
    matches,
    traces,
    state,
    owner: OWNER,
    create: (input = CREATE_INPUT) => service.create(OWNER, input),
    close: async () => {
      for (const session of service.listSessions(OWNER))
        if (session.endedAt === null) await service.end(OWNER, session.matchId);
    },
  };
}

async function fulfill(route: Route, data: unknown) {
  await route.fulfill({
    json: { data: toTransport(data), error: null },
    headers: { 'cache-control': 'private, no-store' },
  });
}
