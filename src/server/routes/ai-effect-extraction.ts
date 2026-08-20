import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { requirePermission } from '../middleware/require-permission.js';
import {
  AiEffectExtractionServiceError,
  aiEffectExtractionService,
} from '../services/ai-effect-extraction-service.js';

export const aiEffectExtractionRouter = Router();

const keyActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('KEEP') }).strict(),
  z.object({ action: z.literal('REPLACE'), value: z.string().min(1).max(4096) }).strict(),
  z.object({ action: z.literal('CLEAR') }).strict(),
]);

const candidateSchema = z
  .object({
    baseUrl: z.string().max(2048),
    modelId: z.string().max(128),
    apiKey: keyActionSchema,
  })
  .strict();

const saveSchema = candidateSchema
  .extend({
    expectedRevision: z.number().int().positive(),
    enabled: z.boolean(),
  })
  .strict();

const extractionSchema = z.object({ cardCode: z.string().trim().min(1).max(128) }).strict();

aiEffectExtractionRouter.use(requireAuth, requirePermission('cards.manage'));

aiEffectExtractionRouter.get('/admin/config', async (_req, res) => {
  try {
    const view = await aiEffectExtractionService.getAdminConfig();
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.json({ data: view, error: null });
  } catch (error) {
    respondError(res, error);
  }
});

aiEffectExtractionRouter.put('/admin/config', async (req, res) => {
  const parsed = saveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    respondInvalidRequest(res);
    return;
  }
  try {
    const view = await aiEffectExtractionService.saveConfig(parsed.data, req.user!.id);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.json({ data: view, error: null });
  } catch (error) {
    respondError(res, error);
  }
});

aiEffectExtractionRouter.post('/admin/test', async (req, res) => {
  const parsed = candidateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    respondInvalidRequest(res);
    return;
  }
  try {
    const result = await aiEffectExtractionService.testCandidate(parsed.data, req.user!.id);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.json({ data: result, error: null });
  } catch (error) {
    respondError(res, error);
  }
});

aiEffectExtractionRouter.post('/admin/extract', async (req, res) => {
  const parsed = extractionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    respondInvalidRequest(res);
    return;
  }
  try {
    const text = await aiEffectExtractionService.extractCardEffect(
      parsed.data.cardCode,
      req.user!.id
    );
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.json({ data: { text }, error: null });
  } catch (error) {
    respondError(res, error);
  }
});

function respondInvalidRequest(res: Response): void {
  res.status(400).json({
    data: null,
    error: { code: 'INVALID_REQUEST', message: 'AI 提取参数非法' },
  });
}

function respondError(res: Response, error: unknown): void {
  if (error instanceof AiEffectExtractionServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.error('[AiEffectExtraction] Request failed:', error);
  res.status(500).json({
    data: null,
    error: { code: 'AI_EFFECT_INTERNAL_ERROR', message: 'AI 提取服务暂时不可用' },
  });
}
