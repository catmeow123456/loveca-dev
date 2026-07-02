import type {
  OnlineCommandResult,
  OnlineMatchSnapshot,
  OnlineMatchSnapshotResponse,
  PublicEventsResponse,
} from '@game/online';
import type { GameCommand } from '@game/application/game-commands';
import { toTransport } from '@game/online/serde';
import { apiClient } from './apiClient';

export interface CreateSolitaireMatchResult {
  readonly matchId: string;
  readonly snapshot: OnlineMatchSnapshot;
}

export async function createSolitaireMatch(deckId: string): Promise<CreateSolitaireMatchResult> {
  const response = await apiClient.post<CreateSolitaireMatchResult>(
    '/api/battle/solitaire-matches',
    {
      deckId,
    }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '创建对墙打对局失败');
  }
  return response.data;
}

export async function fetchSolitaireMatchSnapshot(
  matchId: string,
  sinceSeq?: number
): Promise<OnlineMatchSnapshot | null> {
  const search =
    sinceSeq !== undefined && Number.isSafeInteger(sinceSeq) && sinceSeq >= 0
      ? `?sinceSeq=${sinceSeq}`
      : '';
  const response = await apiClient.get<OnlineMatchSnapshotResponse>(
    `/api/battle/solitaire-matches/${encodeURIComponent(matchId)}/snapshot${search}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取对墙打快照失败');
  }
  const snapshot = response.data;
  return isSnapshotNotModified(snapshot) ? null : snapshot;
}

export async function fetchSolitaireMatchPublicEvents(
  matchId: string,
  afterSeq?: number
): Promise<PublicEventsResponse> {
  const search =
    afterSeq !== undefined && Number.isSafeInteger(afterSeq) && afterSeq >= 0
      ? `?afterSeq=${afterSeq}`
      : '';
  const response = await apiClient.get<PublicEventsResponse>(
    `/api/battle/solitaire-matches/${encodeURIComponent(matchId)}/public-events${search}`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '读取对墙打公开日志失败');
  }
  return response.data;
}

function isSnapshotNotModified(
  snapshot: OnlineMatchSnapshotResponse
): snapshot is Extract<OnlineMatchSnapshotResponse, { readonly modified: false }> {
  return 'modified' in snapshot && snapshot.modified === false;
}

export async function executeSolitaireMatchCommand(
  matchId: string,
  command: GameCommand
): Promise<OnlineCommandResult> {
  const response = await apiClient.post<OnlineCommandResult>(
    `/api/battle/solitaire-matches/${encodeURIComponent(matchId)}/command`,
    { command: toTransport(command) }
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '对墙打命令发送失败');
  }
  return response.data;
}

export async function advanceSolitaireMatchPhase(matchId: string): Promise<OnlineCommandResult> {
  const response = await apiClient.post<OnlineCommandResult>(
    `/api/battle/solitaire-matches/${encodeURIComponent(matchId)}/advance`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '对墙打阶段推进失败');
  }
  return response.data;
}

export async function undoSolitaireMatch(
  matchId: string,
  input: {
    readonly expectedRevision: number;
    readonly undoEntryId: string;
    readonly idempotencyKey?: string;
  }
): Promise<OnlineCommandResult> {
  const response = await apiClient.post<OnlineCommandResult>(
    `/api/battle/solitaire-matches/${encodeURIComponent(matchId)}/undo`,
    input
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '对墙打撤销失败');
  }
  return response.data;
}

export async function leaveSolitaireMatch(matchId: string): Promise<void> {
  const response = await apiClient.post<{ readonly left: boolean }>(
    `/api/battle/solitaire-matches/${encodeURIComponent(matchId)}/leave`
  );
  if (!response.data) {
    throw new Error(response.error?.message ?? '离开对墙打对局失败');
  }
}
