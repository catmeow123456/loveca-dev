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
import targetRows from '../fixtures/november-07-draft-effects.json';
import partnerRows from '../fixtures/november-07-regression-partners.json';
const sourceRows = { ...targetRows, ...partnerRows };

/** Read the November 07 target cards by printed or base code. */
export function getNovember07DraftRow(cardCodeOrBase: string) {
  const exact = sourceRows[cardCodeOrBase as keyof typeof sourceRows];
  const row =
    exact ??
    Object.values(sourceRows).find((candidate) =>
      candidate.cardCode.startsWith(`${cardCodeOrBase}-`)
    );
  if (!row) throw new Error(`Missing November 07 fixture: ${cardCodeOrBase}`);
  return row;
}

/** Preserve the complete Chinese and Japanese texts from the authorized export. */
export function getNovember07DraftCard(cardCodeOrBase: string): MemberCardData | LiveCardData {
  const row = getNovember07DraftRow(cardCodeOrBase);
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
  if (row.cardType !== CardType.LIVE || row.score === null || row.requirements === null) {
    throw new Error(`Invalid November 07 card: ${row.cardCode}`);
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

export function createNovember07DraftCard(
  cardCodeOrBase: string,
  ownerId: string,
  instanceId: string
): CardInstance {
  return createCardInstance(getNovember07DraftCard(cardCodeOrBase), ownerId, instanceId);
}

export function getNovember07MemberData(cardCodeOrBase: string): MemberCardData {
  const data = getNovember07DraftCard(cardCodeOrBase);
  if (data.cardType !== CardType.MEMBER) throw new Error(`Not a member: ${cardCodeOrBase}`);
  return data;
}

export function getNovember07LiveData(cardCodeOrBase: string): LiveCardData {
  const data = getNovember07DraftCard(cardCodeOrBase);
  if (data.cardType !== CardType.LIVE) throw new Error(`Not a LIVE: ${cardCodeOrBase}`);
  return data;
}
