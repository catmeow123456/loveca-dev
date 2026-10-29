import { createHeartRequirement, type AnyCardData } from '../../src/domain/entities/card';
import { CardType, HeartColor } from '../../src/shared/types/enums';
export function sealedCards(): AnyCardData[] {
  return [
    ...['N', 'R', 'P', 'R+', 'P+', 'SEC', 'L', 'SECL', 'PE', 'PE+', 'SECE', 'LLE'].flatMap((rare) =>
      Array.from({ length: 4 }, (_, i): AnyCardData => {
        const common = {
          cardCode: `PL!N-${rare === 'SECL' ? 'bp1' : 'bp7'}-${String(i + 1).padStart(3, '0')}-${rare}`,
          name: `测试角色 ${i + 1}`,
          product: 'ブースターパック MELLOW MOMENT',
          rare,
          groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
        };
        if (['L', 'SECL'].includes(rare))
          return {
            ...common,
            cardType: CardType.LIVE,
            score: 3,
            requirements: createHeartRequirement({ [HeartColor.PINK]: 2, [HeartColor.BLUE]: 1 }),
          };
        if (['PE', 'PE+', 'SECE', 'LLE'].includes(rare))
          return { ...common, cardType: CardType.ENERGY };
        return {
          ...common,
          cardType: CardType.MEMBER,
          cost: 1,
          blade: 1,
          hearts: [{ color: HeartColor.GRAY, count: 2 }],
        };
      })
    ),
    { cardCode: 'LL-E-001-SD', name: '基础能量', cardType: CardType.ENERGY },
  ];
}
export function seededRandom(seed: number) {
  return (upper: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % upper;
  };
}
