import { describe, expect, it } from 'vitest';
import { bp8ExportCards } from '../helpers/bp8-export-cards';
import { seededRandom } from '../helpers/sealed-cards';
import {
  generateBp8Box,
  isBp8Product,
  buildSealedDeck,
  treasurePackIndices,
} from '../../src/domain/rules/sealed-box';
import { getBaseCardCode } from '../../src/shared/utils/card-code';
import { CardType } from '../../src/shared/types/enums';

describe('BP8 collation with the authorized November 16 export', () => {
  const cards = bp8ExportCards();
  it('recognizes product metadata, including reprints, without accepting BP7 or unrelated codes', () => {
    expect(cards.filter(isBp8Product)).toHaveLength(170);
    const sample = cards.find(isBp8Product)!;
    expect(isBp8Product({ ...sample, productCode: 'BP8' })).toBe(true);
    expect(isBp8Product({ ...sample, productCode: undefined })).toBe(true);
    expect(isBp8Product({ ...sample, productCode: 'BP07', product: 'MELLOW MOMENT' })).toBe(false);
    expect(isBp8Product({ ...sample, productCode: undefined, product: undefined })).toBe(false);
    expect(cards.filter(isBp8Product).some((c) => !c.cardCode.includes('-bp8-'))).toBe(true);
  });
  it('generates valid frozen boxes and decks across 500 seeds from all real print families', () => {
    for (let seed = 0; seed < 500; seed++) {
      const pool = generateBp8Box(cards, seededRandom(seed));
      expect(pool.version).toBe('BP8_SIMULATED_V1');
      expect(pool.packs).toHaveLength(10);
      expect(pool.packs.every((p) => p.length === 5)).toBe(true);
      const flat = pool.packs.flat();
      expect(flat.every(isBp8Product)).toBe(true);
      const lives = flat.filter((c) => c.cardType === CardType.LIVE);
      expect(lives).toHaveLength(6);
      for (const live of lives)
        expect(
          lives.filter((c) => getBaseCardCode(c.cardCode) === getBaseCardCode(live.cardCode)).length
        ).toBeLessThanOrEqual(4);
      const indices = flat
        .flatMap((c, i) => (c.cardType === CardType.MEMBER ? [i] : []))
        .slice(0, 24);
      const deck = buildSealedDeck(pool, indices);
      expect(deck.mainDeck).toHaveLength(30);
      expect(deck.energyDeck).toHaveLength(12);
    }
  });
  it('can draw the complete treasure family of each of the ten SEC characters', () => {
    const names = new Set<string>();
    for (let target = 0; target < 10; target++) {
      let chosen = false;
      const pool = generateBp8Box(cards, (upper) => {
        if (upper === 10000) return 9999;
        if (upper === 60) return 0;
        if (upper === 10 && !chosen) {
          chosen = true;
          return target;
        }
        return 0;
      });
      const index = treasurePackIndices(pool)[0];
      expect(index).toBeDefined();
      names.add(pool.packs[index][0].nameJp!);
    }
    expect(names.size).toBe(10);
  });
  it('reports missing buckets if the new draft prints have not been published', () => {
    expect(() => generateBp8Box(bp8ExportCards(true), seededRandom(1))).toThrow('八弹卡池缺少 P+');
  });
});
