import { createHash, randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { GameCommand } from '../../application/game-commands.js';
import { fromTransport, toTransport } from '../../online/serde.js';
import { TUTORIAL_CHECKPOINT_IDS, type TutorialCheckpointId } from '../../online/tutorial-types.js';
import {
  BASIC_LIVE_TUTORIAL_ID,
  BASIC_LIVE_TUTORIAL_VERSION,
} from '../services/basic-live-tutorial-scenario.js';
import { getTutorialSessionService } from '../services/tutorial-runtime-service.js';
import { TutorialSessionServiceError } from '../services/tutorial-session-service.js';

const CREATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_CREATES_PER_WINDOW = 8;
const MAX_ACTIVE_SESSIONS_PER_IP = 3;

interface TutorialAdmissionRecord {
  readonly createdAt: number;
}

interface ActiveTutorialRecord {
  readonly ip: string;
  expiresAt: number;
}

const admissionByIp = new Map<string, TutorialAdmissionRecord[]>();
const activeRuns = new Map<string, ActiveTutorialRecord>();

export const tutorialRouter = Router();

tutorialRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  next();
});

tutorialRouter.post('/sessions', async (req, res) => {
  try {
    const now = Date.now();
    const ip = normalizeIp(req);
    assertAdmissionAvailable(ip, now);
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

    const accessToken = randomBytes(24).toString('base64url');
    const participantKey = hashAccessToken(accessToken);
    const service = await getTutorialSessionService();
    const snapshot = service.createSession({
      participantKey,
      scenarioId,
      scenarioVersion,
      checkpointId,
    });
    recordAdmission(ip, now);
    activeRuns.set(snapshot.runId, { ip, expiresAt: snapshot.expiresAt });
    respondData(res, { accessToken, snapshot });
  } catch (error) {
    respondTutorialError(res, error);
  }
});

tutorialRouter.get('/sessions/:runId', async (req, res) => {
  try {
    const runId = readRunId(req);
    const participantKey = readParticipantKey(req);
    const service = await getTutorialSessionService();
    const snapshot = service.getSnapshot(runId, participantKey);
    touchActiveRun(snapshot.runId, snapshot.expiresAt);
    respondData(res, snapshot);
  } catch (error) {
    respondTutorialError(res, error);
  }
});

tutorialRouter.post('/sessions/:runId/commands', async (req, res) => {
  try {
    const body = req.body as
      Partial<{ readonly expectedSeq: number; readonly command: unknown }> | undefined;
    if (!Number.isSafeInteger(body?.expectedSeq) || body?.command === undefined) {
      throw new TutorialSessionServiceError('TUTORIAL_INVALID_INPUT', '教程命令参数非法');
    }
    const service = await getTutorialSessionService();
    const result = service.executePlayerCommand({
      runId: readRunId(req),
      participantKey: readParticipantKey(req),
      expectedSeq: body!.expectedSeq!,
      command: fromTransport<GameCommand>(body!.command),
    });
    touchActiveRun(result.snapshot.runId, result.snapshot.expiresAt);
    respondData(res, result);
  } catch (error) {
    respondTutorialError(res, error);
  }
});

tutorialRouter.post('/sessions/:runId/script/advance', async (req, res) => {
  try {
    const body = req.body as Partial<{ readonly expectedSeq: number }> | undefined;
    if (!Number.isSafeInteger(body?.expectedSeq)) {
      throw new TutorialSessionServiceError('TUTORIAL_INVALID_INPUT', '教程脚本 revision 非法');
    }
    const service = await getTutorialSessionService();
    const result = service.advanceScript({
      runId: readRunId(req),
      participantKey: readParticipantKey(req),
      expectedSeq: body!.expectedSeq!,
    });
    touchActiveRun(result.snapshot.runId, result.snapshot.expiresAt);
    respondData(res, result);
  } catch (error) {
    respondTutorialError(res, error);
  }
});

tutorialRouter.delete('/sessions/:runId', async (req, res) => {
  try {
    const runId = readRunId(req);
    const service = await getTutorialSessionService();
    service.deleteSession(runId, readParticipantKey(req));
    activeRuns.delete(runId);
    respondData(res, { deleted: true });
  } catch (error) {
    respondTutorialError(res, error);
  }
});

function normalizeIp(req: Request): string {
  return req.ip?.trim() || req.socket.remoteAddress?.trim() || 'unknown';
}

function pruneAdmissionState(now: number): void {
  for (const [ip, records] of admissionByIp) {
    const retained = records.filter((record) => record.createdAt + CREATE_WINDOW_MS > now);
    if (retained.length > 0) admissionByIp.set(ip, retained);
    else admissionByIp.delete(ip);
  }
  for (const [runId, record] of activeRuns) {
    if (record.expiresAt <= now) activeRuns.delete(runId);
  }
}

function assertAdmissionAvailable(ip: string, now: number): void {
  pruneAdmissionState(now);
  const recentCreates = admissionByIp.get(ip) ?? [];
  if (recentCreates.length >= MAX_CREATES_PER_WINDOW) {
    throw new TutorialSessionServiceError(
      'TUTORIAL_CREATE_RATE_LIMITED',
      '教程创建过于频繁，请稍后再试',
      429
    );
  }
  const activeCount = [...activeRuns.values()].filter((record) => record.ip === ip).length;
  if (activeCount >= MAX_ACTIVE_SESSIONS_PER_IP) {
    throw new TutorialSessionServiceError(
      'TUTORIAL_ACTIVE_SESSION_LIMIT',
      '当前设备已有多个教程会话，请先关闭旧教程',
      429
    );
  }
}

function recordAdmission(ip: string, now: number): void {
  const records = admissionByIp.get(ip) ?? [];
  admissionByIp.set(ip, [...records, { createdAt: now }]);
}

function touchActiveRun(runId: string, expiresAt: number): void {
  const active = activeRuns.get(runId);
  if (active) active.expiresAt = expiresAt;
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
