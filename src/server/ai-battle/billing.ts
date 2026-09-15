import { z } from 'zod';
import {
  isCodexAiBattleModel,
  type ApiAiBattleModel,
} from '../../online/ai-battle-billing-types.js';
import type {
  AiBattleModel,
  AiBillingRecord,
  AiBillingSummary,
  AiBillingTotals,
  AiMatchBilling,
  AiTokenUsage,
} from '../../online/ai-battle-billing-types.js';

// Beijing list prices. CNY cents / 1M tokens, not discount ratios.
// https://help.aliyun.com/zh/model-studio/qwen3-8-max
// https://help.aliyun.com/zh/model-studio/qwen3-8-flash
// https://help.aliyun.com/zh/model-studio/model-pricing
// https://help.aliyun.com/zh/model-studio/context-cache
const PRICING: Readonly<Record<ApiAiBattleModel, { pricingDate: string; prices: AiTokenUsage }>> = {
  'qwen3.8-max': {
    pricingDate: '2026-09-11',
    prices: {
      inputTokens: 1200,
      implicitCachedTokens: 150,
      explicitCachedTokens: 100,
      cacheCreationTokens: 1500,
      outputTokens: 3600,
    },
  },
  'qwen3.8-flash': {
    pricingDate: '2026-09-11',
    prices: {
      inputTokens: 80,
      implicitCachedTokens: 10,
      explicitCachedTokens: 10,
      cacheCreationTokens: 125,
      outputTokens: 270,
    },
  },
  'glm-5.2': {
    pricingDate: '2026-09-14',
    prices: {
      inputTokens: 800,
      implicitCachedTokens: 200,
      // Unsupported buckets; parseAiTokenUsage rejects explicit-cache usage for this model.
      explicitCachedTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 2800,
    },
  },
  'deepseek-v4.1-flash': {
    pricingDate: '2026-09-14',
    // Freeze Beijing peak list prices for estimates; off-peak discounts are not applied.
    prices: {
      inputTokens: 200,
      implicitCachedTokens: 20,
      // Unsupported buckets; parseAiTokenUsage rejects explicit-cache usage for this model.
      explicitCachedTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 800,
    },
  },
};

export const emptyAiTokenUsage = (): AiTokenUsage => ({
  inputTokens: 0,
  implicitCachedTokens: 0,
  explicitCachedTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
});

export function createAiBillingRecord(model: AiBattleModel): AiBillingRecord {
  return {
    revision: 0,
    model,
    pricingDate: isCodexAiBattleModel(model) ? null : PRICING[model].pricingDate,
    prices: isCodexAiBattleModel(model) ? null : { ...PRICING[model].prices },
    attempts: 0,
    reportedAttempts: 0,
    usage: emptyAiTokenUsage(),
  };
}

export function addAiTokenUsage(a: AiTokenUsage, b: AiTokenUsage): AiTokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    implicitCachedTokens: a.implicitCachedTokens + b.implicitCachedTokens,
    explicitCachedTokens: a.explicitCachedTokens + b.explicitCachedTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

export function calculateAiCost(usage: AiTokenUsage, prices: AiTokenUsage | null): string | null {
  if (prices === null) return null;
  let units = 0n;
  for (const key of Object.keys(usage) as (keyof AiTokenUsage)[])
    units += BigInt(usage[key]) * BigInt(prices[key]);
  // One unit is 10^-8 CNY. Do not round individual requests before accumulating.
  return `${units / 100_000_000n}.${(units % 100_000_000n).toString().padStart(8, '0')}`;
}

const token = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema = z.object({
  prompt_tokens: token,
  completion_tokens: token,
  prompt_tokens_details: z.object({
    cached_tokens: token,
    cache_creation_input_tokens: token.optional(),
    cache_type: z.literal('ephemeral').optional(),
  }),
});

/** Only the current DashScope Chat Completions usage contract. No protocol fallbacks. */
export function parseAiTokenUsage(value: unknown, model: AiBattleModel): AiTokenUsage | null {
  const parsed = usageSchema.safeParse(value);
  if (!parsed.success) return null;
  const {
    prompt_tokens: total,
    completion_tokens: output,
    prompt_tokens_details: details,
  } = parsed.data;
  const explicit = details.cache_type === 'ephemeral';
  // These models support implicit caching only; explicit reports have no reviewed price.
  if (explicit && (model === 'glm-5.2' || model === 'deepseek-v4.1-flash')) return null;
  if (explicit && details.cache_creation_input_tokens === undefined) return null;
  const created = details.cache_creation_input_tokens ?? 0;
  const cached = details.cached_tokens;
  if ((!explicit && created !== 0) || cached > total || created > total - cached) return null;
  return {
    inputTokens: total - cached - created,
    implicitCachedTokens: explicit ? 0 : cached,
    explicitCachedTokens: explicit ? cached : 0,
    cacheCreationTokens: created,
    outputTokens: output,
  };
}

export interface AiBillingDelta {
  readonly attempts?: number;
  readonly reportedAttempts?: number;
  readonly pendingAttempts?: number;
  readonly usage?: AiTokenUsage;
}

export function updateAiBillingSummary(
  previous: AiBillingSummary | null,
  delta: AiBillingDelta,
  prices: AiTokenUsage | null
): AiBillingSummary {
  const usage = addAiTokenUsage(
    previous?.usage ?? emptyAiTokenUsage(),
    delta.usage ?? emptyAiTokenUsage()
  );
  const attempts = (previous?.attempts ?? 0) + (delta.attempts ?? 0);
  const reportedAttempts = (previous?.reportedAttempts ?? 0) + (delta.reportedAttempts ?? 0);
  return {
    usage,
    attempts,
    reportedAttempts,
    unreportedAttempts: attempts - reportedAttempts,
    pendingAttempts: (previous?.pendingAttempts ?? 0) + (delta.pendingAttempts ?? 0),
    estimatedCny: calculateAiCost(usage, prices),
    saveFailed: false,
  };
}

export function projectAiBilling(
  record: AiBillingRecord,
  pendingAttempts = 0,
  saveFailed = false
): AiMatchBilling {
  return {
    ...record,
    pendingAttempts,
    saveFailed,
    // Derived from the two persisted counters; never stored in the jsonb record itself.
    unreportedAttempts: record.attempts - record.reportedAttempts,
    estimatedCny: calculateAiCost(record.usage, record.prices),
  };
}

/**
 * Log-safe error facts. Driver/DB messages can embed connection URLs; stack frames and
 * query parameters must never reach logs. Mirrors the project `safeError` pattern.
 */
export function safeAiErrorForLog(error: unknown): {
  readonly name: string;
  readonly message: string;
} {
  const message = (error instanceof Error ? error.message : String(error)).replace(
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi,
    '[REDACTED_URL]'
  );
  return { name: error instanceof Error ? error.name : 'UnknownError', message };
}

export interface AiBillingPersistence {
  save(matchId: string, record: AiBillingRecord): Promise<void>;
  readOwned(matchId: string, ownerUserId: string): Promise<AiBillingRecord | null | undefined>;
}

/** One game's cumulative facts. Individual requests live only in their HTTP callback closures. */
export class AiBattleBilling {
  private record: AiBillingRecord;
  private matchId: string | null = null;
  private pendingAttempts = 0;
  private saveFailed = false;
  private writes: Promise<void> = Promise.resolve();

  constructor(
    model: AiBattleModel,
    private readonly persistence: AiBillingPersistence,
    private readonly changed: (
      matchId: string,
      billing: AiMatchBilling,
      decisionId?: string,
      delta?: AiBillingDelta
    ) => void
  ) {
    this.record = createAiBillingRecord(model);
  }

  async initialize(matchId: string): Promise<void> {
    this.matchId = matchId;
    if (!(await this.flush())) throw new Error('AI 计费记录初始化失败');
  }

  view(): AiMatchBilling {
    return globalThis.structuredClone(
      projectAiBilling(this.record, this.pendingAttempts, this.saveFailed)
    );
  }

  async begin(decisionId: string): Promise<{
    interrupt(): void;
    cancelBeforeSend(): Promise<void>;
    finish(usage: AiTokenUsage | null): Promise<void>;
  }> {
    if (this.saveFailed && !(await this.flush())) throw new Error('AI 计费保存失败，已停止新请求');
    this.update(decisionId, { attempts: 1, pendingAttempts: 1 });
    if (!(await this.flush())) {
      this.update(decisionId, { attempts: -1, pendingAttempts: -1 });
      // Save the unsent cancellation too; never dispatch a request whose accounting failed.
      await this.flush();
      throw new Error('AI 计费保存失败，未发送模型请求');
    }
    let pending = true;
    let finished = false;
    return {
      interrupt: () => {
        if (!pending || finished) return;
        pending = false;
        this.update(decisionId, { pendingAttempts: -1 });
      },
      cancelBeforeSend: async () => {
        if (finished) return;
        finished = true;
        this.update(decisionId, { attempts: -1, pendingAttempts: pending ? -1 : 0 });
        pending = false;
        await this.flush();
      },
      finish: async (usage) => {
        if (finished) return;
        finished = true;
        this.update(decisionId, {
          pendingAttempts: pending ? -1 : 0,
          reportedAttempts: usage ? 1 : 0,
          ...(usage ? { usage } : {}),
        });
        pending = false;
        await this.flush();
      },
    };
  }

  private update(decisionId: string, delta: AiBillingDelta): void {
    const totals: AiBillingTotals = {
      attempts: this.record.attempts + (delta.attempts ?? 0),
      reportedAttempts: this.record.reportedAttempts + (delta.reportedAttempts ?? 0),
      usage: addAiTokenUsage(this.record.usage, delta.usage ?? emptyAiTokenUsage()),
    };
    this.record = { ...this.record, ...totals, revision: this.record.revision + 1 };
    this.pendingAttempts += delta.pendingAttempts ?? 0;
    this.changed(this.matchId!, this.view(), decisionId, delta);
  }

  async flush(): Promise<boolean> {
    const matchId = this.matchId;
    if (!matchId) throw new Error('AI billing is not initialized');
    const snapshot = globalThis.structuredClone(this.record);
    const write = this.writes.then(async () => {
      // A write retry repeats only this absolute snapshot, never an HTTP call or game command.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await this.persistence.save(matchId, snapshot);
          this.saveFailed = false;
          this.changed(matchId, this.view());
          return true;
        } catch (error) {
          this.saveFailed = true;
          // Keep the degraded saveFailed path, but do not lose the reason: log sanitized
          // facts only (no stack, no query parameters, connection URLs redacted).
          console.warn('[AiBilling] 计费快照保存失败', {
            matchId,
            revision: snapshot.revision,
            ...safeAiErrorForLog(error),
          });
        }
      }
      this.changed(matchId, this.view());
      return false;
    });
    this.writes = write.then(() => undefined);
    return write;
  }
}
