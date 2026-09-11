import {
  aiEffectExtractionService,
  AiEffectExtractionServiceError,
} from '../services/ai-effect-extraction-service.js';
import { AiBattleSetupError, type AiFrozenKnowledge } from './presets.js';
import { createAiModelConfig, DashScopeAiBattleClient } from './model-client.js';
import type { AiBattleModel } from '../../online/ai-battle-billing-types.js';
import type { AiBattleTraceStore } from './trace-store.js';
import type { AiBattleBilling } from './billing.js';

/** The platform singleton is the sole upstream source, including for real-model QA scripts. */
export async function readAiModelConfig(
  model: string = process.env.AI_BATTLE_MODEL ?? 'qwen3.8-flash'
) {
  try {
    return createAiModelConfig(await aiEffectExtractionService.getUpstreamConfiguration(), model);
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

export const validateAiUpstream = (endpoint: string) =>
  aiEffectExtractionService.validateOutboundUrl(endpoint);

export async function createPlatformAiBattleClient(
  knowledge: AiFrozenKnowledge,
  traces: AiBattleTraceStore,
  model: AiBattleModel,
  billing: AiBattleBilling
) {
  return new DashScopeAiBattleClient(
    await readAiModelConfig(model),
    knowledge,
    traces,
    globalThis.fetch,
    Date.now,
    billing,
    validateAiUpstream
  );
}
