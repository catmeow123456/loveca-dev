import { apiClient } from '@/lib/apiClient';

export interface RankedSoftResetConfig {
  mode: 'RESET_TO_INITIAL' | 'RETAIN_TOWARD_CENTER';
  center: number;
  retention: number;
  minimumDeviation: number;
}

export interface RankedRatingConfig {
  initialRating: number;
  initialRatingDeviation: number;
  softResetMode: RankedSoftResetConfig['mode'];
  softResetCenter: number;
  softResetRetention: number;
  softResetMinimumDeviation: number;
}

export interface RankedAdminSeason {
  id: string;
  seasonKey: string;
  name: string;
  lifecycle: 'DRAFT' | 'ACTIVE' | 'FINALIZING' | 'CLOSED';
  queueAdmission: 'OPEN' | 'PAUSED';
  platformTimeZone: string;
  openWindows: { weekdays: number[]; startMinute: number; endMinute: number }[];
  startsAt: string;
  scheduledEndsAt: string;
  finalizingDeadlineAt: string;
  closedAt: string | null;
  ratingAlgorithmVersion: string;
  ratingConfig: RankedRatingConfig;
  leaderboardMinimumMatchCount: number;
  ledgerRevision: number;
  withinOpenWindow: boolean;
  effectiveQueueOpen: boolean;
}

export interface RankedAdminMatch {
  matchId: string;
  seasonId: string;
  seasonKey: string;
  ratingStatus: 'PENDING' | 'SETTLED' | 'VOIDED';
  winnerSeat: 'FIRST' | 'SECOND' | null;
  resultType: string | null;
  priorResultType: 'NORMAL' | 'SURRENDER' | 'DISCONNECT_FORFEIT' | null;
  firstPlayer: { userId: string; username: string; displayName: string | null };
  secondPlayer: { userId: string; username: string; displayName: string | null };
  recordStatus: string;
  completeness: string;
  endedAt: string | null;
}

export interface RankedEnvironmentPreview {
  persistentSeasonReady: boolean;
  algorithms: {
    algorithmVersion: string;
    status: 'SHADOW_CANDIDATE' | 'FORMAL';
    config: RankedRatingConfig;
  }[];
}

export interface RankedSeasonDraftPayload {
  seasonKey: string;
  name: string;
  platformTimeZone: string;
  openWindows: { weekdays: number[]; startMinute: number; endMinute: number }[];
  startsAt: string;
  scheduledEndsAt: string;
  finalizingDeadlineAt: string;
  ratingAlgorithmVersion: string;
  softReset: RankedSoftResetConfig;
  leaderboardMinimumMatchCount: number;
}

export interface RankedActiveSeasonOperationsPayload {
  name: string;
  openWindows: { weekdays: number[]; startMinute: number; endMinute: number }[];
  leaderboardMinimumMatchCount: number;
}

export interface RankedCorrectionPreview {
  seasonId: string;
  matchId: string;
  action: 'VOID' | 'REPLACE';
  targetEventId: string;
  previewToken: string;
  currentLedgerRevision: number;
  projectedLedgerRevision: number;
  affectedPlayerCount: number;
  materializedMatchCount: number;
}

async function requireData<T>(
  request: Promise<{ data: T | null; error: { message: string } | null }>,
  fallback: string
): Promise<T> {
  const response = await request;
  if (!response.data) throw new Error(response.error?.message ?? fallback);
  return response.data;
}

export const fetchRankedEnvironment = () =>
  requireData<RankedEnvironmentPreview>(
    apiClient.get('/api/admin/ranked/environment'),
    '读取排位环境失败'
  );

export const fetchRankedSeasons = () =>
  requireData<RankedAdminSeason[]>(apiClient.get('/api/admin/ranked/seasons'), '读取赛季失败');

export const createRankedSeason = (payload: RankedSeasonDraftPayload) =>
  requireData<RankedAdminSeason>(
    apiClient.post('/api/admin/ranked/seasons', payload),
    '创建赛季失败'
  );

export const updateRankedSeason = (seasonId: string, payload: RankedSeasonDraftPayload) =>
  requireData<RankedAdminSeason>(
    apiClient.put(`/api/admin/ranked/seasons/${seasonId}/draft`, payload),
    '更新赛季草稿失败'
  );

export const updateActiveRankedSeasonOperations = (
  seasonId: string,
  payload: RankedActiveSeasonOperationsPayload
) =>
  requireData<RankedAdminSeason>(
    apiClient.put(`/api/admin/ranked/seasons/${seasonId}/operations`, payload),
    '更新赛季设置失败'
  );

export const runRankedSeasonAction = (
  seasonId: string,
  action: 'activate' | 'finalize' | 'close'
) =>
  requireData<RankedAdminSeason>(
    apiClient.post(`/api/admin/ranked/seasons/${seasonId}/${action}`),
    '更新赛季失败'
  );

export const setRankedAdmission = (seasonId: string, admission: 'OPEN' | 'PAUSED') =>
  requireData<RankedAdminSeason>(
    apiClient.put(`/api/admin/ranked/seasons/${seasonId}/admission`, { admission }),
    '更新匹配状态失败'
  );

export const fetchRankedMatches = (seasonId?: string) =>
  requireData<RankedAdminMatch[]>(
    apiClient.get(
      `/api/admin/ranked/matches${seasonId ? `?seasonId=${encodeURIComponent(seasonId)}` : ''}`
    ),
    '读取排位对局失败'
  );

export const settleRankedMatch = (matchId: string) =>
  requireData(
    apiClient.post(`/api/admin/ranked/matches/${encodeURIComponent(matchId)}/settle`),
    '重试结算失败'
  );

export const previewRankedCorrection = (
  match: RankedAdminMatch,
  action: 'VOID' | 'REPLACE',
  replacementWinnerSeat?: 'FIRST' | 'SECOND',
  replacementResultType?: 'NORMAL' | 'SURRENDER' | 'DISCONNECT_FORFEIT'
) =>
  requireData<RankedCorrectionPreview>(
    apiClient.post(
      `/api/admin/ranked/matches/${encodeURIComponent(match.matchId)}/corrections/preview`,
      {
        seasonId: match.seasonId,
        action,
        replacementWinnerSeat,
        replacementResultType,
      }
    ),
    '更正预览失败'
  );

export const executeRankedCorrection = (
  match: RankedAdminMatch,
  preview: RankedCorrectionPreview,
  reason: string,
  idempotencyKey: string,
  replacementWinnerSeat?: 'FIRST' | 'SECOND',
  replacementResultType?: 'NORMAL' | 'SURRENDER' | 'DISCONNECT_FORFEIT'
) =>
  requireData(
    apiClient.post(`/api/admin/ranked/matches/${encodeURIComponent(match.matchId)}/corrections`, {
      seasonId: match.seasonId,
      action: preview.action,
      replacementWinnerSeat,
      replacementResultType,
      reason,
      idempotencyKey,
      expectedLedgerRevision: preview.currentLedgerRevision,
      expectedTargetEventId: preview.targetEventId,
      previewToken: preview.previewToken,
    }),
    '执行更正失败'
  );
