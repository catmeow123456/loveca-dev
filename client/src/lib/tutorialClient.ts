import type { GameCommand } from '@game/application/game-commands';
import type {
  RemoteCommandResult,
  RemoteMatchSnapshot,
  TutorialCommandResult,
  TutorialCheckpointId,
  TutorialScriptAdvanceResult,
  TutorialSessionSnapshot,
} from '@game/online';
import { fromTransport, toTransport } from '@game/online';
import { apiClient, type ApiResponse } from './apiClient';

export interface CreatedTutorialSession {
  readonly accessToken: string;
  readonly snapshot: TutorialSessionSnapshot;
}

function tutorialHeaders(accessToken: string): Record<string, string> {
  return { 'X-Tutorial-Token': accessToken };
}

function requireData<T>(response: ApiResponse<unknown>, fallback: string): T {
  if (!response.data) throw new Error(response.error?.message ?? fallback);
  return fromTransport<T>(response.data);
}

export async function createTutorialSession(
  scenarioId: string,
  scenarioVersion: string,
  checkpointId: TutorialCheckpointId
): Promise<CreatedTutorialSession> {
  const response = await apiClient.post<unknown>('/api/tutorial/sessions', {
    scenarioId,
    scenarioVersion,
    checkpointId,
  });
  return requireData<CreatedTutorialSession>(response, '创建教程失败');
}

export async function fetchTutorialSession(
  runId: string,
  accessToken: string
): Promise<TutorialSessionSnapshot> {
  const response = await apiClient.getWithHeaders<unknown>(
    `/api/tutorial/sessions/${encodeURIComponent(runId)}`,
    tutorialHeaders(accessToken)
  );
  return requireData<TutorialSessionSnapshot>(response, '同步教程失败');
}

export async function executeTutorialCommand(
  runId: string,
  accessToken: string,
  expectedSeq: number,
  command: GameCommand
): Promise<TutorialCommandResult> {
  const response = await apiClient.postWithHeaders<unknown>(
    `/api/tutorial/sessions/${encodeURIComponent(runId)}/commands`,
    { expectedSeq, command: toTransport(command) },
    tutorialHeaders(accessToken)
  );
  return requireData<TutorialCommandResult>(response, '提交教程操作失败');
}

export async function advanceTutorialScript(
  runId: string,
  accessToken: string,
  expectedSeq: number
): Promise<TutorialScriptAdvanceResult> {
  const response = await apiClient.postWithHeaders<unknown>(
    `/api/tutorial/sessions/${encodeURIComponent(runId)}/script/advance`,
    { expectedSeq },
    tutorialHeaders(accessToken)
  );
  return requireData<TutorialScriptAdvanceResult>(response, '推进教程对手失败');
}

export async function deleteTutorialSession(runId: string, accessToken: string): Promise<void> {
  const response = await apiClient.deleteWithHeaders<unknown>(
    `/api/tutorial/sessions/${encodeURIComponent(runId)}`,
    tutorialHeaders(accessToken)
  );
  if (!response.data) throw new Error(response.error?.message ?? '关闭教程失败');
}

export function tutorialSnapshotToRemote(snapshot: TutorialSessionSnapshot): RemoteMatchSnapshot {
  const view = snapshot.playerViewState;
  const seat = view.match.viewerSeat;
  return {
    matchId: view.match.matchId,
    seat,
    playerId: view.match.participants[seat].id,
    seq: view.match.seq,
    currentPublicSeq: view.match.seq,
    playerViewState: view,
    publicEvents: [],
  };
}

export function tutorialCommandResultToRemote(result: TutorialCommandResult): RemoteCommandResult {
  return {
    success: result.success,
    snapshot: tutorialSnapshotToRemote(result.snapshot),
  };
}
