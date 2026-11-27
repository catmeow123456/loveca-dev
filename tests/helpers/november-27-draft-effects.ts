import {
  createHeartRequirement,
  type BladeHearts,
  type HeartIcon,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { CardType } from '../../src/shared/types/enums';
import { getBaseCardCode } from '../../src/shared/utils/card-code';
import rows from '../fixtures/november-27-draft-effects.json';

function getPrint(cardCodeOrBase: string) {
  const base = getBaseCardCode(cardCodeOrBase);
  const row = rows.find((print) => getBaseCardCode(print.cardCode) === base);
  if (!row) throw new Error(`Missing November 27 print: ${base}`);
  return row;
}

function commonData(row: (typeof rows)[number]) {
  return {
    cardCode: row.cardCode,
    name: row.nameCn,
    nameCn: row.nameCn,
    nameJp: row.nameJp,
    rare: row.rare,
    groupNames: row.groupNames,
    unitName: row.unitName ?? undefined,
    unitNameRaw: row.unitNameRaw ?? undefined,
    bladeHearts: (row.bladeHearts ?? undefined) as BladeHearts | undefined,
    cardText: row.cardTextCn,
    cardTextCn: row.cardTextCn,
    cardTextJp: row.cardTextJp,
  };
}

export function getNovember27MemberData(cardCodeOrBase: string): MemberCardData {
  const row = getPrint(cardCodeOrBase);
  if (row.cardType !== CardType.MEMBER || row.cost === null || row.blade === null) {
    throw new Error(`Expected November 27 member: ${row.cardCode}`);
  }
  return {
    ...commonData(row),
    cardType: CardType.MEMBER,
    cost: row.cost,
    blade: row.blade,
    hearts: row.hearts as HeartIcon[],
  };
}

export function getNovember27LiveData(cardCodeOrBase: string): LiveCardData {
  const row = getPrint(cardCodeOrBase);
  if (row.cardType !== CardType.LIVE || row.score === null) {
    throw new Error(`Expected November 27 LIVE: ${row.cardCode}`);
  }
  return {
    ...commonData(row),
    cardType: CardType.LIVE,
    score: row.score,
    requirements: createHeartRequirement(
      Object.fromEntries(row.requirements.map((icon) => [icon.color, icon.count]))
    ),
  };
}
