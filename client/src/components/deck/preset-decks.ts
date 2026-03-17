/**
 * 推荐预设卡组 - 从 assets/decks/ YAML 文件同步而来
 */
import type { DeckConfig } from '@game/domain/card-data/deck-loader';

export interface PresetDeck {
  id: string;
  name: string;
  description: string;
  tag: string;
  deck: DeckConfig;
}

export const PRESET_DECKS: PresetDeck[] = [
  {
    id: 'muse-starter',
    name: 'μ\'s 预组',
    description: '新手入门首选，μ\'s 官方预构卡组，成员搭配均衡。',
    tag: '入门推荐',
    deck: {
      player_name: '缪斯',
      description: "μ's 预组",
      main_deck: {
        members: [
          { card_code: 'PL!-sd1-001-SD', count: 4 },
          { card_code: 'PL!-sd1-002-SD', count: 2 },
          { card_code: 'PL!-sd1-003-SD', count: 4 },
          { card_code: 'PL!-sd1-004-SD', count: 4 },
          { card_code: 'PL!-sd1-005-SD', count: 2 },
          { card_code: 'PL!-sd1-006-SD', count: 2 },
          { card_code: 'PL!-sd1-007-SD', count: 2 },
          { card_code: 'PL!-sd1-008-SD', count: 2 },
          { card_code: 'PL!-sd1-009-SD', count: 2 },
          { card_code: 'PL!-sd1-011-SD', count: 2 },
          { card_code: 'PL!-sd1-012-SD', count: 4 },
          { card_code: 'PL!-sd1-013-SD', count: 4 },
          { card_code: 'PL!-sd1-014-SD', count: 2 },
          { card_code: 'PL!-sd1-015-SD', count: 2 },
          { card_code: 'PL!-sd1-016-SD', count: 2 },
          { card_code: 'PL!-sd1-017-SD', count: 2 },
          { card_code: 'PL!-sd1-018-SD', count: 2 },
          { card_code: 'PL!-sd1-010-SD', count: 4 },
        ],
        lives: [
          { card_code: 'PL!-sd1-019-SD', count: 4 },
          { card_code: 'PL!-sd1-020-SD', count: 4 },
          { card_code: 'PL!-sd1-021-SD', count: 2 },
          { card_code: 'PL!-sd1-022-SD', count: 2 },
        ],
      },
      energy_deck: [
        { card_code: 'PL!-sd1-023-P', count: 2 },
        { card_code: 'PL!-sd1-024-P', count: 2 },
        { card_code: 'PL!-sd1-025-P', count: 2 },
        { card_code: 'PL!-sd1-026-P', count: 1 },
        { card_code: 'PL!-sd1-027-P', count: 1 },
        { card_code: 'PL!-sd1-028-P', count: 1 },
        { card_code: 'PL!-sd1-029-P', count: 1 },
        { card_code: 'PL!-sd1-030-P', count: 1 },
        { card_code: 'PL!-sd1-031-P', count: 1 },
      ],
    },
  },
  {
    id: 'blue-purple',
    name: '蓝紫',
    description: '蓝紫双色成员协同，节奏稳健的进阶构组。',
    tag: '进阶',
    deck: {
      player_name: '蓝紫',
      description: '蓝紫',
      main_deck: {
        members: [
          { card_code: 'PL!N-bp4-017-N', count: 4 },
          { card_code: 'PL!HS-bp2-004-P', count: 2 },
          { card_code: 'PL!-pb1-020-N', count: 3 },
          { card_code: 'PL!N-bp4-013-N', count: 2 },
          { card_code: 'PL!HS-PR-023-PR', count: 4 },
          { card_code: 'PL!N-bp1-003-P+', count: 3 },
          { card_code: 'PL!N-bp3-009-R+', count: 3 },
          { card_code: 'PL!N-bp3-020-N', count: 4 },
          { card_code: 'PL!N-bp4-004-P+', count: 4 },
          { card_code: 'PL!SP-bp2-016-N', count: 4 },
          { card_code: 'PL!-bp3-012-N', count: 4 },
          { card_code: 'PL!SP-sd1-019-SD', count: 4 },
          { card_code: 'LL-bp4-001-R+', count: 1 },
          { card_code: 'PL!N-bp3-004-P', count: 2 },
          { card_code: 'PL!N-pb1-004-P+', count: 4 },
        ],
        lives: [
          { card_code: 'PL!N-bp4-029-L', count: 3 },
          { card_code: 'PL!N-bp3-032-L', count: 2 },
          { card_code: 'PL!N-bp4-030-L', count: 4 },
          { card_code: 'PL!N-bp4-025-L', count: 3 },
        ],
      },
      energy_deck: [
        { card_code: 'LL-E-003-SD', count: 12 },
      ],
    },
  },
];
