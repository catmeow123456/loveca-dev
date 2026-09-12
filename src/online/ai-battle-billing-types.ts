/** Supported AI battle models. Extending this list also requires a reviewed Beijing price. */
export const AI_BATTLE_MODELS = ['qwen3.8-flash', 'qwen3.8-max'] as const;
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
  readonly pricingDate: string;
  /** Beijing CNY cents per million tokens; integer rates preserve sub-cent costs. */
  readonly prices: AiTokenUsage;
}

export interface AiBillingSummary extends AiBillingTotals {
  readonly pendingAttempts: number;
  /**
   * Derived: attempts − reportedAttempts. `> 0`（即 reportedAttempts < attempts）表示存在
   * 未确认用量（其中 pendingAttempts 为仍在途的待统计尝试）。仅由投影/汇总计算，
   * 从不写入 `match_records.ai_billing`，旧记录随时可由两个持久计数重算，保持向后兼容。
   */
  readonly unreportedAttempts: number;
  readonly estimatedCny: string;
  readonly saveFailed: boolean;
}

export interface AiMatchBilling extends AiBillingRecord, AiBillingSummary {}

export interface AiRecordedBillingResponse {
  readonly matchBilling: AiMatchBilling | null;
}
