import { Router, type Response } from 'express';
import { z } from 'zod';
import { SITE_ANNOUNCEMENT_TYPES, SITE_STATUS_LIFECYCLES } from '../site-status.js';
import { requireAuth } from '../middleware/require-auth.js';
import { requireAdmin } from '../middleware/require-admin.js';
import { validate } from '../middleware/validate.js';
import {
  SiteAnnouncementServiceError,
  siteAnnouncementService,
  type SiteAnnouncementInput,
  type SiteStatusConfigInput,
} from '../services/site-announcement-service.js';

export const siteAnnouncementsRouter = Router();

const siteAnnouncementInputSchema = z.object({
  type: z.enum(SITE_ANNOUNCEMENT_TYPES),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(280),
  detail: z.string().trim().max(4000).nullable().optional(),
  startsAt: z.string().trim().max(64).nullable().optional(),
  endsAt: z.string().trim().max(64).nullable().optional(),
  priority: z.number().int().min(-100).max(100).optional(),
  impactScopes: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  publish: z.boolean().optional(),
  publishedAt: z.string().trim().max(64).nullable().optional(),
});

const siteStatusConfigInputSchema = z.object({
  lifecycle: z.enum(SITE_STATUS_LIFECYCLES),
  title: z.string().trim().max(120).nullable().optional(),
  summary: z.string().trim().max(280).nullable().optional(),
  detail: z.string().trim().max(4000).nullable().optional(),
  startsAt: z.string().trim().max(64).nullable().optional(),
  estimatedEndsAt: z.string().trim().max(64).nullable().optional(),
  restrictsNewGamesAt: z.string().trim().max(64).nullable().optional(),
  impactScopes: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  restrictions: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  action: z.string().trim().max(120).nullable().optional(),
});

siteAnnouncementsRouter.get('/admin', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const announcements = await siteAnnouncementService.listAdminAnnouncements();
    res.json({ data: announcements, total: announcements.length, error: null });
  } catch (error) {
    respondSiteAnnouncementError(res, error);
  }
});

siteAnnouncementsRouter.get('/admin/site-status', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const siteStatus = await siteAnnouncementService.getConfiguredSiteStatus(process.env);
    res.json({ data: siteStatus, error: null });
  } catch (error) {
    respondSiteAnnouncementError(res, error);
  }
});

siteAnnouncementsRouter.put(
  '/admin/site-status',
  requireAuth,
  requireAdmin,
  validate(siteStatusConfigInputSchema),
  async (req, res) => {
    try {
      const siteStatus = await siteAnnouncementService.updateSiteStatusConfig(
        req.body as SiteStatusConfigInput,
        req.user!.id
      );
      res.json({ data: siteStatus, error: null });
    } catch (error) {
      respondSiteAnnouncementError(res, error);
    }
  }
);

siteAnnouncementsRouter.post(
  '/admin',
  requireAuth,
  requireAdmin,
  validate(siteAnnouncementInputSchema),
  async (req, res) => {
    try {
      const announcement = await siteAnnouncementService.createAnnouncement(
        req.body as SiteAnnouncementInput,
        req.user!.id
      );
      res.status(201).json({ data: announcement, error: null });
    } catch (error) {
      respondSiteAnnouncementError(res, error);
    }
  }
);

siteAnnouncementsRouter.put(
  '/admin/:id',
  requireAuth,
  requireAdmin,
  validate(siteAnnouncementInputSchema),
  async (req, res) => {
    const id = readAnnouncementId(req.params.id, res);
    if (!id) {
      return;
    }

    try {
      const announcement = await siteAnnouncementService.updateAnnouncement(
        id,
        req.body as SiteAnnouncementInput,
        req.user!.id
      );
      if (!announcement) {
        respondAnnouncementNotFound(res);
        return;
      }

      res.json({ data: announcement, error: null });
    } catch (error) {
      respondSiteAnnouncementError(res, error);
    }
  }
);

siteAnnouncementsRouter.post('/admin/:id/publish', requireAuth, requireAdmin, async (req, res) => {
  const id = readAnnouncementId(req.params.id, res);
  if (!id) {
    return;
  }

  try {
    const announcement = await siteAnnouncementService.publishAnnouncement(id, req.user!.id);
    if (!announcement) {
      respondAnnouncementNotFound(res);
      return;
    }

    res.json({ data: announcement, error: null });
  } catch (error) {
    respondSiteAnnouncementError(res, error);
  }
});

siteAnnouncementsRouter.delete('/admin/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = readAnnouncementId(req.params.id, res);
  if (!id) {
    return;
  }

  try {
    const deleted = await siteAnnouncementService.deleteAnnouncement(id);
    if (!deleted) {
      respondAnnouncementNotFound(res);
      return;
    }

    res.json({ data: { deleted: true }, error: null });
  } catch (error) {
    respondSiteAnnouncementError(res, error);
  }
});

function readAnnouncementId(
  value: string | readonly string[] | undefined,
  res: Response
): string | null {
  if (typeof value !== 'string') {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '公告 ID 参数非法' },
    });
    return null;
  }

  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) {
    res.status(400).json({
      data: null,
      error: { code: 'INVALID_REQUEST', message: '公告 ID 参数非法' },
    });
    return null;
  }

  return parsed.data;
}

function respondAnnouncementNotFound(res: Response): void {
  res.status(404).json({
    data: null,
    error: { code: 'NOT_FOUND', message: '公告不存在' },
  });
}

function respondSiteAnnouncementError(res: Response, error: unknown): void {
  if (error instanceof SiteAnnouncementServiceError) {
    res.status(error.statusCode).json({
      data: null,
      error: { code: error.code, message: error.message },
    });
    return;
  }

  console.error('[SiteAnnouncements] Route error:', error);
  res.status(500).json({
    data: null,
    error: { code: 'INTERNAL_ERROR', message: '公告操作失败' },
  });
}
