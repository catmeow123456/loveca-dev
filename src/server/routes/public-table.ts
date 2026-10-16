import { Router } from 'express';

/** Retired casual ticket protocol. Old clients must reload the unified lobby. */
export const publicTableRouter = Router();
publicTableRouter.use((_req, res) => {
  res.status(410).json({
    data: null,
    error: { code: 'CASUAL_ENTRY_RETIRED', message: '休闲对战已迁移到对战大厅，请刷新页面' },
  });
});
