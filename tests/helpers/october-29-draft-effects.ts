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
import sourceRows from '../fixtures/october-29-draft-effects.json';

export const OCTOBER_29_TARGET_BASES = [
  'PL!N-bp8-005',
  'PL!N-bp8-017',
  'PL!HS-bp8-007',
  'PL!HS-bp8-008',
  'PL!HS-bp8-015',
  'PL!-bp8-025',
  'PL!HS-bp8-023',
  'PL!N-bp8-029',
] as const;

/** Only the authorized eight targets and the real migrated A song for You! prints. */
export function getOctober29DraftRow(cardCodeOrBase: string) {
  const exact = sourceRows[cardCodeOrBase as keyof typeof sourceRows];
  const row =
    exact ??
    Object.values(sourceRows).find((candidate) =>
      candidate.cardCode.startsWith(`${cardCodeOrBase}-`)
    );
  if (!row) throw new Error(`Missing October 29 fixture: ${cardCodeOrBase}`);
  return row;
}

/** Preserve the export text; the HS015 authorized display exception belongs to definitions. */
export function getOctober29DraftCard(cardCodeOrBase: string): MemberCardData | LiveCardData {
  const row = getOctober29DraftRow(cardCodeOrBase);
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
    throw new Error(`Invalid October 29 card: ${row.cardCode}`);
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

export function createOctober29DraftCard(
  cardCodeOrBase: string,
  ownerId: string,
  instanceId: string
): CardInstance {
  return createCardInstance(getOctober29DraftCard(cardCodeOrBase), ownerId, instanceId);
}

export function getOctober29MemberData(cardCodeOrBase: string): MemberCardData {
  const data = getOctober29DraftCard(cardCodeOrBase);
  if (data.cardType !== CardType.MEMBER) throw new Error(`Not a member: ${cardCodeOrBase}`);
  return data;
}

export function getOctober29LiveData(cardCodeOrBase: string): LiveCardData {
  const data = getOctober29DraftCard(cardCodeOrBase);
  if (data.cardType !== CardType.LIVE) throw new Error(`Not a LIVE: ${cardCodeOrBase}`);
  return data;
}
