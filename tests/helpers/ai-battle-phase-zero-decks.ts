import { readFileSync } from 'node:fs';
import * as yaml from 'yaml';
import type { DeckConfig as RuntimeDeckConfig } from '../../src/application/game-service';
import { DeckConfigSchema, DeckLoader } from '../../src/domain/card-data/deck-loader';
import { CardDataRegistry } from '../../src/domain/card-data/loader';
import type {
  AnyCardData,
  BladeHeartItem,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  AI_BATTLE_PHASE_ZERO_DECKS,
  type AiBattlePhaseZeroDeckKey,
} from '../../src/server/ai-battle/phase-zero-baseline';
import { BladeHeartEffect, CardType, HeartColor } from '../../src/shared/types/enums';
import { normalizeCardCode } from '../../src/shared/utils/card-code';

const HEART_COLOR_BY_SOURCE_KEY = {
  heart01: HeartColor.PINK,
  heart02: HeartColor.RED,
  heart03: HeartColor.YELLOW,
  heart04: HeartColor.GREEN,
  heart05: HeartColor.BLUE,
  heart06: HeartColor.PURPLE,
  heart0: HeartColor.RAINBOW,
} as const;

const BLADE_HEART_COLOR_BY_SOURCE_KEY = {
  b_heart01: HeartColor.PINK,
  b_heart02: HeartColor.RED,
  b_heart03: HeartColor.YELLOW,
  b_heart04: HeartColor.GREEN,
  b_heart05: HeartColor.BLUE,
  b_heart06: HeartColor.PURPLE,
  b_all: HeartColor.RAINBOW,
} as const;

export const aiBattleAuthoritativeCardRegistry = loadAuthoritativeCardRegistry();

export function loadAiBattlePhaseZeroRuntimeDeck(
  deckKey: AiBattlePhaseZeroDeckKey
): RuntimeDeckConfig {
  const source = AI_BATTLE_PHASE_ZERO_DECKS[deckKey];
  const deck = DeckConfigSchema.parse(yaml.parse(readFileSync(source.sourceAssetPath, 'utf8')));
  const result = new DeckLoader(aiBattleAuthoritativeCardRegistry).loadFromConfig(deck);
  if (!result.success || !result.deck) {
    throw new Error(
      `Failed to load ${source.sourceAssetPath} from authoritative card data: ${result.errors.join(
        '; '
      )}`
    );
  }
  return {
    mainDeck: result.deck.mainDeck,
    energyDeck: result.deck.energyDeck,
  };
}

interface AuthoritativeCardRecord {
  readonly card_no: string;
  readonly name: string;
  readonly type: 'メンバー' | 'ライブ' | 'エネルギー';
  readonly series?: string;
  readonly unit?: string;
  readonly cost?: number;
  readonly blade?: number;
  readonly base_heart?: Readonly<Record<string, number>>;
  readonly blade_heart?: Readonly<Record<string, number>>;
  readonly special_heart?: Readonly<Record<string, number>>;
  readonly score?: number;
  readonly need_heart?: Readonly<Record<string, number>>;
  readonly ability?: string;
  readonly rare?: string;
  readonly product?: string;
}

function loadAuthoritativeCardRegistry(): CardDataRegistry {
  const records = JSON.parse(readFileSync('llocg_db/json/cards.json', 'utf8')) as Readonly<
    Record<string, AuthoritativeCardRecord>
  >;
  const registry = new CardDataRegistry();
  registry.load(Object.values(records).map(mapAuthoritativeCard));
  return registry;
}

function mapAuthoritativeCard(record: AuthoritativeCardRecord): AnyCardData {
  const cardCode = normalizeCardCode(record.card_no);
  const common = {
    cardCode,
    name: record.name,
    nameJp: record.name,
    workNames: splitLines(record.series),
    unitName: normalizeUnitName(record.unit),
    cardText: record.ability,
    cardTextJp: record.ability,
    rare: record.rare,
    product: record.product,
  };
  if (record.type === 'メンバー') {
    return {
      ...common,
      cardType: CardType.MEMBER,
      cost: record.cost ?? 0,
      blade: record.blade ?? 0,
      hearts: mapHearts(record.base_heart).map(({ color, count }) => createHeartIcon(color, count)),
      bladeHearts: mapBladeHearts(record),
    } satisfies MemberCardData;
  }
  if (record.type === 'ライブ') {
    return {
      ...common,
      cardType: CardType.LIVE,
      score: record.score ?? 0,
      requirements: createHeartRequirement(
        Object.fromEntries(mapHearts(record.need_heart).map(({ color, count }) => [color, count]))
      ),
      bladeHearts: mapBladeHearts(record),
    } satisfies LiveCardData;
  }
  return {
    ...common,
    cardType: CardType.ENERGY,
  } satisfies EnergyCardData;
}

function mapHearts(
  source: Readonly<Record<string, number>> | undefined
): Array<{ readonly color: HeartColor; readonly count: number }> {
  if (!source) return [];
  return Object.entries(source).flatMap(([key, count]) => {
    const color = HEART_COLOR_BY_SOURCE_KEY[key as keyof typeof HEART_COLOR_BY_SOURCE_KEY];
    return color && count > 0 ? [{ color, count }] : [];
  });
}

function mapBladeHearts(record: AuthoritativeCardRecord): BladeHeartItem[] | undefined {
  const items: BladeHeartItem[] = [];
  for (const [key, count] of Object.entries(record.blade_heart ?? {})) {
    const heartColor =
      BLADE_HEART_COLOR_BY_SOURCE_KEY[key as keyof typeof BLADE_HEART_COLOR_BY_SOURCE_KEY];
    if (!heartColor || count <= 0) continue;
    for (let index = 0; index < count; index += 1) {
      items.push({ effect: BladeHeartEffect.HEART, heartColor });
    }
  }
  for (const [key, count] of Object.entries(record.special_heart ?? {})) {
    const effect =
      key === 'draw' ? BladeHeartEffect.DRAW : key === 'score' ? BladeHeartEffect.SCORE : null;
    if (!effect || count <= 0) continue;
    for (let index = 0; index < count; index += 1) {
      items.push({ effect });
    }
  }
  return items.length > 0 ? items : undefined;
}

function splitLines(value: string | undefined): string[] | undefined {
  const items = value
    ?.split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : undefined;
}

function normalizeUnitName(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const unwrapped = raw.replace(/^「/, '').replace(/」$/, '');
  const normalized = unwrapped === 'みらくらぱーく!' ? 'みらくらぱーく！' : unwrapped;
  return `「${normalized}」`;
}
