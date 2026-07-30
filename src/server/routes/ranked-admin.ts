import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../middleware/require-admin.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validate } from '../middleware/validate.js';
import { RankedAlgorithmRegistryError } from '../rating/ranked-algorithm-registry.js';
import { RankedRatingLedgerError } from '../rating/ranked-ledger.js';
import {
  RankedAdminServiceError,
  rankedAdminService,
  type RankedAdminActiveSeasonOperationsInput,
  type RankedAdminSeasonDraftInput,
} from '../services/ranked-admin-service.js';
import { RankedRatingServiceError } from '../services/ranked-rating-service.js';
import { RankedSeasonServiceError } from '../services/ranked-season-service.js';

export const rankedAdminRouter = Router();

const seasonIdSchema = z.string().uuid();
const matchIdSchema = z.string().trim().min(1).max(160);

const openWindowSchema = z.object({
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
});

const softResetSchema = z
  .object({
    mode: z.enum(['RESET_TO_INITIAL', 'RETAIN_TOWARD_CENTER']),
    center: z.number().finite(),
    retention: z.number().finite().min(0).max(1),
    minimumDeviation: z.number().finite().positive(),
  })
  .strict();

const seasonDraftSchema = z
  .object({
    seasonKey: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9_-]{2,63}$/),
    name: z.string().trim().min(1).max(100),
    platformTimeZone: z.string().trim().min(1).max(80),
    openWindows: z.array(openWindowSchema).min(1).max(32),
    startsAt: z.coerce.date(),
    scheduledEndsAt: z.coerce.date(),
    finalizingDeadlineAt: z.coerce.date(),
    ratingAlgorithmVersion: z.string().trim().min(1).max(100),
    softReset: softResetSchema,
    leaderboardMinimumMatchCount: z.number().int().min(1).max(100),
  })
  .strict();

const activeSeasonOperationsSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    openWindows: z.array(openWindowSchema).min(1).max(32),
    leaderboardMinimumMatchCount: z.number().int().min(1).max(100),
  })
  .strict();

const admissionSchema = z.object({
  admission: z.enum(['OPEN', 'PAUSED']),
});

const correctionPreviewSchema = z
  .object({
    seasonId: z.string().uuid(),
    action: z.enum(['VOID', 'REPLACE']),
    replacementWinnerSeat: z.enum(['FIRST', 'SECOND']).optional(),
  })
  .superRefine(validateCorrectionChoice);

const correctionExecuteSchema = z
  .object({
    seasonId: z.string().uuid(),
    action: z.enum(['VOID', 'REPLACE']),
    replacementWinnerSeat: z.enum(['FIRST', 'SECOND']).optional(),
    replacementResultType: z.enum(['NORMAL', 'SURRENDER', 'DISCONNECT_FORFEIT']).optional(),
    reason: z.string().trim().min(5).max(1000),
    idempotencyKey: z.string().trim().min(8).max(160),
    expectedLedgerRevision: z.number().int().min(0),
  })
  .superRefine(validateCorrectionChoice);

rankedAdminRouter.use(requireAuth, requireAdmin);

rankedAdminRouter.get('/environment', async (_req, res) => {
  try {
    respondData(res, await rankedAdminService.getEnvironmentPreview());
  } catch (error) {
    respondRankedAdminError(res, error);
  }
});

rankedAdminRouter.get('/seasons', async (_req, res) => {
  try {
    const seasons = await rankedAdminService.listSeasons();
    res.json({ data: seasons, total: seasons.length, error: null });
  } catch (error) {
    respondRankedAdminError(res, error);
  }
});

rankedAdminRouter.get('/seasons/:seasonId', async (req, res) => {
  const seasonId = readParam(req.params.seasonId, seasonIdSchema, '赛季 ID', res);
  if (!seasonId) {
    return;
  }
  try {
    respondData(res, await rankedAdminService.getSeason(seasonId));
  } catch (error) {
    respondRankedAdminError(res, error);
  }
});

rankedAdminRouter.post('/seasons', validate(seasonDraftSchema), async (req, res) => {
  try {
    const season = await rankedAdminService.createDraft(
      req.body as RankedAdminSeasonDraftInput,
      req.user!.id
    );
    res.status(201).json({ data: season, error: null });
  } catch (error) {
    respondRankedAdminError(res, error);
  }
});

rankedAdminRouter.put('/seasons/:seasonId/draft', validate(seasonDraftSchema), async (req, res) => {
  const seasonId = readParam(req.params.seasonId, seasonIdSchema, '赛季 ID', res);
  if (!seasonId) {
    return;
  }
  try {
    respondData(
      res,
      await rankedAdminService.updateDraft(
        seasonId,
        req.body as RankedAdminSeasonDraftInput,
        req.user!.id
      )
    );
  } catch (error) {
    respondRankedAdminError(res, error);
  }
});

rankedAdminRouter.put(
  '/seasons/:seasonId/operations',
  validate(activeSeasonOperationsSchema),
  async (req, res) => {
    const seasonId = readParam(req.params.seasonId, seasonIdSchema, '赛季 ID', res);
    if (!seasonId) {
      return;
    }
    try {
      respondData(
        res,
        await rankedAdminService.updateActiveOperations(
          seasonId,
          req.body as RankedAdminActiveSeasonOperationsInput,
          req.user!.id
        )
      );
    } catch (error) {
      respondRankedAdminError(res, error);
    }
  }
);

rankedAdminRouter.post('/seasons/:seasonId/activate', async (req, res) => {
  await runSeasonCommand(req.params.seasonId, res, (seasonId) =>
    rankedAdminService.activateSeason(seasonId, req.user!.id)
  );
});

rankedAdminRouter.put(
  '/seasons/:seasonId/admission',
  validate(admissionSchema),
  async (req, res) => {
    await runSeasonCommand(req.params.seasonId, res, (seasonId) =>
      rankedAdminService.setQueueAdmission(
        seasonId,
        (req.body as z.infer<typeof admissionSchema>).admission,
        req.user!.id
      )
    );
  }
);

rankedAdminRouter.post('/seasons/:seasonId/finalize', async (req, res) => {
  await runSeasonCommand(req.params.seasonId, res, (seasonId) =>
    rankedAdminService.beginFinalizing(seasonId, req.user!.id)
  );
});

rankedAdminRouter.post('/seasons/:seasonId/close', async (req, res) => {
  await runSeasonCommand(req.params.seasonId, res, (seasonId) =>
    rankedAdminService.closeSeason(seasonId, req.user!.id)
  );
});

rankedAdminRouter.get('/matches', async (req, res) => {
  const parsed = z
    .object({
      seasonId: z.string().uuid().optional(),
      ratingStatus: z.enum(['PENDING', 'SETTLED', 'VOIDED']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    })
    .safeParse(req.query);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  try {
    const matches = await rankedAdminService.listMatches(parsed.data);
    res.json({ data: matches, total: matches.length, error: null });
  } catch (error) {
    respondRankedAdminError(res, error);
  }
});

rankedAdminRouter.get('/matches/:matchId', async (req, res) => {
  const matchId = readParam(req.params.matchId, matchIdSchema, '对局 ID', res);
  if (!matchId) {
    return;
  }
  try {
    respondData(res, await rankedAdminService.getMatch(matchId));
  } catch (error) {
    respondRankedAdminError(res, error);
  }
});

rankedAdminRouter.post('/matches/:matchId/settle', async (req, res) => {
  const matchId = readParam(req.params.matchId, matchIdSchema, '对局 ID', res);
  if (!matchId) {
    return;
  }
  try {
    respondData(res, await rankedAdminService.settleMatch(matchId, req.user!.id));
  } catch (error) {
    respondRankedAdminError(res, error);
  }
});

rankedAdminRouter.post(
  '/matches/:matchId/corrections/preview',
  validate(correctionPreviewSchema),
  async (req, res) => {
    const matchId = readParam(req.params.matchId, matchIdSchema, '对局 ID', res);
    if (!matchId) {
      return;
    }
    try {
      respondData(
        res,
        await rankedAdminService.previewCorrection({
          ...(req.body as z.infer<typeof correctionPreviewSchema>),
          matchId,
        })
      );
    } catch (error) {
      respondRankedAdminError(res, error);
    }
  }
);

rankedAdminRouter.post(
  '/matches/:matchId/corrections',
  validate(correctionExecuteSchema),
  async (req, res) => {
    const matchId = readParam(req.params.matchId, matchIdSchema, '对局 ID', res);
    if (!matchId) {
      return;
    }
    try {
      respondData(
        res,
        await rankedAdminService.executeCorrection({
          ...(req.body as z.infer<typeof correctionExecuteSchema>),
          matchId,
          adminUserId: req.user!.id,
        })
      );
    } catch (error) {
      respondRankedAdminError(res, error);
    }
  }
);

rankedAdminRouter.get('/monitoring/summary', async (req, res) => {
  const parsed = z.object({ seasonId: z.string().uuid().optional() }).safeParse(req.query);
  if (!parsed.success) {
    respondValidationError(res, parsed.error);
    return;
  }
  try {
    respondData(res, await rankedAdminService.getMonitoringSummary(parsed.data.seasonId));
  } catch (error) {
    respondRankedAdminError(res, error);
  }
});

async function runSeasonCommand(
  rawSeasonId: string | readonly string[] | undefined,
  res: Response,
  command: (seasonId: string) => Promise<unknown>
): Promise<void> {
  const seasonId = readParam(rawSeasonId, seasonIdSchema, '赛季 ID', res);
  if (!seasonId) {
    return;
  }
  try {
    respondData(res, await command(seasonId));
  } catch (error) {
    respondRankedAdminError(res, error);
  }
}

function validateCorrectionChoice(
  value: {
    readonly action: 'VOID' | 'REPLACE';
    readonly replacementWinnerSeat?: RankedWinnerSeat;
  },
  context: z.RefinementCtx
): void {
  if (value.action === 'REPLACE' && !value.replacementWinnerSeat) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['replacementWinnerSeat'],
      message: '替换结算必须指定新的胜方',
    });
  }
  if (value.action === 'VOID' && value.replacementWinnerSeat) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['replacementWinnerSeat'],
      message: '作废结算不能指定替换胜方',
    });
  }
}

type RankedWinnerSeat = 'FIRST' | 'SECOND';

function readParam<T>(
  value: string | readonly string[] | undefined,
  schema: z.ZodType<T>,
  label: string,
  res: Response
): T | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: `${label} 参数非法` },
    });
    return null;
  }
  return parsed.data;
}

function respondData(res: Response, data: unknown): void {
  res.json({ data, error: null });
}

function respondValidationError(res: Response, error: z.ZodError): void {
  res.status(400).json({
    data: null,
    error: {
      code: 'VALIDATION_ERROR',
      message: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    },
  });
}

function respondRankedAdminError(res: Response, error: unknown): void {
  if (
    error instanceof RankedAdminServiceError ||
    error instanceof RankedSeasonServiceError ||
    error instanceof RankedRatingServiceError ||
    error instanceof RankedAlgorithmRegistryError
  ) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  if (error instanceof RankedRatingLedgerError) {
    res.status(409).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.error('[RankedAdmin] Route error:', error);
  res.status(500).json({
    data: null,
    error: { code: 'INTERNAL_ERROR', message: '排位管理操作失败' },
  });
}
