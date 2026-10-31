import { describe, expect, it } from 'vitest';
import {
  generateBp7Box,
  buildSealedDeck,
  validateSealedDraft,
  treasurePackIndices,
  SEALED_TREASURE_ONE_IN,
} from '../../src/domain/rules/sealed-box';
import { CardType } from '../../src/shared/types/enums';
import { getBaseCardCode } from '../../src/shared/utils/card-code';
import { sealedCards, seededRandom } from '../helpers/sealed-cards';

describe('BP7 simulated collation', () => {
  it('draws one treasure pack in exactly one of sixty box-level outcomes', () => {
    const seen: number[] = [];
    for (let roll = 0; roll < 60; roll++) {
      let lotteryCalls = 0;
      const pool = generateBp7Box(sealedCards(), (upper) => {
        if (upper === 60) {
          lotteryCalls++;
          return roll;
        }
        return upper === 10000 ? 9999 : 0;
      });
      expect(lotteryCalls).toBe(1);
      if (treasurePackIndices(pool).length) seen.push(roll);
    }
    expect(seen).toEqual([0]);
  });
  it('keeps a character family together and permits three energies alongside ordinary upgrades', () => {
    const pool = generateBp7Box(sealedCards(), () => 0);
    expect(treasurePackIndices(pool)).toEqual([0]);
    expect(pool.packs[0].map((card) => card.rare)).toEqual(['R+', 'P', 'P+', 'SEC', 'SECE']);
    expect(new Set(pool.packs[0].map((card) => card.name)).size).toBe(1);
    expect(
      new Set(pool.packs[0].slice(0, 4).map((card) => getBaseCardCode(card.cardCode))).size
    ).toBe(1);
    const cards = pool.packs.flat();
    const indices = cards
      .flatMap((card, index) => (card.cardType === CardType.MEMBER ? [index] : []))
      .slice(0, 24);
    const deck = buildSealedDeck(pool, indices);
    expect(cards.filter((card) => card.cardType === CardType.MEMBER)).toHaveLength(41);
    expect(deck.energyDeck.filter((card) => card.cardCode !== 'LL-E-001-SD')).toHaveLength(3);
    expect(deck.energyDeck).toHaveLength(12);
    expect(deck.mainDeck).toHaveLength(30);
  });
  it('selects characters without extra print weight and can place the treasure in any pack', () => {
    for (let character = 0; character < 4; character++) {
      for (let pack = 0; pack < 10; pack++) {
        let pickedCharacter = false;
        let tenCalls = 0;
        const pool = generateBp7Box(sealedCards(), (upper) => {
          if (upper === 10000) return 9999;
          if (upper === 60) return 0;
          if (upper === 4 && !pickedCharacter) {
            pickedCharacter = true;
            return character;
          }
          // Shuffle has one upper=10 draw, followed by the pack position draw.
          if (upper === 10 && ++tenCalls === 2) return pack;
          return 0;
        });
        expect(treasurePackIndices(pool)).toEqual([pack]);
        expect(pool.packs[pack][0].name).toBe(`测试角色 ${character + 1}`);
      }
    }
  });
  it('rejects an incomplete or wrong-character treasure family without cross-product fallback', () => {
    const missing = sealedCards().filter((card) => card.cardCode !== 'PL!N-bp7-001-P+');
    expect(() => generateBp7Box(missing, () => 0)).toThrow('完整配套');
    const wrong = sealedCards().map((card) =>
      card.rare === 'SECE' ? { ...card, name: '其他角色' } : card
    );
    expect(() => generateBp7Box(wrong, () => 0)).toThrow('完整配套');
  });
  it('matches full-width rarities and spacing without conflating empty Japanese names', () => {
    const cards = sealedCards().map((card) => ({
      ...card,
      nameJp: ' ',
      name: card.rare === 'SECE' ? card.name.replace(' ', '　') : card.name,
      rare: card.rare?.replace('+', '＋'),
      cardCode: card.cardCode.replace('+', '＋'),
    }));
    const pool = generateBp7Box(cards, () => 0);
    expect(treasurePackIndices(pool)).toEqual([0]);
    expect(new Set(pool.packs[0].map((card) => card.name.replace(/\s/g, ''))).size).toBe(1);
  });
  it.each(
    [0, 1500, 2000].flatMap((member) =>
      [0, 500].flatMap((live) =>
        [0, 800, 950, 1000].flatMap((energy) =>
          [0, 1].map((treasure) => [member, live, energy, treasure] as const)
        )
      )
    )
  )(
    'keeps independent category boundaries for rolls %i/%i/%i with treasure roll %i',
    (member, live, energy, treasure) => {
      const rolls = [member, live, energy];
      const cards = generateBp7Box(sealedCards(), (upper) =>
        upper === 10000 ? rolls.shift()! : upper === SEALED_TREASURE_ONE_IN ? treasure : 0
      ).packs.flat();
      expect(cards.filter((c) => c.rare === 'P+')).toHaveLength(
        Number(member === 0) + Number(treasure === 0)
      );
      expect(cards.filter((c) => c.rare === 'SEC')).toHaveLength(
        Number(member === 1500) + Number(treasure === 0)
      );
      expect(cards.filter((c) => c.rare === 'SECL')).toHaveLength(live === 0 ? 1 : 0);
      for (const [roll, rare] of [
        [0, 'PE+'],
        [800, 'SECE'],
        [950, 'LLE'],
      ] as const)
        expect(cards.filter((c) => c.rare === rare)).toHaveLength(
          Number(energy === roll) + Number(rare === 'SECE' && treasure === 0)
        );
      expect(cards.filter((c) => c.rare === 'R+')).toHaveLength(
        4 - Number(member < 2000) - Number(energy < 1000)
      );
      expect(cards.filter((c) => c.cardType === CardType.LIVE)).toHaveLength(6);
      expect(cards).toHaveLength(50);
    }
  );
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
      const treasure = treasurePackIndices(pool);
      expect(treasure.length).toBeLessThanOrEqual(1);
      for (const [index, pack] of pool.packs.entries()) {
        expect(pack).toHaveLength(5);
        expect(pack.filter((c) => c.rare === 'N')).toHaveLength(treasure.includes(index) ? 0 : 2);
        expect(pack.filter((c) => c.rare === 'R')).toHaveLength(treasure.includes(index) ? 0 : 1);
      }
      expect(cards).toHaveLength(50);
      expect(cards.filter((c) => c.cardType === CardType.LIVE)).toHaveLength(6);
      const energy = cards.filter((c) => c.cardType === CardType.ENERGY);
      expect([1 + treasure.length, 2 + treasure.length]).toContain(energy.length);
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
      upper === 10000 ? (ordinal++ === 0 ? roll : 9999) : upper === SEALED_TREASURE_ONE_IN ? 1 : 0
    ).packs.flat();
    expect(cards.find((c) => ['P+', 'SEC'].includes(c.rare!))?.rare ?? null).toBe(rare);
  });
  it('retains ordinary PE with bonus energy and includes BP7 old-number SECL reprints', () => {
    const cards = generateBp7Box(sealedCards(), (upper) =>
      upper === SEALED_TREASURE_ONE_IN ? 1 : 0
    ).packs.flat();
    expect(cards.filter((c) => c.cardType === CardType.MEMBER)).toHaveLength(42);
    expect(cards.some((c) => c.rare === 'SECL' && c.cardCode.includes('-bp1-'))).toBe(true);
    expect(cards.filter((c) => c.rare === 'PE')).toHaveLength(1);
    expect(cards.filter((c) => c.rare === 'PE+')).toHaveLength(1);
  });
  it('does not supplement a missing bucket from another product', () => {
    const cards = sealedCards().map((c) => (c.rare === 'SEC' ? { ...c, product: 'OTHER' } : c));
    expect(() => generateBp7Box(cards, (upper) => upper - 1)).toThrow('SEC');
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
