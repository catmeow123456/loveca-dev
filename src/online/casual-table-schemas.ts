import { z } from 'zod';

export const casualEntrySchema = z
  .object({
    format: z.enum(['CONSTRUCTED', 'SEALED_BP7']),
    ruleMode: z.enum(['NORMAL', 'UNLIMITED']),
    requestId: z.uuid(),
    deckId: z.uuid().optional(),
    spectatorEnabled: z.boolean(),
  })
  .superRefine((entry, ctx) => {
    if (
      entry.format === 'CONSTRUCTED'
        ? !entry.deckId
        : entry.deckId !== undefined || entry.ruleMode !== 'UNLIMITED'
    ) {
      ctx.addIssue({
        code: 'custom',
        message: '自由构筑需要卡组，开盒赛不选择账号卡组且不限制 PT',
      });
    }
  });
