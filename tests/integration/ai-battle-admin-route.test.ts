import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUserRole } from '../../src/shared/auth/permissions';
import { fromTransport } from '../../src/online/serde';
import { GameCommandType } from '../../src/application/game-commands';
import { deck } from '../helpers/ai-battle-fixture';

const auth = vi.hoisted(() => ({ roles: new Map<string, string>() }));
vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: (_sql: string, values: string[]) =>
      Promise.resolve({
        rows: auth.roles.has(values[0]!) ? [{ role: auth.roles.get(values[0]!) }] : [],
      }),
  },
}));
vi.mock('../../src/server/middleware/require-gameplay-available.js', () => ({
  requireGameplayAvailable: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { AiBattleService } from '../../src/server/services/ai-battle-service';
import {
  OnlineMatchService,
  onlineMatchService,
} from '../../src/server/services/online-match-service';
import { createAiBattleRouter } from '../../src/server/routes/ai-battle';
import { onlineRouter } from '../../src/server/routes/online';
import type { AiBattleSessionView } from '../../src/server/services/ai-battle-service';

const servers: ReturnType<express.Express['listen']>[] = [];
const input = {
  humanPresetId: 'muse-starter',
  aiPresetId: 'muse-starter',
  handbookId: 'muse-balanced',
  humanSeat: 'FIRST' as const,
};
const material = {
  id: 'test',
  title: 'test',
  source: 'test',
  sha256: 'test',
  content: 'test knowledge',
};

function createService() {
  const matches = new OnlineMatchService({ recorder: null });
  const createModel = vi.fn(() =>
    Promise.resolve({ decide: () => Promise.resolve({ kind: 'RESPONSE' as const, text: '{}' }) })
  );
  const start = vi.fn(() => Promise.resolve());
  const preset = {
    id: 'muse-starter',
    name: '预组',
    deck: deck(),
    yaml: material,
    pointValidation: { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 },
  };
  const service = new AiBattleService({
    matchService: matches,
    driver: { start },
    createModel,
    loadProfile: (userId) => Promise.resolve({ userId, displayName: '管理员' }),
    presets: {
      list: () =>
        Promise.resolve([
          {
            id: preset.id,
            name: preset.name,
            defaultHandbookId: 'muse-balanced',
            handbooks: [{ id: 'muse-balanced', name: '均衡' }],
          },
        ]),
      load: () =>
        Promise.resolve({
          human: preset,
          ai: preset,
          knowledge: {
            rules: { ...material, id: 'rules' },
            tutorial: { ...material, id: 'tutorial' },
            handbook: { ...material, id: 'handbook' },
            ownDeck: { ...material, id: 'ownDeck' },
          },
        }),
    },
  });
  return { service, matches, createModel, start };
}

async function serverFixture() {
  const f = createService();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.get('x-test-user');
    const role = req.get('x-test-role');
    if (id && isUserRole(role)) req.user = { id, role };
    next();
  });
  app.use('/ai', createAiBattleRouter(f.service));
  app.use('/online', onlineRouter);
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  const request = (
    path: string,
    options: { userId?: string; role?: string; body?: unknown; method?: string } = {}
  ) =>
    globalThis.fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        ...(options.userId
          ? { 'x-test-user': options.userId, 'x-test-role': options.role ?? 'admin' }
          : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  return { ...f, request };
}

afterEach(async () => {
  vi.restoreAllMocks();
  auth.roles.clear();
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          )
      )
  );
});

describe('AI administrator routes and ownership', () => {
  it('serves retained observations without driving the game and scopes a decision to its own match', async () => {
    const f = await serverFixture();
    auth.roles.set('owner', 'admin');
    const created = await f.service.create('owner', input);
    const id = created.session.matchId;
    const beforeRevision = f.matches.getMatch(id)!.remoteRevision;
    for (const suffix of ['/decisions', '/export']) {
      const response = await f.request(`/ai/sessions/${id}${suffix}`, { userId: 'owner' });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.json()).toBeDefined();
    }
    expect(f.matches.getMatch(id)!.remoteRevision).toBe(beforeRevision);
    expect(f.start).toHaveBeenCalledTimes(1);
    expect(
      (await f.request(`/ai/sessions/${id}/decisions/not-retained`, { userId: 'owner' })).status
    ).toBe(404);
    await f.service.end('owner', id);
    const exported = await f.request(`/ai/sessions/${id}/export`, { userId: 'owner' });
    expect(exported.status).toBe(200);
    expect(await exported.json()).toMatchObject({
      format: 'loveca-ai-observation-v1',
      matchId: id,
      decisions: [],
      incompleteMaterialIds: [],
    });
    expect(f.matches.getMatch(id)).toBeNull();
  });

  it.each([
    { userId: undefined, role: undefined, status: 401 },
    { userId: 'player', role: 'user', status: 403 },
    { userId: 'season', role: 'season_admin', status: 403 },
  ])(
    'denies unauthorized list/create/end with private cache headers: $role',
    async ({ userId, role, status }) => {
      const f = await serverFixture();
      if (userId) auth.roles.set(userId, role!);
      for (const [path, method, body] of [
        ['/ai/sessions', 'GET', undefined],
        ['/ai/sessions', 'POST', input],
        ['/ai/sessions/unknown/end', 'POST', {}],
        ['/ai/sessions/unknown/advance', 'POST', {}],
      ] as const) {
        const response = await f.request(path, { userId, role, method, body });
        expect(response.status).toBe(status);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
      }
      expect(f.matches.getRuntimeStats().matchCount).toBe(0);
    }
  );

  it('creates only the authenticated human seat and denies another administrator before and after end', async () => {
    const f = await serverFixture();
    auth.roles.set('owner', 'admin');
    auth.roles.set('other', 'admin');
    const created = await f.request('/ai/sessions', { userId: 'owner', body: input });
    expect(created.status).toBe(201);
    const data = fromTransport<{ data: { session: AiBattleSessionView } }>(
      await created.json()
    ).data;
    const id = data.session.matchId;
    const match = f.matches.getMatch(id)!;
    expect(match.participants.FIRST).toMatchObject({ userId: 'owner', participantKind: 'USER' });
    expect(match.participants.SECOND).toMatchObject({
      ownerUserId: 'owner',
      participantKind: 'SYSTEM',
    });
    for (const suffix of [
      '',
      '/snapshot',
      '/public-events',
      '/decisions',
      '/decisions/1',
      '/export',
      '/end',
      '/advance',
    ]) {
      const response = await f.request(`/ai/sessions/${id}${suffix}`, {
        userId: 'other',
        method: suffix === '/end' || suffix === '/advance' ? 'POST' : 'GET',
      });
      expect(response.status).toBe(404);
    }
    const command = {
      type: GameCommandType.MULLIGAN,
      playerId: match.participants.SECOND.playerId,
      timestamp: 1,
      cardIdsToMulligan: [],
    };
    const before = match.remoteRevision;
    expect(
      (await f.request(`/ai/sessions/${id}/command`, { userId: 'other', body: { command } })).status
    ).toBe(404);
    const accepted = await f.request(`/ai/sessions/${id}/command`, {
      userId: 'owner',
      body: { command },
    });
    expect(accepted.status).toBe(200);
    expect(fromTransport<{ data: { success: boolean } }>(await accepted.json()).data.success).toBe(
      true
    );
    expect(match.remoteRevision).toBe(before + 1);
    expect(match.session.getCommandLogSince(0).at(-1)?.playerId).toBe(
      match.participants.FIRST.playerId
    );
    expect(
      (await f.request(`/ai/sessions/${id}/end`, { userId: 'owner', method: 'POST' })).status
    ).toBe(200);
    expect(f.matches.getMatch(id)).toBeNull();
    expect(
      (await f.request(`/ai/sessions/${id}/end`, { userId: 'owner', method: 'POST' })).status
    ).toBe(200);
    expect((await f.request(`/ai/sessions/${id}`, { userId: 'other' })).status).toBe(404);
    expect((await f.request(`/ai/sessions/${id}`, { userId: 'owner' })).status).toBe(200);
    expect((await f.request(`/ai/sessions/${id}/export`, { userId: 'owner' })).status).toBe(200);
    expect((await f.request(`/ai/sessions/${id}/export`, { userId: 'other' })).status).toBe(404);
    auth.roles.set('owner', 'user');
    expect((await f.request(`/ai/sessions/${id}`, { userId: 'owner' })).status).toBe(403);
    expect((await f.request(`/ai/sessions/${id}/export`, { userId: 'owner' })).status).toBe(403);
  });

  it('rejects extra creation parameters and rechecks revoked roles on the generic online path', async () => {
    const f = await serverFixture();
    auth.roles.set('owner', 'admin');
    for (const extra of [
      { userId: 'other' },
      { playerId: 'system' },
      { deckPath: '/tmp/deck' },
      { upstream: 'https://example.test' },
    ]) {
      expect(
        (await f.request('/ai/sessions', { userId: 'owner', body: { ...input, ...extra } })).status
      ).toBe(400);
    }
    const created = await f.service.create('owner', input);
    vi.spyOn(onlineMatchService, 'getMatch').mockImplementation((id) => f.matches.getMatch(id));
    auth.roles.set('owner', 'user');
    const response = await f.request(`/online/matches/${created.session.matchId}/command`, {
      userId: 'owner',
      body: { command: { type: GameCommandType.SURRENDER } },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(f.matches.isMatchCompleted(created.session.matchId)).toBe(false);
  });

  it('does not expose another administrator AI match through generic debug exports or spectator links', async () => {
    const f = await serverFixture();
    auth.roles.set('owner', 'admin');
    auth.roles.set('other', 'admin');
    const { session } = await f.service.create('owner', input);
    const id = session.matchId;
    vi.spyOn(onlineMatchService, 'getMatch').mockImplementation((matchId) =>
      f.matches.getMatch(matchId)
    );
    for (const [suffix, method, body] of [
      ['/debug-replay/export', 'GET', undefined],
      ['/spectator-links/player-view', 'POST', { viewerSeat: 'SECOND' }],
    ] as const) {
      const response = await f.request(`/online/admin/matches/${id}${suffix}`, {
        userId: 'other',
        method,
        body,
      });
      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(await f.matches.createAdminPlayerViewSpectatorLink(id, 'SECOND')).toBeNull();
    expect(
      f.matches.createRoomCodePlayerViewSpectatorLink(id, 'SECOND', ['FIRST', 'SECOND'], 'fixture')
    ).toBeNull();
    auth.roles.set('owner', 'user');
    const revoked = await f.request(`/online/admin/matches/${id}/debug-replay/export`, {
      userId: 'owner',
    });
    expect(revoked.status).toBe(403);
    expect(revoked.headers.get('cache-control')).toBe('private, no-store');
  });

  it('rejects malformed command shapes and manual overrides before authority execution', async () => {
    const f = await serverFixture();
    auth.roles.set('owner', 'admin');
    const created = await f.service.create('owner', input);
    const match = f.matches.getMatch(created.session.matchId)!;
    const revision = match.remoteRevision;
    for (const command of [
      null,
      [],
      { type: GameCommandType.MULLIGAN, cardIdsToMulligan: 'all' },
      { type: GameCommandType.MOVE_TABLE_CARD, cardId: 'anything' },
      { type: GameCommandType.CONFIRM_EFFECT_STEP, effectId: 'effect', selectedCardIds: [null] },
    ]) {
      const response = await f.request(`/ai/sessions/${match.matchId}/command`, {
        userId: 'owner',
        body: { command },
      });
      expect(response.status).toBe(400);
    }
    expect(match.remoteRevision).toBe(revision);
    expect(match.session.getCommandLogSince(0)).toHaveLength(0);
  });

  it('bounds concurrent creation and retains a failed startup when its cleanup needs retry', async () => {
    const f = createService();
    const pending = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) => f.service.create(`owner-${index}`, input))
    );
    expect(pending.filter((result) => result.status === 'fulfilled')).toHaveLength(4);
    const failure = pending.find((result) => result.status === 'rejected');
    expect(failure?.status).toBe('rejected');
    if (failure?.status === 'rejected')
      expect(failure.reason).toMatchObject({ code: 'AI_CAPACITY_FULL' });
    expect(f.matches.getRuntimeStats().matchCount).toBe(4);

    const failed = createService();
    failed.start.mockRejectedValueOnce(new Error('driver start failed'));
    const remove = vi.spyOn(failed.matches, 'deleteMatch').mockResolvedValueOnce(false);
    await expect(failed.service.create('owner', input)).rejects.toMatchObject({
      code: 'AI_CREATE_CLEANUP_FAILED',
    });
    const retained = failed.service.listSessions('owner');
    expect(retained).toHaveLength(1);
    expect(retained[0]?.stoppedReason).toBe('AI_CREATE_CLEANUP_FAILED');
    remove.mockRestore();
    await failed.service.end('owner', retained[0]!.matchId);
    expect(failed.matches.getRuntimeStats().matchCount).toBe(0);
  });

  it('captures final failure accounting after an earlier queued model completion', async () => {
    const f = createService();
    const created = await f.service.create('owner', { ...input, humanSeat: 'SECOND' });
    const id = created.session.matchId;
    await f.matches.attachAiBattle(id, () => {});
    const task = await f.matches.advanceAiBattle(id);
    if (task.kind !== 'MODEL') throw new Error('Missing initial strategy task');
    const completion = f.matches.completeAiBattleTask(id, task.task, {
      kind: 'RESPONSE',
      text: '{}',
    });
    const ending = f.service.end('owner', id);
    expect((await completion).kind).toBe('ACCEPTED');
    expect((await ending).consecutiveFailures).toBe(1);
    expect(f.service.getSession('owner', id).consecutiveFailures).toBe(1);
    expect(f.matches.getMatch(id)).toBeNull();
  });

  it('validates the model before registering a match and releases creation occupancy after failure', async () => {
    const f = createService();
    f.createModel.mockRejectedValueOnce(new Error('model configuration missing'));
    await expect(f.service.create('owner', input)).rejects.toThrow('model configuration missing');
    expect(f.matches.getRuntimeStats().matchCount).toBe(0);
    expect(f.start).not.toHaveBeenCalled();
    const created = await f.service.create('owner', input);
    expect(f.matches.getMatch(created.session.matchId)).not.toBeNull();
    await expect(f.service.create('owner', input)).rejects.toMatchObject({
      code: 'AI_MATCH_ALREADY_ACTIVE',
    });
    const remove = vi.spyOn(f.matches, 'endAiBattle').mockResolvedValueOnce({
      removed: false,
      endedAt: Date.now(),
      consecutiveFailures: 0,
      stoppedReason: null,
    });
    await expect(f.service.end('owner', created.session.matchId)).rejects.toMatchObject({
      code: 'AI_END_FAILED',
    });
    expect(f.service.getSession('owner', created.session.matchId).endedAt).toBeNull();
    remove.mockRestore();
    await f.service.end('owner', created.session.matchId);
    expect(f.matches.getMatch(created.session.matchId)).toBeNull();
  });
});
