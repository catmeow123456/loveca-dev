import { Router } from 'express';
import { config } from '../config.js';
import { siteAnnouncementService } from '../services/site-announcement-service.js';

export const appConfigRouter = Router();

appConfigRouter.get('/', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const emailEnabled = config.isEmailFeatureEnabled;
  const siteStatus = await siteAnnouncementService.getPublicSiteStatus(process.env);

  res.json({
    data: {
      features: {
        email: {
          enabled: emailEnabled,
          verificationRequired: config.isEmailVerificationRequired,
          passwordResetEnabled: emailEnabled,
        },
      },
      siteStatus,
    },
    error: null,
  });
});
