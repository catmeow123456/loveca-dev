import { apiClient, getAccessToken, getApiBaseUrl } from '@/lib/apiClient';
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
  OnlineMatchSnapshot,
  OnlineMatchSnapshotResponse,
  OnlineRoomView,
  TurnOrderProposalMode,
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

export async function proposeTurnOrder(
  roomCode: string,
  proposal: TurnOrderProposalMode
): Promise<OnlineRoomView> {
  const response = await apiClient.post<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/turn-order-proposal`,
    { proposal }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '提交先后手提议失败');
  }
  return response.data;
}

export async function respondTurnOrder(
  roomCode: string,
  accepted: boolean
): Promise<OnlineRoomView> {
  const response = await apiClient.post<OnlineRoomView>(
    `/api/online/rooms/${encodeURIComponent(roomCode)}/turn-order-response`,
    { accepted }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '响应先后手提议失败');
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
  const snapshot = response.data;
  return isSnapshotNotModified(snapshot) ? null : snapshot;
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

export async function acceptOnlineUndoRequest(
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

export async function fetchMatchRecordDetail(matchId: string): Promise<MatchRecordDetailView> {
  const response = await apiClient.get<MatchRecordDetailView>(
    `/api/battle/match-records/${encodeURIComponent(matchId)}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取历史对局详情失败');
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
