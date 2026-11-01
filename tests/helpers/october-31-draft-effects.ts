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
import sourceRows from '../fixtures/october-31-draft-effects.json';

export const OCTOBER_31_TARGET_BASES = [
  'PL!-bp8-009',
  'PL!-bp8-015',
  'PL!N-bp8-003',
  'PL!N-bp8-021',
  'PL!N-bp8-025',
  'PL!HS-bp8-011',
  'PL!SP-PR-033',
] as const;

/** Only the seven authorized October 31 target cards, copied from the specified export. */
export function getOctober31DraftRow(cardCodeOrBase: string) {
  const exact = sourceRows[cardCodeOrBase as keyof typeof sourceRows];
  const row =
    exact ??
    Object.values(sourceRows).find((candidate) =>
      candidate.cardCode.startsWith(`${cardCodeOrBase}-`)
    );
  if (!row) throw new Error(`Missing October 31 fixture: ${cardCodeOrBase}`);
  return row;
}

/** Preserve both exported texts; Maki uses the explicitly authorized Chinese LIVE-success timing. */
export function getOctober31DraftCard(cardCodeOrBase: string): MemberCardData | LiveCardData {
  const row = getOctober31DraftRow(cardCodeOrBase);
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
  if (row.cardType === CardType.MEMBER && row.cost !== null && row.blade !== null) {
    return {
      ...base,
      cardType: CardType.MEMBER,
      cost: row.cost,
      blade: row.blade,
      hearts: structuredClone(row.hearts ?? []) as HeartIcon[],
    };
  }
  if (row.cardType !== CardType.LIVE || row.score === null) {
    throw new Error(`Invalid October 31 card: ${row.cardCode}`);
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

export function createOctober31DraftCard(
  cardCodeOrBase: string,
  ownerId: string,
  instanceId: string
): CardInstance {
  return createCardInstance(getOctober31DraftCard(cardCodeOrBase), ownerId, instanceId);
}

export function getOctober31MemberData(cardCodeOrBase: string): MemberCardData {
  const data = getOctober31DraftCard(cardCodeOrBase);
  if (data.cardType !== CardType.MEMBER) throw new Error(`Not a member: ${cardCodeOrBase}`);
  return data;
}

export function getOctober31LiveData(cardCodeOrBase: string): LiveCardData {
  const data = getOctober31DraftCard(cardCodeOrBase);
  if (data.cardType !== CardType.LIVE) throw new Error(`Not a LIVE: ${cardCodeOrBase}`);
  return data;
}
