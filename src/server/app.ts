import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { URL } from 'node:url';
import { config } from './config.js';
import { authenticate } from './middleware/authenticate.js';
import { attachRequestContext } from './middleware/request-context.js';
import { errorHandler } from './middleware/error-handler.js';
import { authRouter } from './routes/auth.js';
import { cardsRouter } from './routes/cards.js';
import { decksRouter } from './routes/decks.js';
import { profilesRouter } from './routes/profiles.js';
import { imagesRouter, publicImagesRouter } from './routes/images.js';
import { debugOnlineRouter } from './routes/debug-online.js';
import { onlineRouter } from './routes/online.js';
import { battleRouter } from './routes/battle.js';
import { appConfigRouter } from './routes/app-config.js';
import { siteAnnouncementsRouter } from './routes/site-announcements.js';
import { publicTableRouter } from './routes/public-table.js';
import { rankedRouter } from './routes/ranked.js';
import { rankedAdminRouter } from './routes/ranked-admin.js';
import { deckPointTablesAdminRouter, deckPointTablesRouter } from './routes/deck-point-tables.js';
import { playerBadgesRouter } from './routes/player-badges.js';
import { matchEmotesRouter } from './routes/match-emotes.js';
import { aiEffectExtractionRouter } from './routes/ai-effect-extraction.js';
import { playerWallpapersRouter } from './routes/player-wallpapers.js';
import { themeTableRouter } from './routes/theme-table.js';
import { themeTableAdminRouter } from './routes/theme-table-admin.js';
import { adminUsersRouter } from './routes/admin-users.js';
import { platformOperationsRouter } from './routes/platform-operations.js';
import { cardSyncRouter } from './routes/card-sync.js';
import { deckClassifierAdminRouter } from './routes/deck-classifier-admin.js';
import { activityCoverAdminRouter } from './routes/activity-covers.js';
import { activityBadgeAdminRouter } from './routes/activity-badges.js';
import { tutorialRouter } from './routes/tutorial.js';
import { matchmakingBgmRouter } from './routes/matchmaking-bgm.js';
import { checkApplicationReadiness } from './services/readiness-service.js';

export function createApp(): express.Express {
  const app = express();

  if (!config.isDev) {
    // Production traffic is expected to arrive through the local reverse proxy.
    app.set('trust proxy', 'loopback');
  }

  // Security headers
  app.use(
    helmet({
      crossOriginResourcePolicy: config.isDev ? { policy: 'cross-origin' } : undefined,
    })
  );

  // CORS — only needed in dev (production is same-origin via Nginx)
  if (config.isDev) {
    app.use(
      cors({
        origin(origin, callback) {
          if (!origin) {
            callback(null, true);
            return;
          }

          try {
            const parsed = new URL(origin);
            const isLocalhost =
              (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
              /^5\d{3}$/.test(parsed.port);
            callback(null, isLocalhost);
          } catch {
            callback(null, false);
          }
        },
        credentials: true,
      })
    );
  }

  // Body parsing
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(attachRequestContext);

  // Authentication (optional — parses JWT if present)
  app.use(authenticate);

  // Routes
  app.use('/api/auth', authRouter);
  app.use('/api/config', appConfigRouter);
  app.use('/api/cards', cardsRouter);
  app.use('/api/decks', decksRouter);
  app.use('/api/deck-point-tables', deckPointTablesRouter);
  app.use('/api/profiles', profilesRouter);
  app.use('/api/images', imagesRouter);
  app.use('/api/site-announcements', siteAnnouncementsRouter);
  app.use('/api/online', onlineRouter);
  app.use('/api/battle', battleRouter);
  app.use('/api/tutorial', tutorialRouter);
  app.use('/api/public-table', publicTableRouter);
  app.use('/api/ranked', rankedRouter);
  app.use('/api/player-badges', playerBadgesRouter);
  app.use('/api/player-wallpapers', playerWallpapersRouter);
  app.use('/api/match-emotes', matchEmotesRouter);
  app.use('/api/matchmaking-bgm', matchmakingBgmRouter);
  app.use('/api/ai-effect-extraction', aiEffectExtractionRouter);
  app.use('/api/theme-table', themeTableRouter);
  app.use('/api/admin/theme-table', themeTableAdminRouter);
  app.use('/api/admin/ranked', rankedAdminRouter);
  app.use('/api/admin/deck-classifier', deckClassifierAdminRouter);
  app.use('/api/admin/deck-point-tables', deckPointTablesAdminRouter);
  app.use('/api/admin/users', adminUsersRouter);
  app.use('/api/admin/platform-operations', platformOperationsRouter);
  app.use('/api/admin/card-sync', cardSyncRouter);
  app.use('/api/admin/activity-covers', activityCoverAdminRouter);
  app.use('/api/admin/activity-badges', activityBadgeAdminRouter);
  if (config.isDev) {
    app.use('/images', publicImagesRouter);
    app.use('/api/debug', debugOnlineRouter);
  }

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/ready', async (_req, res) => {
    const readiness = await checkApplicationReadiness();
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? 'ready' : 'not_ready',
      checkedAt: readiness.checkedAt,
    });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
