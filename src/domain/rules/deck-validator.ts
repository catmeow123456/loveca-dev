/**
 * 卡组构筑验证器
 *
 * 实现规则 6.1 的卡组构筑规则验证
 */

import { CardType } from '../../shared/types/enums';
import type { AnyCardData } from '../entities/card';
import { getBaseCardCode } from '../../shared/utils/card-code';

// ============================================
// 常量定义
// ============================================

/**
 * 主卡组要求的卡牌数量
 * 参考规则 6.1.1.1
 */
export const MAIN_DECK_SIZE = 60;

/**
 * 能量卡组要求的卡牌数量
 * 参考规则 6.1.2.1
 */
export const ENERGY_DECK_SIZE = 12;

/**
 * 同编号卡牌的最大数量
 * 参考规则 6.1.1.2
 */
export const MAX_SAME_CODE_COUNT = 4;

// ============================================
// 验证结果类型
// ============================================

/**
 * 单个验证错误
 */
export interface ValidationError {
  /** 错误代码 */
  code: string;
  /** 错误消息 */
  message: string;
  /** 相关卡牌编号（如果有） */
  cardCode?: string;
}

/**
 * 卡组验证结果
 */
export interface DeckValidationResult {
  /** 是否验证通过 */
  valid: boolean;
  /** 错误列表 */
  errors: ValidationError[];
  /** 警告列表（不阻止验证通过） */
  warnings: ValidationError[];
  /** 统计信息 */
  stats: {
    mainDeckSize: number;
    energyDeckSize: number;
    memberCardCount: number;
    liveCardCount: number;
    uniqueCardCodes: number;
  };
}

// ============================================
// 验证函数
// ============================================

/**
 * 验证主卡组
 * @param mainDeck 主卡组卡牌数据数组
 * @returns 验证错误列表
 */
function validateMainDeck(mainDeck: AnyCardData[]): ValidationError[] {
  const errors: ValidationError[] = [];

  // 6.1.1.1 - 检查主卡组数量、成员卡 48 张，Live 卡 12 张
  if (mainDeck.length !== MAIN_DECK_SIZE) {
    errors.push({
      code: 'MAIN_DECK_SIZE_INVALID',
      message: `主卡组必须正好 ${MAIN_DECK_SIZE} 张，当前 ${mainDeck.length} 张`,
    });
  }

  // 检查主卡组不能包含能量卡
  const energyCards = mainDeck.filter((card) => card.cardType === CardType.ENERGY);
  if (energyCards.length > 0) {
    errors.push({
      code: 'MAIN_DECK_HAS_ENERGY',
      message: `主卡组不能包含能量卡，发现 ${energyCards.length} 张能量卡`,
    });
  }

  const MemberCards = mainDeck.filter((card) => card.cardType === CardType.MEMBER);
  if (MemberCards.length !== 48) {
    errors.push({
      code: 'MEMBER_CARDS_NUMBER_INVALID',
      message: `主卡组有 ${MemberCards.length} 张成员卡，正确的数量应为 48 张`,
    });
  }

  // 6.1.1.2 - 检查同基础编号主卡组卡牌最多 4 张（不同稀有度视为同一张卡）
  const codeCounts = new Map<string, number>();
  for (const card of mainDeck) {
    const baseCode = getBaseCardCode(card.cardCode);
    const count = (codeCounts.get(baseCode) ?? 0) + 1;
    codeCounts.set(baseCode, count);
  }

  for (const [baseCode, count] of codeCounts) {
    if (count > MAX_SAME_CODE_COUNT) {
      errors.push({
        code: 'MAIN_DECK_TOO_MANY_SAME_CODE',
        message: `基础编号 ${baseCode} 的卡牌超过 ${MAX_SAME_CODE_COUNT} 张限制，当前 ${count} 张`,
        cardCode: baseCode,
      });
    }
  }

  return errors;
}

/**
 * 验证能量卡组
 * @param energyDeck 能量卡组卡牌数据数组
 * @returns 验证错误列表
 */
function validateEnergyDeck(energyDeck: AnyCardData[]): ValidationError[] {
  const errors: ValidationError[] = [];

  // 6.1.2.1 - 检查能量卡组数量
  if (energyDeck.length !== ENERGY_DECK_SIZE) {
    errors.push({
      code: 'ENERGY_DECK_SIZE_INVALID',
      message: `能量卡组必须正好 ${ENERGY_DECK_SIZE} 张，当前 ${energyDeck.length} 张`,
    });
  }

  // 6.1.2.2 - 检查能量卡组只能包含能量卡
  const nonEnergyCards = energyDeck.filter((card) => card.cardType !== CardType.ENERGY);
  if (nonEnergyCards.length > 0) {
    errors.push({
      code: 'ENERGY_DECK_HAS_NON_ENERGY',
      message: `能量卡组只能包含能量卡，发现 ${nonEnergyCards.length} 张非能量卡`,
    });
  }

  return errors;
}

/**
 * 计算卡组统计信息
 */
function calculateStats(
  mainDeck: AnyCardData[],
  energyDeck: AnyCardData[]
): DeckValidationResult['stats'] {
  const allCards = [...mainDeck, ...energyDeck];
  const uniqueCodes = new Set(allCards.map((c) => c.cardCode));

  return {
    mainDeckSize: mainDeck.length,
    energyDeckSize: energyDeck.length,
    memberCardCount: mainDeck.filter((c) => c.cardType === CardType.MEMBER).length,
    liveCardCount: mainDeck.filter((c) => c.cardType === CardType.LIVE).length,
    uniqueCardCodes: uniqueCodes.size,
  };
}

/**
 * 验证完整卡组
 *
 * 参考规则 6.1：
 * - 6.1.1.1 主卡组必须正好 60 张
 * - 6.1.1.2 同编号成员卡最多 4 张
 * - 6.1.2.1 能量卡组必须正好 12 张
 * - 6.1.2.2 能量卡组只能包含能量卡
 *
 * @param mainDeck 主卡组
 * @param energyDeck 能量卡组
 * @returns 验证结果
 */
export function validateDeck(
  mainDeck: AnyCardData[],
  energyDeck: AnyCardData[]
): DeckValidationResult {
  const mainDeckErrors = validateMainDeck(mainDeck);
  const energyDeckErrors = validateEnergyDeck(energyDeck);

  const errors = [...mainDeckErrors, ...energyDeckErrors];
  const warnings: ValidationError[] = [];

  // 检查是否缺少 Live 卡（警告）
  const liveCardCount = mainDeck.filter((c) => c.cardType === CardType.LIVE).length;
  if (liveCardCount === 0) {
    warnings.push({
      code: 'NO_LIVE_CARDS',
      message: '主卡组中没有 Live 卡，可能无法获胜',
    });
  }

  // 检查是否缺少成员卡（警告）
  const memberCardCount = mainDeck.filter((c) => c.cardType === CardType.MEMBER).length;
  if (memberCardCount === 0) {
    warnings.push({
      code: 'NO_MEMBER_CARDS',
      message: '主卡组中没有成员卡，无法进行 Live',
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: calculateStats(mainDeck, energyDeck),
  };
}

/**
 * 快速检查卡组是否有效
 * @param mainDeck 主卡组
 * @param energyDeck 能量卡组
 * @returns 是否有效
 */
export function isDeckValid(mainDeck: AnyCardData[], energyDeck: AnyCardData[]): boolean {
  return validateDeck(mainDeck, energyDeck).valid;
}

// ============================================
// 辅助函数
// ============================================

/**
 * 统计卡牌编号出现次数
 * @param cards 卡牌数组
 * @returns 编号到数量的映射
 */
export function countCardCodes(cards: AnyCardData[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const baseCode = getBaseCardCode(card.cardCode);
    counts.set(baseCode, (counts.get(baseCode) ?? 0) + 1);
  }
  return counts;
}

/**
 * 检查是否可以添加卡牌到卡组
 * @param currentDeck 当前卡组
 * @param cardToAdd 要添加的卡牌
 * @param deckType 卡组类型
 * @returns 是否可以添加
 */
export function canAddCard(
  currentDeck: AnyCardData[],
  cardToAdd: AnyCardData,
  deckType: 'main' | 'energy'
): { canAdd: boolean; reason?: string } {
  // 检查卡组类型匹配
  if (deckType === 'main' && cardToAdd.cardType === CardType.ENERGY) {
    return { canAdd: false, reason: '能量卡不能加入主卡组' };
  }

  if (deckType === 'energy' && cardToAdd.cardType !== CardType.ENERGY) {
    return { canAdd: false, reason: '只有能量卡可以加入能量卡组' };
  }

  // 检查数量限制
  const maxSize = deckType === 'main' ? MAIN_DECK_SIZE : ENERGY_DECK_SIZE;
  if (currentDeck.length >= maxSize) {
    return { canAdd: false, reason: `${deckType === 'main' ? '主' : '能量'}卡组已满` };
  }

  // 检查同基础编号数量限制（仅主卡组，不同稀有度视为同一张卡）
  if (deckType === 'main') {
    const baseCode = getBaseCardCode(cardToAdd.cardCode);
    const sameBaseCount = currentDeck.filter(
      (c) => getBaseCardCode(c.cardCode) === baseCode
    ).length;
    if (sameBaseCount >= MAX_SAME_CODE_COUNT) {
      return {
        canAdd: false,
        reason: `基础编号 ${baseCode} 的卡牌已达到 ${MAX_SAME_CODE_COUNT} 张上限`,
      };
    }
  }

  return { canAdd: true };
}
