import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import type { AnyCardData, BladeHeartItem, HeartIcon } from '../../src/domain/entities/card';
import { createHeartRequirement } from '../../src/domain/entities/card';
import { CardDataRegistry } from '../../src/domain/card-data/loader';
import { loadDeckFromYamlString } from '../../src/domain/card-data/deck-loader';
import { BladeHeartEffect, CardType, HeartColor } from '../../src/shared/types/enums';

interface RawCard {
  card_no: string;
  name: string;
  type: string;
  series: string;
  unit?: string;
  cost?: number;
  blade?: number;
  score?: number;
  ability?: string;
  base_heart?: Record<string, number>;
  need_heart?: Record<string, number>;
  blade_heart?: Record<string, number>;
  special_heart?: Record<string, number>;
}

export function readFrozenMuseDeck() {
  return readFrozenDeck(
    '缪预组.yaml',
    "μ's",
    '4a085d4710ec06b4a5046a8a8dc48bd5ff66aeb88fcbe1222ee1f52b737133cf',
    'f76355ee3e84cb6f31f2ea65f5a565970dce6bca3f6ef6ea6e20ae9d61fe7171'
  );
}

export function readFrozenGreenHasunosoraDeck() {
  return readFrozenDeck(
    '绿莲-6弹ver.yaml',
    '蓮ノ空',
    '8bd34fe220c73043a30434276749f64ac2acca6ef1b83048aca59612cb4764bd',
    'e48dd847c5da80295442ec590783f0f1f7f96068f6676214c50581290fddda67'
  );
}

export function readFrozenBluePurpleDeck() {
  return readFrozenDeck(
    '蓝紫.yaml',
    frozenGroups,
    '040ba2258970d6804146985605088c926f12898d9a22736ec4164ff46c2d077e',
    '0d61f31c84ee5757e4509a81d1fd0a9b197dd0bb159d0cbbb42b0b8826c76260'
  );
}

export function readFrozenLikeATreasureDeck() {
  return readFrozenDeck(
    'Like a Treasure.yaml',
    frozenGroups,
    '5d696a1ebcf00dd7b394cf0dabd935eefacb2eb46355c62b758192b0530ccd35',
    '44a526b2bdc044450a75afada3b4fecec6bf07fb997267cfa3035f1f5b8c38eb'
  );
}

function frozenGroups(card: RawCard): readonly string[] {
  const groups: Record<string, string> = {
    'ラブライブ！': "μ's",
    'ラブライブ！サンシャイン!!': 'Aqours',
    'ラブライブ！スーパースター!!': 'Liella!',
    'ラブライブ！蓮ノ空女学院スクールアイドルクラブ': '蓮ノ空',
    'ラブライブ！虹ヶ咲学園スクールアイドル同好会': '虹ヶ咲',
  };
  return card.series.split('\n').map((series) => {
    const group = groups[series.trim()];
    if (!group) throw new Error(`Unknown frozen work: ${series}`);
    return group;
  });
}

/** Test-only exact-printing facts; never a runtime card-source fallback. */
function readFrozenDeck(
  file: string,
  group: string | ((card: RawCard) => readonly string[]),
  expectedYaml: string,
  expectedFacts: string
) {
  const yaml = readFileSync(new URL(`../../assets/decks/${file}`, import.meta.url), 'utf8');
  const config = parse(yaml) as {
    main_deck: { members: Entry[]; lives: Entry[] };
    energy_deck: Entry[];
  };
  const entries = [...config.main_deck.members, ...config.main_deck.lives, ...config.energy_deck];
  const raw = JSON.parse(
    readFileSync(new URL('../../llocg_db/json/cards.json', import.meta.url), 'utf8')
  ) as Record<string, RawCard>;
  const byCode = new Map(Object.values(raw).map((card) => [card.card_no.normalize('NFKC'), card]));
  const facts = entries.map((entry) => {
    const card = byCode.get(entry.card_code.normalize('NFKC'));
    if (!card) throw new Error(`Missing frozen printing: ${entry.card_code}`);
    return [entry.card_code, entry.count, card] as const;
  });
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const yamlHash = hash(yaml);
  const factsHash = hash(JSON.stringify(facts));
  if (yamlHash !== expectedYaml || factsHash !== expectedFacts)
    throw new Error(
      `The ${file} deck/facts changed; review the support matrix before accepting a new baseline`
    );
  const registry = new CardDataRegistry();
  registry.load(
    facts.map(([code, , card]) =>
      convertCard(code, card, typeof group === 'string' ? [group] : group(card))
    )
  );
  const loaded = loadDeckFromYamlString(yaml, registry);
  if (!loaded.success || !loaded.deck || loaded.warnings.length)
    throw new Error(JSON.stringify({ errors: loaded.errors, warnings: loaded.warnings }));
  return { deck: loaded.deck, yamlHash, factsHash };
}

interface Entry {
  card_code: string;
  count: number;
}

// The selected starter cards use these tokens. Unknown tokens fail instead of producing guessed facts.
// This follows the existing llocg sync mappings; it is not a product data-source fallback.
const colors: Readonly<Record<string, HeartColor>> = {
  heart01: HeartColor.PINK,
  heart02: HeartColor.RED,
  heart03: HeartColor.YELLOW,
  heart04: HeartColor.GREEN,
  heart05: HeartColor.BLUE,
  heart06: HeartColor.PURPLE,
  heart0: HeartColor.RAINBOW,
};
function hearts(raw: Record<string, number> = {}): HeartIcon[] {
  return Object.entries(raw).map(([key, count]) => {
    const color = colors[key];
    if (!color) throw new Error(`Unknown frozen heart token: ${key}`);
    return { color, count };
  });
}
function convertCard(code: string, raw: RawCard, groups: readonly string[]): AnyCardData {
  const bladeHearts: BladeHeartItem[] = [];
  for (const [key, count] of Object.entries(raw.blade_heart ?? {})) {
    const color = key === 'b_all' ? HeartColor.RAINBOW : colors[key.replace(/^b_/, '')];
    if (!color) throw new Error(`Unknown frozen blade heart token: ${key}`);
    for (let i = 0; i < count; i++)
      bladeHearts.push({ effect: BladeHeartEffect.HEART, heartColor: color });
  }
  for (const [key, count] of Object.entries(raw.special_heart ?? {})) {
    const effect =
      key === 'draw' ? BladeHeartEffect.DRAW : key === 'score' ? BladeHeartEffect.SCORE : null;
    if (!effect) throw new Error(`Unknown frozen special heart token: ${key}`);
    for (let i = 0; i < count; i++) bladeHearts.push({ effect });
  }
  const base = {
    cardCode: code,
    name: raw.name,
    nameJp: raw.name,
    cardText: raw.ability,
    cardTextJp: raw.ability,
    workNames: [raw.series],
    groupNames: groups,
    unitName: raw.unit,
    bladeHearts,
  };
  switch (raw.type) {
    case 'メンバー':
      if (raw.cost === undefined) throw new Error(`Incomplete member: ${code}`);
      return {
        ...base,
        cardType: CardType.MEMBER,
        cost: raw.cost,
        blade: raw.blade ?? 0,
        hearts: hearts(raw.base_heart),
      };
    case 'ライブ':
      if (raw.score === undefined || !raw.need_heart) throw new Error(`Incomplete LIVE: ${code}`);
      return {
        ...base,
        cardType: CardType.LIVE,
        score: raw.score,
        requirements: createHeartRequirement(
          Object.fromEntries(hearts(raw.need_heart).map(({ color, count }) => [color, count]))
        ),
      };
    case 'エネルギー':
      return { ...base, cardType: CardType.ENERGY };
    default:
      throw new Error(`Unknown frozen card type: ${raw.type}`);
  }
}
