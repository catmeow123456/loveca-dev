import { z } from 'zod';

export const casualEntrySchema = z
  .object({
    format: z.enum(['CONSTRUCTED', 'SEALED_BP7', 'HEXTECH']),
    ruleMode: z.enum(['NORMAL', 'UNLIMITED']),
    requestId: z.uuid(),
    deckId: z.uuid().optional(),
    spectatorEnabled: z.boolean(),
  })
  .superRefine((entry, ctx) => {
    if (
      (entry.format === 'SEALED_BP7' ? entry.deckId !== undefined : !entry.deckId) ||
      (entry.format !== 'CONSTRUCTED' && entry.ruleMode !== 'UNLIMITED')
    ) {
      ctx.addIssue({
        code: 'custom',
        message: '构筑与海克斯需要卡组；开盒战不选择账号卡组；开盒战和海克斯不限制 PT',
      });
    }
  });
