import type { BladeHearts, HeartIcon, MemberCardData } from '../../src/domain/entities/card';
import { CardType } from '../../src/shared/types/enums';
import { getBaseCardCode } from '../../src/shared/utils/card-code';
import rows from '../fixtures/november-20-draft-effects.json';

export const november20SharedPrBases = [
  ['PL!HS-PR-043', 'PL!N-PR-037'],
  ['PL!SP-PR-034', 'PL!N-PR-038'],
  ['PL!SP-PR-035', 'PL!N-PR-039'],
];

export function getNovember20MemberData(cardCodeOrBase: string): MemberCardData {
  const base = getBaseCardCode(cardCodeOrBase);
  const row = rows.find((print) => getBaseCardCode(print.cardCode) === base);
  if (!row || row.cardType !== CardType.MEMBER)
    throw new Error(`Missing November 20 member: ${base}`);
  return {
    cardCode: row.cardCode,
    cardType: CardType.MEMBER,
    name: row.nameCn,
    nameCn: row.nameCn,
    nameJp: row.nameJp,
    rare: row.rare,
    groupNames: row.groupNames,
    unitName: row.unitName,
    unitNameRaw: row.unitNameRaw,
    cost: row.cost,
    blade: row.blade,
    hearts: row.hearts as HeartIcon[],
    bladeHearts: (row.bladeHearts ?? undefined) as BladeHearts | undefined,
    cardText: row.cardTextCn,
    cardTextCn: row.cardTextCn,
    cardTextJp: row.cardTextJp,
  };
}
