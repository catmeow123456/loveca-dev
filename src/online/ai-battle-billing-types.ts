/** API models use reviewed Beijing prices; local Codex models use subscription accounting. */
export const API_AI_BATTLE_MODELS = [
  'qwen3.8-flash',
  'qwen3.8-max',
  'glm-5.2',
  'deepseek-v4.1-flash',
] as const;
export const CODEX_AI_REASONING_EFFORTS = ['low', 'medium'] as const;
export type CodexAiReasoningEffort = (typeof CODEX_AI_REASONING_EFFORTS)[number];
export const DEFAULT_CODEX_AI_BATTLE_MODEL = 'codex:gpt-5.6-luna' as const;
export const CODEX_AI_BATTLE_MODELS = [
  DEFAULT_CODEX_AI_BATTLE_MODEL,
  'codex:gpt-6-astra',
  'codex:gpt-5.6-terra',
  'codex:gpt-5.6-sol',
] as const;
export const AI_BATTLE_MODELS = [...API_AI_BATTLE_MODELS, ...CODEX_AI_BATTLE_MODELS] as const;
export type ApiAiBattleModel = (typeof API_AI_BATTLE_MODELS)[number];
export type CodexAiBattleModel = (typeof CODEX_AI_BATTLE_MODELS)[number];
export function isCodexAiBattleModel(model: string): model is CodexAiBattleModel {
  return (CODEX_AI_BATTLE_MODELS as readonly string[]).includes(model);
}
export type AiBattleModel = (typeof AI_BATTLE_MODELS)[number];

/** Mutually exclusive token buckets; inputTokens excludes cache reads and creation. */
export interface AiTokenUsage {
  readonly inputTokens: number;
  readonly implicitCachedTokens: number;
  readonly explicitCachedTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
}

export interface AiBillingTotals {
  readonly attempts: number;
  readonly reportedAttempts: number;
  readonly usage: AiTokenUsage;
}

/** Persistent facts, independent of diagnostic retention and game checkpoints. */
export interface AiBillingRecord extends AiBillingTotals {
  readonly revision: number;
  readonly model: AiBattleModel;
  readonly pricingDate: string | null;
  /** Beijing CNY cents per million tokens; null for subscription calls. */
  readonly prices: AiTokenUsage | null;
}

export interface AiBillingSummary extends AiBillingTotals {
  readonly pendingAttempts: number;
  /**
   * Derived: attempts − reportedAttempts. `> 0`（即 reportedAttempts < attempts）表示存在
   * 未确认用量（其中 pendingAttempts 为仍在途的待统计尝试）。仅由投影/汇总计算，
   * 从不写入 `match_records.ai_billing`，旧记录随时可由两个持久计数重算，保持向后兼容。
   */
  readonly unreportedAttempts: number;
  /** null denotes ChatGPT subscription usage; never a zero-price API estimate. */
  readonly estimatedCny: string | null;
  readonly saveFailed: boolean;
}

export interface AiMatchBilling extends AiBillingRecord, AiBillingSummary {}

export interface AiRecordedBillingResponse {
  readonly matchBilling: AiMatchBilling | null;
}

/** Local, per-game test limits; not a subscription quota or persistent billing format. */
export interface CodexBattleBudget {
  readonly maxCalls?: number;
  readonly maxInputTokens?: number;
  readonly maxUncachedInputTokens?: number;
  readonly maxOutputTokens?: number;
}
