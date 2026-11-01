import { z } from 'zod/v4';
import { BladeHeartItemSchema, HeartIconSchema } from '../domain/card-data/schema.js';

// This is the public projection, not a database row. Zod strips unlisted fields,
// including audit identities and external source metadata.
export const publicCardRecordSchema = z.object({
  card_code: z.string().min(1),
  card_type: z.enum(['MEMBER', 'LIVE', 'ENERGY']),
  name_jp: z.string().nullable(),
  name_cn: z.string().nullable(),
  work_names: z.array(z.string()).nullable(),
  group_names: z.array(z.string()).nullable(),
  unit_name: z.string().nullable(),
  unit_name_raw: z.string().nullable(),
  cost: z.number().int().nonnegative().nullable(),
  blade: z.number().int().nonnegative().nullable(),
  hearts: z.array(HeartIconSchema),
  blade_hearts: z.array(BladeHeartItemSchema).nullable(),
  score: z.number().int().nonnegative().nullable(),
  requirements: z.array(HeartIconSchema),
  card_text_jp: z.string().nullable(),
  card_text_cn: z.string().nullable(),
  image_filename: z.string().nullable(),
  rare: z.string().nullable(),
  product: z.string().nullable(),
  product_code: z.string().nullable(),
});

export const publicCardCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  cards: z
    .array(publicCardRecordSchema)
    .min(1)
    .refine(
      (cards) => new Set(cards.map((card) => card.card_code)).size === cards.length,
      'Duplicate card codes'
    ),
});

export type PublicCardRecord = z.infer<typeof publicCardRecordSchema>;
