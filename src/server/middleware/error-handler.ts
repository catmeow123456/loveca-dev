import type { Request, Response, NextFunction } from 'express';

/**
 * Global error handler middleware.
 * Catches unhandled errors and returns standardized error responses.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Unhandled error:', err);

  const status = 'status' in err ? (err as { status: number }).status : 500;
  const message =
    process.env.NODE_ENV === 'production' && status === 500 ? '服务器内部错误' : err.message;

  res.status(status).json({
    data: null,
    error: { code: 'INTERNAL_ERROR', message },
  });
}
