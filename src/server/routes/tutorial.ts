import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { toTransport } from '../../online/serde.js';
import { TUTORIAL_CHECKPOINT_IDS, type TutorialCheckpointId } from '../../online/tutorial-types.js';
import {
  BASIC_LIVE_TUTORIAL_ID,
  BASIC_LIVE_TUTORIAL_VERSION,
} from '../services/basic-live-tutorial-scenario.js';
import { getTutorialSessionService } from '../services/tutorial-runtime-service.js';
import { parseTutorialGameCommand } from '../services/tutorial-command-validation.js';
import {
  TutorialAdmissionController,
  TutorialMutationRateLimiter,
  type TutorialAdmissionReservation,
} from '../services/tutorial-request-limits.js';
import { TutorialSessionServiceError } from '../services/tutorial-session-service.js';

const CREATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_CREATES_PER_WINDOW = 8;
const MAX_ACTIVE_SESSIONS_PER_IP = 3;
const MUTATION_WINDOW_MS = 60 * 1000;
const MAX_MUTATIONS_PER_RUN = 120;
const MAX_MUTATIONS_PER_IP = 240;

const admissionController = new TutorialAdmissionController({
  createWindowMs: CREATE_WINDOW_MS,
  maxCreatesPerWindow: MAX_CREATES_PER_WINDOW,
  maxActiveSessionsPerIp: MAX_ACTIVE_SESSIONS_PER_IP,
});
const mutationRateLimiter = new TutorialMutationRateLimiter({
  windowMs: MUTATION_WINDOW_MS,
  maxRequestsPerRun: MAX_MUTATIONS_PER_RUN,
  maxRequestsPerIp: MAX_MUTATIONS_PER_IP,
});

export const tutorialRouter = Router();

tutorialRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  next();
});

tutorialRouter.post('/sessions', async (req, res) => {
  let reservation: TutorialAdmissionReservation | null = null;
  try {
    const body = req.body as
      | Partial<{
          readonly scenarioId: string;
          readonly scenarioVersion: string;
          readonly checkpointId: TutorialCheckpointId;
        }>
      | undefined;
    const scenarioId = body?.scenarioId ?? BASIC_LIVE_TUTORIAL_ID;
    const scenarioVersion = body?.scenarioVersion ?? BASIC_LIVE_TUTORIAL_VERSION;
    const isKnownScenario =
      scenarioId === BASIC_LIVE_TUTORIAL_ID && scenarioVersion === BASIC_LIVE_TUTORIAL_VERSION;
    if (!isKnownScenario) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_SCENARIO_NOT_FOUND',
        '指定的教程版本不存在',
        404
      );
    }
    const checkpointId = body?.checkpointId;
    if (!checkpointId || !Object.values(TUTORIAL_CHECKPOINT_IDS).includes(checkpointId)) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_CHECKPOINT_NOT_FOUND',
        '指定的教程章节不存在',
        404
      );
    }

    const now = Date.now();
    reservation = admissionController.reserve(normalizeIp(req), now);
    const accessToken = randomBytes(24).toString('base64url');
    const participantKey = hashAccessToken(accessToken);
    const service = await getTutorialSessionService();
    const snapshot = service.createSession({
      participantKey,
      scenarioId,
      scenarioVersion,
      checkpointId,
    });
    admissionController.commit(reservation, snapshot.runId, snapshot.expiresAt);
    reservation = null;
    respondData(res, { accessToken, snapshot });
  } catch (error) {
    if (reservation) admissionController.cancel(reservation);
    respondTutorialError(res, error);
  }
});

tutorialRouter.get('/sessions/:runId', async (req, res) => {
  try {
    const runId = readRunId(req);
    const participantKey = readParticipantKey(req);
    const service = await getTutorialSessionService();
    const snapshot = service.getSnapshot(runId, participantKey);
    admissionController.touch(snapshot.runId, snapshot.expiresAt);
    respondData(res, snapshot);
  } catch (error) {
    respondTutorialError(res, error);
  }
});

tutorialRouter.post('/sessions/:runId/commands', async (req, res) => {
  try {
    const runId = readRunId(req);
    mutationRateLimiter.consume(normalizeIp(req), runId, Date.now());
    const body = req.body as
      Partial<{ readonly expectedSeq: number; readonly command: unknown }> | undefined;
    if (
      !Number.isSafeInteger(body?.expectedSeq) ||
      (body?.expectedSeq ?? -1) < 0 ||
      body?.command === undefined
    ) {
      throw new TutorialSessionServiceError('TUTORIAL_INVALID_INPUT', '教程命令参数非法');
    }
    const command = parseTutorialGameCommand(body.command);
    const participantKey = readParticipantKey(req);
    const service = await getTutorialSessionService();
    const result = service.executePlayerCommand({
      runId,
      participantKey,
      expectedSeq: body!.expectedSeq!,
      command,
    });
    admissionController.touch(result.snapshot.runId, result.snapshot.expiresAt);
    respondData(res, result);
  } catch (error) {
    respondTutorialError(res, error);
  }
});

tutorialRouter.post('/sessions/:runId/script/advance', async (req, res) => {
  try {
    const runId = readRunId(req);
    mutationRateLimiter.consume(normalizeIp(req), runId, Date.now());
    const body = req.body as Partial<{ readonly expectedSeq: number }> | undefined;
    if (!Number.isSafeInteger(body?.expectedSeq) || (body?.expectedSeq ?? -1) < 0) {
      throw new TutorialSessionServiceError('TUTORIAL_INVALID_INPUT', '教程脚本 revision 非法');
    }
    const participantKey = readParticipantKey(req);
    const service = await getTutorialSessionService();
    const result = service.advanceScript({
      runId,
      participantKey,
      expectedSeq: body!.expectedSeq!,
    });
    admissionController.touch(result.snapshot.runId, result.snapshot.expiresAt);
    respondData(res, result);
  } catch (error) {
    respondTutorialError(res, error);
  }
});

tutorialRouter.delete('/sessions/:runId', async (req, res) => {
  try {
    const runId = readRunId(req);
    const participantKey = readParticipantKey(req);
    const service = await getTutorialSessionService();
    service.deleteSession(runId, participantKey);
    admissionController.remove(runId);
    respondData(res, { deleted: true });
  } catch (error) {
    respondTutorialError(res, error);
  }
});

function normalizeIp(req: Request): string {
  return req.ip?.trim() || req.socket.remoteAddress?.trim() || 'unknown';
}

function hashAccessToken(accessToken: string): string {
  return createHash('sha256').update(accessToken).digest('hex');
}

function readRunId(req: Request): string {
  const value = req.params.runId;
  const runId = Array.isArray(value) ? value[0] : value;
  if (!runId?.trim()) {
    throw new TutorialSessionServiceError('TUTORIAL_INVALID_INPUT', '教程会话 ID 非法');
  }
  return runId.trim();
}

function readParticipantKey(req: Request): string {
  const header = req.header('x-tutorial-token')?.trim();
  const authorization = req.header('authorization')?.trim();
  const token =
    header ||
    (authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '');
  if (!token) {
    throw new TutorialSessionServiceError(
      'TUTORIAL_SESSION_NOT_FOUND',
      '教程会话不存在或已过期',
      404
    );
  }
  return hashAccessToken(token);
}

function respondData(res: Response, value: unknown): void {
  res.json({ data: toTransport(value), error: null });
}

function respondTutorialError(res: Response, error: unknown): void {
  if (error instanceof TutorialSessionServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.error('Tutorial route failed:', error);
  res.status(500).json({
    data: null,
    error: { code: 'TUTORIAL_INTERNAL_ERROR', message: '教程暂时不可用，请稍后重试' },
  });
}
