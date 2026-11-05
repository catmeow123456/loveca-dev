import {
  createCardInstance,
  createHeartRequirement,
  type BladeHearts,
  type CardInstance,
  type HeartIcon,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { CardType, type HeartColor } from '../../src/shared/types/enums';
import sourceRows from '../fixtures/november-04-draft-effects.json';

export const NOVEMBER_04_TARGET_BASES = ['PL!-bp8-020', 'PL!HS-bp8-016', 'PL!HS-bp8-021'] as const;

/** November 04 target cards and the published 20-cost Hime used in the cost regression. */
export function getNovember04DraftRow(cardCodeOrBase: string) {
  const exact = sourceRows[cardCodeOrBase as keyof typeof sourceRows];
  const row =
    exact ??
    Object.values(sourceRows).find((candidate) =>
      candidate.cardCode.startsWith(`${cardCodeOrBase}-`)
    );
  if (!row) throw new Error(`Missing November 04 fixture: ${cardCodeOrBase}`);
  return row;
}

/** Preserve the complete Chinese and Japanese texts from the authorized export. */
export function getNovember04DraftCard(cardCodeOrBase: string): MemberCardData | LiveCardData {
  const row = getNovember04DraftRow(cardCodeOrBase);
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
    sourceFlags: globalThis.structuredClone(row.sourceFlags) as MemberCardData['sourceFlags'],
    bladeHearts: row.bladeHearts?.length
      ? (globalThis.structuredClone(row.bladeHearts) as BladeHearts)
      : undefined,
  };
  if (row.cardType === CardType.MEMBER && row.cost !== null && row.blade !== null) {
    return {
      ...base,
      cardType: CardType.MEMBER,
      cost: row.cost,
      blade: row.blade,
      hearts: globalThis.structuredClone(row.hearts ?? []) as HeartIcon[],
    };
  }
  if (row.cardType !== CardType.LIVE || row.score === null) {
    throw new Error(`Invalid November 04 card: ${row.cardCode}`);
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

export function createNovember04DraftCard(
  cardCodeOrBase: string,
  ownerId: string,
  instanceId: string
): CardInstance {
  return createCardInstance(getNovember04DraftCard(cardCodeOrBase), ownerId, instanceId);
}

export function getNovember04MemberData(cardCodeOrBase: string): MemberCardData {
  const data = getNovember04DraftCard(cardCodeOrBase);
  if (data.cardType !== CardType.MEMBER) throw new Error(`Not a member: ${cardCodeOrBase}`);
  return data;
}

export function getNovember04LiveData(cardCodeOrBase: string): LiveCardData {
  const data = getNovember04DraftCard(cardCodeOrBase);
  if (data.cardType !== CardType.LIVE) throw new Error(`Not a LIVE: ${cardCodeOrBase}`);
  return data;
}
