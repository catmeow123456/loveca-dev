import { Router } from 'express';
import { config } from '../config.js';
import { siteAnnouncementService } from '../services/site-announcement-service.js';
import { matchEmoteCatalogService } from '../services/match-emote-catalog-service.js';
import { battleTimeoutConfigService } from '../services/battle-timeout-config-service.js';

export const appConfigRouter = Router();

appConfigRouter.get('/', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const emailEnabled = config.isEmailFeatureEnabled;
  const [siteStatus, matchEmotes, battleEntries, battleTimeouts] = await Promise.all([
    siteAnnouncementService.getPublicSiteStatus(),
    matchEmoteCatalogService.getPublicCatalog(),
    siteAnnouncementService.getPlayerBattleEntryVisibility(),
    battleTimeoutConfigService.getConfig(),
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
        battleTimeouts,
      },
      siteStatus,
      matchEmotes,
    },
    error: null,
  });
});
