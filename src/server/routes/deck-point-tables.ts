import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { validate } from '../middleware/validate.js';
import {
  DeckPointTableServiceError,
  deckPointTableService,
  type CreateDeckPointTableDraftInput,
  type DiscardDeckPointTableInput,
  type PublishDeckPointTableInput,
  type UpdateDeckPointTableInput,
} from '../services/deck-point-table-service.js';

export const deckPointTablesRouter = Router();
export const deckPointTablesAdminRouter = Router();

const tableIdSchema = z.string().uuid();
const entrySchema = z
  .object({
    baseCardCode: z.string().trim().min(1).max(80),
    points: z.number().int().min(1).max(99),
  })
  .strict();
const draftSchema = z
  .object({
    version: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/),
    displayName: z.string().trim().min(1).max(100),
    pointLimit: z.number().int().min(1).max(99),
    entries: z.array(entrySchema).max(500),
  })
  .strict();
const effectiveDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
const updateTableSchema = draftSchema.extend({
  effectiveDateTime: effectiveDateTimeSchema.optional(),
  expectedRevision: z.number().int().positive(),
});
const diffSchema = z
  .object({
    compareToId: z.string().uuid().optional(),
  })
  .strict();
const publishSchema = z
  .object({
    mode: z.enum(['IMMEDIATE', 'SCHEDULED']),
    effectiveDateTime: effectiveDateTimeSchema.optional(),
    expectedRevision: z.number().int().positive(),
    expectedActiveTableId: z.string().uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === 'SCHEDULED' && !value.effectiveDateTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveDateTime'],
        message: '定时发布必须提供北京时间生效时间',
      });
    }
    if (value.mode === 'IMMEDIATE' && value.effectiveDateTime) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveDateTime'],
        message: '立即发布不能由客户端指定生效时间',
      });
    }
  });
const expectedRevisionSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
const discardSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    replacementTableId: z.string().uuid().optional(),
    replacementExpectedRevision: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.replacementTableId) !== Boolean(value.replacementExpectedRevision)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replacementTableId'],
        message: '替代表 ID 与替代表 revision 必须同时提供',
      });
    }
  });
const rollbackDraftSchema = z
  .object({
    version: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/),
    displayName: z.string().trim().min(1).max(100),
  })
  .strict();

deckPointTablesRouter.get('/current', async (_req, res) => {
  try {
    const table = await deckPointTableService.getCurrentTable();
    respondData(res, {
      version: table.version,
      displayName: table.displayName,
      pointLimit: table.pointLimit,
      effectiveFrom: table.effectiveFrom,
      platformTimeZone: table.platformTimeZone,
      entries: table.entries.map(({ baseCardCode, points }) => ({ baseCardCode, points })),
    });
  } catch (error) {
    respondPointTableError(res, error);
  }
});

deckPointTablesAdminRouter.use(requireAuth, requireAdmin);

deckPointTablesAdminRouter.get('/', async (_req, res) => {
  try {
    const tables = await deckPointTableService.listTables();
    res.json({ data: tables, total: tables.length, error: null });
  } catch (error) {
    respondPointTableError(res, error);
  }
});

deckPointTablesAdminRouter.get('/:id', async (req, res) => {
  const id = readTableId(req.params.id, res);
  if (!id) return;
  try {
    const table = await deckPointTableService.getTable(id);
    if (!table) {
      respondNotFound(res);
      return;
    }
    respondData(res, table);
  } catch (error) {
    respondPointTableError(res, error);
  }
});

deckPointTablesAdminRouter.get('/:id/audit', async (req, res) => {
  const id = readTableId(req.params.id, res);
  if (!id) return;
  try {
    const audit = await deckPointTableService.listAudit(id);
    res.json({ data: audit, total: audit.length, error: null });
  } catch (error) {
    respondPointTableError(res, error);
  }
});

deckPointTablesAdminRouter.post('/', validate(draftSchema), async (req, res) => {
  try {
    const table = await deckPointTableService.createDraft(
      req.body as CreateDeckPointTableDraftInput,
      req.user!.id
    );
    res.status(201).json({ data: table, error: null });
  } catch (error) {
    respondPointTableError(res, error);
  }
});

deckPointTablesAdminRouter.put('/:id', validate(updateTableSchema), async (req, res) => {
  const id = readTableId(req.params.id, res);
  if (!id) return;
  try {
    respondData(
      res,
      await deckPointTableService.updateTable(
        id,
        req.body as UpdateDeckPointTableInput,
        req.user!.id
      )
    );
  } catch (error) {
    respondPointTableError(res, error);
  }
});

deckPointTablesAdminRouter.post('/:id/diff', validate(diffSchema), async (req, res) => {
  const id = readTableId(req.params.id, res);
  if (!id) return;
  try {
    respondData(
      res,
      await deckPointTableService.previewDiff(
        id,
        (req.body as z.infer<typeof diffSchema>).compareToId
      )
    );
  } catch (error) {
    respondPointTableError(res, error);
  }
});

deckPointTablesAdminRouter.post('/:id/publish', validate(publishSchema), async (req, res) => {
  const id = readTableId(req.params.id, res);
  if (!id) return;
  try {
    respondData(
      res,
      await deckPointTableService.publish(id, req.body as PublishDeckPointTableInput, req.user!.id)
    );
  } catch (error) {
    respondPointTableError(res, error);
  }
});

deckPointTablesAdminRouter.post(
  '/:id/cancel-schedule',
  validate(expectedRevisionSchema),
  async (req, res) => {
    const id = readTableId(req.params.id, res);
    if (!id) return;
    try {
      respondData(
        res,
        await deckPointTableService.cancelSchedule(
          id,
          (req.body as z.infer<typeof expectedRevisionSchema>).expectedRevision,
          req.user!.id
        )
      );
    } catch (error) {
      respondPointTableError(res, error);
    }
  }
);

deckPointTablesAdminRouter.post('/:id/discard', validate(discardSchema), async (req, res) => {
  const id = readTableId(req.params.id, res);
  if (!id) return;
  try {
    respondData(
      res,
      await deckPointTableService.discardTable(
        id,
        req.body as DiscardDeckPointTableInput,
        req.user!.id
      )
    );
  } catch (error) {
    respondPointTableError(res, error);
  }
});

deckPointTablesAdminRouter.delete('/:id', validate(expectedRevisionSchema), async (req, res) => {
  const id = readTableId(req.params.id, res);
  if (!id) return;
  try {
    respondData(
      res,
      await deckPointTableService.deleteTable(
        id,
        (req.body as z.infer<typeof expectedRevisionSchema>).expectedRevision
      )
    );
  } catch (error) {
    respondPointTableError(res, error);
  }
});

deckPointTablesAdminRouter.post(
  '/:id/rollback-draft',
  validate(rollbackDraftSchema),
  async (req, res) => {
    const id = readTableId(req.params.id, res);
    if (!id) return;
    try {
      const table = await deckPointTableService.createRollbackDraft(
        id,
        req.body as z.infer<typeof rollbackDraftSchema>,
        req.user!.id
      );
      res.status(201).json({ data: table, error: null });
    } catch (error) {
      respondPointTableError(res, error);
    }
  }
);

function readTableId(value: string | readonly string[] | undefined, res: Response): string | null {
  const parsed = tableIdSchema.safeParse(value);
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: 'PT限制表 ID 参数非法' },
    });
    return null;
  }
  return parsed.data;
}

function respondData(res: Response, data: unknown): void {
  res.json({ data, error: null });
}

function respondNotFound(res: Response): void {
  res.status(404).json({
    data: null,
    error: { code: 'POINT_TABLE_NOT_FOUND', message: 'PT限制表不存在' },
  });
}

function respondPointTableError(res: Response, error: unknown): void {
  if (error instanceof DeckPointTableServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.error('[DeckPointTables] Route error:', error);
  res.status(500).json({
    data: null,
    error: { code: 'INTERNAL_ERROR', message: 'PT限制表操作失败' },
  });
}
