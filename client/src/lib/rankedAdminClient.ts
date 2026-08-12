import { apiClient } from '@/lib/apiClient';

export interface RankedSoftResetConfig {
  mode: 'RESET_TO_INITIAL' | 'RETAIN_TOWARD_CENTER';
  center: number;
  retention: number;
  minimumDeviation: number;
}

export interface RankedRatingConfig {
  algorithmVersion: string;
  ratingScale: number;
  initialRating: number;
  initialRatingDeviation: number;
  minimumRatingDeviation: number;
  maximumRatingDeviation: number;
  placementMatchCount: number;
  softResetMode: RankedSoftResetConfig['mode'];
  softResetCenter: number;
  softResetRetention: number;
  softResetMinimumDeviation: number;
  growthPool?: {
    mode: 'POST_PLACEMENT_AVERAGE_CENTERED';
    enabled: boolean;
    centerRating: number;
    maximumTotalAdjustment: number;
    transitionWidth: number;
    positiveSplitMode: 'EQUAL';
    negativeWinnerShare: number;
  };
  parameterRevision?: {
    mode: 'ADMIN_SEASON_RECALCULATION';
    revisionId: string;
    baseAlgorithmVersion: 'GLICKO1_PER_MATCH_V3' | 'GLICKO1_PER_MATCH_V4';
    sourceSoftResetMode: RankedSoftResetConfig['mode'];
    sourceSoftResetCenter: number;
    sourceSoftResetRetention: number;
    sourceSoftResetMinimumDeviation: number;
  };
}

export interface RankedRatingRevisionParameters {
  ratingScale: number;
  minimumRatingDeviation: number;
  placementMatchCount: number;
  growthPool?: {
    enabled: boolean;
    centerRating: number;
    maximumTotalAdjustment: number;
    transitionWidth: number;
    negativeWinnerShare: number;
  };
}

export interface RankedRatingRevisionBlockers {
  pendingMatches: number;
  runningMatches: number;
  activeTickets: number;
  activeReservations: number;
  activeParticipations: number;
  matchEnvironmentMismatches: number;
  matchRecordRulesMismatches: number;
}

export interface RankedRatingRevisionPlayerChange {
  userId: string;
  playerName: string;
  before: { rating: number; ratingDeviation: number; ratedMatchCount: number } | null;
  after: { rating: number; ratingDeviation: number; ratedMatchCount: number } | null;
  ratingDelta: number;
  ratingDeviationDelta: number;
  ratedMatchCountDelta: number;
  rankBefore: number | null;
  rankAfter: number | null;
  rankDelta: number | null;
}

export interface RankedRatingRevisionPreview {
  schemaVersion: 'loveca-ranked-rating-revision-preview-v1';
  seasonId: string;
  sourceAlgorithmVersion: string;
  targetAlgorithmVersion: string;
  sourceConfig: RankedRatingConfig;
  targetConfig: RankedRatingConfig;
  sourceLedgerRevision: number;
  projectedLedgerRevision: number;
  previewExpiresAt: string;
  previewToken: string;
  blockers: RankedRatingRevisionBlockers;
  canApply: boolean;
  materializedMatchCount: number;
  affectedMatchCount: number;
  affectedPlayerCount: number;
  leaderboardEnteredCount: number;
  leaderboardLeftCount: number;
  seedDeviationClampCount: number;
  maximumAbsoluteRatingChange: number;
  maximumAbsoluteRankChange: number;
  maximumAbsolutePerMatchDeltaChange: number;
  playerChanges: RankedRatingRevisionPlayerChange[];
}

export interface RankedRatingRevisionHistoryItem {
  id: string;
  revisionNumber: number;
  sourceAlgorithmVersion: string;
  targetAlgorithmVersion: string;
  sourceConfig: RankedRatingConfig;
  targetConfig: RankedRatingConfig;
  sourceLedgerRevision: number;
  targetLedgerRevision: number;
  reason: string;
  previewSummary: Record<string, unknown>;
  appliedBy: string | null;
  appliedAt: string;
  current: boolean;
}

export interface RankedAdminSeason {
  id: string;
  seasonKey: string;
  name: string;
  announcement: string;
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
  firstRatingDelta: number | null;
  secondRatingDelta: number | null;
}

export interface RankedAdminMatchDeckCard {
  baseCardCode: string;
  cardCode: string;
  name: string;
  cardType: 'MEMBER' | 'LIVE';
  count: number;
  imageFilename: string | null;
}

export interface RankedAdminMatchDeck {
  seat: 'FIRST' | 'SECOND';
  userId: string;
  sourceDeckName: string | null;
  deckFingerprint: string;
  mainDeckCards: RankedAdminMatchDeckCard[];
}

export interface RankedAdminMatchDetail extends RankedAdminMatch {
  decks: RankedAdminMatchDeck[];
  events: unknown[];
}

export interface RankedAdminMatchPage {
  matches: RankedAdminMatch[];
  total: number;
}

export interface RankedAdminMatchFilters {
  seasonId?: string;
  userQuery?: string;
  ratingStatus?: 'PENDING' | 'SETTLED' | 'VOIDED';
  limit?: number;
  offset?: number;
}

export interface RankedAdminOverview {
  seasonId: string;
  generatedAt: string;
  health: {
    waitingTickets: number;
    activeReservations: number;
    runningMatches: number;
    pendingMatches: number;
    oldestPendingEndedAt: string | null;
  };
  statistics: {
    totalParticipants: number;
    placementCompletedPlayers: number;
    leaderboardPlayers: number;
    totalSettledMatches: number;
    matchesToday: number;
    matchesLast7Days: number;
    activePlayersLast7Days: number;
    averageMatchesPerPlayer: number;
    leaderboardCutoffRating: number | null;
  };
  matchCountDistribution: {
    label: string;
    minimum: number;
    maximum: number | null;
    playerCount: number;
  }[];
  ratingDistribution: {
    minimumRating: number;
    maximumRatingExclusive: number;
    playerCount: number;
  }[];
}

export type RankedAdminPlayerStatus = 'PLACEMENT' | 'PLACED_NOT_ELIGIBLE' | 'RANKED';

export interface RankedAdminPlayerSearchResult {
  userId: string;
  username: string;
  displayName: string | null;
}

export interface RankedAdminPlayerSummary {
  userId: string;
  username: string;
  displayName: string | null;
  rating: number;
  ratingDeviation: number;
  ratedMatchCount: number;
  placementCompleted: boolean;
  leaderboardEligible: boolean;
  status: RankedAdminPlayerStatus;
  rank: number | null;
}

export interface RankedAdminPlayerRankRow {
  userId: string;
  username: string;
  displayName: string | null;
  rating: number;
  ratingDeviation: number;
  ratedMatchCount: number;
  rank: number;
  isTarget: boolean;
}

export interface RankedAdminPlayerContext {
  seasonId: string;
  generatedAt: string;
  ledgerRevision: number;
  placementRequired: number;
  leaderboardMinimumMatchCount: number;
  player: RankedAdminPlayerSummary;
  neighbors: { rows: RankedAdminPlayerRankRow[] };
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
  announcement: string;
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
  announcement: string;
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

export const fetchRankedOverview = (seasonId: string) =>
  requireData<RankedAdminOverview>(
    apiClient.get(`/api/admin/ranked/overview?seasonId=${encodeURIComponent(seasonId)}`),
    '读取排位概览失败'
  );

export const searchRankedAdminPlayers = (seasonId: string, query: string, limit = 10) => {
  const search = new URLSearchParams({
    seasonId,
    q: query.trim(),
    limit: String(limit),
  });
  return requireData<RankedAdminPlayerSearchResult[]>(
    apiClient.get(`/api/admin/ranked/players/search?${search.toString()}`),
    '搜索排位玩家失败'
  );
};

export const fetchRankedAdminPlayerContext = (seasonId: string, userId: string) =>
  requireData<RankedAdminPlayerContext>(
    apiClient.get(
      `/api/admin/ranked/players/${encodeURIComponent(userId)}/context?seasonId=${encodeURIComponent(seasonId)}`
    ),
    '读取玩家排位信息失败'
  );

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

export const fetchRankedRatingRevisions = (seasonId: string) =>
  requireData<RankedRatingRevisionHistoryItem[]>(
    apiClient.get(`/api/admin/ranked/seasons/${seasonId}/rating-revisions`),
    '读取评分参数修订记录失败'
  );

export const previewRankedRatingRevision = (
  seasonId: string,
  parameters: RankedRatingRevisionParameters,
  reason: string
) =>
  requireData<RankedRatingRevisionPreview>(
    apiClient.post(`/api/admin/ranked/seasons/${seasonId}/rating-revisions/preview`, {
      parameters,
      reason,
    }),
    '回算预览失败'
  );

export const applyRankedRatingRevision = (seasonId: string, preview: RankedRatingRevisionPreview) =>
  requireData<RankedRatingRevisionPreview>(
    apiClient.post(`/api/admin/ranked/seasons/${seasonId}/rating-revisions/apply`, {
      previewToken: preview.previewToken,
    }),
    '应用评分参数修订失败'
  );

export async function fetchRankedMatches(
  filters: RankedAdminMatchFilters = {}
): Promise<RankedAdminMatchPage> {
  const search = new URLSearchParams();
  if (filters.seasonId) search.set('seasonId', filters.seasonId);
  if (filters.userQuery?.trim()) search.set('userQuery', filters.userQuery.trim());
  if (filters.ratingStatus) search.set('ratingStatus', filters.ratingStatus);
  if (filters.limit !== undefined) search.set('limit', String(filters.limit));
  if (filters.offset !== undefined) search.set('offset', String(filters.offset));
  const query = search.toString();
  const response = await apiClient.get<RankedAdminMatch[]>(
    `/api/admin/ranked/matches${query ? `?${query}` : ''}`
  );
  if (!response.data) throw new Error(response.error?.message ?? '读取排位对局失败');
  return {
    matches: response.data,
    total: response.total ?? response.data.length,
  };
}

export const fetchRankedMatch = (matchId: string) =>
  requireData<RankedAdminMatchDetail>(
    apiClient.get(`/api/admin/ranked/matches/${encodeURIComponent(matchId)}`),
    '读取排位对局卡组失败'
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
