import type { OnlineMatchSnapshot, Seat } from '@game/online';
import { apiClient, toApiClientError } from '@/lib/apiClient';

export type AiBattleDeckKey = 'MUSE_STARTER' | 'GREEN_HASUNOSORA_B6';

export interface AiBattlePublicConfig {
  readonly schemaVersion: 'ai-battle.public-entry-config/v1';
  readonly available: boolean;
  readonly debugTraceEnabled: boolean;
  readonly opponent: {
    readonly displayName: 'Loveca AI';
    readonly participantKind: 'SYSTEM';
    readonly modelId: string;
    readonly strategy: 'SERVER_MODEL_WITH_CONSERVATIVE_FALLBACK';
    readonly chatUsedAsModelInput: false;
  };
  readonly decks: readonly {
    readonly deckKey: AiBattleDeckKey;
    readonly displayName: string;
    readonly description: string;
  }[];
  readonly seats: readonly Seat[];
}

export interface AiBattleDebugTraceEntry {
  readonly seq: number;
  readonly createdAt: number;
  readonly stage: 'STARTED' | 'COMPLETED';
  readonly decisionKind: string;
  readonly authorityRevision: number;
  readonly source: 'RULE' | 'MODEL' | 'CONSERVATIVE_FALLBACK';
  readonly tier: string | null;
  readonly reasonCode: string | null;
  readonly summary: string;
  readonly selection: {
    readonly kind: string;
    readonly selectedCount: number;
    readonly label: string;
  } | null;
  readonly model: {
    readonly modelId: string;
    readonly finalOutcome: 'MODEL_SELECTION' | 'CONSERVATIVE_FALLBACK' | 'CANCELLED';
    readonly attemptCount: number;
    readonly outcomes: readonly string[];
    readonly totalLatencyMs: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly estimatedCostMicrosCny: number;
  } | null;
  readonly modelContext: {
    readonly attempts: readonly {
      readonly attemptNumber: 1 | 2;
      readonly attemptKind: 'INITIAL' | 'REPAIR' | 'RETRY';
      readonly failureCode: string | null;
      readonly requestSha256: string;
      readonly requestEnvelopeVersion: string;
      readonly promptVersion: string;
      readonly outputSchemaVersion: string;
      readonly systemMessage: string;
      readonly userMessage: string;
      readonly parsedOutput: {
        readonly selection: Readonly<Record<string, unknown>> & { readonly kind: string };
        readonly tradeoff: string | null;
        readonly nextPlan: string | null;
      } | null;
      readonly outcome: string;
    }[];
  } | null;
  readonly executionStatus: 'ACCEPTED' | 'REJECTED' | 'STALE' | null;
}

export interface AiBattleDebugTraceView {
  readonly schemaVersion: 'ai-battle.debug-trace/v2';
  readonly enabled: boolean;
  readonly matchId: string;
  readonly currentSeq: number;
  readonly truncated: boolean;
  readonly entries: readonly AiBattleDebugTraceEntry[];
}

export interface AiBattleHistoryDocumentDownload {
  readonly schemaVersion: 'ai-battle.reflection-document-download/v1';
  readonly filename: string;
  readonly mediaType: 'text/markdown;charset=utf-8';
  readonly generatedAt: number;
  readonly decisionCount: number;
  readonly content: string;
}

export interface AiBattleView {
  readonly schemaVersion: 'ai-battle.phase-four-entry/v1';
  readonly matchId: string;
  readonly roomCode: string;
  readonly humanSeat: Seat;
  readonly systemSeat: Seat;
  readonly humanDeckKey: AiBattleDeckKey;
  readonly aiDeckKey: AiBattleDeckKey;
  readonly snapshot: OnlineMatchSnapshot;
}

export interface CreateAiBattleInput {
  readonly humanDeckKey: AiBattleDeckKey;
  readonly aiDeckKey: AiBattleDeckKey;
  readonly aiSeat: Seat;
}

export async function fetchAiBattlePublicConfig(): Promise<AiBattlePublicConfig> {
  const response = await apiClient.get<AiBattlePublicConfig>('/api/online/ai-battles/config');
  if (!response.data) throw toApiClientError(response, '读取 AI 对战配置失败');
  return response.data;
}

export async function createAiBattle(input: CreateAiBattleInput): Promise<AiBattleView> {
  const response = await apiClient.post<AiBattleView>('/api/online/ai-battles', input);
  if (!response.data) throw toApiClientError(response, '创建 AI 对局失败');
  return response.data;
}

export async function fetchCurrentAiBattle(): Promise<AiBattleView | null> {
  const response = await apiClient.get<AiBattleView | null>('/api/online/ai-battles/current');
  if (response.error) throw toApiClientError(response, '检查当前 AI 对局失败');
  return response.data;
}

export async function fetchAiBattle(matchId: string): Promise<AiBattleView> {
  const response = await apiClient.get<AiBattleView>(
    `/api/online/ai-battles/${encodeURIComponent(matchId)}`
  );
  if (!response.data) throw toApiClientError(response, '恢复 AI 对局失败');
  return response.data;
}

export async function fetchAiBattleDebugTrace(
  matchId: string,
  afterSeq = 0
): Promise<AiBattleDebugTraceView> {
  const response = await apiClient.get<AiBattleDebugTraceView>(
    `/api/online/ai-battles/${encodeURIComponent(matchId)}/debug-trace?afterSeq=${String(afterSeq)}`
  );
  if (!response.data) throw toApiClientError(response, '读取 AI 调试轨迹失败');
  return response.data;
}

export async function fetchAiBattleHistoryDocument(
  matchId: string
): Promise<AiBattleHistoryDocumentDownload> {
  const response = await apiClient.get<AiBattleHistoryDocumentDownload>(
    `/api/online/ai-battles/${encodeURIComponent(matchId)}/history-document`
  );
  if (!response.data) throw toApiClientError(response, '导出 AI 对战历史失败');
  return response.data;
}

export async function restartAiBattle(matchId: string): Promise<AiBattleView> {
  const response = await apiClient.post<AiBattleView>(
    `/api/online/ai-battles/${encodeURIComponent(matchId)}/restart`
  );
  if (!response.data) throw toApiClientError(response, '重新开始 AI 对局失败');
  return response.data;
}

export async function leaveAiBattle(matchId: string): Promise<void> {
  const response = await apiClient.post<{ readonly left: true }>(
    `/api/online/ai-battles/${encodeURIComponent(matchId)}/leave`
  );
  if (!response.data?.left) throw toApiClientError(response, '离开 AI 对局失败');
}
