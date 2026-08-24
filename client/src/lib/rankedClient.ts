import { apiClient } from '@/lib/apiClient';
import type { PublicTableStatusView } from '@game/online/public-table-types';
import type {
  RankedOverviewView,
  RankedSeasonEnvironmentView,
  RankedSeasonPublicView,
} from '@game/online/ranked-types';
import type { DeckArchetypeEnvironmentView } from '@game/online/deck-classifier-types';

async function requireData<T>(
  request: Promise<{ data: T | null; error: { message: string } | null }>,
  fallback: string
): Promise<T> {
  const response = await request;
  if (!response.data) {
    throw new Error(response.error?.message ?? fallback);
  }
  return response.data;
}

export function fetchRankedOverview(seasonId?: string): Promise<RankedOverviewView> {
  const suffix = seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : '';
  return requireData(apiClient.get(`/api/ranked/overview${suffix}`), '读取赛季排位状态失败');
}

export function fetchRankedSeasons(): Promise<RankedSeasonPublicView[]> {
  return requireData(apiClient.get('/api/ranked/seasons'), '读取排位赛季失败');
}

export function fetchRankedEnvironment(seasonId: string): Promise<RankedSeasonEnvironmentView> {
  const query = `?seasonId=${encodeURIComponent(seasonId)}`;
  return requireData(apiClient.get(`/api/ranked/environment${query}`), '读取赛季卡牌使用率失败');
}

export function fetchRankedDeckArchetypeEnvironment(
  seasonId: string
): Promise<DeckArchetypeEnvironmentView> {
  const query = `?seasonId=${encodeURIComponent(seasonId)}`;
  return requireData(
    apiClient.get(`/api/ranked/environment/decks${query}`),
    '读取赛季卡组环境失败'
  );
}

export function joinRankedQueue(deckId: string): Promise<PublicTableStatusView> {
  return requireData(apiClient.post('/api/ranked/queue/join', { deckId }), '开始排位失败');
}

export function heartbeatRankedQueue(): Promise<PublicTableStatusView> {
  return requireData(apiClient.post('/api/ranked/queue/heartbeat'), '更新排位状态失败');
}

export function confirmRankedQueue(): Promise<PublicTableStatusView> {
  return requireData(apiClient.post('/api/ranked/queue/confirm'), '确认排位对局失败');
}

export function cancelRankedQueue(): Promise<PublicTableStatusView> {
  return requireData(apiClient.post('/api/ranked/queue/cancel'), '取消排位匹配失败');
}
