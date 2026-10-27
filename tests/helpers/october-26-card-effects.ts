import {
  createHeartRequirement,
  type BladeHearts,
  type HeartIcon,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { CardType, type HeartColor } from '../../src/shared/types/enums';
import sourceRows from '../fixtures/october-26-card-effects.json';

export type October26CardCode = keyof typeof sourceRows;
export const OCTOBER_26_CARD_CODES = Object.keys(sourceRows) as October26CardCode[];

/** Frozen from the authorized export; null Blade Hearts follow the server registry mapping. */
export function getOctober26CardData(cardCode: string): MemberCardData | LiveCardData {
  const row = sourceRows[cardCode as October26CardCode];
  if (!row) throw new Error(`Missing October 26 fixture: ${cardCode}`);
  const base = {
    cardCode: row.cardCode,
    name: row.nameCn,
    nameCn: row.nameCn,
    nameJp: row.nameJp,
    rare: row.rare,
    workNames: row.workNames ?? undefined,
    groupNames: row.groupNames ?? undefined,
    unitName: row.unitName ?? undefined,
    unitNameRaw: row.unitNameRaw ?? undefined,
    cardText: row.cardTextCn,
    cardTextCn: row.cardTextCn,
    cardTextJp: row.cardTextJp,
    sourceFlags: structuredClone(row.sourceFlags) as MemberCardData['sourceFlags'],
    bladeHearts: row.bladeHearts?.length
      ? (structuredClone(row.bladeHearts) as BladeHearts)
      : undefined,
  };
  if (row.cardType === CardType.MEMBER) {
    if (row.cost === null || row.blade === null) throw new Error(`Incomplete member: ${cardCode}`);
    return {
      ...base,
      cardType: CardType.MEMBER,
      cost: row.cost,
      blade: row.blade,
      hearts: structuredClone(row.hearts) as HeartIcon[],
    };
  }
  if (row.cardType !== CardType.LIVE || row.score === null) {
    throw new Error(`Invalid LIVE fixture: ${cardCode}`);
  }
  const colors: Partial<Record<HeartColor, number>> = {};
  for (const requirement of row.requirements) {
    const color = requirement.color as HeartColor;
    colors[color] = (colors[color] ?? 0) + requirement.count;
  }
  return {
    ...base,
    cardType: CardType.LIVE,
    score: row.score,
    requirements: createHeartRequirement(colors),
  };
}
