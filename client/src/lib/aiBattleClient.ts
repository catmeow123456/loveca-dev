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
  readonly executionStatus: 'ACCEPTED' | 'REJECTED' | 'STALE' | null;
}

export interface AiBattleDebugTraceView {
  readonly schemaVersion: 'ai-battle.debug-trace/v1';
  readonly enabled: boolean;
  readonly matchId: string;
  readonly currentSeq: number;
  readonly truncated: boolean;
  readonly entries: readonly AiBattleDebugTraceEntry[];
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

const AI_BATTLE_MATCH_STORAGE_KEY = 'loveca.ai-battle.match.v1';

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

export function storeAiBattleMatchId(matchId: string): void {
  window.sessionStorage.setItem(AI_BATTLE_MATCH_STORAGE_KEY, matchId);
}

export function readStoredAiBattleMatchId(): string | null {
  return window.sessionStorage.getItem(AI_BATTLE_MATCH_STORAGE_KEY);
}

export function clearStoredAiBattleMatchId(matchId?: string): void {
  if (matchId && window.sessionStorage.getItem(AI_BATTLE_MATCH_STORAGE_KEY) !== matchId) return;
  window.sessionStorage.removeItem(AI_BATTLE_MATCH_STORAGE_KEY);
}
