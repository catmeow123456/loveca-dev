import { Router, type Response } from 'express';
import { z } from 'zod';
import { requirePermission } from '../middleware/require-permission.js';
import { requireAuth } from '../middleware/require-auth.js';
import {
  ThemeTableAdminServiceError,
  themeTableAdminService,
} from '../services/theme-table-admin-service.js';

export const themeTableAdminRouter = Router();

const idSchema = z.string().uuid();
const httpUrlSchema = z
  .url()
  .max(1000)
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, '预组来源链接只支持 HTTP 或 HTTPS');
const openWindowSchema = z
  .object({
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((value) => value.startMinute < value.endMinute, '开放时段结束时间必须晚于开始时间');
const evaluationPolicySchema = z
  .object({
    minimumCompletedMatchesPerPair: z.number().int().min(1).max(10_000),
    minimumCompletionRate: z.number().min(0).max(1),
    maximumExceptionRate: z.number().min(0).max(1),
    maximumExposureDeviation: z.number().min(0).max(1),
    maximumMedianWaitSeconds: z.number().int().min(1).max(86_400),
    winRateLowerBound: z.number().min(0).max(1),
    winRateUpperBound: z.number().min(0).max(1),
    baselineWindowLabel: z.string().trim().min(1).max(200),
  })
  .refine((value) => value.winRateLowerBound < value.winRateUpperBound, {
    message: '胜率下限必须低于上限',
  });
const draftSchema = z
  .object({
    versionKey: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9_-]{2,63}$/),
    name: z.string().trim().min(1).max(100),
    platformTimeZone: z.string().trim().min(1).max(80),
    openWindows: z.array(openWindowSchema).min(1).max(32),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    scheduleLabel: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(1000),
    announcement: z.string().trim().min(1).max(3000),
    evaluationPolicy: evaluationPolicySchema,
    deckChoiceCount: z.number().int().positive(),
  })
  .strict();
const operationsSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    openWindows: z.array(openWindowSchema).min(1).max(32),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    scheduleLabel: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(1000),
    announcement: z.string().trim().min(1).max(3000),
  })
  .strict();
const deckMetadataSchema = z.object({
  deckKey: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  displayName: z.string().trim().min(1).max(100),
  playStyleTags: z.array(z.string().trim().min(1).max(30)).max(8),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  sourceLabel: z.string().trim().min(1).max(200),
  sourceUrl: httpUrlSchema.nullable().optional(),
  reviewNote: z.string().trim().min(1).max(3000),
});
const deckSchema = z.discriminatedUnion('sourceType', [
  deckMetadataSchema
    .extend({ sourceType: z.literal('CLOUD'), sourceDeckId: z.string().uuid() })
    .strict(),
  deckMetadataSchema
    .extend({ sourceType: z.literal('YAML'), yamlContent: z.string().min(1).max(100_000) })
    .strict(),
]);
const deckUpdateMetadataSchema = deckMetadataSchema.omit({ deckKey: true });
const deckUpdateSchema = z.discriminatedUnion('sourceType', [
  deckUpdateMetadataSchema
    .extend({ sourceType: z.literal('CLOUD'), sourceDeckId: z.string().uuid() })
    .strict(),
  deckUpdateMetadataSchema
    .extend({ sourceType: z.literal('YAML'), yamlContent: z.string().min(1).max(100_000) })
    .strict(),
]);
const matchupSchema = z
  .object({
    firstDeckVersionId: z.string().uuid(),
    secondDeckVersionId: z.string().uuid(),
    weight: z.number().int().min(1).max(1000),
    testSummary: z
      .record(z.string(), z.unknown())
      .refine((value) => Object.keys(value).length > 0, '必须填写双向试打记录'),
  })
  .strict();

themeTableAdminRouter.use(requireAuth, requirePermission('season.theme.manage'));

themeTableAdminRouter.get('/environment', async (_req, res) => {
  await respond(res, () => themeTableAdminService.getEnvironmentPreview());
});

themeTableAdminRouter.get('/events', async (_req, res) => {
  await respond(res, () => themeTableAdminService.listEvents());
});

themeTableAdminRouter.post('/events', async (req, res) => {
  const input = parseBody(res, draftSchema, req.body);
  if (!input) return;
  await respond(res, () => themeTableAdminService.createDraft(req.user!.id, input), 201);
});

themeTableAdminRouter.put('/events/:themeId/draft', async (req, res) => {
  const themeId = parseId(res, req.params.themeId);
  const input = parseBody(res, draftSchema, req.body);
  if (!themeId || !input) return;
  await respond(res, () => themeTableAdminService.updateDraft(req.user!.id, themeId, input));
});

themeTableAdminRouter.put('/events/:themeId/operations', async (req, res) => {
  const themeId = parseId(res, req.params.themeId);
  const input = parseBody(res, operationsSchema, req.body);
  if (!themeId || !input) return;
  await respond(res, () => themeTableAdminService.updateOperations(req.user!.id, themeId, input));
});

themeTableAdminRouter.post('/events/:themeId/decks', async (req, res) => {
  const themeId = parseId(res, req.params.themeId);
  const input = parseBody(res, deckSchema, req.body);
  if (!themeId || !input) return;
  await respond(res, () => themeTableAdminService.addDeck(req.user!.id, themeId, input), 201);
});

themeTableAdminRouter.put('/events/:themeId/decks/:deckId', async (req, res) => {
  const themeId = parseId(res, req.params.themeId);
  const deckId = parseId(res, req.params.deckId);
  const input = parseBody(res, deckUpdateSchema, req.body);
  if (!themeId || !deckId || !input) return;
  await respond(res, () => themeTableAdminService.updateDeck(req.user!.id, themeId, deckId, input));
});

themeTableAdminRouter.delete('/events/:themeId/decks/:deckId', async (req, res) => {
  const themeId = parseId(res, req.params.themeId);
  const deckId = parseId(res, req.params.deckId);
  if (!themeId || !deckId) return;
  await respond(res, () => themeTableAdminService.deleteDeck(req.user!.id, themeId, deckId));
});

themeTableAdminRouter.post('/events/:themeId/matchups', async (req, res) => {
  const themeId = parseId(res, req.params.themeId);
  const input = parseBody(res, matchupSchema, req.body);
  if (!themeId || !input) return;
  await respond(res, () => themeTableAdminService.addMatchup(req.user!.id, themeId, input), 201);
});

themeTableAdminRouter.put('/events/:themeId/matchups/:matchupId/enabled', async (req, res) => {
  const themeId = parseId(res, req.params.themeId);
  const matchupId = parseId(res, req.params.matchupId);
  const input = parseBody(res, z.object({ enabled: z.boolean() }).strict(), req.body);
  if (!themeId || !matchupId || !input) return;
  await respond(res, () =>
    themeTableAdminService.setMatchupEnabled(req.user!.id, themeId, matchupId, input.enabled)
  );
});

themeTableAdminRouter.post('/events/:themeId/:action', async (req, res) => {
  const themeId = parseId(res, req.params.themeId);
  const action = z.enum(['activate', 'pause', 'resume', 'close']).safeParse(req.params.action);
  if (!themeId || !action.success) {
    if (!action.success) invalid(res, '活动操作无效');
    return;
  }
  await respond(res, () =>
    themeTableAdminService.runLifecycleAction(
      req.user!.id,
      themeId,
      action.data.toUpperCase() as 'ACTIVATE' | 'PAUSE' | 'RESUME' | 'CLOSE'
    )
  );
});

function parseId(res: Response, value: string | undefined): string | null {
  const result = idSchema.safeParse(value);
  if (!result.success) {
    invalid(res, '娱乐模式参数无效');
    return null;
  }
  return result.data;
}

function parseBody<T extends z.ZodType>(
  res: Response,
  schema: T,
  value: unknown
): z.output<T> | null {
  const result = schema.safeParse(value);
  if (!result.success) {
    invalid(res, result.error.issues[0]?.message ?? '请求参数无效');
    return null;
  }
  return result.data;
}

function invalid(res: Response, message: string) {
  res.status(400).json({ data: null, error: { code: 'INVALID_REQUEST', message } });
}

async function respond(res: Response, operation: () => Promise<unknown>, status = 200) {
  try {
    res.status(status).json({ data: await operation(), error: null });
  } catch (error) {
    if (error instanceof ThemeTableAdminServiceError) {
      res.status(error.statusCode).json({
        data: null,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    console.error('theme table admin request failed', error);
    res.status(500).json({
      data: null,
      error: { code: 'THEME_TABLE_ADMIN_INTERNAL_ERROR', message: '娱乐模式管理服务暂时不可用' },
    });
  }
}
