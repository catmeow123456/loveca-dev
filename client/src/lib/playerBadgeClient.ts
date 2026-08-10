import type { PlayerBadgeView } from '@game/online/player-badge-types';
import { apiClient } from '@/lib/apiClient';

export async function fetchMyPlayerBadges(): Promise<PlayerBadgeView[]> {
  const response = await apiClient.get<PlayerBadgeView[]>('/api/player-badges/me');
  if (response.data === null) {
    throw new Error(response.error?.message ?? '读取徽章失败');
  }
  return response.data;
}
