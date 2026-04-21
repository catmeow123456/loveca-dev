/**
 * 卡牌数据注册表
 *
 * 注意：前端卡牌数据主要通过 cardService 从数据库获取。
 * 此注册表主要用于后端逻辑中按编号和名称查找卡牌。
 *
 * @module domain/card-data/loader
 */
import type { AnyCardData, MemberCardData, LiveCardData, EnergyCardData } from '../entities/card.js';
import { CardType } from '../../shared/types/enums.js';

// ============================================
// 卡牌注册表
// ============================================

/**
 * 卡牌数据注册表
 * 提供按编号和名称查找卡牌的功能
 */
export class CardDataRegistry {
  private cardsByCode: Map<string, AnyCardData> = new Map();
  private cardsByName: Map<string, AnyCardData[]> = new Map();
  private allCards: AnyCardData[] = [];

  /**
   * 加载卡牌数据
   * @param cards 卡牌数据数组
   */
  load(cards: AnyCardData[]): void {
    this.cardsByCode.clear();
    this.cardsByName.clear();
    this.allCards = [...cards];

    for (const card of cards) {
      // 按编号索引
      this.cardsByCode.set(card.cardCode, card);

      // 按名称索引（同名可能有多张）
      const nameList = this.cardsByName.get(card.name) ?? [];
      nameList.push(card);
      this.cardsByName.set(card.name, nameList);
    }
  }

  /**
   * 根据卡牌编号获取卡牌数据
   * @param cardCode 卡牌编号
   * @returns 卡牌数据，如果不存在则返回 undefined
   */
  getByCode(cardCode: string): AnyCardData | undefined {
    return this.cardsByCode.get(cardCode);
  }

  /**
   * 根据卡牌名称获取所有同名卡牌
   * @param name 卡牌名称
   * @returns 同名卡牌数组
   */
  getByName(name: string): AnyCardData[] {
    return this.cardsByName.get(name) ?? [];
  }

  /**
   * 获取所有卡牌
   * @returns 所有卡牌数据数组
   */
  getAll(): AnyCardData[] {
    return [...this.allCards];
  }

  /**
   * 获取所有成员卡
   */
  getAllMembers(): MemberCardData[] {
    return this.allCards.filter((c): c is MemberCardData => c.cardType === CardType.MEMBER);
  }

  /**
   * 获取所有 Live 卡
   */
  getAllLives(): LiveCardData[] {
    return this.allCards.filter((c): c is LiveCardData => c.cardType === CardType.LIVE);
  }

  /**
   * 获取所有能量卡
   */
  getAllEnergies(): EnergyCardData[] {
    return this.allCards.filter((c): c is EnergyCardData => c.cardType === CardType.ENERGY);
  }

  /**
   * 获取卡牌总数
   */
  get size(): number {
    return this.allCards.length;
  }

  /**
   * 检查编号是否存在
   */
  hasCode(cardCode: string): boolean {
    return this.cardsByCode.has(cardCode);
  }
}

/**
 * 全局卡牌注册表实例
 */
export const globalCardRegistry = new CardDataRegistry();
