/**
 * Card data service
 * Provides card data CRUD operations via self-hosted API
 */

import { apiClient, isApiConfigured } from './apiClient';
import type { AnyCardData, MemberCardData, LiveCardData, EnergyCardData, HeartIcon, BladeHeartItem, BladeHearts } from '@game/domain/entities/card';
import { createHeartRequirement } from '@game/domain/entities/card';
import { CardType, HeartColor, BladeHeartEffect } from '@game/shared/types/enums';

// ============================================
// Database record type
// ============================================

export interface CardDbRecord {
  id: string;
  card_code: string;
  card_type: 'MEMBER' | 'LIVE' | 'ENERGY';
  name: string;
  group_name: string | null;
  unit_name: string | null;
  cost: number | null;
  blade: number | null;
  hearts: HeartIcon[];
  blade_hearts: BladeHeartItem[] | null;
  score: number | null;
  requirements: HeartIcon[];
  card_text: string | null;
  image_filename: string | null;
  rare: string | null;
  product: string | null;
  status: 'DRAFT' | 'PUBLISHED';
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

// ============================================
// Card update/create types
// ============================================

export interface CardUpdateInput {
  name?: string;
  groupName?: string | null;
  unitName?: string | null;
  cost?: number | null;
  blade?: number | null;
  hearts?: HeartIcon[];
  bladeHearts?: BladeHeartItem[] | null;
  score?: number | null;
  requirements?: HeartIcon[];
  cardText?: string | null;
  imageFilename?: string | null;
  rare?: string | null;
  product?: string | null;
}

export interface CardCreateInput extends CardUpdateInput {
  cardCode: string;
  cardType: 'MEMBER' | 'LIVE' | 'ENERGY';
  name: string;
}

// ============================================
// Data conversion
// ============================================

function dbRecordToCardData(record: CardDbRecord): AnyCardData {
  const baseData = {
    cardCode: record.card_code,
    name: record.name,
    groupName: record.group_name ?? undefined,
    unitName: record.unit_name ?? undefined,
    cardText: record.card_text ?? undefined,
    imageFilename: record.image_filename ?? undefined,
    rare: record.rare ?? undefined,
    product: record.product ?? undefined,
  };

  const convertBladeHearts = (items: BladeHeartItem[] | null): BladeHearts | undefined => {
    if (!items || items.length === 0) return undefined;
    return items.map(item => ({
      effect: item.effect as BladeHeartEffect,
      heartColor: item.heartColor as HeartColor | undefined,
    }));
  };

  switch (record.card_type) {
    case 'MEMBER':
      return {
        ...baseData,
        cardType: CardType.MEMBER,
        cost: record.cost ?? 0,
        blade: record.blade ?? 0,
        hearts: record.hearts || [],
        bladeHearts: convertBladeHearts(record.blade_hearts),
      } as MemberCardData;

    case 'LIVE':
      return {
        ...baseData,
        cardType: CardType.LIVE,
        score: record.score ?? 1,
        requirements: createHeartRequirement(
          (record.requirements || []).reduce((acc, h) => {
            acc[h.color] = (acc[h.color] || 0) + h.count;
            return acc;
          }, {} as Record<string, number>)
        ),
        bladeHearts: convertBladeHearts(record.blade_hearts),
      } as LiveCardData;

    case 'ENERGY':
      return {
        ...baseData,
        cardType: CardType.ENERGY,
      } as EnergyCardData;

    default:
      throw new Error(`Unknown card type: ${record.card_type}`);
  }
}

function cardDataToDbUpdate(data: CardUpdateInput): Partial<CardDbRecord> {
  const update: Partial<CardDbRecord> = {};

  if (data.name !== undefined) update.name = data.name;
  if (data.groupName !== undefined) update.group_name = data.groupName ?? null;
  if (data.unitName !== undefined) update.unit_name = data.unitName ?? null;
  if (data.cost !== undefined) update.cost = data.cost ?? null;
  if (data.blade !== undefined) update.blade = data.blade ?? null;
  if (data.hearts !== undefined) update.hearts = data.hearts;
  if (data.bladeHearts !== undefined) update.blade_hearts = data.bladeHearts ?? null;
  if (data.score !== undefined) update.score = data.score ?? null;
  if (data.requirements !== undefined) update.requirements = data.requirements;
  if (data.cardText !== undefined) update.card_text = data.cardText ?? null;
  if (data.imageFilename !== undefined) update.image_filename = data.imageFilename ?? null;
  if (data.rare !== undefined) update.rare = data.rare ?? null;
  if (data.product !== undefined) update.product = data.product ?? null;

  return update;
}

// ============================================
// Service class
// ============================================

class CardService {
  private cache: Map<string, AnyCardData> = new Map();
  private cacheExpiry: number = 0;
  private statusCache: Map<string, 'DRAFT' | 'PUBLISHED'> = new Map();
  private statusCacheExpiry: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async getAllCards(forceRefresh = false, statusFilter?: 'DRAFT' | 'PUBLISHED' | 'all'): Promise<AnyCardData[]> {
    if (!statusFilter && !forceRefresh && this.cache.size > 0 && Date.now() < this.cacheExpiry) {
      return Array.from(this.cache.values());
    }

    if (!isApiConfigured) {
      console.warn('API not configured, cannot fetch card data');
      return [];
    }

    const statusParam = statusFilter ? `?status=${statusFilter}` : '';
    const result = await apiClient.get<CardDbRecord[]>(`/api/cards${statusParam}`);

    if (result.error) {
      throw new Error(`获取卡牌数据失败: ${result.error.message}`);
    }

    const data = result.data ?? [];
    const cards = data.map(dbRecordToCardData);

    if (!statusFilter) {
      this.cache.clear();
      cards.forEach(card => this.cache.set(card.cardCode, card));
      this.cacheExpiry = Date.now() + this.CACHE_TTL;
    }

    return cards;
  }

  async getCardByCode(cardCode: string): Promise<AnyCardData | null> {
    const cached = this.cache.get(cardCode);
    if (cached && Date.now() < this.cacheExpiry) {
      return cached;
    }

    if (!isApiConfigured) return null;

    const result = await apiClient.get<CardDbRecord>(`/api/cards/${encodeURIComponent(cardCode)}`);

    if (result.error) {
      if (result.error.code === 'NOT_FOUND') return null;
      throw new Error(`获取卡牌失败: ${result.error.message}`);
    }

    if (!result.data) return null;

    const card = dbRecordToCardData(result.data);
    this.cache.set(cardCode, card);
    return card;
  }

  async updateCard(cardCode: string, updates: CardUpdateInput): Promise<AnyCardData> {
    if (!isApiConfigured) throw new Error('API 未配置');

    const dbUpdates = cardDataToDbUpdate(updates);
    const result = await apiClient.put<CardDbRecord>(
      `/api/cards/${encodeURIComponent(cardCode)}`,
      dbUpdates
    );

    if (result.error) throw new Error(`更新卡牌失败: ${result.error.message}`);

    const card = dbRecordToCardData(result.data!);
    this.cache.set(cardCode, card);
    return card;
  }

  async createCard(input: CardCreateInput): Promise<AnyCardData> {
    if (!isApiConfigured) throw new Error('API 未配置');

    const dbRecord = {
      card_code: input.cardCode,
      card_type: input.cardType,
      name: input.name,
      group_name: input.groupName ?? null,
      unit_name: input.unitName ?? null,
      cost: input.cost ?? null,
      blade: input.blade ?? null,
      hearts: input.hearts ?? [],
      blade_hearts: input.bladeHearts ?? null,
      score: input.score ?? null,
      requirements: input.requirements ?? [],
      card_text: input.cardText ?? null,
      image_filename: input.imageFilename ?? null,
      rare: input.rare ?? null,
      product: input.product ?? null,
    };

    const result = await apiClient.post<CardDbRecord>('/api/cards', dbRecord);

    if (result.error) throw new Error(`创建卡牌失败: ${result.error.message}`);

    const card = dbRecordToCardData(result.data!);
    this.cache.set(card.cardCode, card);
    return card;
  }

  async deleteCard(cardCode: string): Promise<void> {
    if (!isApiConfigured) throw new Error('API 未配置');

    const result = await apiClient.delete(`/api/cards/${encodeURIComponent(cardCode)}`);
    if (result.error) throw new Error(`删除卡牌失败: ${result.error.message}`);

    this.cache.delete(cardCode);
  }

  async exportCards(): Promise<AnyCardData[]> {
    return this.getAllCards(true);
  }

  async importCards(cards: CardCreateInput[]): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const card of cards) {
      try {
        await this.createCard(card);
        success++;
      } catch (err) {
        failed++;
        errors.push(`${card.cardCode}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { success, failed, errors };
  }

  async getCardsByType(type: CardType): Promise<AnyCardData[]> {
    const allCards = await this.getAllCards();
    return allCards.filter(card => card.cardType === type);
  }

  async getCardsByGroup(groupName: string): Promise<AnyCardData[]> {
    const allCards = await this.getAllCards();
    return allCards.filter(card => card.groupName === groupName);
  }

  async searchCards(query: string): Promise<AnyCardData[]> {
    const allCards = await this.getAllCards();
    const lowerQuery = query.toLowerCase();
    return allCards.filter(card =>
      card.name.toLowerCase().includes(lowerQuery) ||
      card.cardCode.toLowerCase().includes(lowerQuery)
    );
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheExpiry = 0;
    this.statusCache.clear();
    this.statusCacheExpiry = 0;
  }

  async publishCard(cardCode: string): Promise<void> {
    if (!isApiConfigured) throw new Error('API 未配置');

    const result = await apiClient.put(`/api/cards/${encodeURIComponent(cardCode)}/publish`);
    if (result.error) throw new Error(`上线卡牌失败: ${result.error.message}`);

    this.clearCache();
  }

  async unpublishCard(cardCode: string): Promise<void> {
    if (!isApiConfigured) throw new Error('API 未配置');

    const result = await apiClient.put(`/api/cards/${encodeURIComponent(cardCode)}/unpublish`);
    if (result.error) throw new Error(`下线卡牌失败: ${result.error.message}`);

    this.clearCache();
  }

  async getCardStatusMap(): Promise<Map<string, 'DRAFT' | 'PUBLISHED'>> {
    if (!isApiConfigured) return new Map();

    if (this.statusCache.size > 0 && Date.now() < this.statusCacheExpiry) {
      return new Map(this.statusCache);
    }

    const result = await apiClient.get<Record<string, string>>('/api/cards/status-map');

    if (result.error) {
      console.error('获取卡牌状态失败:', result.error.message);
      return new Map();
    }

    this.statusCache.clear();
    if (result.data) {
      for (const [code, status] of Object.entries(result.data)) {
        this.statusCache.set(code, status as 'DRAFT' | 'PUBLISHED');
      }
    }
    this.statusCacheExpiry = Date.now() + this.CACHE_TTL;

    return new Map(this.statusCache);
  }

  getCacheStatus(): { size: number; expiry: Date; isExpired: boolean } {
    return {
      size: this.cache.size,
      expiry: new Date(this.cacheExpiry),
      isExpired: Date.now() >= this.cacheExpiry,
    };
  }
}

export const cardService = new CardService();
