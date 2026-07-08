import { Router } from 'express';
import { config } from '../config.js';
import { siteAnnouncementService } from '../services/site-announcement-service.js';

export const appConfigRouter = Router();

appConfigRouter.get('/', async (_req, res) => {
  const emailEnabled = config.isEmailFeatureEnabled;
  const siteStatus = await siteAnnouncementService.getPublicSiteStatus(process.env);

  res.json({
    data: {
      features: {
        email: {
          enabled: emailEnabled,
          verificationRequired: emailEnabled,
          passwordResetEnabled: emailEnabled,
        },
      },
      siteStatus,
    },
    error: null,
  });
});
