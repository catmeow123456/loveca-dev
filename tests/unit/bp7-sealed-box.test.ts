import { describe, expect, it } from 'vitest';
import {
  generateBp7Box,
  buildSealedDeck,
  validateSealedDraft,
} from '../../src/domain/rules/sealed-box';
import { CardType } from '../../src/shared/types/enums';
import { getBaseCardCode } from '../../src/shared/utils/card-code';
import { sealedCards, seededRandom } from '../helpers/sealed-cards';

describe('BP7 simulated collation', () => {
  it.each(
    [0, 1500, 2000].flatMap((member) =>
      [0, 500].flatMap((live) =>
        [0, 800, 950, 1000].map((energy) => [member, live, energy] as const)
      )
    )
  )('keeps independent category boundaries for rolls %i/%i/%i', (member, live, energy) => {
    const rolls = [member, live, energy];
    const cards = generateBp7Box(sealedCards(), (upper) =>
      upper === 10000 ? rolls.shift()! : 0
    ).packs.flat();
    expect(cards.filter((c) => c.rare === 'P+')).toHaveLength(member === 0 ? 1 : 0);
    expect(cards.filter((c) => c.rare === 'SEC')).toHaveLength(member === 1500 ? 1 : 0);
    expect(cards.filter((c) => c.rare === 'SECL')).toHaveLength(live === 0 ? 1 : 0);
    for (const [roll, rare] of [
      [0, 'PE+'],
      [800, 'SECE'],
      [950, 'LLE'],
    ] as const)
      expect(cards.filter((c) => c.rare === rare)).toHaveLength(energy === roll ? 1 : 0);
    expect(cards.filter((c) => c.rare === 'R+')).toHaveLength(
      4 - Number(member < 2000) - Number(energy < 1000)
    );
    expect(cards.filter((c) => c.cardType === CardType.LIVE)).toHaveLength(6);
    expect(cards).toHaveLength(50);
  });
  it('does not increase a base card weight when another print is added', () => {
    const cards = sealedCards();
    const extra = { ...cards.find((c) => c.rare === 'P')!, imageFilename: 'alternate-print.png' };
    for (let seed = 0; seed < 100; seed++) {
      const original = generateBp7Box(cards, seededRandom(seed));
      const withPrint = generateBp7Box([...cards, extra], seededRandom(seed));
      expect(withPrint.packs.flat().map((c) => getBaseCardCode(c.cardCode))).toEqual(
        original.packs.flat().map((c) => getBaseCardCode(c.cardCode))
      );
    }
  });
  it('preserves box/pack/type guarantees across seeds, including rare replacement combinations', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 500; seed++) {
      const pool = generateBp7Box(sealedCards(), seededRandom(seed));
      const cards = pool.packs.flat();
      expect(pool.packs).toHaveLength(10);
      for (const pack of pool.packs) {
        expect(pack).toHaveLength(5);
        expect(pack.filter((c) => c.rare === 'N')).toHaveLength(2);
        expect(pack.filter((c) => c.rare === 'R')).toHaveLength(1);
      }
      expect(cards).toHaveLength(50);
      expect(cards.filter((c) => c.cardType === CardType.LIVE)).toHaveLength(6);
      const energy = cards.filter((c) => c.cardType === CardType.ENERGY);
      expect([1, 2]).toContain(energy.length);
      expect(cards.filter((c) => c.rare === 'PE')).toHaveLength(1);
      const counts = new Map<string, number>();
      for (const card of cards.filter((c) => c.cardType === CardType.LIVE))
        counts.set(
          getBaseCardCode(card.cardCode),
          (counts.get(getBaseCardCode(card.cardCode)) ?? 0) + 1
        );
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(4);
      const indices = cards
        .flatMap((card, index) => (card.cardType === CardType.MEMBER ? [index] : []))
        .slice(0, 24);
      const deck = buildSealedDeck(pool, indices);
      expect(deck.mainDeck).toHaveLength(30);
      expect(deck.energyDeck).toHaveLength(12);
      for (const card of cards) seen.add(card.rare!);
    }
    expect([...seen].sort()).toEqual(
      ['N', 'R', 'P', 'R+', 'P+', 'SEC', 'L', 'SECL', 'PE', 'PE+', 'SECE', 'LLE'].sort()
    );
  });
  it.each([
    [1499, 'P+'],
    [1500, 'SEC'],
    [1999, 'SEC'],
    [2000, null],
  ])('uses exact member probability boundary %s', (roll, rare) => {
    let ordinal = 0;
    const cards = generateBp7Box(sealedCards(), (upper) =>
      upper === 10000 ? (ordinal++ === 0 ? roll : 9999) : 0
    ).packs.flat();
    expect(cards.find((c) => ['P+', 'SEC'].includes(c.rare!))?.rare ?? null).toBe(rare);
  });
  it('retains ordinary PE with bonus energy and includes BP7 old-number SECL reprints', () => {
    const cards = generateBp7Box(sealedCards(), () => 0).packs.flat();
    expect(cards.filter((c) => c.cardType === CardType.MEMBER)).toHaveLength(42);
    expect(cards.some((c) => c.rare === 'SECL' && c.cardCode.includes('-bp1-'))).toBe(true);
    expect(cards.filter((c) => c.rare === 'PE')).toHaveLength(1);
    expect(cards.filter((c) => c.rare === 'PE+')).toHaveLength(1);
  });
  it('does not supplement a missing bucket from another product', () => {
    const cards = sealedCards().map((c) => (c.rare === 'SEC' ? { ...c, product: 'OTHER' } : c));
    expect(() => generateBp7Box(cards, () => 9999)).toThrow('SEC');
  });
  it('rejects unavailable copies, non-members and incomplete decks without limiting member duplicates to four', () => {
    const pool = generateBp7Box(sealedCards(), (upper) => (upper === 10000 ? 9999 : 0));
    const indices = pool.packs
      .flat()
      .flatMap((c, index) => (c.cardType === CardType.MEMBER ? [index] : []))
      .slice(0, 24);
    expect(() => buildSealedDeck(pool, indices)).not.toThrow();
    expect(() => validateSealedDraft(pool, [0, 0])).toThrow('持有数量');
    expect(() => validateSealedDraft(pool, [50])).toThrow();
    expect(() =>
      validateSealedDraft(pool, [pool.packs.flat().findIndex((c) => c.cardType === CardType.LIVE)])
    ).toThrow();
    expect(() => buildSealedDeck(pool, indices.slice(1))).toThrow('24');
  });
});
