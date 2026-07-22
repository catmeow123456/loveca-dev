import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { URL } from 'node:url';
import { config } from './config.js';
import { authenticate } from './middleware/authenticate.js';
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

  // Authentication (optional — parses JWT if present)
  app.use(authenticate);

  // Routes
  app.use('/api/auth', authRouter);
  app.use('/api/config', appConfigRouter);
  app.use('/api/cards', cardsRouter);
  app.use('/api/decks', decksRouter);
  app.use('/api/profiles', profilesRouter);
  app.use('/api/images', imagesRouter);
  app.use('/api/site-announcements', siteAnnouncementsRouter);
  app.use('/api/online', onlineRouter);
  app.use('/api/battle', battleRouter);
  if (config.isDev) {
    app.use('/images', publicImagesRouter);
    app.use('/api/debug', debugOnlineRouter);
  }

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
