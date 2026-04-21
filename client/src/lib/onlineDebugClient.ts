import { apiClient } from '@/lib/apiClient';
import type {
  DebugCommandResult,
  DebugMatchSnapshot,
  DebugMatchStatus,
  DebugSeatDeckSelection,
  Seat,
} from '@game/online';
import { fromTransport, toTransport } from '@game/online';
import type { GameCommand } from '@game/application/game-commands';

export async function fetchOnlineDebugStatus(matchId: string): Promise<DebugMatchStatus> {
  const response = await apiClient.get<DebugMatchStatus>(`/api/debug/matches/${encodeURIComponent(matchId)}`);
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取调试对局状态失败');
  }
  return response.data;
}

export async function selectOnlineDebugDeck(
  matchId: string,
  selection: DebugSeatDeckSelection
): Promise<DebugMatchStatus> {
  const response = await apiClient.post<unknown>(
    `/api/debug/matches/${encodeURIComponent(matchId)}/seat`,
    toTransport(selection)
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '锁定调试卡组失败');
  }
  return fromTransport<DebugMatchStatus>(response.data);
}

export async function resetOnlineDebugMatch(matchId: string): Promise<DebugMatchStatus> {
  const response = await apiClient.post<DebugMatchStatus>(
    `/api/debug/matches/${encodeURIComponent(matchId)}/reset`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '重置调试对局失败');
  }
  return response.data;
}

export async function fetchOnlineDebugSnapshot(
  matchId: string,
  seat: Seat
): Promise<DebugMatchSnapshot> {
  const response = await apiClient.get<unknown>(
    `/api/debug/matches/${encodeURIComponent(matchId)}/snapshot?seat=${seat}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取调试对局快照失败');
  }
  return fromTransport<DebugMatchSnapshot>(response.data);
}

export async function executeOnlineDebugCommand(
  matchId: string,
  seat: Seat,
  command: GameCommand
): Promise<DebugCommandResult> {
  const response = await apiClient.post<unknown>(
    `/api/debug/matches/${encodeURIComponent(matchId)}/command`,
    {
      seat,
      command: toTransport(command),
    }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '调试命令发送失败');
  }
  return fromTransport<DebugCommandResult>(response.data);
}

export async function advanceOnlineDebugPhase(
  matchId: string,
  seat: Seat
): Promise<DebugCommandResult> {
  const response = await apiClient.post<unknown>(
    `/api/debug/matches/${encodeURIComponent(matchId)}/advance`,
    { seat }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '阶段推进失败');
  }
  return fromTransport<DebugCommandResult>(response.data);
}
