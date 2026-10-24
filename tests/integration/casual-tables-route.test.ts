import { once } from 'node:events';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const service = vi.hoisted(() => ({
  getCurrent: vi.fn(),
  list: vi.fn(),
  preview: vi.fn(),
  create: vi.fn(),
  findOpponent: vi.fn(),
  join: vi.fn(),
  switchWaiting: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  heartbeat: vi.fn(),
  changeDeck: vi.fn(),
  setSpectatorPreference: vi.fn(),
  spectate: vi.fn(),
  requestRematch: vi.fn(),
  respondRematch: vi.fn(),
  leave: vi.fn(),
  continuePublic: vi.fn(),
  saveSealedDraft: vi.fn(),
  setSealedReady: vi.fn(),
  requestSealedRematch: vi.fn(),
  respondSealedRematch: vi.fn(),
}));
const availability = vi.hoisted(() => ({ getGameplayRestriction: vi.fn() }));
vi.mock('../../src/server/services/site-announcement-service.js', () => ({
  siteAnnouncementService: availability,
}));
vi.mock('../../src/server/services/casual-table-service.js', () => ({
  casualTableService: service,
  CasualTableServiceError: class extends Error {
    constructor(
      public code: string,
      message: string,
      public statusCode = 409
    ) {
      super(message);
    }
  },
}));
vi.mock('../../src/server/services/online-room-service.js', () => ({
  OnlineRoomServiceError: class extends Error {},
}));
vi.mock('../../src/server/middleware/require-auth.js', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.headers.authorization) {
      res.status(401).json({ data: null, error: { code: 'UNAUTHORIZED' } });
      return;
    }
    req.user = { id: 'viewer', role: 'user' } as express.Request['user'];
    next();
  },
}));
import { casualTablesRouter } from '../../src/server/routes/casual-tables';
import { CasualTableServiceError } from '../../src/server/services/casual-table-service';
const target = {
  tableId: '11111111-1111-4111-8111-111111111111',
  roundId: '22222222-2222-4222-8222-222222222222',
  revision: 1,
};
const entry = {
  format: 'CONSTRUCTED',
  ruleMode: 'NORMAL',
  requestId: '33333333-3333-4333-8333-333333333333',
  deckId: '44444444-4444-4444-8444-444444444444',
  spectatorEnabled: false,
};
let server: ReturnType<express.Express['listen']>;
let base: string;
const request = (path: string, body?: unknown, auth = true) =>
  globalThis.fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: 'Bearer test' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
beforeAll(async () => {
  const app = express();
  app.use(express.json(), casualTablesRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(
  () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
);
beforeEach(() => {
  vi.resetAllMocks();
  availability.getGameplayRestriction.mockResolvedValue(null);
});
describe('casual table HTTP contract', () => {
  it('forwards an optional normalized room code and preserves actionable creation conflicts', async () => {
    service.create.mockResolvedValue({ roomCode: 'FRIENDS42', state: 'WAITING' });
    const input = { ...entry, discoverability: 'UNLISTED', note: '', roomCode: '  friends42  ' };
    expect((await request('/create', input)).status).toBe(200);
    expect(service.create).toHaveBeenCalledWith('viewer', { ...input, roomCode: 'FRIENDS42' });
    service.create.mockRejectedValue(
      new CasualTableServiceError('CASUAL_ROOM_CODE_TAKEN', '这个房间号已被占用', 409)
    );
    const conflict = await request('/create', input);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      data: null,
      error: { code: 'CASUAL_ROOM_CODE_TAKEN', message: '这个房间号已被占用' },
    });
  });
  it('authenticates lobby reads and writes, and disables shared caching', async () => {
    expect((await request('/rooms', undefined, false)).status).toBe(401);
    expect((await request('/find', entry, false)).status).toBe(401);
    expect(service.findOpponent).not.toHaveBeenCalled();
    service.getCurrent.mockResolvedValue({ table: null, otherParticipation: null });
    const response = await request('/me');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each([
    '/join',
    '/switch',
    '/confirm',
    '/cancel',
    '/heartbeat',
    '/deck',
    '/spectator-preference',
    '/spectate',
    '/rematch/request',
    '/rematch/respond',
    '/leave',
    '/continue-public',
  ])('requires a fenced and fully typed %s command', async (path) => {
    const response = await request(path, { target: { ...target, roundId: 'old-room-code' } });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'CASUAL_INVALID_REQUEST'
    );
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
  });
  it('passes only validated command data and maps stale state conflicts', async () => {
    service.join.mockResolvedValue({ state: 'RESERVED' });
    expect(
      (await request('/join', { target, entry, privateDeck: 'must not forward' })).status
    ).toBe(200);
    expect(service.join).toHaveBeenCalledWith('viewer', target, entry);
    service.confirm.mockRejectedValue(
      new CasualTableServiceError('CASUAL_STATE_CHANGED', '本轮已更新', 409)
    );
    const response = await request('/confirm', { target });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: 'CASUAL_STATE_CHANGED' },
    });
  });
  it.each([
    ['/find', 'findOpponent', entry],
    ['/create', 'create', { ...entry, discoverability: 'PUBLIC', note: '' }],
    ['/join', 'join', { target, entry }],
  ] as const)(
    'lets %s recover committed retries while new gameplay is restricted',
    async (path, method, body) => {
      availability.getGameplayRestriction.mockResolvedValue({ title: '维护', summary: null });
      service[method].mockResolvedValue({ tableId: target.tableId, state: 'RESERVED' });
      const recovered = await request(path, body);
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({
        data: { tableId: target.tableId },
        error: null,
      });
      expect(service[method]).toHaveBeenCalledTimes(1);

      service[method].mockRejectedValue(
        new CasualTableServiceError('CASUAL_UNAVAILABLE', '维护', 503)
      );
      const admission = await request(path, body);
      expect(admission.status).toBe(503);
      expect(await admission.json()).toMatchObject({
        data: null,
        error: { code: 'CASUAL_UNAVAILABLE' },
      });

      const confirmation = await request('/confirm', { target });
      expect(confirmation.status).toBe(503);
      expect(service.confirm).not.toHaveBeenCalled();
    }
  );
  it('keeps private code lookup separate from public search and validates spectator seats', async () => {
    service.list.mockResolvedValue({ rooms: [] });
    expect((await request('/rooms?filter=PLAYING&spectatable=true&search=test')).status).toBe(200);
    expect(service.list).toHaveBeenCalledWith('viewer', {
      filter: 'PLAYING',
      search: 'test',
      spectatable: true,
    });
    expect((await request('/spectate', { target, seat: 'OPPONENT_PRIVATE' })).status).toBe(400);
    expect(service.spectate).not.toHaveBeenCalled();
  });
  it('accepts sealed entries without account decks and rejects mixed format parameters', async () => {
    service.findOpponent.mockResolvedValue({ state: 'WAITING', format: 'SEALED_BP7' });
    const sealed = {
      format: 'SEALED_BP7',
      ruleMode: 'UNLIMITED',
      requestId: entry.requestId,
      spectatorEnabled: false,
    };
    expect((await request('/find', sealed)).status).toBe(200);
    expect(service.findOpponent).toHaveBeenCalledWith('viewer', sealed);
    expect((await request('/find', { ...sealed, deckId: entry.deckId })).status).toBe(400);
    expect((await request('/find', { ...sealed, ruleMode: 'NORMAL' })).status).toBe(400);
    expect((await request('/find', { ...sealed, format: 'CONSTRUCTED' })).status).toBe(400);
  });
  it('validates sealed draft and consent commands before forwarding the authenticated identity', async () => {
    service.saveSealedDraft.mockResolvedValue({ state: 'BUILDING' });
    service.respondSealedRematch.mockResolvedValue({ state: 'BUILDING' });
    expect(
      (await request('/sealed/draft', { target, draftRevision: 1, indices: [0, 1, 2] })).status
    ).toBe(200);
    expect(service.saveSealedDraft).toHaveBeenCalledWith('viewer', target, 1, [0, 1, 2]);
    expect(
      (await request('/sealed/draft', { target, draftRevision: 1, indices: [50] })).status
    ).toBe(400);
    expect(
      (
        await request('/sealed/rematch/respond', {
          target,
          requestId: entry.requestId,
          accept: true,
        })
      ).status
    ).toBe(200);
    expect(service.respondSealedRematch).toHaveBeenCalledWith(
      'viewer',
      target,
      entry.requestId,
      true
    );
    expect(
      (await request('/sealed/ready', { target, draftRevision: 1, ready: true }, false)).status
    ).toBe(401);
  });
});
