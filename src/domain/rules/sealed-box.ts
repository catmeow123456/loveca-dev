import type { AnyCardData } from '../entities/card.js';
import type { DeckConfig } from '../../application/game-service.js';
import { CardType } from '../../shared/types/enums.js';
import { getBaseCardCode } from '../../shared/utils/card-code.js';
import { SEALED_BP7_PRODUCT_LABEL } from '../../shared/sealed-format.js';

// These identify collation probabilities, not different snapshot schemas.
export const SEALED_BOX_VERSION = 'BP7_SIMULATED_V2';
export const SEALED_BOX_VERSIONS = ['BP7_SIMULATED_V1', SEALED_BOX_VERSION] as const;
export const SEALED_TREASURE_ONE_IN = 60;
export const SEALED_BUILDING_MS = 15 * 60 * 1000;
export const SEALED_RARITY_ODDS = {
  member: [
    ['P+', 1500],
    ['SEC', 500],
  ],
  live: [['SECL', 500]],
  energy: [
    ['PE+', 800],
    ['SECE', 150],
    ['LLE', 50],
  ],
} as const;

export interface SealedPool {
  readonly version: (typeof SEALED_BOX_VERSIONS)[number];
  readonly packs: readonly (readonly AnyCardData[])[];
  readonly basicEnergy: AnyCardData;
}

export class SealedBoxError extends Error {}

const treasureRarities = ['R+', 'P', 'P+', 'SEC', 'SECE'] as const;
const characterName = (card: AnyCardData) =>
  (card.nameJp?.trim() || card.name).normalize('NFKC').replace(/\s/g, '');

/** Derived from frozen cards; no extra persistent flag or current-card lookup. */
export function treasurePackIndices(pool: SealedPool): number[] {
  return pool.packs.flatMap((pack, index) => {
    if (pack.length !== 5) return [];
    const ordered = treasureRarities.map((rare) =>
      pack.find((card) => card.rare?.normalize('NFKC').toUpperCase() === rare)
    );
    if (ordered.some((card) => !card)) return [];
    const cards = ordered as AnyCardData[];
    const base = getBaseCardCode(cards[0].cardCode);
    return cards.every(
      (card, i) =>
        characterName(card) === characterName(cards[0]) &&
        (i === 4
          ? card.cardType === CardType.ENERGY
          : card.cardType === CardType.MEMBER && getBaseCardCode(card.cardCode) === base)
    )
      ? [index]
      : [];
  });
}

export function isBp7Product(card: AnyCardData): boolean {
  return (
    card.productCode?.toUpperCase() === 'BP07' ||
    card.productCode?.toUpperCase() === 'BP7' ||
    /MELLOWMOMENT/i.test((card.product ?? '').replace(/\s/g, ''))
  );
}

/** randomInt is server-owned and exclusive of its upper bound. */
export function generateBp7Box(
  cards: readonly AnyCardData[],
  randomInt: (upper: number) => number
): SealedPool {
  const buckets = new Map<string, Map<string, AnyCardData[]>>();
  const types: Record<string, CardType> = {
    N: CardType.MEMBER,
    R: CardType.MEMBER,
    P: CardType.MEMBER,
    'R+': CardType.MEMBER,
    'P+': CardType.MEMBER,
    SEC: CardType.MEMBER,
    L: CardType.LIVE,
    SECL: CardType.LIVE,
    PE: CardType.ENERGY,
    'PE+': CardType.ENERGY,
    SECE: CardType.ENERGY,
    LLE: CardType.ENERGY,
  };
  for (const card of cards) {
    const rare = card.rare?.normalize('NFKC').toUpperCase();
    if (!isBp7Product(card) || !rare || types[rare] !== card.cardType) continue;
    const bucket = buckets.get(rare) ?? new Map<string, AnyCardData[]>();
    const base = getBaseCardCode(card.cardCode);
    bucket.set(base, [...(bucket.get(base) ?? []), card]);
    buckets.set(rare, bucket);
  }
  for (const rare of Object.keys(types)) {
    if (!buckets.get(rare)?.size)
      throw new SealedBoxError(`${SEALED_BP7_PRODUCT_LABEL}卡池缺少 ${rare}，暂时无法开盒`);
  }
  const basicEnergy = cards.find(
    (card) => card.cardCode === 'LL-E-001-SD' && card.cardType === CardType.ENERGY
  );
  if (!basicEnergy) throw new SealedBoxError('缺少基础能量卡，暂时无法开盒');
  const liveCounts = new Map<string, number>();
  function draw(rare: string): AnyCardData {
    const candidates = [...buckets.get(rare)!.entries()].filter(
      ([base]) => types[rare] !== CardType.LIVE || (liveCounts.get(base) ?? 0) < 4
    );
    if (!candidates.length)
      throw new SealedBoxError(`${SEALED_BP7_PRODUCT_LABEL} Live 卡池不足以生成合法卡组`);
    const [base, prints] = candidates[randomInt(candidates.length)];
    const card = prints[randomInt(prints.length)];
    if (card.cardType === CardType.LIVE) liveCounts.set(base, (liveCounts.get(base) ?? 0) + 1);
    return card;
  }
  function upgrade(odds: readonly (readonly [string, number])[]): string | null {
    let roll = randomInt(10000);
    for (const [rare, weight] of odds) {
      if (roll < weight) return rare;
      roll -= weight;
    }
    return null;
  }
  const member = upgrade(SEALED_RARITY_ODDS.member);
  const live = upgrade(SEALED_RARITY_ODDS.live);
  const energy = upgrade(SEALED_RARITY_ODDS.energy);
  // One box-level draw: exactly 1/60, not a rounded basis-point or per-pack rate.
  const hasTreasure = randomInt(SEALED_TREASURE_ONE_IN) === 0;
  let treasure: AnyCardData[] | null = null;
  if (hasTreasure) {
    const characters = new Map<string, { members: AnyCardData[][]; energies: AnyCardData[][] }[]>();
    for (const [base, prints] of buckets.get('SEC')!) {
      const name = characterName(prints[0]);
      const memberPools = ['R+', 'P', 'P+', 'SEC'].map((rare) => buckets.get(rare)!.get(base));
      const energies = [...buckets.get('SECE')!.values()]
        .map((prints) => prints.filter((card) => characterName(card) === name))
        .filter((prints) => prints.length > 0);
      if (
        memberPools.some(
          (pool) => !pool?.length || pool.some((card) => characterName(card) !== name)
        ) ||
        !energies.length
      )
        throw new SealedBoxError(
          `${SEALED_BP7_PRODUCT_LABEL}宝藏包缺少 ${prints[0].name} 的完整配套卡牌`
        );
      const families = characters.get(name) ?? [];
      families.push({ members: memberPools as AnyCardData[][], energies });
      characters.set(name, families);
    }
    const families = [...characters.values()][randomInt(characters.size)];
    const family = families[randomInt(families.length)];
    const energyPrints = family.energies[randomInt(family.energies.length)];
    treasure = [...family.members, energyPrints].map((prints) => prints[randomInt(prints.length)]);
  }
  const flex = [
    ...Array<string>(hasTreasure ? 8 : 9).fill('P'),
    member ?? 'R+',
    energy ?? 'R+',
    ...(hasTreasure ? [] : ['R+']),
    'R+',
    ...Array<string>(5).fill('L'),
    live ?? 'L',
    'PE',
  ].map(draw);
  for (let i = flex.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [flex[i], flex[j]] = [flex[j], flex[i]];
  }
  const packs = Array.from({ length: hasTreasure ? 9 : 10 }, (_, index) => [
    draw('N'),
    draw('N'),
    draw('R'),
    flex[index * 2],
    flex[index * 2 + 1],
  ]);
  if (treasure) packs.splice(randomInt(10), 0, treasure);
  return {
    version: SEALED_BOX_VERSION,
    packs,
    basicEnergy,
  };
}

export function validateSealedDraft(
  pool: SealedPool,
  indices: readonly number[],
  complete = false
): void {
  const cards = pool.packs.flat();
  if (indices.length > 24 || (complete && indices.length !== 24))
    throw new SealedBoxError('请选择 24 张成员卡');
  if (
    new Set(indices).size !== indices.length ||
    indices.some(
      (index) => !Number.isInteger(index) || index < 0 || cards[index]?.cardType !== CardType.MEMBER
    )
  ) {
    throw new SealedBoxError('只能选择本盒开出的成员，且不能超过持有数量');
  }
}

export function buildSealedDeck(pool: SealedPool, indices: readonly number[]): DeckConfig {
  validateSealedDraft(pool, indices, true);
  const cards = pool.packs.flat();
  const lives = cards.filter((card) => card.cardType === CardType.LIVE);
  const energy = cards.filter((card) => card.cardType === CardType.ENERGY);
  if (
    cards.length !== 50 ||
    lives.length !== 6 ||
    energy.length < 1 ||
    energy.length > (treasurePackIndices(pool).length === 1 ? 3 : 2) ||
    pool.basicEnergy.cardType !== CardType.ENERGY
  ) {
    throw new SealedBoxError('开盒牌池无效');
  }
  return {
    mainDeck: [...indices.map((index) => cards[index]), ...lives],
    energyDeck: [...energy, ...Array<AnyCardData>(12 - energy.length).fill(pool.basicEnergy)],
  };
}
