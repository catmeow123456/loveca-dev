import type {
  ThemeAdminDeckView,
  ThemeAdminEventView,
  ThemeAdminMatchupView,
  ThemeTableEvaluationPolicy,
} from '@game/online/theme-table-types';
import { apiClient } from '@/lib/apiClient';

export type { ThemeAdminDeckView, ThemeAdminEventView, ThemeAdminMatchupView };

export interface ThemeAdminEnvironmentPreview {
  rulesEnvironmentId: string;
  cardCatalogHash: string;
  publishedCardCount: number;
  allocationAlgorithmVersion: string;
}

export interface ThemeAdminDraftPayload {
  versionKey: string;
  name: string;
  platformTimeZone: string;
  openWindows: { weekdays: number[]; startMinute: number; endMinute: number }[];
  startsAt: string;
  endsAt: string;
  scheduleLabel: string;
  summary: string;
  announcement: string;
  evaluationPolicy: ThemeTableEvaluationPolicy;
}

export interface ThemeAdminOperationsPayload {
  name: string;
  openWindows: { weekdays: number[]; startMinute: number; endMinute: number }[];
  startsAt: string;
  endsAt: string;
  scheduleLabel: string;
  summary: string;
  announcement: string;
}

interface ThemeAdminDeckMetadataPayload {
  deckKey: string;
  displayName: string;
  playStyleTags: string[];
  difficulty: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  sourceLabel: string;
  sourceUrl: string | null;
  reviewNote: string;
}

export type ThemeAdminDeckPayload = ThemeAdminDeckMetadataPayload &
  ({ sourceType: 'CLOUD'; sourceDeckId: string } | { sourceType: 'YAML'; yamlContent: string });

export type ThemeAdminDeckUpdatePayload = Omit<ThemeAdminDeckMetadataPayload, 'deckKey'> &
  ({ sourceType: 'CLOUD'; sourceDeckId: string } | { sourceType: 'YAML'; yamlContent: string });

export interface ThemeAdminMatchupPayload {
  firstDeckVersionId: string;
  secondDeckVersionId: string;
  weight: number;
  testSummary: Record<string, unknown>;
}

async function requireData<T>(
  request: Promise<{ data: T | null; error: { message: string } | null }>,
  fallback: string
): Promise<T> {
  const response = await request;
  if (!response.data) throw new Error(response.error?.message ?? fallback);
  return response.data;
}

export const fetchThemeAdminEnvironment = () =>
  requireData<ThemeAdminEnvironmentPreview>(
    apiClient.get('/api/admin/theme-table/environment'),
    '读取娱乐模式环境失败'
  );

export const fetchThemeAdminEvents = () =>
  requireData<ThemeAdminEventView[]>(
    apiClient.get('/api/admin/theme-table/events'),
    '读取娱乐模式失败'
  );

export const createThemeAdminDraft = (payload: ThemeAdminDraftPayload) =>
  requireData<ThemeAdminEventView>(
    apiClient.post('/api/admin/theme-table/events', payload),
    '创建娱乐模式草稿失败'
  );

export const updateThemeAdminDraft = (themeId: string, payload: ThemeAdminDraftPayload) =>
  requireData<ThemeAdminEventView>(
    apiClient.put(`/api/admin/theme-table/events/${themeId}/draft`, payload),
    '更新娱乐模式草稿失败'
  );

export const updateThemeAdminOperations = (themeId: string, payload: ThemeAdminOperationsPayload) =>
  requireData<ThemeAdminEventView>(
    apiClient.put(`/api/admin/theme-table/events/${themeId}/operations`, payload),
    '更新娱乐模式信息失败'
  );

export const addThemeAdminDeck = (themeId: string, payload: ThemeAdminDeckPayload) =>
  requireData<ThemeAdminDeckView>(
    apiClient.post(`/api/admin/theme-table/events/${themeId}/decks`, payload),
    '冻结娱乐模式预组失败'
  );

export const updateThemeAdminDeck = (
  themeId: string,
  deckId: string,
  payload: ThemeAdminDeckUpdatePayload
) =>
  requireData<ThemeAdminDeckView>(
    apiClient.put(`/api/admin/theme-table/events/${themeId}/decks/${deckId}`, payload),
    '更新娱乐模式预组失败'
  );

export const deleteThemeAdminDeck = (themeId: string, deckId: string) =>
  requireData<{ id: string; disabledMatchupCount: number }>(
    apiClient.delete(`/api/admin/theme-table/events/${themeId}/decks/${deckId}`),
    '删除娱乐模式预组失败'
  );

export const addThemeAdminMatchup = (themeId: string, payload: ThemeAdminMatchupPayload) =>
  requireData<ThemeAdminMatchupView>(
    apiClient.post(`/api/admin/theme-table/events/${themeId}/matchups`, payload),
    '新增实测组合失败'
  );

export const setThemeAdminMatchupEnabled = (themeId: string, matchupId: string, enabled: boolean) =>
  requireData<ThemeAdminMatchupView>(
    apiClient.put(`/api/admin/theme-table/events/${themeId}/matchups/${matchupId}/enabled`, {
      enabled,
    }),
    '更新娱乐模式组合失败'
  );

export const runThemeAdminLifecycleAction = (
  themeId: string,
  action: 'activate' | 'pause' | 'resume' | 'close'
) =>
  requireData<ThemeAdminEventView>(
    apiClient.post(`/api/admin/theme-table/events/${themeId}/${action}`),
    '更新娱乐模式状态失败'
  );
