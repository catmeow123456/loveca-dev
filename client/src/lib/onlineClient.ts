import {
  ApiClientError,
  apiClient,
  getAccessToken,
  getApiBaseUrl,
  toApiClientError,
} from '@/lib/apiClient';
import type {
  DebugReplayBundle,
  DebugReplayCheckpointView,
  DebugReplayImportSummary,
  DebugReplayTimelineView,
  MatchRecordDetailView,
  MatchRecordReplayView,
  MatchRecordSummaryView,
  MatchRecordTimelineView,
  OnlineAdminRoomSummary,
  OnlineCommandResult,
  OpeningRpsGesture,
  OpeningTurnOrderChoice,
  OnlineMatchSnapshot,
  OnlineMatchSnapshotResponse,
  OnlineRoomView,
  OnlineRoomSpectatorEntryView,
  OnlineSpectatorJoinView,
  OnlineSpectatorLinkView,
  OnlineSpectatorSnapshotResponse,
  OnlineSpectatorSwitchView,
  PublicEventsResponse,
  Seat,
} from '@game/online';
import { toTransport } from '@game/online';
import type { GameCommand } from '@game/application/game-commands';

export async function createOnlineRoom(roomCode: string): Promise<OnlineRoomView> {
  const response = await apiClient.post<OnlineRoomView>('/api/online/rooms', { roomCode });
  if (!response.data) {
    throw new Error(response.error?.message ?? '创建房间失败');
  }
  return response.data;
}

export async function joinOnlineRoom(roomCode: string): Promise<OnlineRoomView> {
  const response = await apiClient.post<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/join`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '加入房间失败');
  }
  return response.data;
}

export async function fetchOnlineRoom(roomCode: string): Promise<OnlineRoomView> {
  const response = await apiClient.get<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取房间状态失败');
  }
  return response.data;
}

export async function fetchOnlineRoomSpectatorEntry(
  roomCode: string
): Promise<OnlineRoomSpectatorEntryView> {
  const response = await apiClient.get<OnlineRoomSpectatorEntryView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/spectator-entry`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取房间号观战入口失败');
  }
  return response.data;
}

export async function createOnlineRoomSpectatorEntryLink(
  roomCode: string,
  viewerSeat: Seat
): Promise<OnlineSpectatorLinkView> {
  const response = await apiClient.post<OnlineSpectatorLinkView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/spectator-entry/${encodeURIComponent(
      viewerSeat
    )}/link`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '进入房间号观战失败');
  }
  return response.data;
}

export async function updateOnlineRoomSpectatorEntry(
  roomCode: string,
  enabled: boolean
): Promise<OnlineRoomView> {
  const response = await apiClient.put<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/spectator-entry`,
    { enabled }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '更新房间号观战设置失败');
  }
  return response.data;
}

export async function lockOnlineRoomDeck(
  roomCode: string,
  deckId: string
): Promise<OnlineRoomView> {
  const response = await apiClient.post<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/deck`,
    { deckId }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '锁定卡组失败');
  }
  return response.data;
}

export async function readyOnlineRoomStart(roomCode: string): Promise<OnlineRoomView> {
  const response = await apiClient.post<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/ready-start`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '准备开始失败');
  }
  return response.data;
}

export async function submitOnlineOpeningRps(
  roomCode: string,
  gesture: OpeningRpsGesture
): Promise<OnlineRoomView> {
  const response = await apiClient.post<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/opening-rps`,
    { gesture }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '提交猜拳失败');
  }
  return response.data;
}

export async function replayOnlineOpeningRps(roomCode: string): Promise<OnlineRoomView> {
  const response = await apiClient.post<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/opening-rps/replay`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '重新猜拳失败');
  }
  return response.data;
}

export async function chooseOnlineOpeningTurnOrder(
  roomCode: string,
  choice: OpeningTurnOrderChoice
): Promise<OnlineRoomView> {
  const response = await apiClient.post<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/opening-turn-order`,
    { choice }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '选择先后手失败');
  }
  return response.data;
}

export async function leaveOnlineRoom(roomCode: string): Promise<{ room: OnlineRoomView | null }> {
  const response = await apiClient.post<{ room: OnlineRoomView | null }>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/leave`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '离开房间失败');
  }
  return response.data;
}

export async function requestOnlineRoomRestart(roomCode: string): Promise<OnlineRoomView> {
  const response = await apiClient.post<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/restart-request`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '请求重开失败');
  }
  return response.data;
}

export async function acceptOnlineRoomRestart(
  roomCode: string,
  requestId: string
): Promise<OnlineRoomView> {
  const response = await apiClient.post<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/restart-request/${encodeURIComponent(
      requestId
    )}/accept`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '同意重开失败');
  }
  return response.data;
}

export async function rejectOnlineRoomRestart(
  roomCode: string,
  requestId: string
): Promise<OnlineRoomView> {
  const response = await apiClient.post<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/restart-request/${encodeURIComponent(
      requestId
    )}/reject`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '拒绝重开失败');
  }
  return response.data;
}

export async function cancelOnlineRoomRestart(
  roomCode: string,
  requestId: string
): Promise<OnlineRoomView> {
  const response = await apiClient.post<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/restart-request/${encodeURIComponent(
      requestId
    )}/cancel`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '取消重开失败');
  }
  return response.data;
}

export function leaveOnlineRoomOnUnload(roomCode: string): void {
  const apiBaseUrl = getApiBaseUrl();
  const accessToken = getAccessToken();
  if (!apiBaseUrl || !accessToken) {
    return;
  }

  void fetch(`${apiBaseUrl}/api/online/rooms/${encodeURIComponent(roomCode)}/leave`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: 'include',
    keepalive: true,
  }).catch(() => {
    // Best-effort only. The server-side stale cleanup covers failed unload requests.
  });
}

export async function fetchOnlineMatchSnapshot(matchId: string): Promise<OnlineMatchSnapshot>;
export async function fetchOnlineMatchSnapshot(
  matchId: string,
  sinceSeq: number | undefined
): Promise<OnlineMatchSnapshot | null>;
export async function fetchOnlineMatchSnapshot(
  matchId: string,
  sinceSeq?: number
): Promise<OnlineMatchSnapshot | null> {
  const snapshot = await fetchOnlineMatchSnapshotResponse(matchId, sinceSeq);
  return isSnapshotNotModified(snapshot) ? null : snapshot;
}

export async function fetchOnlineMatchSnapshotResponse(
  matchId: string,
  sinceSeq?: number
): Promise<OnlineMatchSnapshotResponse> {
  const search =
    sinceSeq !== undefined && Number.isSafeInteger(sinceSeq) && sinceSeq >= 0
      ? `?sinceSeq=${sinceSeq}`
      : '';
  const response = await apiClient.get<OnlineMatchSnapshotResponse>(
    `/api/online/matches/${encodeURIComponent(matchId)}/snapshot${search}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取联机对局快照失败');
  }
  return response.data;
}

export async function fetchOnlineMatchPublicEvents(
  matchId: string,
  afterSeq?: number
): Promise<PublicEventsResponse> {
  const search =
    afterSeq !== undefined && Number.isSafeInteger(afterSeq) && afterSeq >= 0
      ? `?afterSeq=${afterSeq}`
      : '';
  const response = await apiClient.get<PublicEventsResponse>(
    `/api/online/matches/${encodeURIComponent(matchId)}/public-events${search}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取公开对局日志失败');
  }
  return response.data;
}

export async function createOnlineAdminPlayerSpectatorLink(
  matchId: string,
  viewerSeat: Seat
): Promise<OnlineSpectatorLinkView> {
  const response = await apiClient.post<OnlineSpectatorLinkView>(
    `/api/online/admin/matches/${encodeURIComponent(matchId)}/spectator-links/player-view`,
    { viewerSeat }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '生成管理员观战链接失败');
  }
  return response.data;
}

interface JoinOnlineSpectatorLinkInput {
  readonly clientId?: string;
}

const spectatorRetryUntilBySession = new Map<string, number>();

function getSpectatorSessionKey(token: string, sessionId: string): string {
  return JSON.stringify([token, sessionId]);
}

function assertSpectatorRequestAllowed(token: string, sessionId: string): void {
  const key = getSpectatorSessionKey(token, sessionId);
  const retryUntil = spectatorRetryUntilBySession.get(key);
  if (retryUntil === undefined) {
    return;
  }
  const retryAfterMs = retryUntil - Date.now();
  if (retryAfterMs <= 0) {
    spectatorRetryUntilBySession.delete(key);
    return;
  }
  throw new ApiClientError({
    code: 'ONLINE_SPECTATOR_RATE_LIMITED',
    message: '观战同步暂时繁忙，请稍等',
    status: 429,
    retryAfterMs,
  });
}

function rememberSpectatorRateLimit(token: string, sessionId: string, error: ApiClientError): void {
  if (error.code !== 'ONLINE_SPECTATOR_RATE_LIMITED' || error.retryAfterMs === undefined) {
    return;
  }
  spectatorRetryUntilBySession.set(
    getSpectatorSessionKey(token, sessionId),
    Date.now() + Math.max(1, error.retryAfterMs)
  );
}

function throwSpectatorRequestError<T>(
  token: string,
  sessionId: string,
  response: Parameters<typeof toApiClientError<T>>[0],
  fallbackMessage: string
): never {
  const responseError = toApiClientError(response, fallbackMessage);
  const error =
    responseError.status === 429 && responseError.code !== 'ONLINE_SPECTATOR_RATE_LIMITED'
      ? new ApiClientError({
          code: 'ONLINE_SPECTATOR_RATE_LIMITED',
          message: '观战同步暂时繁忙，请稍等',
          status: 429,
          retryAfterMs: responseError.retryAfterMs ?? 1_000,
        })
      : responseError;
  rememberSpectatorRateLimit(token, sessionId, error);
  throw error;
}

export async function joinOnlineSpectatorLink(
  token: string,
  input?: JoinOnlineSpectatorLinkInput
): Promise<OnlineSpectatorJoinView> {
  const payload = { clientId: input?.clientId?.trim() };
  const response = await apiClient.post<OnlineSpectatorJoinView>(
    `/api/online/spectator-links/${encodeURIComponent(token)}/sessions`,
    Object.fromEntries(
      Object.entries(payload).filter(([, value]) => typeof value === 'string' && value.length > 0)
    )
  );
  if (!response.data) {
    throw toApiClientError(response, '进入观战失败');
  }
  return response.data;
}

export async function fetchOnlineSpectatorSnapshotResponse(
  token: string,
  sessionId: string | undefined,
  sinceSeq?: number,
  sinceViewVersion?: number
): Promise<OnlineSpectatorSnapshotResponse> {
  if (sessionId) {
    assertSpectatorRequestAllowed(token, sessionId);
  }
  const params = new URLSearchParams();
  if (sessionId) {
    params.set('sessionId', sessionId);
  }
  if (sinceSeq !== undefined && Number.isSafeInteger(sinceSeq) && sinceSeq >= 0) {
    params.set('sinceSeq', String(sinceSeq));
  }
  if (
    sinceViewVersion !== undefined &&
    Number.isSafeInteger(sinceViewVersion) &&
    sinceViewVersion >= 0
  ) {
    params.set('sinceViewVersion', String(sinceViewVersion));
  }
  const search = params.toString();
  const response = await apiClient.get<OnlineSpectatorSnapshotResponse>(
    `/api/online/spectator-links/${encodeURIComponent(token)}/snapshot${search ? `?${search}` : ''}`
  );
  if (!response.data) {
    if (sessionId) {
      throwSpectatorRequestError(token, sessionId, response, '读取观战快照失败');
    }
    throw toApiClientError(response, '读取观战快照失败');
  }
  return response.data;
}

export async function switchOnlineSpectatorView(
  token: string,
  sessionId: string,
  viewerSeat: Seat
): Promise<OnlineSpectatorSwitchView> {
  assertSpectatorRequestAllowed(token, sessionId);
  const response = await apiClient.post<OnlineSpectatorSwitchView>(
    `/api/online/spectator-links/${encodeURIComponent(token)}/sessions/${encodeURIComponent(sessionId)}/view`,
    { viewerSeat }
  );
  if (!response.data) {
    throwSpectatorRequestError(token, sessionId, response, '切换观战视角失败');
  }
  return response.data;
}

export async function fetchOnlineSpectatorPublicEvents(
  token: string,
  sessionId: string | undefined,
  afterSeq?: number
): Promise<PublicEventsResponse> {
  if (sessionId) {
    assertSpectatorRequestAllowed(token, sessionId);
  }
  const params = new URLSearchParams();
  if (sessionId) {
    params.set('sessionId', sessionId);
  }
  if (afterSeq !== undefined && Number.isSafeInteger(afterSeq) && afterSeq >= 0) {
    params.set('afterSeq', String(afterSeq));
  }
  const search = params.toString();
  const response = await apiClient.get<PublicEventsResponse>(
    `/api/online/spectator-links/${encodeURIComponent(token)}/public-events${
      search ? `?${search}` : ''
    }`
  );
  if (!response.data) {
    if (sessionId) {
      throwSpectatorRequestError(token, sessionId, response, '读取观战公开日志失败');
    }
    throw toApiClientError(response, '读取观战公开日志失败');
  }
  return response.data;
}

function isSnapshotNotModified(
  snapshot: OnlineMatchSnapshotResponse
): snapshot is Extract<OnlineMatchSnapshotResponse, { readonly modified: false }> {
  return 'modified' in snapshot && snapshot.modified === false;
}

export async function executeOnlineMatchCommand(
  matchId: string,
  command: GameCommand
): Promise<OnlineCommandResult> {
  const response = await apiClient.post<OnlineCommandResult>(
    `/api/online/matches/${encodeURIComponent(matchId)}/command`,
    { command: toTransport(command) }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '联机命令发送失败');
  }
  return response.data;
}

export async function createOnlineUndoRequest(
  matchId: string,
  input: {
    readonly expectedRevision: number;
    readonly undoEntryId: string;
    readonly idempotencyKey?: string;
  }
): Promise<OnlineCommandResult> {
  const response = await apiClient.post<OnlineCommandResult>(
    `/api/online/matches/${encodeURIComponent(matchId)}/undo-requests`,
    input
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '撤销请求发送失败');
  }
  return response.data;
}

export async function undoOnlineMatch(
  matchId: string,
  input: {
    readonly expectedRevision: number;
    readonly undoEntryId: string;
    readonly idempotencyKey?: string;
  }
): Promise<OnlineCommandResult> {
  const response = await apiClient.post<OnlineCommandResult>(
    `/api/online/matches/${encodeURIComponent(matchId)}/undo`,
    input
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '联机撤销失败');
  }
  return response.data;
}

export async function acceptOnlineUndoRequest(
  matchId: string,
  requestId: string,
  input: {
    readonly expectedRevision: number;
    readonly idempotencyKey?: string;
    readonly grantContinuous?: boolean;
  }
): Promise<OnlineCommandResult> {
  const response = await apiClient.post<OnlineCommandResult>(
    `/api/online/matches/${encodeURIComponent(matchId)}/undo-requests/${encodeURIComponent(
      requestId
    )}/accept`,
    input
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '接受撤销请求失败');
  }
  return response.data;
}

export async function rejectOnlineUndoRequest(
  matchId: string,
  requestId: string,
  input: {
    readonly expectedRevision: number;
    readonly idempotencyKey?: string;
  }
): Promise<OnlineCommandResult> {
  const response = await apiClient.post<OnlineCommandResult>(
    `/api/online/matches/${encodeURIComponent(matchId)}/undo-requests/${encodeURIComponent(
      requestId
    )}/reject`,
    input
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '拒绝撤销请求失败');
  }
  return response.data;
}

export async function fetchOnlineAdminRooms(): Promise<readonly OnlineAdminRoomSummary[]> {
  const response = await apiClient.get<OnlineAdminRoomSummary[]>('/api/online/admin/rooms');
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取联机房间监控数据失败');
  }
  return response.data;
}

export async function fetchMatchRecords(): Promise<readonly MatchRecordSummaryView[]> {
  const response = await apiClient.get<MatchRecordSummaryView[]>('/api/battle/match-records');
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取历史对局记录失败');
  }
  return response.data;
}

export interface AdminMatchRecordFilters {
  readonly userQuery?: string;
  readonly userId?: string;
  readonly startedFrom?: number;
  readonly startedTo?: number;
}

export async function fetchAdminMatchRecords(
  filters: AdminMatchRecordFilters = {}
): Promise<readonly MatchRecordSummaryView[]> {
  const search = buildAdminMatchRecordSearch(filters);
  const response = await apiClient.get<MatchRecordSummaryView[]>(
    `/api/battle/admin/match-records${search}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取管理员历史对局记录失败');
  }
  return response.data;
}

export async function fetchMatchRecordDetail(matchId: string): Promise<MatchRecordDetailView> {
  const response = await apiClient.get<MatchRecordDetailView>(
    `/api/battle/match-records/${encodeURIComponent(matchId)}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取历史对局详情失败');
  }
  return response.data;
}

export async function fetchAdminMatchRecordDetail(matchId: string): Promise<MatchRecordDetailView> {
  const response = await apiClient.get<MatchRecordDetailView>(
    `/api/battle/admin/match-records/${encodeURIComponent(matchId)}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取管理员历史对局详情失败');
  }
  return response.data;
}

export async function fetchMatchRecordTimeline(matchId: string): Promise<MatchRecordTimelineView> {
  const response = await apiClient.get<MatchRecordTimelineView>(
    `/api/battle/match-records/${encodeURIComponent(matchId)}/timeline`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取历史对局时间线失败');
  }
  return response.data;
}

export async function fetchAdminMatchRecordTimeline(
  matchId: string,
  viewerSeat: 'FIRST' | 'SECOND' = 'FIRST'
): Promise<MatchRecordTimelineView> {
  const response = await apiClient.get<MatchRecordTimelineView>(
    `/api/battle/admin/match-records/${encodeURIComponent(matchId)}/timeline?viewerSeat=${viewerSeat}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取管理员历史对局时间线失败');
  }
  return response.data;
}

export async function fetchMatchRecordReplay(
  matchId: string,
  options: { readonly checkpointSeq?: number } = {}
): Promise<MatchRecordReplayView> {
  const { checkpointSeq } = options;
  const search =
    checkpointSeq !== undefined && Number.isSafeInteger(checkpointSeq) && checkpointSeq > 0
      ? `?checkpointSeq=${checkpointSeq}`
      : '';
  const response = await apiClient.get<MatchRecordReplayView>(
    `/api/battle/match-records/${encodeURIComponent(matchId)}/replay${search}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取历史对局回放节点失败');
  }
  return response.data;
}

export async function fetchAdminMatchRecordReplay(
  matchId: string,
  options: { readonly checkpointSeq?: number; readonly viewerSeat?: 'FIRST' | 'SECOND' } = {}
): Promise<MatchRecordReplayView> {
  const searchParams = new URLSearchParams();
  if (
    options.checkpointSeq !== undefined &&
    Number.isSafeInteger(options.checkpointSeq) &&
    options.checkpointSeq > 0
  ) {
    searchParams.set('checkpointSeq', String(options.checkpointSeq));
  }
  searchParams.set('viewerSeat', options.viewerSeat ?? 'FIRST');
  const search = `?${searchParams.toString()}`;
  const response = await apiClient.get<MatchRecordReplayView>(
    `/api/battle/admin/match-records/${encodeURIComponent(matchId)}/replay${search}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取管理员历史对局回放节点失败');
  }
  return response.data;
}

export async function exportAdminMatchRecordBundle(matchId: string): Promise<DebugReplayBundle> {
  const response = await apiClient.get<DebugReplayBundle>(
    `/api/battle/admin/match-records/${encodeURIComponent(matchId)}/export`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '导出历史对局回放包失败');
  }
  return response.data;
}

function buildAdminMatchRecordSearch(filters: AdminMatchRecordFilters): string {
  const params = new URLSearchParams();
  if (filters.userQuery?.trim()) {
    params.set('userQuery', filters.userQuery.trim());
  }
  if (filters.userId?.trim()) {
    params.set('userId', filters.userId.trim());
  }
  if (typeof filters.startedFrom === 'number' && Number.isFinite(filters.startedFrom)) {
    params.set('startedFrom', String(filters.startedFrom));
  }
  if (typeof filters.startedTo === 'number' && Number.isFinite(filters.startedTo)) {
    params.set('startedTo', String(filters.startedTo));
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

export async function exportDebugReplayBundle(matchId: string): Promise<DebugReplayBundle> {
  const response = await apiClient.post<DebugReplayBundle>(
    `/api/online/admin/matches/${encodeURIComponent(matchId)}/debug-replay/export`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '导出调试回放包失败');
  }
  return response.data;
}

export async function importDebugReplayBundle(bundle: unknown): Promise<DebugReplayImportSummary> {
  const response = await apiClient.post<DebugReplayImportSummary>(
    '/api/online/admin/debug-replay/import',
    { bundle }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '导入调试回放包失败');
  }
  return response.data;
}

export async function fetchDebugReplayTimeline(bundleId: string): Promise<DebugReplayTimelineView> {
  const response = await apiClient.get<DebugReplayTimelineView>(
    `/api/online/admin/debug-replay/${encodeURIComponent(bundleId)}/timeline`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取调试回放时间线失败');
  }
  return response.data;
}

export async function fetchDebugReplayCheckpoint(
  bundleId: string,
  checkpointSeq: number,
  viewerSeat: 'FIRST' | 'SECOND'
): Promise<DebugReplayCheckpointView> {
  const response = await apiClient.get<DebugReplayCheckpointView>(
    `/api/online/admin/debug-replay/${encodeURIComponent(bundleId)}/checkpoints/${checkpointSeq}?viewerSeat=${viewerSeat}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取调试回放检查点失败');
  }
  return response.data;
}

export async function advanceOnlineMatchPhase(matchId: string): Promise<OnlineCommandResult> {
  const response = await apiClient.post<OnlineCommandResult>(
    `/api/online/matches/${encodeURIComponent(matchId)}/advance`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '联机阶段推进失败');
  }
  return response.data;
}
