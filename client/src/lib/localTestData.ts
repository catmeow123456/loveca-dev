import * as yaml from 'yaml';
import { DeckLoader, type DeckConfig as YamlDeckConfig } from '@game/domain/card-data/deck-loader';
import { CardDataRegistry } from '@game/domain/card-data/loader';
import type { DeckConfig as GameDeckConfig } from '@game/application/game-service';
import type {
  AnyCardData,
  BladeHeartItem,
  EnergyCardData,
  HeartIcon,
  HeartRequirement,
  LiveCardData,
  MemberCardData,
} from '@game/domain/entities/card';
import { CardType, HeartColor, BladeHeartEffect } from '@game/shared/types/enums';
import { normalizeCardCode } from '@game/shared/utils/card-code';
import testDeckOneYaml from '../../../assets/decks/缪预组.yaml?raw';
import testDeckTwoYaml from '../../../assets/decks/蓝紫.yaml?raw';
import { localTestCnCards, localTestJpCards } from '@/lib/localTestCardSources.generated';

type LlocgJpCard = {
  card_no?: string;
  name?: string;
  type?: string;
  series?: string;
  unit?: string;
  cost?: number;
  blade?: number;
  base_heart?: Record<string, number>;
  blade_heart?: Record<string, number>;
  special_heart?: Record<string, number>;
  score?: number;
  need_heart?: Record<string, number>;
  ability?: string;
  rare?: string;
  product?: string;
  img?: string;
  _img?: string;
};

type LlocgCnCard = {
  card_name_cn?: string;
  card_name_org?: string;
  img?: string;
  _img?: string;
  detail?: {
    card_name_cn?: string;
    card_name_org?: string;
    ability?: string;
  };
};

const JP_TYPE_MAP: Record<string, CardType> = {
  メンバー: CardType.MEMBER,
  ライブ: CardType.LIVE,
  エネルギー: CardType.ENERGY,
};

const HEART_COLOR_MAP: Record<string, HeartColor> = {
  heart01: HeartColor.PINK,
  heart02: HeartColor.RED,
  heart03: HeartColor.YELLOW,
  heart04: HeartColor.GREEN,
  heart05: HeartColor.BLUE,
  heart06: HeartColor.PURPLE,
  heart0: HeartColor.RAINBOW,
};

const BLADE_HEART_COLOR_MAP: Record<string, HeartColor> = {
  b_heart01: HeartColor.PINK,
  b_heart02: HeartColor.RED,
  b_heart03: HeartColor.YELLOW,
  b_heart04: HeartColor.GREEN,
  b_heart05: HeartColor.BLUE,
  b_heart06: HeartColor.PURPLE,
  b_all: HeartColor.RAINBOW,
};

export interface LocalTestData {
  readonly cards: AnyCardData[];
  readonly player1Name: string;
  readonly player2Name: string;
  readonly player1Deck: GameDeckConfig;
  readonly player2Deck: GameDeckConfig;
}

export function loadLocalTestData(): LocalTestData {
  const player1YamlDeck = yaml.parse(testDeckOneYaml) as YamlDeckConfig;
  const player2YamlDeck = yaml.parse(testDeckTwoYaml) as YamlDeckConfig;
  const neededCodes = collectDeckCodes(player1YamlDeck, player2YamlDeck);
  const cnByCode = buildCnCardIndex(localTestCnCards as Record<string, LlocgCnCard>);
  const cards = Array.from(neededCodes, (code) =>
    transformCard(code, (localTestJpCards as Record<string, LlocgJpCard>)[code], cnByCode.get(code))
  );
  const registry = new CardDataRegistry();
  registry.load(cards);
  const loader = new DeckLoader(registry);
  const player1LoadedDeck = loader.loadFromConfig(player1YamlDeck);
  const player2LoadedDeck = loader.loadFromConfig(player2YamlDeck);

  if (!player1LoadedDeck.success || !player1LoadedDeck.deck) {
    throw new Error(`玩家1本地测试卡组加载失败: ${player1LoadedDeck.errors.join(', ')}`);
  }
  if (!player2LoadedDeck.success || !player2LoadedDeck.deck) {
    throw new Error(`玩家2本地测试卡组加载失败: ${player2LoadedDeck.errors.join(', ')}`);
  }

  return {
    cards,
    player1Name: player1YamlDeck.player_name,
    player2Name: player2YamlDeck.player_name,
    player1Deck: {
      mainDeck: player1LoadedDeck.deck.mainDeck,
      energyDeck: player1LoadedDeck.deck.energyDeck,
    },
    player2Deck: {
      mainDeck: player2LoadedDeck.deck.mainDeck,
      energyDeck: player2LoadedDeck.deck.energyDeck,
    },
  };
}

function collectDeckCodes(...decks: YamlDeckConfig[]): Set<string> {
  const codes = new Set<string>();
  for (const deck of decks) {
    for (const entry of deck.main_deck.members) codes.add(normalizeCardCode(entry.card_code));
    for (const entry of deck.main_deck.lives) codes.add(normalizeCardCode(entry.card_code));
    for (const entry of deck.energy_deck) codes.add(normalizeCardCode(entry.card_code));
  }
  return codes;
}

function buildCnCardIndex(cards: Record<string, LlocgCnCard>): Map<string, LlocgCnCard> {
  const result = new Map<string, LlocgCnCard>();
  for (const [code, card] of Object.entries(cards)) {
    result.set(normalizeCardCode(code), card);
  }
  return result;
}

function transformCard(
  code: string,
  jp: LlocgJpCard | undefined,
  cn: LlocgCnCard | undefined
): AnyCardData {
  if (!jp) {
    throw new Error(`本地测试卡牌数据缺失: ${code}`);
  }

  const cardType = jp.type ? JP_TYPE_MAP[jp.type] : undefined;
  if (!cardType) {
    throw new Error(`无法识别本地测试卡牌类型: ${code}`);
  }

  const baseData = {
    cardCode: normalizeCardCode(jp.card_no ?? code),
    name: pickCardName(jp, cn),
    groupName: jp.series,
    unitName: jp.unit ? normalizeUnitName(jp.unit) : undefined,
    cardText: cn?.detail?.ability || jp.ability || undefined,
    imageFilename: pickImageFilename(jp, cn),
    rare: jp.rare,
    product: jp.product,
  };

  if (cardType === CardType.MEMBER) {
    return {
      ...baseData,
      cardType,
      cost: jp.cost ?? 0,
      blade: jp.blade ?? 0,
      hearts: convertHearts(jp.base_heart),
      bladeHearts: convertBladeHearts(jp.blade_heart, jp.special_heart),
    } satisfies MemberCardData;
  }

  if (cardType === CardType.LIVE) {
    return {
      ...baseData,
      cardType,
      score: jp.score ?? 0,
      requirements: createHeartRequirement(convertHearts(jp.need_heart)),
      bladeHearts: convertBladeHearts(jp.blade_heart, jp.special_heart),
    } satisfies LiveCardData;
  }

  return {
    ...baseData,
    cardType,
  } satisfies EnergyCardData;
}

function pickCardName(jp: LlocgJpCard, cn: LlocgCnCard | undefined): string {
  const cnName = cn?.detail?.card_name_cn || cn?.card_name_cn;
  if (cnName && cnName !== '能量' && cnName !== 'エネルギー') {
    return cnName;
  }
  return jp.name ?? jp.card_no ?? '未知卡牌';
}

function normalizeUnitName(unit: string): string {
  return unit.startsWith('「') ? unit : `「${unit}」`;
}

function pickImageFilename(jp: LlocgJpCard, cn: LlocgCnCard | undefined): string | undefined {
  const imagePath = cn?._img || jp._img || cn?.img || jp.img;
  return imagePath?.replace(/^.*\//, '');
}

function convertHearts(source: Record<string, number> | undefined): HeartIcon[] {
  const result: HeartIcon[] = [];
  for (const [key, count] of Object.entries(source ?? {})) {
    const color = HEART_COLOR_MAP[key];
    if (color && count > 0) {
      result.push({ color, count });
    }
  }
  return result;
}

function convertBladeHearts(
  bladeHeartSource: Record<string, number> | undefined,
  specialHeartSource: Record<string, number> | undefined
): BladeHeartItem[] | undefined {
  const result: BladeHeartItem[] = [];

  for (const [key, count] of Object.entries(bladeHeartSource ?? {})) {
    const heartColor = BLADE_HEART_COLOR_MAP[key];
    if (heartColor && count > 0) {
      for (let i = 0; i < count; i++) {
        result.push({ effect: BladeHeartEffect.HEART, heartColor });
      }
    }
  }

  for (const [key, count] of Object.entries(specialHeartSource ?? {})) {
    const effect =
      key === 'draw' ? BladeHeartEffect.DRAW : key === 'score' ? BladeHeartEffect.SCORE : null;
    if (effect && count > 0) {
      for (let i = 0; i < count; i++) {
        result.push({ effect });
      }
    }
  }

  return result.length > 0 ? result : undefined;
}

function createHeartRequirement(hearts: readonly HeartIcon[]): HeartRequirement {
  const colorRequirements = new Map<HeartColor, number>();
  let totalRequired = 0;

  for (const heart of hearts) {
    colorRequirements.set(heart.color, (colorRequirements.get(heart.color) ?? 0) + heart.count);
    totalRequired += heart.count;
  }

  return {
    colorRequirements,
    totalRequired,
  };
}
