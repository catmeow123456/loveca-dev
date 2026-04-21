/**
 * 卡组数据加载器
 *
 * 从 YAML 文件加载玩家卡组配置，并转换为游戏可用的卡组数据
 */

import * as yaml from 'yaml';
import { z } from 'zod/v4';
import type { AnyCardData, MemberCardData, LiveCardData, EnergyCardData } from '../entities/card.js';
import { CardType } from '../../shared/types/enums.js';
import { CardDataRegistry } from './loader.js';
import { MAX_SAME_CODE_COUNT } from '../rules/deck-validator.js';

// ============================================
// YAML Schema 定义
// ============================================

/**
 * 卡牌条目 Schema（编号 + 数量）
 */
export const CardEntrySchema = z.object({
  card_code: z.string().min(1),
  count: z.number().int().positive().max(4),
});

/**
 * 主卡组 Schema
 */
export const MainDeckSchema = z.object({
  members: z.array(CardEntrySchema),
  lives: z.array(CardEntrySchema),
});

/**
 * 完整卡组配置 Schema
 */
export const DeckConfigSchema = z.object({
  player_name: z.string().min(1),
  description: z.string().optional(),
  main_deck: MainDeckSchema,
  energy_deck: z.array(CardEntrySchema),
});

export type DeckConfig = z.infer<typeof DeckConfigSchema>;
export type CardEntry = z.infer<typeof CardEntrySchema>;
export { CardDataRegistry };

// ============================================
// 类型定义
// ============================================

/**
 * 加载后的卡组数据
 */
export interface LoadedDeck {
  /** 玩家名称 */
  playerName: string;
  /** 卡组描述 */
  description?: string;
  /** 主卡组（成员卡 + Live 卡，共 60 张） */
  mainDeck: AnyCardData[];
  /** 能量卡组（12 张） */
  energyDeck: EnergyCardData[];
  /** 成员卡列表 */
  memberCards: MemberCardData[];
  /** Live 卡列表 */
  liveCards: LiveCardData[];
}

/**
 * 卡组加载结果
 */
export interface DeckLoadResult {
  /** 是否成功 */
  success: boolean;
  /** 加载的卡组数据 */
  deck?: LoadedDeck;
  /** 错误信息列表 */
  errors: string[];
  /** 警告信息列表 */
  warnings: string[];
}

/**
 * 卡组验证错误
 */
export interface DeckValidationError {
  type: 'CARD_NOT_FOUND' | 'INVALID_COUNT' | 'WRONG_CARD_TYPE' | 'DECK_SIZE_ERROR';
  message: string;
  cardCode?: string;
}

// ============================================
// 卡组加载器
// ============================================

/**
 * 卡组加载器类
 */
export class DeckLoader {
  constructor(private registry: CardDataRegistry) {}

  /**
   * 从配置对象加载卡组
   * @param config 卡组配置
   * @returns 加载结果
   */
  loadFromConfig(config: DeckConfig): DeckLoadResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const memberCards: MemberCardData[] = [];
    const liveCards: LiveCardData[] = [];
    const energyCards: EnergyCardData[] = [];

    // 加载成员卡
    for (const entry of config.main_deck.members) {
      const result = this.expandCardEntry(entry, CardType.MEMBER);
      if (result.error) {
        errors.push(result.error);
      } else if (result.cards) {
        memberCards.push(...(result.cards as MemberCardData[]));
      }
      if (result.warning) {
        warnings.push(result.warning);
      }
    }

    // 加载 Live 卡
    for (const entry of config.main_deck.lives) {
      const result = this.expandCardEntry(entry, CardType.LIVE);
      if (result.error) {
        errors.push(result.error);
      } else if (result.cards) {
        liveCards.push(...(result.cards as LiveCardData[]));
      }
      if (result.warning) {
        warnings.push(result.warning);
      }
    }

    // 加载能量卡
    for (const entry of config.energy_deck) {
      const result = this.expandCardEntry(entry, CardType.ENERGY);
      if (result.error) {
        errors.push(result.error);
      } else if (result.cards) {
        energyCards.push(...(result.cards as EnergyCardData[]));
      }
      if (result.warning) {
        warnings.push(result.warning);
      }
    }

    // 验证卡组大小
    const mainDeckSize = memberCards.length + liveCards.length;
    if (mainDeckSize !== 60) {
      warnings.push(
        `主卡组大小应为 60 张，当前为 ${mainDeckSize} 张 (${memberCards.length} 成员 + ${liveCards.length} Live)`
      );
    }
    if (memberCards.length !== 48) {
      warnings.push(`成员卡应为 48 张，当前为 ${memberCards.length} 张`);
    }
    if (liveCards.length !== 12) {
      warnings.push(`Live 卡应为 12 张，当前为 ${liveCards.length} 张`);
    }
    if (energyCards.length !== 12) {
      warnings.push(`能量卡组应为 12 张，当前为 ${energyCards.length} 张`);
    }

    // 如果有严重错误，返回失败
    if (errors.length > 0) {
      return {
        success: false,
        errors,
        warnings,
      };
    }

    // 构建主卡组
    const mainDeck: AnyCardData[] = [...memberCards, ...liveCards];

    const deck: LoadedDeck = {
      playerName: config.player_name,
      description: config.description,
      mainDeck,
      energyDeck: energyCards,
      memberCards,
      liveCards,
    };

    return {
      success: true,
      deck,
      errors: [],
      warnings,
    };
  }

  /**
   * 展开卡牌条目（根据 count 复制卡牌数据）
   */
  private expandCardEntry(
    entry: CardEntry,
    expectedType: CardType
  ): { cards?: AnyCardData[]; error?: string; warning?: string } {
    const cardData = this.registry.getByCode(entry.card_code);

    if (!cardData) {
      return {
        error: `卡牌不存在: ${entry.card_code}`,
      };
    }

    if (cardData.cardType !== expectedType) {
      return {
        error: `卡牌类型不匹配: ${entry.card_code} 是 ${cardData.cardType}，期望 ${expectedType}`,
      };
    }

    if (entry.count > MAX_SAME_CODE_COUNT && cardData.cardType === CardType.MEMBER) {
      return {
        error: `同编号成员卡最多 ${MAX_SAME_CODE_COUNT} 张: ${entry.card_code} 数量为 ${entry.count}`,
      };
    }

    // 复制卡牌数据
    const cards: AnyCardData[] = [];
    for (let i = 0; i < entry.count; i++) {
      cards.push({ ...cardData });
    }

    return { cards };
  }
}

// ============================================
// 便捷函数
// ============================================

/**
 * 从 YAML 字符串加载卡组
 * @param yamlContent YAML 字符串内容
 * @param registry 卡牌注册表
 * @returns 加载结果
 */
export function loadDeckFromYamlString(
  yamlContent: string,
  registry: CardDataRegistry
): DeckLoadResult {
  const loader = new DeckLoader(registry);

  let rawConfig: unknown;
  try {
    rawConfig = yaml.parse(yamlContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      errors: [`YAML 解析错误: ${message}`],
      warnings: [],
    };
  }

  const parseResult = DeckConfigSchema.safeParse(rawConfig);
  if (!parseResult.success) {
    return {
      success: false,
      errors: [`YAML 格式验证失败: ${String(parseResult.error)}`],
      warnings: [],
    };
  }

  return loader.loadFromConfig(parseResult.data);
}
