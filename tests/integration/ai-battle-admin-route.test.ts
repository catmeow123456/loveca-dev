import { AiBattleTraceStore } from '../../src/server/ai-battle/trace-store';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiBattleModelClient } from '../../src/server/ai-battle/driver';
import {
  API_AI_BATTLE_MODELS,
  AI_BATTLE_MODELS,
  type AiBattleModel,
} from '../../src/online/ai-battle-model-registry';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUserRole } from '../../src/shared/auth/permissions';
import { fromTransport } from '../../src/online/serde';
import {
  GameCommandType,
  createBeginSpecialMemberPlayCommand,
  createConfirmSpecialMemberPlayCommand,
  createCancelSpecialMemberPlayCommand,
  type GameCommand,
} from '../../src/application/game-commands';
import { deck, replaceHand, stage } from '../helpers/ai-battle-fixture';
import { readFrozenLikeATreasureDeck } from '../helpers/ai-curated-decks';
import type { CardInstance, MemberCardData } from '../../src/domain/entities/card';
import { getActiveEnergyIds } from '../../src/domain/entities/zone';
import {
  FaceState,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';
import { createMemoryAiBilling } from '../helpers/ai-battle-billing';

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

const archiveDirs: string[] = [];
const servers: ReturnType<express.Express['listen']>[] = [];
const input = {
  model: 'qwen3.8-max' as const,
  enableThinking: false,
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

function createService(models: readonly AiBattleModel[] = API_AI_BATTLE_MODELS) {
  const billing = createMemoryAiBilling();
  const traces = new AiBattleTraceStore();
  const matches = new OnlineMatchService({ recorder: null });
  const createModel = vi.fn((): Promise<AiBattleModelClient> =>
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
    now: () => Date.now(),
    traces,
    availableModels: () => models,
    billingPersistence: billing.persistence,
    matchService: matches,
    driver: { start, stop: vi.fn(async () => {}) },
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
  return { service, matches, createModel, start, billing, traces };
}

async function serverFixture(models?: readonly AiBattleModel[]) {
  const f = createService(models);
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
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  const request = (
    path: string,
    options: {
      userId?: string;
      role?: string;
      body?: unknown;
      method?: string;
      headers?: Record<string, string>;
    } = {}
  ) =>
    globalThis.fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': 'application/json',
        ...options.headers,
        ...(options.userId
          ? { 'x-test-user': options.userId, 'x-test-role': options.role ?? 'admin' }
          : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  return { ...f, request };
}

async function humanSpecialPlayFixture(energyCount = 6) {
  const f = await serverFixture();
  auth.roles.set('owner', 'admin');
  auth.roles.set('other', 'admin');
  const created = await f.service.create('owner', input);
  const match = f.matches.getMatch(created.session.matchId)!;
  const game = match.session.state!;
  Object.assign(game, {
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  });
  const cards = readFrozenLikeATreasureDeck().deck.mainDeck;
  const card = (code: string) => cards.find((card) => card.cardCode === code)!;
  const oldId = stage(match.session, card('PL!N-pb1-030-N') as MemberCardData, SlotPosition.CENTER);
  const [sourceId] = replaceHand(match.session, [card('PL!N-bp7-011-R+')]);
  const player = game.players[0];
  const [waitingMember, waitingLive] = player.mainDeck.cardIds.slice(0, 2);
  const registry = game.cardRegistry as Map<string, CardInstance>;
  registry.set(waitingMember!, { ...registry.get(waitingMember!)!, data: card('PL!HS-PR-021-RM') });
  registry.set(waitingLive!, { ...registry.get(waitingLive!)!, data: card('PL!N-bp7-031-L') });
  Object.assign(player.mainDeck, { cardIds: player.mainDeck.cardIds.slice(2) });
  Object.assign(player.waitingRoom, { cardIds: [waitingMember!, waitingLive!] });
  const energies = [...player.energyZone.cardIds, ...player.energyDeck.cardIds].slice(
    0,
    energyCount
  );
  Object.assign(player.energyZone, {
    cardIds: energies,
    cardStates: new Map(
      energies.map((id) => [id, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }])
    ),
  });
  Object.assign(player.energyDeck, {
    cardIds: player.energyDeck.cardIds.filter((id) => !energies.includes(id)),
  });
  const begin = createBeginSpecialMemberPlayCommand(
    // The route must replace the client-supplied player identity, including for special play.
    match.participants.SECOND.playerId,
    sourceId!,
    SlotPosition.CENTER,
    'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO'
  );
  const send = async (command: GameCommand, userId = 'owner') => {
    const response = await f.request(`/ai/sessions/${match.matchId}/command`, {
      userId,
      body: { command },
    });
    expect(response.status).toBe(200);
    return fromTransport<{
      data: { success: boolean; error?: string };
      error: { code: string } | null;
    }>(await response.json());
  };
  return {
    ...f,
    match,
    begin,
    send,
    sourceId: sourceId!,
    oldId,
    waitingMember: waitingMember!,
    waitingLive: waitingLive!,
    playerId: player.id,
  };
}

afterEach(async () => {
  await Promise.all(archiveDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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
  it('executes human special play begin, cancel and confirm over HTTP with authoritative costs and ownership', async () => {
    const f = await humanSpecialPlayFixture();
    const initial = structuredClone(f.match.session.state!);
    expect(
      (
        await f.request(`/ai/sessions/${f.match.matchId}/command`, {
          userId: 'other',
          body: { command: f.begin },
        })
      ).status
    ).toBe(404);
    expect(f.match.session.state).toEqual(initial);

    expect((await f.send(f.begin)).data.success).toBe(true);
    const firstPending = f.match.session.state!.pendingSpecialMemberPlay!;
    expect(firstPending.playerId).toBe(f.playerId);
    expect(getActiveEnergyIds(f.match.session.state!.players[0].energyZone)).toHaveLength(6);
    expect(
      (await f.send(createCancelSpecialMemberPlayCommand(f.playerId, firstPending.id))).data.success
    ).toBe(true);
    expect(f.match.session.state!.pendingSpecialMemberPlay).toBeNull();
    expect(f.match.session.state!.players).toEqual(initial.players);

    expect((await f.send(f.begin)).data.success).toBe(true);
    const pending = f.match.session.state!.pendingSpecialMemberPlay!;
    const beforeInvalid = structuredClone(f.match.session.state!);
    const revision = f.match.remoteRevision;
    for (const command of [
      createConfirmSpecialMemberPlayCommand(f.playerId, firstPending.id, []),
      createCancelSpecialMemberPlayCommand(f.playerId, firstPending.id),
      createConfirmSpecialMemberPlayCommand(f.playerId, pending.id, [f.waitingLive]),
    ]) {
      expect((await f.send(command)).data.success).toBe(false);
      expect(f.match.session.state).toEqual(beforeInvalid);
      expect(f.match.remoteRevision).toBe(revision);
    }

    const confirm = createConfirmSpecialMemberPlayCommand(f.playerId, pending.id, []);
    expect((await f.send(confirm)).data.success).toBe(true);
    const after = f.match.session.state!.players[0];
    expect(f.match.session.state!.pendingSpecialMemberPlay).toBeNull();
    expect(after.memberSlots.slots[SlotPosition.CENTER]).toBe(f.sourceId);
    expect(getActiveEnergyIds(after.energyZone)).toHaveLength(2);
    expect(after.mainDeck.cardIds).toContain(f.waitingMember);
    expect(after.waitingRoom.cardIds).toEqual(expect.arrayContaining([f.waitingLive, f.oldId]));
    expect(after.waitingRoom.cardIds).not.toContain(f.waitingMember);
    expect(f.match.session.getCommandLogSince(0).at(-1)?.playerId).toBe(f.playerId);
    const completed = structuredClone(f.match.session.state!);
    expect((await f.send(confirm)).data.success).toBe(false);
    expect(f.match.session.state).toEqual(completed);
  });

  it('rejects unaffordable human special play through the rules instead of the HTTP command allowlist', async () => {
    const f = await humanSpecialPlayFixture(3);
    expect((await f.send(f.begin)).data.success).toBe(true);
    const before = structuredClone(f.match.session.state!);
    const result = await f.send(
      createConfirmSpecialMemberPlayCommand(f.playerId, before.pendingSpecialMemberPlay!.id, [])
    );
    expect(result.data.success).toBe(false);
    expect(result.error?.code).toBe('COMMAND_REJECTED');
    expect(f.match.session.state).toEqual(before);
    expect(getActiveEnergyIds(f.match.session.state!.players[0].energyZone)).toHaveLength(3);
  });

  it('keeps archival off by default and rejects forged enablement before model creation', async () => {
    const f = await serverFixture();
    auth.roles.set('owner', 'admin');
    expect((await (await f.request('/ai/local-options', { userId: 'owner' })).json()).data).toEqual(
      { archiveAvailable: false }
    );
    const response = await f.request('/ai/sessions', {
      userId: 'owner',
      body: { ...input, archiveEnabled: true },
    });
    expect(response.status).toBe(400);
    expect(f.createModel).not.toHaveBeenCalled();
  });

  it('offers a per-game local archive toggle and streams only the owning administrator archive', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loveca-route-archive-'));
    archiveDirs.push(dir);
    for (const [key, value] of Object.entries({
      AI_BATTLE_LOCAL_ARCHIVE: '1',
      AI_BATTLE_ARCHIVE_DIR: dir,
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      DATABASE_URL: 'postgres://test:test@localhost/test',
      FRONTEND_URL: 'http://localhost:5173',
    }))
      vi.stubEnv(key, value);
    const f = await serverFixture();
    auth.roles.set('owner', 'admin');
    auth.roles.set('other', 'admin');
    expect((await (await f.request('/ai/local-options', { userId: 'owner' })).json()).data).toEqual(
      { archiveAvailable: true }
    );
    expect(
      (
        await f.request('/ai/local-options', {
          userId: 'owner',
          headers: { origin: 'https://remote.example' },
        })
      ).status
    ).toBe(403);
    const off = (
      await (
        await f.request('/ai/sessions', {
          userId: 'owner',
          body: { ...input, archiveEnabled: false },
        })
      ).json()
    ).data.session.matchId;
    expect(await readdir(dir)).toEqual([]);
    expect((await f.request(`/ai/sessions/${off}/archive`, { userId: 'owner' })).status).toBe(404);
    await f.service.end('owner', off);
    const enabled = await f.request('/ai/sessions', {
      userId: 'owner',
      body: { ...input, archiveEnabled: true },
    });
    expect(enabled.status).toBe(201);
    const id = (await enabled.json()).data.session.matchId;
    expect(f.service.listDecisions('owner', id).archive?.state).toBe('RECORDING');
    expect((await f.request(`/ai/sessions/${id}/archive`, { userId: 'other' })).status).toBe(404);
    expect(
      (
        await f.request(`/ai/sessions/${id}/archive`, {
          userId: 'owner',
          headers: { 'x-forwarded-for': '192.168.1.2' },
        })
      ).status
    ).toBe(403);
    const full = '完整请求'.repeat(30000);
    f.traces.begin(id, {
      id: 'large',
      revision: 1,
      windowKey: 'MAIN',
      seat: 'SECOND',
      purpose: 'MAIN',
    });
    f.traces.append(id, 'large', 'REQUEST', { text: full }, { status: 'ACCEPTED' });
    await f.service.end('owner', id);
    const response = await f.request(`/ai/sessions/${id}/archive`, { userId: 'owner' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('.jsonl');
    const raw = await response.text();
    expect(Buffer.byteLength(raw)).toBe(Number(response.headers.get('content-length')));
    const rows = raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(rows[0]).toMatchObject({
      kind: 'EXPORT',
      payload: { completeThroughExport: true, status: { state: 'ENDED' } },
    });
    expect(rows.find((row) => row.kind === 'SOURCES').payload.sources).toHaveLength(4);
    expect(rows.find((row) => row.kind === 'APPEND').payload.payload.text).toBe(full);
    expect(rows.some((row) => row.kind === 'BILLING')).toBe(true);
    expect(rows.at(-1).kind).toBe('END');
    auth.roles.set('owner', 'user');
    expect((await f.request(`/ai/sessions/${id}/archive`, { userId: 'owner' })).status).toBe(403);
    // Ended HTTP metadata expires, but disk evidence is deliberately retained.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61 * 60 * 1000);
    f.service.cleanup();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await readdir(dir)).toHaveLength(1);
  });

  it('cleans up a failed archive creation without starting the driver', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loveca-route-archive-'));
    archiveDirs.push(dir);
    const file = join(dir, 'not-a-directory');
    await writeFile(file, 'unchanged');
    for (const [key, value] of Object.entries({
      AI_BATTLE_LOCAL_ARCHIVE: '1',
      AI_BATTLE_ARCHIVE_DIR: file,
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      DATABASE_URL: 'postgres://test:test@localhost/test',
      FRONTEND_URL: 'http://localhost:5173',
    }))
      vi.stubEnv(key, value);
    const f = await serverFixture();
    auth.roles.set('owner', 'admin');
    const response = await f.request('/ai/sessions', {
      userId: 'owner',
      body: { ...input, archiveEnabled: true },
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('AI_ARCHIVE_OPEN_FAILED');
    expect(f.start).not.toHaveBeenCalled();
    expect(f.service.listSessions('owner')).toEqual([]);
  });

  it('advertises only enabled models and rejects forged Codex selection before model creation', async () => {
    const f = await serverFixture();
    auth.roles.set('owner', 'admin');
    expect((await (await f.request('/ai/models', { userId: 'owner' })).json()).data).toEqual(
      API_AI_BATTLE_MODELS
    );
    expect(
      (
        await f.request('/ai/sessions', {
          userId: 'owner',
          body: { ...input, model: 'codex:gpt-6-luna' },
        })
      ).status
    ).toBe(400);
    expect(f.createModel).not.toHaveBeenCalled();
  });

  it.each(['codex:gpt-6-luna', 'codex:gpt-6-sol'] as const)(
    'creates a local %s subscription session with no Qwen prices and blocks remote origin/proxy access',
    async (model) => {
      for (const [key, value] of Object.entries({
        AI_BATTLE_LOCAL_CODEX: '1',
        NODE_ENV: 'development',
        API_HOST: '127.0.0.1',
        DATABASE_URL: 'postgres://test:test@localhost/test',
        FRONTEND_URL: 'http://localhost:5173',
      }))
        vi.stubEnv(key, value);
      const f = await serverFixture(AI_BATTLE_MODELS);
      auth.roles.set('owner', 'admin');
      for (const headers of [
        { origin: 'https://public.example' },
        { 'x-forwarded-for': '192.168.1.2' },
      ]) {
        expect(
          (
            await f.request('/ai/sessions', {
              userId: 'owner',
              body: { ...input, model },
              headers,
            })
          ).status
        ).toBe(403);
      }
      expect(f.createModel).not.toHaveBeenCalled();
      const response = await f.request('/ai/sessions', {
        userId: 'owner',
        body: { ...input, model },
        headers: { origin: 'http://localhost:5173', 'x-forwarded-for': '127.0.0.1' },
      });
      expect(response.status).toBe(201);
      const session = (await response.json()).data.session;
      expect(session.matchBilling).toMatchObject({
        model,
        prices: null,
        pricingDate: null,
        estimatedCny: null,
      });
      expect(f.billing.records.get(session.matchId)).toMatchObject({ prices: null });
    }
  );

  it.each(['low', 'medium'] as const)(
    'passes per-game Codex effort %s and records the resolved value',
    async (reasoningEffort) => {
      const f = await serverFixture(AI_BATTLE_MODELS);
      auth.roles.set('owner', 'admin');
      f.createModel.mockResolvedValueOnce({
        reasoningEffort,
        decide: async () => ({ kind: 'RESPONSE', text: '{}' }),
      });
      const response = await f.request('/ai/sessions', {
        userId: 'owner',
        body: { ...input, model: 'codex:gpt-6-luna', reasoningEffort },
      });
      expect(response.status).toBe(201);
      expect(f.createModel).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'codex:gpt-6-luna',
        expect.anything(),
        false,
        reasoningEffort,
        undefined
      );
      expect((await response.json()).data.session.reasoningEffort).toBe(reasoningEffort);
      expect(f.service.listSessions('owner')[0]!.reasoningEffort).toBe(reasoningEffort);
    }
  );

  it.each([true, false, undefined])('freezes local Fast mode %s per match', async (fastMode) => {
    const f = await serverFixture(AI_BATTLE_MODELS);
    auth.roles.set('owner', 'admin');
    f.createModel.mockResolvedValueOnce({
      fastMode: fastMode === true,
      decide: async () => ({ kind: 'RESPONSE', text: '{}' }),
    });
    const response = await f.request('/ai/sessions', {
      userId: 'owner',
      body: { ...input, model: 'codex:gpt-6-luna', fastMode },
    });
    expect(response.status).toBe(201);
    const session = (await response.json()).data.session;
    expect(session.fastMode).toBe(fastMode === true);
    expect(f.service.getSession('owner', session.matchId).fastMode).toBe(fastMode === true);
    expect(f.createModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'codex:gpt-6-luna',
      expect.anything(),
      false,
      undefined,
      fastMode
    );
  });
  it('rejects API Fast mode, malformed flags and retired models before calling a model', async () => {
    const f = await serverFixture(AI_BATTLE_MODELS);
    auth.roles.set('owner', 'admin');
    for (const body of [
      { ...input, fastMode: true },
      { ...input, fastMode: false },
      ...['true', 1, null].map((fastMode) => ({ ...input, model: 'codex:gpt-6-luna', fastMode })),
      ...['luna', 'terra', 'sol'].map((name) => ({ ...input, model: `codex:gpt-5.6-${name}` })),
    ])
      expect((await f.request('/ai/sessions', { userId: 'owner', body })).status).toBe(400);
    expect(f.createModel).not.toHaveBeenCalled();
  });

  it('rejects invalid effort and Qwen effort before creating a model or match', async () => {
    const f = await serverFixture(AI_BATTLE_MODELS);
    auth.roles.set('owner', 'admin');
    for (const body of [
      { ...input, reasoningEffort: 'low' },
      ...['none', 'high', 'ultra', '', 1].map((reasoningEffort) => ({
        ...input,
        model: 'codex:gpt-6-luna',
        reasoningEffort,
      })),
    ])
      expect((await f.request('/ai/sessions', { userId: 'owner', body })).status).toBe(400);
    await expect(
      f.service.create('owner', { ...input, reasoningEffort: 'medium' })
    ).rejects.toThrow('思考强度仅支持');
    expect(f.createModel).not.toHaveBeenCalled();
    expect(f.service.listSessions('owner')).toEqual([]);
  });

  it('reports the effective server default for older Codex creation requests', async () => {
    const f = await serverFixture(AI_BATTLE_MODELS);
    auth.roles.set('owner', 'admin');
    f.createModel.mockResolvedValueOnce({
      reasoningEffort: 'medium',
      decide: async () => ({ kind: 'RESPONSE', text: '{}' }),
    });
    const response = await f.request('/ai/sessions', {
      userId: 'owner',
      body: { ...input, model: 'codex:gpt-6-luna' },
    });
    expect(response.status).toBe(201);
    expect((await response.json()).data.session.reasoningEffort).toBe('medium');
  });

  it.each(API_AI_BATTLE_MODELS)(
    'requires an explicit supported model and passes %s to the per-game client',
    async (model) => {
      const f = await serverFixture();
      auth.roles.set('owner', 'admin');
      for (const unsupportedModel of [
        undefined,
        'qwen3.8-max-0902',
        'qwen-next',
        'glm-5.2-fast-preview',
        'deepseek-v4-flash',
      ]) {
        expect(
          (
            await f.request('/ai/sessions', {
              userId: 'owner',
              body: { ...input, model: unsupportedModel },
            })
          ).status
        ).toBe(400);
      }
      expect(f.createModel).not.toHaveBeenCalled();
      const response = await f.request('/ai/sessions', {
        userId: 'owner',
        body: { ...input, model },
      });
      expect(response.status).toBe(201);
      const result = (await response.json()) as { data: { session: AiBattleSessionView } };
      expect(result.data.session).toMatchObject({
        model,
        matchBilling: { model, attempts: 0 },
      });
      expect(f.createModel).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        model,
        expect.anything(),
        false,
        undefined,
        undefined
      );
    }
  );

  it.each([true, false])(
    'validates and freezes the thinking switch (%s) for the session',
    async (enableThinking) => {
      const f = await serverFixture();
      auth.roles.set('owner', 'admin');
      for (const invalid of [undefined, null, 'true', 'false', 0, 1]) {
        expect(
          (
            await f.request('/ai/sessions', {
              userId: 'owner',
              body: { ...input, enableThinking: invalid },
            })
          ).status
        ).toBe(400);
      }
      expect(f.createModel).not.toHaveBeenCalled();
      const response = await f.request('/ai/sessions', {
        userId: 'owner',
        body: { ...input, enableThinking },
      });
      expect(response.status).toBe(201);
      const result = (await response.json()) as { data: { session: AiBattleSessionView } };
      expect(result.data.session.enableThinking).toBe(enableThinking);
      expect(f.service.getSession('owner', result.data.session.matchId).enableThinking).toBe(
        enableThinking
      );
      expect(f.createModel).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        input.model,
        expect.anything(),
        enableThinking,
        undefined,
        undefined
      );
    }
  );

  it('reads persistent costs after the match runtime is gone and rechecks permissions', async () => {
    const f = await serverFixture();
    auth.roles.set('owner', 'admin');
    auth.roles.set('other', 'admin');
    const { session } = await f.service.create('owner', input);
    await f.service.end('owner', session.matchId);
    const path = `/ai/records/${session.matchId}/billing`;
    const ownerResponse = await f.request(path, { userId: 'owner' });
    expect(ownerResponse.status).toBe(200);
    expect(await ownerResponse.json()).toMatchObject({
      data: {
        matchBilling: {
          model: 'qwen3.8-max',
          estimatedCny: '0.00000000',
        },
      },
    });
    expect((await f.request(path, { userId: 'other' })).status).toBe(404);
    expect((await f.request(path)).status).toBe(401);
    auth.roles.set('owner', 'user');
    expect((await f.request(path, { userId: 'owner' })).status).toBe(403);
    expect(f.start).toHaveBeenCalledTimes(1);
  });
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
      {
        type: GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY,
        cardId: 'card',
        targetSlot: 'CENTER',
        mode: 'invented',
      },
      {
        type: GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY,
        cardId: 'card',
        targetSlot: 'invalid',
        mode: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
      },
      {
        type: GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY,
        cardId: 'card',
        targetSlot: 'CENTER',
        mode: 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO',
        freePlay: true,
      },
      {
        type: GameCommandType.CONFIRM_SPECIAL_MEMBER_PLAY,
        pendingId: 'pending',
        selectedCardIds: [null],
      },
      { type: GameCommandType.CONFIRM_SPECIAL_MEMBER_PLAY, pendingId: 'pending' },
      { type: GameCommandType.CANCEL_SPECIAL_MEMBER_PLAY },
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

  it('reserves one Codex game across owners, releases on end and leaves API capacity separate', async () => {
    const f = createService(AI_BATTLE_MODELS);
    const codexInput = { ...input, model: 'codex:gpt-6-luna' as const, enableThinking: false };
    const budget = {
      maxCalls: 5,
      maxInputTokens: 500000,
      maxUncachedInputTokens: 150000,
      maxOutputTokens: 10000,
    };
    f.createModel.mockResolvedValue({
      decide: async () => ({ kind: 'RESPONSE', text: '{}' }),
      codexBudget: budget,
    });
    const first = f.service.create('one', codexInput);
    await expect(f.service.create('two', codexInput)).rejects.toMatchObject({
      code: 'AI_CODEX_ALREADY_ACTIVE',
    });
    const created = await first;
    budget.maxCalls = 99;
    expect(created.session.codexBudget?.maxCalls).toBe(5);
    await expect(f.service.create('two', codexInput)).rejects.toMatchObject({
      code: 'AI_CODEX_ALREADY_ACTIVE',
    });
    await f.service.create('api', input);
    await f.service.end('one', created.session.matchId);
    await expect(f.service.create('two', codexInput)).resolves.toBeDefined();
    expect(f.createModel).toHaveBeenCalledTimes(3);
  });
  it('releases the Codex creation reservation after setup failure', async () => {
    const f = createService(AI_BATTLE_MODELS);
    const codexInput = { ...input, model: 'codex:gpt-6-luna' as const, enableThinking: false };
    f.createModel.mockRejectedValueOnce(new Error('login failed'));
    await expect(f.service.create('one', codexInput)).rejects.toThrow('login failed');
    await expect(f.service.create('two', codexInput)).resolves.toBeDefined();
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
