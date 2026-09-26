/**
 * AI 对战模型唯一数据真源（single source of truth）。
 *
 * 新增/修改模型只改本文件：模型 id 列表、计费价格快照（北京列表价）、缓存计费模式、
 * 供应商与思考模式声明都在这里。`API_MODEL_METADATA` 的 `satisfies Record` 保证
 * 列表中每个 API 模型都必须有计费条目（且不允许多余条目），漏配会在编译期报错。
 *
 * 供应商的 endpoint / api key 数值不在本表：dashscope 走平台 AI 上游配置
 * （ai-effect-extraction-service，数据库加密存储、管理后台可编辑）；local-codex 走
 * 本地环境变量（AI_BATTLE_LOCAL_CODEX 等）。本表只声明各模型的解析来源。
 */
import type { AiTokenUsage } from './ai-battle-billing-types.js';

// —— 模型 id 列表 ——
export const API_AI_BATTLE_MODELS = [
  'qwen3.8-flash',
  'qwen3.8-max',
  'glm-5.3',
  'glm-5.2',
  'deepseek-v4.1-flash',
] as const;
export const CODEX_AI_REASONING_EFFORTS = ['low', 'medium'] as const;
export type CodexAiReasoningEffort = (typeof CODEX_AI_REASONING_EFFORTS)[number];
export const DEFAULT_CODEX_AI_BATTLE_MODEL = 'codex:gpt-6-luna' as const;
export const CODEX_AI_BATTLE_MODELS = [
  DEFAULT_CODEX_AI_BATTLE_MODEL,
  'codex:gpt-6-sol',
  'codex:gpt-6-astra',
] as const;
export const AI_BATTLE_MODELS = [...API_AI_BATTLE_MODELS, ...CODEX_AI_BATTLE_MODELS] as const;
export type ApiAiBattleModel = (typeof API_AI_BATTLE_MODELS)[number];
export type CodexAiBattleModel = (typeof CODEX_AI_BATTLE_MODELS)[number];
export function isCodexAiBattleModel(model: string): model is CodexAiBattleModel {
  return (CODEX_AI_BATTLE_MODELS as readonly string[]).includes(model);
}
export type AiBattleModel = (typeof AI_BATTLE_MODELS)[number];

// —— 每模型计费快照：北京列表价，CNY 分 / 百万 token ——
// 价格来源：https://help.aliyun.com/zh/model-studio/billing/
// 缓存计费规则：https://help.aliyun.com/zh/model-studio/context-cache
export interface AiApiModelMetadata {
  readonly pricingDate: string;
  readonly prices: AiTokenUsage;
  /** implicit-only：仅支持隐式缓存，显式缓存用量按未知处理（parseAiTokenUsage 拒绝）。 */
  readonly cacheBilling: 'implicit-only' | 'explicit-supported';
  /** true：费用按北京忙时价预估，闲时实际可能更低（管理页提示）。 */
  readonly peakPriceOnly?: boolean;
}
export const API_MODEL_METADATA: Readonly<Record<ApiAiBattleModel, AiApiModelMetadata>> = {
  'qwen3.8-max': {
    pricingDate: '2026-09-11',
    prices: {
      inputTokens: 1200,
      implicitCachedTokens: 150,
      explicitCachedTokens: 100,
      cacheCreationTokens: 1500,
      outputTokens: 3600,
    },
    cacheBilling: 'explicit-supported',
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
    cacheBilling: 'explicit-supported',
  },
  'glm-5.3': {
    pricingDate: '2026-09-18',
    prices: {
      inputTokens: 800,
      implicitCachedTokens: 200,
      // Unsupported buckets; parseAiTokenUsage rejects explicit-cache usage for this model.
      explicitCachedTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 2800,
    },
    cacheBilling: 'implicit-only',
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
    cacheBilling: 'implicit-only',
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
    cacheBilling: 'implicit-only',
    peakPriceOnly: true,
  },
};

// —— 供应商声明：各模型的 endpoint / api key 解析来源 ——
export const AI_MODEL_PROVIDERS = {
  dashscope: {
    transport: 'chat-completions',
    upstream: 'platform-ai-configuration',
    thinkingControl: 'enable_thinking',
  },
  'local-codex': {
    transport: 'codex-cli',
    upstream: 'local-env',
    thinkingControl: 'reasoning-effort',
  },
} as const;
export type AiModelProviderId = keyof typeof AI_MODEL_PROVIDERS;
/** 每个 API 模型统一经由 DashScope 兼容上游（平台 AI 配置）；Codex 模型走本地 CLI。 */
export const API_MODEL_PROVIDER: AiModelProviderId = 'dashscope';
export const CODEX_MODEL_PROVIDER: AiModelProviderId = 'local-codex';
