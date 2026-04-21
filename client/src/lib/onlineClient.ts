import { apiClient, getAccessToken, getApiBaseUrl } from '@/lib/apiClient';
import type {
  OnlineCommandResult,
  OnlineMatchSnapshot,
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

export async function lockOnlineRoomDeck(roomCode: string, deckId: string): Promise<OnlineRoomView> {
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

export async function leaveOnlineRoom(
  roomCode: string
): Promise<{ room: OnlineRoomView | null }> {
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

export async function fetchOnlineMatchSnapshot(matchId: string): Promise<OnlineMatchSnapshot> {
  const response = await apiClient.get<unknown>(
    `/api/online/matches/${encodeURIComponent(matchId)}/snapshot`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取联机对局快照失败');
  }
  return fromTransport<OnlineMatchSnapshot>(response.data);
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

export async function advanceOnlineMatchPhase(matchId: string): Promise<OnlineCommandResult> {
  const response = await apiClient.post<unknown>(
    `/api/online/matches/${encodeURIComponent(matchId)}/advance`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '联机阶段推进失败');
  }
  return fromTransport<OnlineCommandResult>(response.data);
}
