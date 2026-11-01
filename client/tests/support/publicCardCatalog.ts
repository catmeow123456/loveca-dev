import type { AnyCardData } from '../../../src/domain/entities/card';
import { CardType } from '../../../src/shared/types/enums';
import { publicCardCatalogSchema } from '../../../src/shared/public-card-catalog';

// Use the same frozen card facts for browser startup and the fixture's rule engine.
export function createPublicCardCatalog(cards: readonly AnyCardData[]) {
  const uniqueCards = new Map(cards.map((card) => [card.cardCode, card]));
  return publicCardCatalogSchema.parse({
    schemaVersion: 1,
    cards: [...uniqueCards.values()].map((card) => ({
      card_code: card.cardCode,
      card_type: card.cardType,
      name_jp: card.nameJp ?? null,
      name_cn: card.nameCn ?? card.name,
      work_names: card.workNames ?? null,
      group_names: card.groupNames ?? null,
      unit_name: card.unitName ?? null,
      unit_name_raw: card.unitNameRaw ?? null,
      cost: card.cardType === CardType.MEMBER ? card.cost : null,
      blade: card.cardType === CardType.MEMBER ? card.blade : null,
      hearts: card.cardType === CardType.MEMBER ? card.hearts : [],
      blade_hearts: card.cardType === CardType.ENERGY ? null : (card.bladeHearts ?? null),
      score: card.cardType === CardType.LIVE ? card.score : null,
      requirements:
        card.cardType === CardType.LIVE
          ? [...card.requirements.colorRequirements].map(([color, count]) => ({ color, count }))
          : [],
      card_text_jp: card.cardTextJp ?? null,
      card_text_cn: card.cardTextCn ?? card.cardText ?? null,
      image_filename: card.imageFilename ?? null,
      rare: card.rare ?? null,
      product: card.product ?? null,
      product_code: card.productCode ?? null,
    })),
  });
}
