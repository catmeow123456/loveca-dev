import { Router } from 'express';
import { config } from '../config.js';
import { siteAnnouncementService } from '../services/site-announcement-service.js';
import { matchEmoteCatalogService } from '../services/match-emote-catalog-service.js';

export const appConfigRouter = Router();

appConfigRouter.get('/', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const emailEnabled = config.isEmailFeatureEnabled;
  const [siteStatus, matchEmotes, battleEntries] = await Promise.all([
    siteAnnouncementService.getPublicSiteStatus(process.env),
    matchEmoteCatalogService.getPublicCatalog(),
    siteAnnouncementService.getPlayerBattleEntryVisibility(),
  ]);

  res.json({
    data: {
      features: {
        email: {
          enabled: emailEnabled,
          verificationRequired: config.isEmailVerificationRequired,
          passwordResetEnabled: emailEnabled,
        },
        battleEntries,
      },
      siteStatus,
      matchEmotes,
    },
    error: null,
  });
});
