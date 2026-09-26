import {
  isCodexAiBattleModel,
  type CodexAiReasoningEffort,
} from '../../online/ai-battle-model-registry.js';
import { readLocalCodexConfig } from './local-codex-config.js';
import { createLocalCodexClient } from './codex-model-client.js';
import {
  aiEffectExtractionService,
  AiEffectExtractionServiceError,
} from '../services/ai-effect-extraction-service.js';
import { AiBattleSetupError, type AiFrozenKnowledge } from './presets.js';
import {
  AiUpstreamTransientError,
  createAiModelConfig,
  DashScopeAiBattleClient,
} from './model-client.js';
import type { AiBattleModel } from '../../online/ai-battle-model-registry.js';
import type { AiBattleTraceStore } from './trace-store.js';
import type { AiBattleBilling } from './billing.js';

/** The platform singleton is the sole upstream source, including for real-model QA scripts. */
export async function readAiModelConfig(
  model: string = process.env.AI_BATTLE_MODEL ?? 'qwen3.8-flash',
  enableThinking = false
) {
  try {
    return createAiModelConfig(
      await aiEffectExtractionService.getUpstreamConfiguration(),
      model,
      enableThinking
    );
  } catch (error) {
    if (error instanceof AiBattleSetupError) throw error;
    throw new AiBattleSetupError(
      'AI_MODEL_CONFIG_INVALID',
      error instanceof AiEffectExtractionServiceError
        ? `请检查平台 AI 上游配置：${error.message}`
        : '无法读取平台 AI 上游配置，请检查平台配置中心',
      503
    );
  }
}

/**
 * Deployment allowlist/DNS recheck before every battle request. Host-resolution failure is
 * classified as transient so the model client can bound-retry it instead of failing closed;
 * every other rejection stays a permanent adapter fault.
 */
export const validateAiUpstream = async (endpoint: string): Promise<URL> => {
  try {
    return await aiEffectExtractionService.validateOutboundUrl(endpoint);
  } catch (error) {
    if (
      error instanceof AiEffectExtractionServiceError &&
      error.code === 'AI_EFFECT_HOST_RESOLUTION_FAILED'
    )
      throw new AiUpstreamTransientError(error.message);
    throw error;
  }
};

export async function createPlatformAiBattleClient(
  knowledge: AiFrozenKnowledge,
  traces: AiBattleTraceStore,
  model: AiBattleModel,
  billing: AiBattleBilling,
  enableThinking: boolean,
  reasoningEffort?: CodexAiReasoningEffort,
  fastMode?: boolean
) {
  if (isCodexAiBattleModel(model))
    return createLocalCodexClient(
      readLocalCodexConfig(),
      model,
      knowledge,
      traces,
      billing,
      reasoningEffort,
      fastMode
    );
  return new DashScopeAiBattleClient(
    await readAiModelConfig(model, enableThinking),
    knowledge,
    traces,
    globalThis.fetch,
    Date.now,
    billing,
    validateAiUpstream
  );
}
