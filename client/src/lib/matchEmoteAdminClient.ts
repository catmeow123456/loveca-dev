import { apiClient, toApiClientError } from '@/lib/apiClient';

export interface AdminMatchEmoteAsset {
  readonly id: string;
  readonly assetRevision: string;
  readonly staticImageUrl: string;
  readonly animatedImageUrl: string | null;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly durationMs: number;
  readonly staticBytes: number;
  readonly animatedBytes: number | null;
  readonly createdAt: string;
}

export interface AdminMatchEmoteEntry {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly sortOrder: number;
  readonly enabled: boolean;
  readonly asset: AdminMatchEmoteAsset;
}

export interface AdminMatchEmoteCatalog {
  readonly version: string;
  readonly items: readonly AdminMatchEmoteEntry[];
}

export async function fetchAdminMatchEmoteCatalog(): Promise<AdminMatchEmoteCatalog> {
  const response = await apiClient.get<AdminMatchEmoteCatalog>('/api/match-emotes/admin/catalog');
  if (!response.data) {
    throw toApiClientError(response, '读取快捷表情目录失败');
  }
  return response.data;
}

export async function createAdminMatchEmoteId(): Promise<string> {
  const response = await apiClient.post<{ id: string }>('/api/match-emotes/admin/ids');
  if (!response.data) {
    throw toApiClientError(response, '创建快捷表情 ID 失败');
  }
  return response.data.id;
}

export async function uploadAdminMatchEmoteAsset(file: File): Promise<AdminMatchEmoteAsset> {
  const form = new FormData();
  form.append('file', file, file.name);
  const response = await apiClient.post<AdminMatchEmoteAsset>(
    '/api/match-emotes/admin/assets',
    form
  );
  if (!response.data) {
    throw toApiClientError(response, '上传快捷表情资源失败');
  }
  return response.data;
}

export async function saveAdminMatchEmoteCatalog(
  catalog: AdminMatchEmoteCatalog
): Promise<AdminMatchEmoteCatalog> {
  const response = await apiClient.put<AdminMatchEmoteCatalog>('/api/match-emotes/admin/catalog', {
    expectedVersion: catalog.version,
    items: catalog.items.map((item, sortOrder) => ({
      id: item.id,
      label: item.label,
      shortLabel: item.shortLabel,
      sortOrder,
      enabled: item.enabled,
      assetId: item.asset.id,
    })),
  });
  if (!response.data) {
    throw toApiClientError(response, '保存快捷表情目录失败');
  }
  return response.data;
}
