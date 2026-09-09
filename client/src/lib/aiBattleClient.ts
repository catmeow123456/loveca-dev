import type { GameCommand } from '@game/application/game-commands';
import type {
  OnlineCommandResult,
  OnlineMatchSnapshotResponse,
  PublicEventsResponse,
} from '@game/online';
import type {
  AiBattlePresetChoice,
  AiBattleSessionView,
  CreateAiBattleInput,
  CreateAiBattleResult,
} from '@game/online/ai-battle-types';
import type { AiTraceExport, AiTraceListing } from '@game/online/ai-battle-observation-types';
import { fromTransport, toTransport } from '@game/online/serde';
import { apiClient, toApiClientError, type ApiResponse } from './apiClient';

const ROOT = '/api/admin/ai-battle';
const sessionPath = (id: string) => `${ROOT}/sessions/${encodeURIComponent(id)}`;
async function data<T>(request: Promise<ApiResponse<T>>): Promise<T> {
  const response = await request;
  if (response.data === null) throw toApiClientError(response, 'AI 调试请求失败');
  return fromTransport<T>(response.data);
}

export const fetchAiBattlePresets = () =>
  data(apiClient.get<readonly AiBattlePresetChoice[]>(`${ROOT}/presets`));
export const fetchAiBattleSessions = () =>
  data(apiClient.get<readonly AiBattleSessionView[]>(`${ROOT}/sessions`));
export const createAiBattle = (input: CreateAiBattleInput) =>
  data(apiClient.post<CreateAiBattleResult>(`${ROOT}/sessions`, input));
export const fetchAiBattleSession = (id: string) =>
  data(apiClient.get<AiBattleSessionView>(sessionPath(id)));
export const endAiBattle = (id: string) =>
  data(apiClient.post<AiBattleSessionView>(`${sessionPath(id)}/end`));
export const fetchAiBattleSnapshot = (id: string, sinceSeq?: number) =>
  data(
    apiClient.get<OnlineMatchSnapshotResponse>(
      `${sessionPath(id)}/snapshot${sinceSeq === undefined ? '' : `?sinceSeq=${sinceSeq}`}`
    )
  );
export const fetchAiBattlePublicEvents = (id: string, afterSeq?: number) =>
  data(
    apiClient.get<PublicEventsResponse>(
      `${sessionPath(id)}/public-events${afterSeq === undefined ? '' : `?afterSeq=${afterSeq}`}`
    )
  );
export const executeAiBattleCommand = (id: string, command: GameCommand) =>
  data(
    apiClient.post<OnlineCommandResult>(`${sessionPath(id)}/command`, {
      command: toTransport(command),
    })
  );
export const advanceAiBattlePhase = (id: string) =>
  data(apiClient.post<OnlineCommandResult>(`${sessionPath(id)}/advance`));
export const fetchAiDecisions = (id: string, signal?: AbortSignal) =>
  data(apiClient.get<AiTraceListing>(`${sessionPath(id)}/decisions`, { signal }));
export const fetchAiDecision = (id: string, decisionId: string, signal?: AbortSignal) =>
  data(
    apiClient.get<AiTraceExport>(`${sessionPath(id)}/decisions/${encodeURIComponent(decisionId)}`, {
      signal,
    })
  );
export async function exportAiBattle(id: string): Promise<Blob> {
  const response = await apiClient.getBlob(`${sessionPath(id)}/export`);
  if (!response.data) throw toApiClientError(response, '导出 AI 调试材料失败');
  return response.data;
}
