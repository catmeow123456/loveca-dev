import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

/**
 * Zod schema validation middleware factory.
 * Validates req.body against the provided schema.
 */
export function validate(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      res.status(400).json({
        data: null,
        error: { code: 'VALIDATION_ERROR', message },
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
