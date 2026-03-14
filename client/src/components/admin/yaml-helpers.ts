/**
 * yaml-helpers.ts - 卡牌数据的 YAML 序列化/反序列化
 */

import * as yaml from 'yaml';
import { CardType, HeartColor, BladeHeartEffect } from '@game/shared/types/enums';
import type { CardUpdateInput } from '@/lib/cardService';

export interface YamlCardData {
  name?: string;
  groupName?: string | null;
  unitName?: string | null;
  cost?: number | null;
  blade?: number | null;
  hearts?: { color: string; count: number }[];
  bladeHearts?: { effect: string; heartColor?: string }[] | null;
  score?: number | null;
  requirements?: { color: string; count: number }[];
  cardText?: string | null;
  cardCode?: string;
  cardType?: string;
  rare?: string | null;
  product?: string | null;
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
  obj.name = formData.name || '';
  obj.groupName = formData.groupName ?? null;
  obj.unitName = formData.unitName ?? null;

  const type = formData.cardType || cardType;
  if (type === 'MEMBER' || type === CardType.MEMBER) {
    obj.cost = formData.cost ?? 0;
    obj.blade = formData.blade ?? 0;
    obj.hearts = (formData.hearts || []).map(h => ({ color: h.color, count: h.count }));
  }
  if (type === 'LIVE' || type === CardType.LIVE) {
    obj.score = formData.score ?? 1;
    obj.requirements = (formData.requirements || []).map(r => ({ color: r.color, count: r.count }));
  }
  if (type === 'MEMBER' || type === CardType.MEMBER || type === 'LIVE' || type === CardType.LIVE) {
    obj.bladeHearts = formData.bladeHearts
      ? formData.bladeHearts.map(bh => {
          const item: { effect: string; heartColor?: string } = { effect: bh.effect };
          if (bh.heartColor) item.heartColor = bh.heartColor;
          return item;
        })
      : null;
  }
  obj.cardText = formData.cardText ?? null;
  obj.rare = formData.rare ?? null;
  obj.product = formData.product ?? null;
  return yaml.stringify(obj, { lineWidth: 0 });
}

export function yamlToFormData(
  text: string,
  existingFormData: CardUpdateInput & { cardCode?: string; cardType?: 'MEMBER' | 'LIVE' | 'ENERGY' }
): CardUpdateInput & { cardCode?: string; cardType?: 'MEMBER' | 'LIVE' | 'ENERGY' } {
  const parsed = yaml.parse(text) as YamlCardData;
  const validTypes = ['MEMBER', 'LIVE', 'ENERGY'] as const;
  const cardType = parsed.cardType && validTypes.includes(parsed.cardType as typeof validTypes[number])
    ? (parsed.cardType as 'MEMBER' | 'LIVE' | 'ENERGY')
    : existingFormData.cardType;
  return {
    ...existingFormData,
    ...(parsed.cardCode !== undefined ? { cardCode: parsed.cardCode } : {}),
    ...(cardType !== undefined ? { cardType } : {}),
    name: parsed.name ?? existingFormData.name,
    groupName: parsed.groupName,
    unitName: parsed.unitName,
    cost: parsed.cost,
    blade: parsed.blade,
    hearts: parsed.hearts?.map(h => ({ color: h.color as HeartColor, count: h.count })),
    bladeHearts: parsed.bladeHearts?.map(bh => ({
      effect: bh.effect as BladeHeartEffect,
      ...(bh.heartColor ? { heartColor: bh.heartColor as HeartColor } : {}),
    })) ?? null,
    score: parsed.score,
    requirements: parsed.requirements?.map(r => ({ color: r.color as HeartColor, count: r.count })),
    cardText: parsed.cardText,
    rare: parsed.rare,
    product: parsed.product,
  };
}
