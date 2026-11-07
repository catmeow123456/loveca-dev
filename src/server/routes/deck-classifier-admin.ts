import { DECK_CLASSIFIER_MAX_RECENT_MATCH_LIMIT } from '../../online/deck-classifier-types.js';
import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { DECK_CLASSIFIER_YAML_MAX_BYTES } from '../../online/deck-classifier-types.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission } from '../middleware/require-permission.js';
import {
  DeckClassifierAdminServiceError,
  deckClassifierAdminService,
  type DeckClassifierAdminService,
  type DeckClassifierOperator,
} from '../services/deck-classifier-admin-service.js';
import {
  deckClassifierProcess,
  DeckClassifierProcessError,
} from '../services/deck-classifier-process-runtime.js';
import type { DeckClassifierPreviewView } from '../../online/deck-classifier-types.js';

interface DeckClassifierWorkerNotifier {
  notify(): void;
  preview(revision: number, matchLimit: number | null): Promise<DeckClassifierPreviewView>;
}

const uuidSchema = z.string().uuid();
const reasonSchema = z.string().trim().min(5).max(1000);
const expectedDraftRevisionSchema = z.number().int().nonnegative();
const idempotencyKeySchema = z.string().trim().min(8).max(160);

const archetypeCreateSchema = z
  .object({
    expectedDraftRevision: expectedDraftRevisionSchema,
    archetypeKey: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
    name: z.string().trim().min(1).max(80),
    groupName: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1000).default(''),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    representativeCardCode: z.string().trim().min(1).max(100).nullable().default(null),
    sortOrder: z.number().int().min(-100_000).max(100_000),
    reason: reasonSchema,
  })
  .strict();

const archetypeUpdateSchema = archetypeCreateSchema.omit({
  archetypeKey: true,
  color: true,
  representativeCardCode: true,
});

const archetypeDisplaySchema = z
  .object({
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    representativeCardCode: z.string().trim().min(1).max(100).nullable().default(null),
    reason: reasonSchema,
  })
  .strict();

const archiveSchema = z
  .object({ expectedDraftRevision: expectedDraftRevisionSchema, reason: reasonSchema })
  .strict();

const templateFromMatchSchema = z
  .object({
    expectedDraftRevision: expectedDraftRevisionSchema,
    archetypeId: uuidSchema,
    matchId: z.string().trim().min(1).max(160),
    seat: z.enum(['FIRST', 'SECOND']),
    name: z.string().trim().min(1).max(120),
    sourceNote: z.string().trim().max(1000).default(''),
    reason: reasonSchema,
  })
  .strict();

const templateFromReviewSchema = z
  .object({
    expectedDraftRevision: expectedDraftRevisionSchema,
    archetypeId: uuidSchema,
    deckFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    name: z.string().trim().min(1).max(120),
    sourceNote: z.string().trim().max(1000).default(''),
    reason: reasonSchema,
  })
  .strict();

const templateYamlPreviewSchema = z
  .object({ yamlContent: z.string().min(1).max(DECK_CLASSIFIER_YAML_MAX_BYTES) })
  .strict();
const templateFromYamlSchema = templateFromMatchSchema
  .omit({ matchId: true, seat: true })
  .extend({ yamlContent: templateYamlPreviewSchema.shape.yamlContent })
  .strict();

const templateUpdateSchema = z
  .object({
    expectedDraftRevision: expectedDraftRevisionSchema,
    archetypeId: uuidSchema,
    name: z.string().trim().min(1).max(120),
    cards: z
      .array(
        z
          .object({
            baseCardCode: z.string().trim().min(1).max(100),
            cardType: z.enum(['MEMBER', 'LIVE']),
            count: z.number().int().min(1).max(60),
          })
          .strict()
      )
      .min(1)
      .max(60),
    sourceNote: z.string().trim().max(1000).default(''),
    enabled: z.boolean(),
    reason: reasonSchema,
  })
  .strict();

const cardConstraintSchema = z
  .object({
    baseCardCode: z.string().trim().min(1).max(100),
    cardType: z.enum(['MEMBER', 'LIVE']).optional(),
    minCount: z.number().int().min(0).max(60).optional(),
    maxCount: z.number().int().min(0).max(60).optional(),
  })
  .strict()
  .refine(
    (constraint) =>
      constraint.minCount === undefined ||
      constraint.maxCount === undefined ||
      constraint.minCount <= constraint.maxCount,
    { message: '规则最少数量不能大于最多数量' }
  );

const countSumSchema = z
  .object({
    baseCardCodes: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
    cardType: z.enum(['MEMBER', 'LIVE']).optional(),
    minCount: z.number().int().min(0).max(60).optional(),
    maxCount: z.number().int().min(0).max(60).optional(),
  })
  .strict()
  .refine((constraint) => constraint.minCount !== undefined || constraint.maxCount !== undefined, {
    message: '合计条件至少需要最少或最多数量',
  })
  .refine(
    (constraint) =>
      constraint.minCount === undefined ||
      constraint.maxCount === undefined ||
      constraint.minCount <= constraint.maxCount,
    { message: '合计条件最少数量不能大于最多数量' }
  );

const ruleDefinitionSchema = z
  .object({
    includeAll: z.array(cardConstraintSchema).max(30).optional(),
    includeAny: z.array(cardConstraintSchema).max(30).optional(),
    forbidAny: z.array(cardConstraintSchema).max(30).optional(),
    countSums: z.array(countSumSchema).max(10).optional(),
  })
  .strict()
  .refine(
    (definition) =>
      (definition.includeAll?.length ?? 0) +
        (definition.includeAny?.length ?? 0) +
        (definition.forbidAny?.length ?? 0) +
        (definition.countSums?.length ?? 0) >
      0,
    { message: '识别规则至少需要一个条件' }
  );

const ruleSchema = z
  .object({
    expectedDraftRevision: expectedDraftRevisionSchema,
    archetypeId: uuidSchema,
    name: z.string().trim().min(1).max(120),
    priority: z.number().int().min(0).max(10_000),
    definition: ruleDefinitionSchema,
    enabled: z.boolean(),
    reason: reasonSchema,
  })
  .strict();

const settingsSchema = z
  .object({
    displayMode: z.enum(['PLAYER_EQUAL', 'MATCH_EQUAL', 'BOTH']),
    visibleSections: z
      .array(z.enum(['USAGE', 'WINNER', 'TOP_RANKED']))
      .max(3)
      .refine((sections) => new Set(sections).size === sections.length, {
        message: '玩家展示内容不能重复',
      }),
    cardDisplayMode: z.enum(['PLAYER_EQUAL', 'MATCH_EQUAL', 'BOTH']),
    cardVisibleSections: z
      .array(z.enum(['USAGE', 'WINNER', 'TOP_RANKED']))
      .max(3)
      .refine((sections) => new Set(sections).size === sections.length, {
        message: '卡牌展示内容不能重复',
      }),
    topRankedPlayerCount: z.number().int().min(10).max(100),
    reason: reasonSchema,
  })
  .strict();

const recentMatchLimitSchema = z.number().int().min(1).max(DECK_CLASSIFIER_MAX_RECENT_MATCH_LIMIT);
const matchLimitSchema = recentMatchLimitSchema.nullable();
const executionSettingsSchema = z
  .object({
    recentMatchLimit: recentMatchLimitSchema,
    reason: reasonSchema,
  })
  .strict();
const previewSchema = z
  .object({ expectedDraftRevision: expectedDraftRevisionSchema, matchLimit: matchLimitSchema })
  .strict();

const publishSchema = z
  .object({
    matchLimit: matchLimitSchema,
    expectedDraftRevision: expectedDraftRevisionSchema,
    reason: reasonSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const reclassifySchema = z
  .object({
    matchLimit: matchLimitSchema,
    seasonId: uuidSchema.nullable().default(null),
    reason: reasonSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const overrideSchema = z
  .object({
    deckFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    targetStatus: z.enum(['CLASSIFIED', 'UNKNOWN', 'EXCLUDED']),
    archetypeId: uuidSchema.nullable(),
    appliesToFutureReleases: z.boolean(),
    reason: reasonSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .refine(
    (input) =>
      (input.targetStatus === 'CLASSIFIED' && input.archetypeId !== null) ||
      (input.targetStatus !== 'CLASSIFIED' && input.archetypeId === null),
    { message: '人工分类状态与卡组分类不一致' }
  );

const revokeOverrideSchema = z
  .object({ reason: reasonSchema, idempotencyKey: idempotencyKeySchema })
  .strict();

const candidateQuerySchema = z
  .object({
    userQuery: z.string().trim().max(120).optional(),
    playerAQuery: z.string().trim().max(120).optional(),
    playerBQuery: z.string().trim().max(120).optional(),
    startedFrom: z.coerce.number().int().min(0).max(8640000000000000).optional(),
    startedTo: z.coerce.number().int().min(0).max(8640000000000000).optional(),
    rankedSeasonId: uuidSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().nonnegative().default(0),
  })
  .strict()
  .refine(
    (query) =>
      query.startedFrom === undefined ||
      query.startedTo === undefined ||
      query.startedFrom <= query.startedTo,
    { message: '开始日期不能晚于结束日期' }
  );

export function createDeckClassifierAdminRouter(
  service: DeckClassifierAdminService = deckClassifierAdminService,
  worker: DeckClassifierWorkerNotifier = deckClassifierProcess
): Router {
  const router = Router();
  router.use(requireAuth, requirePermission('season.deck_classifier.manage'));

  router.get('/overview', async (_req, res) => {
    await respond(res, () => service.getOverview());
  });

  router.get('/template-match-candidates', async (req, res) => {
    const parsed = candidateQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        data: null,
        error: {
          code: 'INVALID_REQUEST',
          message: parsed.error.issues[0]?.message ?? '筛选参数无效',
        },
      });
      return;
    }
    await respond(res, () => service.listTemplateMatchCandidates(parsed.data));
  });

  router.get('/runs/:runId', async (req, res) => {
    const runId = readUuidParam(req.params.runId, res);
    if (!runId) return;
    await respond(res, () => service.getClassificationRun(runId));
  });

  router.put('/settings', async (req, res) => {
    const input = readBody(req, res, settingsSchema);
    if (!input) return;
    await respond(res, () => service.updateDisplaySettings(input, readOperator(req)));
  });

  router.put('/execution-settings', async (req, res) => {
    const input = readBody(req, res, executionSettingsSchema);
    if (!input) return;
    await respond(res, () => service.updateExecutionSettings(input, readOperator(req)));
  });

  router.post('/archetypes', async (req, res) => {
    const input = readBody(req, res, archetypeCreateSchema);
    if (!input) return;
    await respond(res, () => service.createArchetype(input, readOperator(req)), 201);
  });

  router.put('/archetypes/:archetypeId', async (req, res) => {
    const archetypeId = readUuidParam(req.params.archetypeId, res);
    const input = readBody(req, res, archetypeUpdateSchema);
    if (!archetypeId || !input) return;
    await respond(res, () => service.updateArchetype(archetypeId, input, readOperator(req)));
  });

  router.put('/archetypes/:archetypeId/display', async (req, res) => {
    const archetypeId = readUuidParam(req.params.archetypeId, res);
    const input = readBody(req, res, archetypeDisplaySchema);
    if (!archetypeId || !input) return;
    await respond(res, () => service.updateArchetypeDisplay(archetypeId, input, readOperator(req)));
  });

  router.post('/archetypes/:archetypeId/archive', async (req, res) => {
    const archetypeId = readUuidParam(req.params.archetypeId, res);
    const input = readBody(req, res, archiveSchema);
    if (!archetypeId || !input) return;
    await respond(res, async () => {
      await service.archiveArchetype(
        archetypeId,
        input.expectedDraftRevision,
        input.reason,
        readOperator(req)
      );
      return { archived: true };
    });
  });

  router.post('/templates/from-match', async (req, res) => {
    const input = readBody(req, res, templateFromMatchSchema);
    if (!input) return;
    await respond(res, () => service.createTemplateFromMatch(input, readOperator(req)), 201);
  });

  router.post('/templates/preview-yaml', async (req, res) => {
    const input = readBody(req, res, templateYamlPreviewSchema);
    if (!input) return;
    await respond(res, () => service.previewTemplateYaml(input.yamlContent));
  });

  router.post('/templates/from-yaml', async (req, res) => {
    const input = readBody(req, res, templateFromYamlSchema);
    if (!input) return;
    await respond(res, () => service.createTemplateFromYaml(input, readOperator(req)), 201);
  });

  router.post('/templates/from-review', async (req, res) => {
    const input = readBody(req, res, templateFromReviewSchema);
    if (!input) return;
    await respond(res, () => service.createTemplateFromReview(input, readOperator(req)), 201);
  });

  router.put('/templates/:templateId', async (req, res) => {
    const templateId = readUuidParam(req.params.templateId, res);
    const input = readBody(req, res, templateUpdateSchema);
    if (!templateId || !input) return;
    await respond(res, () => service.updateTemplate(templateId, input, readOperator(req)));
  });

  router.delete('/templates/:templateId', async (req, res) => {
    const templateId = readUuidParam(req.params.templateId, res);
    const input = readBody(req, res, archiveSchema);
    if (!templateId || !input) return;
    await respond(res, async () => {
      await service.deleteTemplate(
        templateId,
        input.expectedDraftRevision,
        input.reason,
        readOperator(req)
      );
      return { deleted: true };
    });
  });

  router.post('/rules', async (req, res) => {
    const input = readBody(req, res, ruleSchema);
    if (!input) return;
    await respond(res, () => service.createRule(input, readOperator(req)), 201);
  });

  router.put('/rules/:ruleId', async (req, res) => {
    const ruleId = readUuidParam(req.params.ruleId, res);
    const input = readBody(req, res, ruleSchema);
    if (!ruleId || !input) return;
    await respond(res, () => service.updateRule(ruleId, input, readOperator(req)));
  });

  router.delete('/rules/:ruleId', async (req, res) => {
    const ruleId = readUuidParam(req.params.ruleId, res);
    const input = readBody(req, res, archiveSchema);
    if (!ruleId || !input) return;
    await respond(res, async () => {
      await service.deleteRule(
        ruleId,
        input.expectedDraftRevision,
        input.reason,
        readOperator(req)
      );
      return { deleted: true };
    });
  });

  router.post('/preview', async (req, res) => {
    const input = readBody(req, res, previewSchema);
    if (!input) return;
    await respond(res, () => worker.preview(input.expectedDraftRevision, input.matchLimit));
  });

  router.post('/releases', async (req, res) => {
    const input = readBody(req, res, publishSchema);
    if (!input) return;
    await respond(
      res,
      async () => {
        const result = await service.publishRelease(
          input.expectedDraftRevision,
          input.reason,
          input.idempotencyKey,
          readOperator(req),
          input.matchLimit
        );
        worker.notify();
        return result;
      },
      202
    );
  });

  router.post('/runs', async (req, res) => {
    const input = readBody(req, res, reclassifySchema);
    if (!input) return;
    await respond(
      res,
      async () => {
        const run = await service.queueReclassification(
          input.seasonId,
          input.reason,
          input.idempotencyKey,
          readOperator(req),
          input.matchLimit
        );
        worker.notify();
        return run;
      },
      202
    );
  });

  router.post('/overrides', async (req, res) => {
    const input = readBody(req, res, overrideSchema);
    if (!input) return;
    await respond(
      res,
      async () => {
        const run = await service.setOverride(input, readOperator(req));
        worker.notify();
        return run;
      },
      202
    );
  });

  router.post('/overrides/:overrideId/revoke', async (req, res) => {
    const overrideId = readUuidParam(req.params.overrideId, res);
    const input = readBody(req, res, revokeOverrideSchema);
    if (!overrideId || !input) return;
    await respond(
      res,
      async () => {
        const run = await service.revokeOverride(
          overrideId,
          input.reason,
          input.idempotencyKey,
          readOperator(req)
        );
        worker.notify();
        return run;
      },
      202
    );
  });

  return router;
}

function readBody<T extends z.ZodType>(req: Request, res: Response, schema: T): z.output<T> | null {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: {
        code: 'INVALID_REQUEST',
        message: parsed.error.issues[0]?.message ?? '请求参数无效',
      },
    });
    return null;
  }
  return parsed.data;
}

function readUuidParam(value: string | string[] | undefined, res: Response): string | null {
  const parsed = uuidSchema.safeParse(Array.isArray(value) ? value[0] : value);
  if (!parsed.success) {
    res.status(400).json({ data: null, error: { code: 'INVALID_REQUEST', message: 'ID 无效' } });
    return null;
  }
  return parsed.data;
}

function readOperator(req: Request): DeckClassifierOperator {
  if (!req.user) throw new Error('卡组分类管理接口缺少已认证用户');
  return {
    actorUserId: req.user.id,
    actorRole: req.user.role,
    requestId: req.requestId ?? randomUUID(),
  };
}

async function respond(
  res: Response,
  operation: () => Promise<unknown>,
  statusCode = 200
): Promise<void> {
  try {
    const data = await operation();
    res.status(statusCode).json({ data, error: null });
  } catch (error) {
    if (
      error instanceof DeckClassifierAdminServiceError ||
      error instanceof DeckClassifierProcessError
    ) {
      res.status(error.statusCode).json({
        data: null,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    console.error('deck classifier admin request failed', error);
    res.status(500).json({
      data: null,
      error: { code: 'DECK_CLASSIFIER_INTERNAL_ERROR', message: '卡组分类服务暂时不可用' },
    });
  }
}

export const deckClassifierAdminRouter = createDeckClassifierAdminRouter();
