import type { NextFunction, Request, Response } from 'express';

export function setPrivateNoStoreHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

export function privateNoStore(_req: Request, res: Response, next: NextFunction): void {
  setPrivateNoStoreHeaders(res);
  next();
}
