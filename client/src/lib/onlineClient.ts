import { apiClient, getAccessToken, getApiBaseUrl } from '@/lib/apiClient';
import type {
  OnlineAdminRoomSummary,
  OnlineCommandResult,
  OnlineMatchSnapshot,
  OnlineMatchSnapshotResponse,
  OnlineRoomView,
  TurnOrderProposalMode,
} from '@game/online';
import { fromTransport, toTransport } from '@game/online';
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
  const response = await apiClient.get<unknown>(
    `/api/online/matches/${encodeURIComponent(matchId)}/snapshot${search}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取联机对局快照失败');
  }
  const snapshot = fromTransport<OnlineMatchSnapshotResponse>(response.data);
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
  const response = await apiClient.post<unknown>(
    `/api/online/matches/${encodeURIComponent(matchId)}/command`,
    { command: toTransport(command) }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '联机命令发送失败');
  }
  return fromTransport<OnlineCommandResult>(response.data);
}

export async function fetchOnlineAdminRooms(): Promise<readonly OnlineAdminRoomSummary[]> {
  const response = await apiClient.get<OnlineAdminRoomSummary[]>('/api/online/admin/rooms');
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取联机房间监控数据失败');
  }
  return response.data;
}

export async function advanceOnlineMatchPhase(matchId: string): Promise<OnlineCommandResult> {
  const response = await apiClient.post<unknown>(
    `/api/online/matches/${encodeURIComponent(matchId)}/advance`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '联机阶段推进失败');
  }
  return fromTransport<OnlineCommandResult>(response.data);
}
