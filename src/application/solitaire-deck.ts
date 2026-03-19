/**
 * 对墙打模式 — 默认对手卡组加载
 *
 * 从 YAML 字符串加载默认对手卡组（缪预组），
 * 供对墙打模式下自动分配给对手使用。
 * 该卡组对玩家完全不可见，仅用于满足游戏引擎的数据完整性要求。
 */

import { loadDeckFromYamlString } from '../domain/card-data/deck-loader';
import { CardDataRegistry } from '../domain/card-data/loader';
import type { DeckConfig } from './game-service';

/** 对手默认卡组缓存（单例，避免重复加载） */
let cachedDeck: DeckConfig | null = null;

/**
 * 加载对墙打模式的默认对手卡组
 *
 * @param yamlContent YAML 卡组文件内容（由调用方通过 Vite ?raw 导入提供）
 * @param registry 已填充卡牌数据的 CardDataRegistry 实例
 * @returns 满足游戏引擎要求的 DeckConfig
 * @throws 如果加载失败则抛出错误
 */
export function loadSolitaireOpponentDeck(
  yamlContent: string,
  registry: CardDataRegistry
): DeckConfig {
  // 使用缓存
  if (cachedDeck) {
    return cachedDeck;
  }

  const result = loadDeckFromYamlString(yamlContent, registry);

  if (!result.success || !result.deck) {
    const errorMsg = `对墙打对手卡组加载失败: ${result.errors.join(', ')}`;
    throw new Error(errorMsg);
  }

  // 如果有警告，打印到控制台但不阻断
  if (result.warnings.length > 0) {
    console.warn('[Solitaire] 对手卡组加载警告:', result.warnings);
  }

  cachedDeck = {
    mainDeck: [...result.deck.mainDeck],
    energyDeck: [...result.deck.energyDeck],
  };

  return cachedDeck;
}

/**
 * 清除缓存的对手卡组（测试或重置时使用）
 */
export function clearSolitaireDeckCache(): void {
  cachedDeck = null;
}