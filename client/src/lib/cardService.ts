/**
 * Card data service
 * Provides card data CRUD operations via self-hosted API
 */

import { apiClient, isApiConfigured, ApiClientError, toApiClientError } from './apiClient';
import { publicCardCatalogSchema, type PublicCardRecord } from '@game/shared/public-card-catalog';
import { recordCatalogValidationFailure } from './appPerformance';
import type {
  AnyCardData,
  MemberCardData,
  LiveCardData,
  EnergyCardData,
  HeartIcon,
  BladeHeartItem,
  BladeHearts,
} from '@game/domain/entities/card';
import { createHeartRequirement } from '@game/domain/entities/card';
import { CardType, HeartColor, BladeHeartEffect } from '@game/shared/types/enums';

// ============================================
// Database record type
// ============================================

export interface CardDbRecord {
  id: string;
  card_code: string;
  card_type: 'MEMBER' | 'LIVE' | 'ENERGY';
  name_jp: string | null;
  name_cn: string | null;
  work_names: string[] | null;
  group_names: string[] | null;
  unit_name: string | null;
  unit_name_raw: string | null;
  cost: number | null;
  blade: number | null;
  hearts: HeartIcon[];
  blade_hearts: BladeHeartItem[] | null;
  score: number | null;
  requirements: HeartIcon[];
  card_text_jp: string | null;
  card_text_cn: string | null;
  image_filename: string | null;
  image_source_uri: string | null;
  rare: string | null;
  product: string | null;
  product_code: string | null;
  source_external_id: string | null;
  source_flags: Record<string, unknown> | null;
  status: 'DRAFT' | 'PUBLISHED';
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

// ============================================
// Card update/create types
// ============================================

export interface CardUpdateInput {
  nameJp?: string | null;
  nameCn?: string | null;
  workNames?: string[] | null;
  groupNames?: string[] | null;
  unitName?: string | null;
  unitNameRaw?: string | null;
  cost?: number | null;
  blade?: number | null;
  hearts?: HeartIcon[];
  bladeHearts?: BladeHeartItem[] | null;
  score?: number | null;
  requirements?: HeartIcon[];
  cardTextJp?: string | null;
  cardTextCn?: string | null;
  imageFilename?: string | null;
  imageSourceUri?: string | null;
  rare?: string | null;
  product?: string | null;
  productCode?: string | null;
  sourceExternalId?: string | null;
  sourceFlags?: Record<string, unknown> | null;
}

export interface CardCreateInput extends CardUpdateInput {
  cardCode: string;
  cardType: 'MEMBER' | 'LIVE' | 'ENERGY';
}

export type AdminCardStatus = 'DRAFT' | 'PUBLISHED';

export interface AdminCardListItem {
  cardCode: string;
  cardType: CardType;
  nameJp: string | null;
  nameCn: string | null;
  imageFilename: string | null;
  rare: string | null;
  status: AdminCardStatus;
  updatedAt: string;
}

export interface AdminCardListPage {
  items: AdminCardListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AdminCardListParams {
  page: number;
  pageSize: number;
  query?: string;
  cardType?: CardType;
  status?: AdminCardStatus;
}

// ============================================
// Data conversion
// ============================================

function dbRecordToCardData(
  record: PublicCardRecord &
    Partial<Pick<CardDbRecord, 'image_source_uri' | 'source_external_id' | 'source_flags'>>
): AnyCardData {
  const name = record.name_cn?.trim() || record.name_jp?.trim() || record.card_code;
  const cardText = record.card_text_cn?.trim() || record.card_text_jp?.trim() || undefined;

  const baseData = {
    cardCode: record.card_code,
    name,
    nameJp: record.name_jp ?? undefined,
    nameCn: record.name_cn ?? undefined,
    workNames: record.work_names ?? undefined,
    groupNames: record.group_names ?? undefined,
    unitName: record.unit_name ?? undefined,
    unitNameRaw: record.unit_name_raw ?? undefined,
    cardText,
    cardTextJp: record.card_text_jp ?? undefined,
    cardTextCn: record.card_text_cn ?? undefined,
    imageFilename: record.image_filename ?? undefined,
    imageSourceUri: record.image_source_uri ?? undefined,
    rare: record.rare ?? undefined,
    product: record.product ?? undefined,
    productCode: record.product_code ?? undefined,
    sourceExternalId: record.source_external_id ?? undefined,
    sourceFlags: record.source_flags ?? undefined,
  };

  const convertBladeHearts = (items: PublicCardRecord['blade_hearts']): BladeHearts | undefined => {
    if (!items || items.length === 0) return undefined;
    return items.map((item) => ({
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
          (record.requirements || []).reduce(
            (acc, h) => {
              acc[h.color] = (acc[h.color] || 0) + h.count;
              return acc;
            },
            {} as Record<string, number>
          )
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

  if (data.nameJp !== undefined) update.name_jp = data.nameJp ?? null;
  if (data.nameCn !== undefined) update.name_cn = data.nameCn ?? null;
  if (data.workNames !== undefined) update.work_names = data.workNames ?? null;
  if (data.groupNames !== undefined) update.group_names = data.groupNames ?? null;
  if (data.unitName !== undefined) update.unit_name = data.unitName ?? null;
  if (data.unitNameRaw !== undefined) update.unit_name_raw = data.unitNameRaw ?? null;
  if (data.cost !== undefined) update.cost = data.cost ?? null;
  if (data.blade !== undefined) update.blade = data.blade ?? null;
  if (data.hearts !== undefined) update.hearts = data.hearts;
  if (data.bladeHearts !== undefined) update.blade_hearts = data.bladeHearts ?? null;
  if (data.score !== undefined) update.score = data.score ?? null;
  if (data.requirements !== undefined) update.requirements = data.requirements;
  if (data.cardTextJp !== undefined) update.card_text_jp = data.cardTextJp ?? null;
  if (data.cardTextCn !== undefined) update.card_text_cn = data.cardTextCn ?? null;
  if (data.imageFilename !== undefined) update.image_filename = data.imageFilename ?? null;
  if (data.imageSourceUri !== undefined) update.image_source_uri = data.imageSourceUri ?? null;
  if (data.rare !== undefined) update.rare = data.rare ?? null;
  if (data.product !== undefined) update.product = data.product ?? null;
  if (data.productCode !== undefined) update.product_code = data.productCode ?? null;
  if (data.sourceExternalId !== undefined) {
    update.source_external_id = data.sourceExternalId ?? null;
  }
  if (data.sourceFlags !== undefined) update.source_flags = data.sourceFlags ?? null;

  return update;
}

// ============================================
// Service class
// ============================================

class CardService {
  private publishedLoad: Promise<AnyCardData[]> | null = null;

  // Only share an in-flight read. Later loads must revalidate with the server;
  // HTTP caching handles reuse without retaining stale application snapshots.
  getPublishedCards(reload = false): Promise<AnyCardData[]> {
    if (this.publishedLoad) return this.publishedLoad;
    this.publishedLoad = apiClient
      .getPublishedCards({ reload })
      .then((result) => {
        if (result.error) throw toApiClientError(result, '获取卡牌数据失败');
        const parsed = publicCardCatalogSchema.safeParse(result.data);
        if (!parsed.success) {
          recordCatalogValidationFailure();
          throw new ApiClientError({
            code: 'INVALID_CATALOG',
            message: '卡牌数据不完整或格式异常，请重试。',
            status: result.status,
            requestId: result.requestId,
          });
        }
        return parsed.data.cards.map(dbRecordToCardData);
      })
      .finally(() => {
        this.publishedLoad = null;
      });
    return this.publishedLoad;
  }

  private statusCache: Map<string, 'DRAFT' | 'PUBLISHED'> = new Map();
  private statusCacheExpiry: number = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  async getAdminCards(params: AdminCardListParams): Promise<AdminCardListPage> {
    if (!isApiConfigured) {
      throw new Error('API 未配置');
    }

    const search = new URLSearchParams({
      page: String(params.page),
      pageSize: String(params.pageSize),
    });
    if (params.query) search.set('query', params.query);
    if (params.cardType) search.set('cardType', params.cardType);
    if (params.status) search.set('status', params.status);

    const result = await apiClient.get<AdminCardListPage>(`/api/cards/admin?${search}`);
    if (result.error || !result.data) {
      throw new Error(`获取卡牌管理列表失败: ${result.error?.message ?? '响应为空'}`);
    }
    return result.data;
  }

  async updateAdminCardsStatus(
    params: Omit<AdminCardListParams, 'page' | 'pageSize'>,
    targetStatus: AdminCardStatus
  ): Promise<number> {
    if (!isApiConfigured) {
      throw new Error('API 未配置');
    }

    const result = await apiClient.put<{ updated: number }>('/api/cards/admin/status', {
      targetStatus,
      query: params.query,
      cardType: params.cardType,
      status: params.status,
    });
    if (result.error || !result.data) {
      throw new Error(`批量更新卡牌状态失败: ${result.error?.message ?? '响应为空'}`);
    }

    this.clearCache();
    return result.data.updated;
  }

  async getCardByCode(cardCode: string): Promise<AnyCardData | null> {
    if (!isApiConfigured) return null;

    const result = await apiClient.get<CardDbRecord>(`/api/cards/${encodeURIComponent(cardCode)}`);

    if (result.error) {
      if (result.error.code === 'NOT_FOUND') return null;
      throw new Error(`获取卡牌失败: ${result.error.message}`);
    }

    if (!result.data) return null;

    const card = dbRecordToCardData(result.data);
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
    return card;
  }

  async createCard(input: CardCreateInput): Promise<AnyCardData> {
    if (!isApiConfigured) throw new Error('API 未配置');

    const dbRecord = {
      card_code: input.cardCode,
      card_type: input.cardType,
      name_jp: input.nameJp ?? null,
      name_cn: input.nameCn ?? null,
      work_names: input.workNames ?? null,
      group_names: input.groupNames ?? null,
      unit_name: input.unitName ?? null,
      unit_name_raw: input.unitNameRaw ?? null,
      cost: input.cost ?? null,
      blade: input.blade ?? null,
      hearts: input.hearts ?? [],
      blade_hearts: input.bladeHearts ?? null,
      score: input.score ?? null,
      requirements: input.requirements ?? [],
      card_text_jp: input.cardTextJp ?? null,
      card_text_cn: input.cardTextCn ?? null,
      image_filename: input.imageFilename ?? null,
      image_source_uri: input.imageSourceUri ?? null,
      rare: input.rare ?? null,
      product: input.product ?? null,
      product_code: input.productCode ?? null,
      source_external_id: input.sourceExternalId ?? null,
      source_flags: input.sourceFlags ?? null,
    };

    const result = await apiClient.post<CardDbRecord>('/api/cards', dbRecord);

    if (result.error) throw new Error(`创建卡牌失败: ${result.error.message}`);

    const card = dbRecordToCardData(result.data!);
    return card;
  }

  async deleteCard(cardCode: string): Promise<void> {
    if (!isApiConfigured) throw new Error('API 未配置');

    const result = await apiClient.delete(`/api/cards/${encodeURIComponent(cardCode)}`);
    if (result.error) throw new Error(`删除卡牌失败: ${result.error.message}`);
  }

  async exportCards(): Promise<AnyCardData[]> {
    if (!isApiConfigured) throw new Error('API 未配置');

    const result = await apiClient.get<AnyCardData[]>('/api/cards/export');
    if (result.error) throw new Error(`导出卡牌失败: ${result.error.message}`);

    return result.data ?? [];
  }

  async importCards(
    cards: CardCreateInput[]
  ): Promise<{ success: number; failed: number; errors: string[] }> {
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

  clearCache(): void {
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
}

export const cardService = new CardService();
