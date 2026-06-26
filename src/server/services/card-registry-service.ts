import { pool } from '../db/pool.js';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../domain/entities/card.js';
import { createHeartRequirement } from '../../domain/entities/card.js';
import { CardDataRegistry } from '../../domain/card-data/loader.js';
import { inheritMissingBladeHeartsByBase } from '../../domain/card-data/blade-heart-inheritance.js';
import { BladeHeartEffect, CardType, HeartColor } from '../../shared/types/enums.js';

interface CardDbRecord {
  readonly card_code: string;
  readonly card_type: 'MEMBER' | 'LIVE' | 'ENERGY';
  readonly name_jp: string | null;
  readonly name_cn: string | null;
  readonly work_names: string[] | null;
  readonly group_names: string[] | null;
  readonly unit_name: string | null;
  readonly unit_name_raw: string | null;
  readonly cost: number | null;
  readonly blade: number | null;
  readonly hearts: Array<{ color: string; count: number }> | null;
  readonly blade_hearts: Array<{ effect: string; heartColor?: string; value?: number }> | null;
  readonly score: number | null;
  readonly requirements: Array<{ color: string; count: number }> | null;
  readonly card_text_jp: string | null;
  readonly card_text_cn: string | null;
  readonly image_filename: string | null;
  readonly image_source_uri: string | null;
  readonly rare: string | null;
  readonly product: string | null;
  readonly product_code: string | null;
  readonly source_external_id: string | null;
  readonly source_flags: Record<string, unknown> | null;
}

const CARD_REGISTRY_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedRegistry: CardDataRegistry | null = null;
let cacheExpiresAt = 0;

export async function getPublishedCardRegistry(forceRefresh = false): Promise<CardDataRegistry> {
  if (!forceRefresh && cachedRegistry && Date.now() < cacheExpiresAt) {
    return cachedRegistry;
  }

  const { rows } = await pool.query<CardDbRecord>(
    "SELECT * FROM cards WHERE status = 'PUBLISHED' ORDER BY card_code"
  );

  const registry = new CardDataRegistry();
  registry.load(inheritMissingBladeHeartsByBase(rows).map(mapCardRecordToCardData));

  cachedRegistry = registry;
  cacheExpiresAt = Date.now() + CARD_REGISTRY_CACHE_TTL_MS;

  return registry;
}

function mapCardRecordToCardData(record: CardDbRecord): AnyCardData {
  const name = record.name_cn?.trim() || record.name_jp?.trim() || record.card_code;
  const cardText = record.card_text_cn?.trim() || record.card_text_jp?.trim() || undefined;
  const groupName = record.group_names?.length ? record.group_names.join('\n') : undefined;

  const baseData = {
    cardCode: record.card_code,
    name,
    nameJp: record.name_jp ?? undefined,
    nameCn: record.name_cn ?? undefined,
    groupName,
    workNames: record.work_names ?? undefined,
    groupNames: record.group_names ?? undefined,
    unitName: record.unit_name ?? undefined,
    unitNameRaw: record.unit_name_raw ?? undefined,
    cardText,
    cardTextJp: record.card_text_jp ?? undefined,
    cardTextCn: record.card_text_cn ?? undefined,
    imageFilename: record.image_filename ?? undefined,
    imageSourceUri: record.image_source_uri ?? undefined,
    rare: record.rare ?? undefined,
    product: record.product ?? undefined,
    productCode: record.product_code ?? undefined,
    sourceExternalId: record.source_external_id ?? undefined,
    sourceFlags: record.source_flags ?? undefined,
  };

  const convertBladeHearts = (
    items: CardDbRecord['blade_hearts']
  ): MemberCardData['bladeHearts'] => {
    if (!items || items.length === 0) {
      return undefined;
    }

    return items.map((item) => ({
      effect: item.effect as BladeHeartEffect,
      heartColor: item.heartColor as HeartColor | undefined,
    }));
  };

  switch (record.card_type) {
    case 'MEMBER':
      return {
        ...baseData,
        cardType: CardType.MEMBER,
        cost: record.cost ?? 0,
        blade: record.blade ?? 0,
        hearts: record.hearts ?? [],
        bladeHearts: convertBladeHearts(record.blade_hearts),
      } as MemberCardData;

    case 'LIVE':
      return {
        ...baseData,
        cardType: CardType.LIVE,
        score: record.score ?? 1,
        requirements: createHeartRequirement(
          (record.requirements ?? []).reduce(
            (accumulator, requirement) => {
              accumulator[requirement.color] =
                (accumulator[requirement.color] ?? 0) + requirement.count;
              return accumulator;
            },
            {} as Record<string, number>
          )
        ),
        bladeHearts: convertBladeHearts(record.blade_hearts),
      } as LiveCardData;

    case 'ENERGY':
      return {
        ...baseData,
        cardType: CardType.ENERGY,
      } as EnergyCardData;

    default:
      throw new Error(`Unknown card type: ${String(record.card_type)}`);
  }
}
