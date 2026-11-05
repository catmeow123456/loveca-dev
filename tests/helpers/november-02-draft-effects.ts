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
import sourceRows from '../fixtures/november-02-draft-effects.json';

export const NOVEMBER_02_TARGET_BASES = [
  'PL!-bp8-014',
  'PL!-bp8-022',
  'PL!HS-ad2-001',
  'PYHN-ad2-001',
] as const;

/** Only the four authorized November 02 target cards, copied from the specified export. */
export function getNovember02DraftRow(cardCodeOrBase: string) {
  const exact = sourceRows[cardCodeOrBase as keyof typeof sourceRows];
  const row =
    exact ??
    Object.values(sourceRows).find((candidate) =>
      candidate.cardCode.startsWith(`${cardCodeOrBase}-`)
    );
  if (!row) throw new Error(`Missing November 02 fixture: ${cardCodeOrBase}`);
  return row;
}

/** Preserve the complete Chinese and Japanese texts from the authorized export. */
export function getNovember02DraftCard(cardCodeOrBase: string): MemberCardData | LiveCardData {
  const row = getNovember02DraftRow(cardCodeOrBase);
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
    throw new Error(`Invalid November 02 card: ${row.cardCode}`);
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

export function createNovember02DraftCard(
  cardCodeOrBase: string,
  ownerId: string,
  instanceId: string
): CardInstance {
  return createCardInstance(getNovember02DraftCard(cardCodeOrBase), ownerId, instanceId);
}

export function getNovember02MemberData(cardCodeOrBase: string): MemberCardData {
  const data = getNovember02DraftCard(cardCodeOrBase);
  if (data.cardType !== CardType.MEMBER) throw new Error(`Not a member: ${cardCodeOrBase}`);
  return data;
}

export function getNovember02LiveData(cardCodeOrBase: string): LiveCardData {
  const data = getNovember02DraftCard(cardCodeOrBase);
  if (data.cardType !== CardType.LIVE) throw new Error(`Not a LIVE: ${cardCodeOrBase}`);
  return data;
}
