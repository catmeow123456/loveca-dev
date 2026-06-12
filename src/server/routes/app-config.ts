import { Router } from 'express';
import { config } from '../config.js';

export const appConfigRouter = Router();

appConfigRouter.get('/', (_req, res) => {
  const emailEnabled = config.isEmailFeatureEnabled;

  res.json({
    data: {
      features: {
        email: {
          enabled: emailEnabled,
          verificationRequired: emailEnabled,
          passwordResetEnabled: emailEnabled,
        },
      },
    },
    error: null,
  });
});
