import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { privateNoStore } from '../middleware/private-no-store.js';
import { requireGameplayAvailable } from '../middleware/require-gameplay-available.js';
import {
  CasualTableServiceError,
  casualTableService as service,
} from '../services/casual-table-service.js';
import { OnlineRoomServiceError } from '../services/online-room-service.js';

export const casualTablesRouter = Router();
casualTablesRouter.use(requireAuth, privateNoStore);
const target = z.object({
  tableId: z.uuid(),
  roundId: z.uuid(),
  revision: z.number().int().positive(),
});
const entry = z.object({ requestId: z.uuid(), deckId: z.uuid(), spectatorEnabled: z.boolean() });
const targeted = z.object({ target });

casualTablesRouter.get('/me', async (req, res) => {
  try {
    res.json({ data: await service.getCurrent(req.user!.id), error: null });
  } catch (error) {
    respondError(res, error);
  }
});
casualTablesRouter.get('/rooms', async (req, res) => {
  try {
    const query = z
      .object({
        filter: z.enum(['ALL', 'WAITING', 'PLAYING']).optional(),
        search: z.string().max(80).optional(),
        spectatable: z.enum(['true', 'false']).optional(),
        cursor: z.string().max(2048).optional(),
      })
      .parse(req.query);
    res.json({
      data: await service.list(req.user!.id, {
        ...query,
        spectatable: query.spectatable === 'true',
      }),
      error: null,
    });
  } catch (error) {
    respondError(res, error);
  }
});
casualTablesRouter.get('/rooms/:roomCode', async (req, res) => {
  try {
    res.json({
      data: await service.preview(req.user!.id, String(req.params.roomCode)),
      error: null,
    });
  } catch (error) {
    respondError(res, error);
  }
});

function mutation<T>(
  path: string,
  schema: z.ZodType<T>,
  available: boolean,
  operation: (userId: string, data: T) => Promise<unknown>
) {
  casualTablesRouter.post(
    path,
    ...(available ? [requireGameplayAvailable] : []),
    async (req, res) => {
      try {
        res.json({ data: await operation(req.user!.id, schema.parse(req.body)), error: null });
      } catch (error) {
        respondError(res, error);
      }
    }
  );
}
mutation('/find', entry, true, (user, data) => service.findOpponent(user, data));
mutation(
  '/create',
  entry.extend({
    discoverability: z.enum(['PUBLIC', 'UNLISTED']),
    note: z.string().trim().max(40),
  }),
  true,
  (user, data) => service.create(user, data)
);
mutation('/join', targeted.extend({ entry }), true, (user, data) =>
  service.join(user, data.target, data.entry)
);
mutation('/switch', z.object({ source: target, destination: target, entry }), true, (user, data) =>
  service.switchWaiting(user, data.source, data.destination, data.entry)
);
mutation('/confirm', targeted, true, (user, data) => service.confirm(user, data.target));
mutation('/cancel', targeted, false, (user, data) => service.cancel(user, data.target));
mutation('/heartbeat', targeted, false, (user, data) => service.heartbeat(user, data.target));
mutation('/deck', targeted.extend({ deckId: z.uuid() }), true, (user, data) =>
  service.changeDeck(user, data.target, data.deckId)
);
mutation('/spectator-preference', targeted.extend({ enabled: z.boolean() }), false, (user, data) =>
  service.setSpectatorPreference(user, data.target, data.enabled)
);
mutation('/spectate', targeted.extend({ seat: z.enum(['FIRST', 'SECOND']) }), false, (user, data) =>
  service.spectate(user, data.target, data.seat)
);
mutation(
  '/rematch/request',
  targeted.extend({ deckId: z.uuid(), spectatorEnabled: z.boolean() }),
  true,
  (user, data) => service.requestRematch(user, data.target, data.deckId, data.spectatorEnabled)
);
mutation(
  '/rematch/respond',
  targeted.extend({
    requestId: z.uuid(),
    deckId: z.uuid().nullable(),
    spectatorEnabled: z.boolean().nullable(),
  }),
  false,
  (user, data) =>
    service.respondRematch(user, data.target, data.requestId, data.deckId, data.spectatorEnabled)
);
mutation('/leave', targeted, false, (user, data) => service.leave(user, data.target));
mutation(
  '/continue-public',
  targeted.extend({ entry, publishNewRoom: z.boolean() }),
  true,
  (user, data) => service.continuePublic(user, data.target, data.entry, data.publishNewRoom)
);

function respondError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    res.status(400).json({
      data: null,
      error: { code: 'CASUAL_INVALID_REQUEST', message: '房间操作参数无效，请刷新后重试' },
    });
    return;
  }
  if (error instanceof CasualTableServiceError || error instanceof OnlineRoomServiceError) {
    res
      .status(error.statusCode)
      .json({ data: null, error: { code: error.code, message: error.message } });
    return;
  }
  console.error('casual table request failed', error);
  res.status(500).json({
    data: null,
    error: { code: 'CASUAL_INTERNAL_ERROR', message: '对战大厅暂时不可用，请稍后重试' },
  });
}
