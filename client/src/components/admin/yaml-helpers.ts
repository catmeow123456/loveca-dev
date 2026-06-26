/**
 * yaml-helpers.ts - 卡牌数据的 YAML 序列化/反序列化
 */

import * as yaml from 'yaml';
import { CardType, HeartColor, BladeHeartEffect } from '@game/shared/types/enums';
import type { CardUpdateInput } from '@/lib/cardService';

export interface YamlCardData {
  nameJp?: string | null;
  nameCn?: string | null;
  workNames?: string[] | null;
  groupNames?: string[] | null;
  unitName?: string | null;
  unitNameRaw?: string | null;
  cost?: number | null;
  blade?: number | null;
  hearts?: { color: string; count: number }[];
  bladeHearts?: { effect: string; heartColor?: string }[] | null;
  score?: number | null;
  requirements?: { color: string; count: number }[];
  cardTextJp?: string | null;
  cardTextCn?: string | null;
  cardCode?: string;
  cardType?: string;
  rare?: string | null;
  product?: string | null;
  productCode?: string | null;
  imageSourceUri?: string | null;
  sourceExternalId?: string | null;
  sourceFlags?: Record<string, unknown> | null;
}

export function formDataToYaml(
  formData: CardUpdateInput & { cardCode?: string; cardType?: string },
  cardType?: string,
  isCreating?: boolean
): string {
  const obj: YamlCardData = {};
  if (isCreating) {
    obj.cardCode = formData.cardCode || '';
    obj.cardType = formData.cardType || 'MEMBER';
  }
  obj.nameJp = formData.nameJp ?? null;
  obj.nameCn = formData.nameCn ?? null;
  obj.workNames = formData.workNames ?? null;
  obj.groupNames = formData.groupNames ?? null;
  obj.unitName = formData.unitName ?? null;
  obj.unitNameRaw = formData.unitNameRaw ?? null;

  const type = formData.cardType || cardType;
  if (type === 'MEMBER' || type === CardType.MEMBER) {
    obj.cost = formData.cost ?? 0;
    obj.blade = formData.blade ?? 0;
    obj.hearts = (formData.hearts || []).map((h) => ({ color: h.color, count: h.count }));
  }
  if (type === 'LIVE' || type === CardType.LIVE) {
    obj.score = formData.score ?? 1;
    obj.requirements = (formData.requirements || []).map((r) => ({
      color: r.color,
      count: r.count,
    }));
  }
  if (type === 'MEMBER' || type === CardType.MEMBER || type === 'LIVE' || type === CardType.LIVE) {
    obj.bladeHearts = formData.bladeHearts
      ? formData.bladeHearts.map((bh) => {
          const item: { effect: string; heartColor?: string } = { effect: bh.effect };
          if (bh.heartColor) item.heartColor = bh.heartColor;
          return item;
        })
      : null;
  }
  obj.cardTextJp = formData.cardTextJp ?? null;
  obj.cardTextCn = formData.cardTextCn ?? null;
  obj.rare = formData.rare ?? null;
  obj.product = formData.product ?? null;
  obj.productCode = formData.productCode ?? null;
  obj.imageSourceUri = formData.imageSourceUri ?? null;
  obj.sourceExternalId = formData.sourceExternalId ?? null;
  obj.sourceFlags = formData.sourceFlags ?? null;
  return yaml.stringify(obj, { lineWidth: 0 });
}

export function yamlToFormData(
  text: string,
  existingFormData: CardUpdateInput & { cardCode?: string; cardType?: 'MEMBER' | 'LIVE' | 'ENERGY' }
): CardUpdateInput & { cardCode?: string; cardType?: 'MEMBER' | 'LIVE' | 'ENERGY' } {
  const parsed = yaml.parse(text) as YamlCardData;
  const validTypes = ['MEMBER', 'LIVE', 'ENERGY'] as const;
  const cardType =
    parsed.cardType && validTypes.includes(parsed.cardType as (typeof validTypes)[number])
      ? (parsed.cardType as 'MEMBER' | 'LIVE' | 'ENERGY')
      : existingFormData.cardType;
  return {
    ...existingFormData,
    ...(parsed.cardCode !== undefined ? { cardCode: parsed.cardCode } : {}),
    ...(cardType !== undefined ? { cardType } : {}),
    nameJp: parsed.nameJp,
    nameCn: parsed.nameCn,
    workNames: parsed.workNames,
    groupNames: parsed.groupNames,
    unitName: parsed.unitName,
    unitNameRaw: parsed.unitNameRaw,
    cost: parsed.cost,
    blade: parsed.blade,
    hearts: parsed.hearts?.map((h) => ({ color: h.color as HeartColor, count: h.count })),
    bladeHearts:
      parsed.bladeHearts?.map((bh) => ({
        effect: bh.effect as BladeHeartEffect,
        ...(bh.heartColor ? { heartColor: bh.heartColor as HeartColor } : {}),
      })) ?? null,
    score: parsed.score,
    requirements: parsed.requirements?.map((r) => ({
      color: r.color as HeartColor,
      count: r.count,
    })),
    cardTextJp: parsed.cardTextJp,
    cardTextCn: parsed.cardTextCn,
    rare: parsed.rare,
    product: parsed.product,
    productCode: parsed.productCode,
    imageSourceUri: parsed.imageSourceUri,
    sourceExternalId: parsed.sourceExternalId,
    sourceFlags: parsed.sourceFlags,
  };
}
