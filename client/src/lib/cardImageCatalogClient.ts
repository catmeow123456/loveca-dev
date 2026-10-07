import { apiClient } from './apiClient';
import type {
  CardImageCatalogDetail,
  CardImageCatalogFilters,
  CardImageCatalogPage,
} from '@game/shared/game-assets';

export const cardImageCatalogClient = {
  async list(filters: CardImageCatalogFilters): Promise<CardImageCatalogPage> {
    const query = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
    });
    if (filters.query) query.set('query', filters.query);
    if (filters.cardType) query.set('cardType', filters.cardType);
    if (filters.cardStatus) query.set('cardStatus', filters.cardStatus);
    if (filters.filename) query.set('filename', filters.filename);
    const result = await apiClient.get<CardImageCatalogPage>(`/api/admin/card-images?${query}`);
    if (result.error || !result.data) {
      throw new Error(result.error?.message ?? '读取卡图目录失败');
    }
    return result.data;
  },

  async detail(cardCode: string, verifyContent = false): Promise<CardImageCatalogDetail> {
    const query = verifyContent ? '?verifyContent=true' : '';
    const result = await apiClient.get<CardImageCatalogDetail>(
      `/api/admin/card-images/${encodeURIComponent(cardCode)}${query}`
    );
    if (result.error || !result.data) {
      throw new Error(result.error?.message ?? '读取卡图详情失败');
    }
    return result.data;
  },
};
