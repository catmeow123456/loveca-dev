/**
 * 推荐预设卡组 - 从 assets/decks/ YAML 文件同步而来
 */
import * as yaml from 'yaml';
import { DeckConfigSchema, type DeckConfig } from '@game/domain/card-data/deck-loader';
import museStarterYaml from '../../../../assets/decks/缪预组.yaml?raw';
import greenHasunosoraBp6Yaml from '../../../../assets/decks/绿莲-6弹ver.yaml?raw';
import bluePurpleYaml from '../../../../assets/decks/蓝紫.yaml?raw';

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
const bluePurpleDeck = parsePresetDeck(bluePurpleYaml, '蓝紫.yaml');

export const PRESET_DECKS: PresetDeck[] = [
  {
    id: 'muse-starter',
    name: 'μ\'s 预组',
    description: '新手入门首选，μ\'s 官方预构卡组，成员搭配均衡。',
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
    id: 'blue-purple',
    name: '蓝紫',
    description: '蓝紫双色成员协同，节奏稳健的进阶构组。',
    tag: '进阶',
    deck: bluePurpleDeck,
  },
];
