import {
  createHeartRequirement,
  type AnyCardData,
  type BladeHearts,
  type HeartIcon,
} from '../../src/domain/entities/card';
import { CardType, type HeartColor } from '../../src/shared/types/enums';
import rows from '../fixtures/november-16-bp8-sealed.json';

// Explicitly includes the export's DRAFT prints for offline collation validation only.
// The production service still loads exclusively from the published registry.
export function bp8ExportCards(publishedOnly = false): AnyCardData[] {
  return rows
    .filter((row) => !publishedOnly || row.status === 'PUBLISHED')
    .map((row) => {
      const base = {
        cardCode: row.cardCode,
        name: row.nameCn || row.nameJp!,
        nameCn: row.nameCn ?? undefined,
        nameJp: row.nameJp ?? undefined,
        rare: row.rare!,
        product: row.product!,
        productCode: row.productCode!,
        imageFilename: row.imageFilename ?? undefined,
        groupNames: row.groupNames ?? undefined,
        workNames: row.workNames ?? undefined,
        unitName: row.unitName ?? undefined,
        unitNameRaw: row.unitNameRaw ?? undefined,
        cardText: row.cardTextCn ?? undefined,
        cardTextCn: row.cardTextCn ?? undefined,
        cardTextJp: row.cardTextJp ?? undefined,
        bladeHearts: (row.bladeHearts ?? undefined) as BladeHearts | undefined,
      };
      if (row.cardType === CardType.ENERGY) return { ...base, cardType: CardType.ENERGY };
      if (row.cardType === CardType.MEMBER) {
        if (row.cost === null || row.blade === null)
          throw new Error(`Incomplete member: ${row.cardCode}`);
        return {
          ...base,
          cardType: CardType.MEMBER,
          cost: row.cost,
          blade: row.blade,
          hearts: (row.hearts ?? []) as HeartIcon[],
        };
      }
      if (row.cardType !== CardType.LIVE || row.score === null || row.requirements === null)
        throw new Error(`Incomplete LIVE: ${row.cardCode}`);
      return {
        ...base,
        cardType: CardType.LIVE,
        score: row.score,
        requirements: createHeartRequirement(
          Object.fromEntries(row.requirements.map((r) => [r.color as HeartColor, r.count]))
        ),
      };
    });
}
