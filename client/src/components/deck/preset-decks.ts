/**
 * 推荐预设卡组 - 从 assets/decks/ YAML 文件同步而来
 */
import * as yaml from 'yaml';
import { DeckConfigSchema, type DeckConfig } from '@game/domain/card-data/deck-loader';
import museStarterYaml from '../../../../assets/decks/缪预组.yaml?raw';
import greenHasunosoraBp6Yaml from '../../../../assets/decks/绿莲-6弹ver.yaml?raw';
import decklog1Y9J3SYaml from '../../../../assets/decks/decklog-1Y9J3S.yaml?raw';
import decklog222H9SYaml from '../../../../assets/decks/decklog-222H9S.yaml?raw';
import decklog1YWYS4Yaml from '../../../../assets/decks/decklog-1YWYS4.yaml?raw';
import decklogN33A0Yaml from '../../../../assets/decks/decklog-N33A0.yaml?raw';

export interface PresetDeck {
  id: string;
  name: string;
  description: string;
  tag: string;
  deck: DeckConfig;
}

function parsePresetDeck(source: string, filename: string): DeckConfig {
  const parsed = yaml.parse(source);
  const result = DeckConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid preset deck YAML: ${filename}`);
  }
  return result.data;
}

const museStarterDeck = parsePresetDeck(museStarterYaml, '缪预组.yaml');
const greenHasunosoraBp6Deck = parsePresetDeck(greenHasunosoraBp6Yaml, '绿莲-6弹ver.yaml');
const decklog1Y9J3SDeck = parsePresetDeck(decklog1Y9J3SYaml, 'decklog-1Y9J3S.yaml');
const decklog222H9SDeck = parsePresetDeck(decklog222H9SYaml, 'decklog-222H9S.yaml');
const decklog1YWYS4Deck = parsePresetDeck(decklog1YWYS4Yaml, 'decklog-1YWYS4.yaml');
const decklogN33A0Deck = parsePresetDeck(decklogN33A0Yaml, 'decklog-N33A0.yaml');

export const PRESET_DECKS: PresetDeck[] = [
  {
    id: 'muse-starter',
    name: "μ's 预组",
    description: "新手入门首选，μ's 官方预构卡组，成员搭配均衡。",
    tag: '入门推荐',
    deck: museStarterDeck,
  },
  {
    id: 'green-hasunosora-bp6',
    name: '绿莲-6弹ver',
    description: '莲之空绿莲 6 弹构组，覆盖多张已自动化卡效，适合新人测试。',
    tag: '入门推荐',
    deck: greenHasunosoraBp6Deck,
  },
  {
    id: 'decklog-1Y9J3S',
    name: 'Liella! 加分星',
    description: 'Liella! 三小队混合构筑，围绕分数增益与 LIVE 推进。',
    tag: 'DeckLog',
    deck: decklog1Y9J3SDeck,
  },
  {
    id: 'decklog-222H9S',
    name: 'Liella! 可香三神',
    description: '以唐可可、涩谷香音和三神组件为核心的 Liella! 构筑。',
    tag: 'DeckLog',
    deck: decklog222H9SDeck,
  },
  {
    id: 'decklog-1YWYS4',
    name: "μ's DGG混合",
    description: "以 Dreamin' Go! Go!! 和 μ's 成员为主轴的混合构筑。",
    tag: 'DeckLog',
    deck: decklog1YWYS4Deck,
  },
  {
    id: 'decklog-N33A0',
    name: '五费黛雅 Love U',
    description: '以五费黛雅与 Love U my friends 为核心的多作品构筑。',
    tag: 'DeckLog',
    deck: decklogN33A0Deck,
  },
];
